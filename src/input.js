// One interaction system for Quest controllers, tracked hands and the desktop mouse.
// - point + trigger (or pinch) presses pads and grabs faders/knobs/platters
// - poking a pad with the controller tip or index fingertip presses it too
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _tip = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
const _plane = new THREE.Plane();
const _th = new THREE.Vector3(), _g = new THREE.Vector3(), _box = new THREE.Box3();

function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

export class Input {
  constructor(renderer, scene, camera, items) {
    this.r = renderer; this.camera = camera; this.items = items;
    this.onLook = null;
    const el = renderer.domElement;

    // Desktop mouse
    this.mouse = { id: 'mouse', ndc: new THREE.Vector2(), drag: null, look: null, inside: false };
    const setNdc = e => { const b = el.getBoundingClientRect(); this.mouse.ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); this.mouse.inside = true; };
    el.addEventListener('pointermove', e => {
      setNdc(e);
      const l = this.mouse.look;
      if (l) { this.onLook?.(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }
    });
    el.addEventListener('pointerdown', e => {
      setNdc(e);
      el.setPointerCapture(e.pointerId);
      const hit = this._hit(this.mouse);
      if (hit) this._begin(this.mouse, hit); else this.mouse.look = { x: e.clientX, y: e.clientY };
    });
    const up = () => { this._end(this.mouse); this.mouse.look = null; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { this.mouse.inside = false; });

    // XR controllers + hands
    const cmf = new XRControllerModelFactory(), hmf = new XRHandModelFactory();
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.xr = [0, 1].map(i => {
      const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), hand = renderer.xr.getHand(i);
      grip.add(cmf.createControllerModel(grip));
      hand.add(hmf.createHandModel(hand, 'mesh'));
      scene.add(ctrl, grip, hand);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x2be8ff, transparent: true, opacity: 0.7 }));
      ctrl.add(line);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      scene.add(dot);
      const p = { id: 'xr' + i, ctrl, grip, hand, line, dot, source: null, drag: null, poke: new Map(), direct: null, pinch: false, squeeze: false, nearUI: false };
      ctrl.addEventListener('connected', e => { p.source = e.data; });
      ctrl.addEventListener('disconnected', () => { this._end(p); if (p.direct) this._endDirect(p); p.source = null; p.dot.visible = false; });
      ctrl.addEventListener('squeezestart', () => { p.squeeze = true; });
      ctrl.addEventListener('squeezeend', () => { p.squeeze = false; });
      ctrl.addEventListener('selectstart', () => {
        if (p.direct || (p.source?.hand && p.nearUI)) return;   // hands near the desk touch things directly
        const hit = this._hit(p); if (hit) this._begin(p, hit);
      });
      ctrl.addEventListener('selectend', () => this._end(p));
      return p;
    });
  }

  _targets() {
    const out = [];
    for (const it of this.items) if (it.mesh && (!it.enabled || it.enabled()) && shown(it.mesh)) out.push(it.hit || it.mesh);
    return out;
  }

  _setRay(p) {
    if (p.id === 'mouse') { _ray.setFromCamera(p.ndc, this.camera); return; }
    p.ctrl.updateMatrixWorld();
    _o.setFromMatrixPosition(p.ctrl.matrixWorld);
    _d.set(0, 0, -1).transformDirection(p.ctrl.matrixWorld);
    _ray.set(_o, _d);
  }

  _hit(p) {
    this._setRay(p);
    _ray.far = 8;
    const h = _ray.intersectObjects(this._targets(), false)[0];
    return h ? { item: h.object.userData.item, point: h.point, distance: h.distance } : null;
  }

  // Ray hit on the drag item's surface plane, in that surface's local frame.
  _local(p, it) {
    this._setRay(p);
    const f = it.frame;
    f.updateMatrixWorld();
    _n.set(0, 1, 0).transformDirection(f.matrixWorld);
    _q.setFromMatrixPosition(f.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(_n, _q);
    if (!_ray.ray.intersectPlane(_plane, _v)) return null;
    return f.worldToLocal(_v.clone());
  }

  _begin(p, hit) {
    const it = hit.item;
    if (it.kind === 'button') { it.press(p); this.buzz(p, 0.6, 30); return; }
    p.drag = it;
    it.dragging = true;
    const l = this._local(p, it);
    if (l) it.onDragStart?.(l, p);
    this.buzz(p, 0.3, 15);
  }

  _end(p) {
    if (!p.drag) return;
    const it = p.drag; p.drag = null; it.dragging = false;
    it.onDragEnd?.(p);
  }

  buzz(p, strength, ms) {
    try { p.source?.gamepad?.hapticActuators?.[0]?.pulse?.(strength, ms); } catch {}
  }

  _poke(p) {
    if (p.source.hand) {
      const j = p.hand.joints?.['index-finger-tip'];
      if (!j) return;
      j.getWorldPosition(_tip);
    } else {
      p.ctrl.getWorldPosition(_tip);
    }
    for (const it of this.items) {
      if (it.kind !== 'button' || !it.poke || (it.enabled && !it.enabled()) || !shown(it.mesh)) continue;
      const l = it.mesh.worldToLocal(_v.copy(_tip));
      const inside = Math.abs(l.x) < it.hw + 0.012 && Math.abs(l.z) < it.hd + 0.012;
      let st = p.poke.get(it);
      if (!st) { st = { armed: false, down: false }; p.poke.set(it, st); }
      if (!inside || l.y > it.top + 0.09 || l.y < -0.06) { st.armed = false; st.down = false; continue; }
      if (l.y > it.top + 0.006) { st.armed = true; if (l.y > it.top + 0.014) st.down = false; continue; }
      if (st.armed && !st.down && l.y <= it.top + 0.006) { st.down = true; st.armed = false; it.press(p); this.buzz(p, 0.8, 35); }
    }
  }

  // Direct hand use: touch a record to spin it, pinch (or squeeze the grip) on a
  // fader/knob to move it. Works with tracked hands and with controllers.
  _direct(p) {
    let grab = null;
    if (p.source.hand) {
      const ji = p.hand.joints?.['index-finger-tip'], jt = p.hand.joints?.['thumb-tip'];
      if (!ji || !jt) return;
      ji.getWorldPosition(_tip); jt.getWorldPosition(_th);
      const d = _tip.distanceTo(_th), was = p.pinch;
      if (!p.pinch && d < 0.022) p.pinch = true; else if (p.pinch && d > 0.045) p.pinch = false;
      p.pinchStart = p.pinch && !was;
      if (p.pinch) grab = _g.copy(_tip).add(_th).multiplyScalar(0.5);
    } else {
      p.ctrl.getWorldPosition(_tip);
      p.pinchStart = p.squeeze && !p.wasSqueeze; p.wasSqueeze = p.squeeze;
      if (p.squeeze) grab = _g.copy(_tip);
    }
    p.nearUI = false;
    for (const it of this.items) {
      if (!shown(it.mesh)) continue;
      it.mesh.getWorldPosition(_v);
      if (_v.distanceToSquared(_tip) < 0.045) { p.nearUI = true; break; }
    }
    if (p.direct) {
      const it = p.direct;
      if (p.directMode === 'touch') {
        const l = it.frame.worldToLocal(_v.copy(_tip));
        if (l.y > 0.07 || Math.hypot(l.x - it.cx, l.z - it.cz) > it.r + 0.06) { this._endDirect(p); return; }
        it.onDrag?.(l, p);
      } else {
        if (!grab) { this._endDirect(p); return; }
        if (it.hold) it.onHold?.(p); else it.onDrag?.(it.frame.worldToLocal(_v.copy(grab)), p);
      }
      it.hover = true;
      return;
    }
    if (p.drag) return;
    for (const it of this.items) {
      if (!it.touch || !shown(it.mesh)) continue;
      const l = it.frame.worldToLocal(_v.copy(_tip));
      if (Math.hypot(l.x - it.cx, l.z - it.cz) < it.r && l.y > -0.02 && l.y < 0.045) { this._startDirect(p, it, 'touch', l); return; }
    }
    if (p.pinchStart && grab) {
      for (const it of this.items) {
        if (it.kind !== 'drag' || it.touch || !shown(it.mesh)) continue;
        const g = it.mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        if (_box.copy(g.boundingBox).expandByScalar(0.035).containsPoint(it.mesh.worldToLocal(_v.copy(grab)))) {
          this._startDirect(p, it, 'grab', it.frame.worldToLocal(_v.copy(grab)));
          return;
        }
      }
    }
  }
  _startDirect(p, it, mode, l) {
    p.direct = it; p.directMode = mode; it.dragging = true;
    it.onDragStart?.(l, p);
    this.buzz(p, 0.4, 20);
  }
  _endDirect(p) {
    const it = p.direct; p.direct = null; it.dragging = false;
    it.onDragEnd?.(p);
  }

  // Where a held object sits: between finger and thumb, in the controller grip,
  // or just below the view on desktop.
  holdPoint(p, out) {
    if (p.id === 'mouse') return out.set(0.1, -0.13, -0.32).applyMatrix4(this.camera.matrixWorld);
    if (p.source?.hand) {
      const ji = p.hand.joints?.['index-finger-tip'], jt = p.hand.joints?.['thumb-tip'];
      if (ji && jt) { ji.getWorldPosition(out); jt.getWorldPosition(_th); return out.add(_th).multiplyScalar(0.5); }
    }
    return p.grip.getWorldPosition(out);
  }

  update(presenting) {
    for (const it of this.items) it.hover = false;
    if (!presenting) {
      for (const p of this.xr) { p.dot.visible = false; }
      const m = this.mouse;
      if (m.drag?.hold) { m.drag.onHold?.(m); m.drag.hover = true; }
      else if (m.drag) { const l = this._local(m, m.drag); if (l) m.drag.onDrag?.(l, m); m.drag.hover = true; }
      else if (m.inside && !m.look) { const h = this._hit(m); if (h) h.item.hover = true; }
      return;
    }
    for (const p of this.xr) {
      if (!p.source) { p.line.visible = false; p.dot.visible = false; continue; }
      this._direct(p);
      if (p.direct) { p.line.visible = false; p.dot.visible = false; continue; }
      p.line.visible = !(p.source.hand && p.nearUI);
      const h = this._hit(p);
      if (p.drag?.hold) { p.drag.onHold?.(p); p.drag.hover = true; }
      else if (p.drag) {
        const l = this._local(p, p.drag);
        if (l) p.drag.onDrag?.(l, p);
        p.drag.hover = true;
      } else if (h) h.item.hover = true;
      const len = h ? h.distance : (p.source.hand ? 0.25 : 1.6);
      p.line.scale.z = len;
      p.line.material.opacity = p.source.hand ? 0.35 : 0.7;
      p.dot.visible = !!h;
      if (h) p.dot.position.copy(h.point);
      this._poke(p);
    }
  }
}
