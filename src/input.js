// One interaction system for Quest controllers, tracked hands and the desktop mouse.
// - point + trigger (or pinch) presses pads and grabs faders/knobs/platters
// - poking a pad with the controller tip or index fingertip presses it too
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3(), _tip = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3();
const _plane = new THREE.Plane();

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
      const p = { id: 'xr' + i, ctrl, grip, hand, line, dot, source: null, drag: null, poke: new Map() };
      ctrl.addEventListener('connected', e => { p.source = e.data; });
      ctrl.addEventListener('disconnected', () => { this._end(p); p.source = null; p.dot.visible = false; });
      ctrl.addEventListener('selectstart', () => { const hit = this._hit(p); if (hit) this._begin(p, hit); });
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
      const inside = Math.abs(l.x) < it.hw + 0.008 && Math.abs(l.z) < it.hd + 0.008;
      let st = p.poke.get(it);
      if (!st) { st = { armed: false, down: false }; p.poke.set(it, st); }
      if (!inside || l.y > it.top + 0.09 || l.y < -0.06) { st.armed = false; st.down = false; continue; }
      if (l.y > it.top + 0.004) { st.armed = true; if (l.y > it.top + 0.014) st.down = false; continue; }
      if (st.armed && !st.down) { st.down = true; st.armed = false; it.press(p); this.buzz(p, 0.8, 35); }
    }
  }

  update(presenting) {
    for (const it of this.items) it.hover = false;
    if (!presenting) {
      for (const p of this.xr) { p.dot.visible = false; }
      const m = this.mouse;
      if (m.drag) { const l = this._local(m, m.drag); if (l) m.drag.onDrag?.(l, m); m.drag.hover = true; }
      else if (m.inside && !m.look) { const h = this._hit(m); if (h) h.item.hover = true; }
      return;
    }
    for (const p of this.xr) {
      if (!p.source) { p.line.visible = false; p.dot.visible = false; continue; }
      p.line.visible = true;
      const h = this._hit(p);
      if (p.drag) {
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
