// Neon Booth: a WebXR DJ booth that remote-controls Spotify playback.
import * as THREE from 'three';
import * as sp from './spotify.js';
import { DemoBackend } from './demo.js';
import { Beat } from './beat.js';
import { createWorld, PYRO, CO2 } from './world.js';
import { createFX } from './fx.js';
import { HITS } from './hits.js';
import { Input } from './input.js';
import { Voice } from './voice.js';
import { makeCanvas, hsl, getImage, whenImage, ellipsize, drawCover, hueOf, fmtTime } from './ui.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SCRUB_PER_RAD = 8000 / TAU;      // one full turn of the platter = 8 seconds

// ---------------------------------------------------------------- state
const S = {
  backend: null, st: null, lastTrackId: null, queue: [], playlists: [], page: 0, devices: [],
  saved: false, baseVol: 70, volTouch: 0, xf: 0, deck: 0, transitioning: false, scrub: null,
  fx: { color: 0, laser: 0.75, speed: 0.45 }, auto: false, beams: true, dropUntil: 0, beatN: 0, fading: false, albumHue: null, cheer: 0, micHeld: null, toast: '', toastUntil: 0, errAt: {},
};
const FX = { hue: 0.86, drop: 0, playing: false };

// ---------------------------------------------------------------- renderer + scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x05010c);
const FOG = new THREE.FogExp2(0x07010f, 0.012);
scene.background = BG; scene.fog = FOG;

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 220);
camera.rotation.order = 'YXZ';
let yaw = 0, pitch = -0.6;
const desktopCam = () => camera.position.set(0, 1.5, 0.35);
desktopCam();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0x9a7cff, 0x14001f, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9); keyLight.position.set(0.5, 3, 1.5); scene.add(keyLight);
const boothLight = new THREE.PointLight(0xff2bd6, 2.5, 4, 1.5); boothLight.position.set(0, 1.7, -0.95); scene.add(boothLight);

const world = createWorld(scene);
const fx = createFX(world.show, { pyro: PYRO, co2: CO2 });
const beat = new Beat();
const items = [];
const input = new Input(renderer, scene, camera, items);
input.onLook = (dx, dy) => { yaw -= dx * 0.004; pitch = clamp(pitch - dy * 0.004, -1.35, 1.1); };

// ---------------------------------------------------------------- materials + builders
const metal = new THREE.MeshStandardMaterial({ color: 0x1c1a26, metalness: 0.55, roughness: 0.42 });
const dark = new THREE.MeshStandardMaterial({ color: 0x09080d, metalness: 0.2, roughness: 0.7 });
const hidden = new THREE.MeshBasicMaterial({ visible: false });
const neonA = [], neonB = [];
const neon = (alt = false) => { const m = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }); (alt ? neonB : neonA).push(m); return m; };

function drawPadLabel(cv, text, sub) {
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(6, 6, w - 12, h - 12, 22); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 12;
  const size = text.length <= 2 ? h * 0.46 : text.length <= 5 ? Math.min(h * 0.3, w * 0.2) : Math.min(h * 0.22, w * 0.15);
  ctx.font = `900 ${size}px system-ui,sans-serif`;
  ctx.fillText(ellipsize(ctx, text, w - 28), w / 2, sub ? h * 0.42 : h / 2);
  if (sub) {
    ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.font = `700 ${Math.min(h * 0.16, w * 0.1)}px system-ui,sans-serif`;
    ctx.fillText(ellipsize(ctx, sub, w - 28), w / 2, h * 0.74);
  }
  ctx.shadowBlur = 0;
  cv.update();
}

function makePad(parent, { x, z, w = 0.085, d = 0.085, label = '', sub = '', color = 0xff2bd6, onPress, poke = true }) {
  const h = 0.02;
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, h / 2, z); parent.add(mesh);
  const cv = makeCanvas(256, Math.max(64, Math.round(256 * d / w)));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.94, d * 0.94), new THREE.MeshBasicMaterial({ map: cv.tex, transparent: true, toneMapped: false }));
  face.rotation.x = -Math.PI / 2; face.position.y = h / 2 + 0.0008; mesh.add(face);
  const it = {
    kind: 'button', mesh, hw: w / 2, hd: d / 2, top: h / 2, poke, cv, base: new THREE.Color(color), lit: false, flash: 0, hover: false,
    label(t, s) { drawPadLabel(cv, t, s); },
    press(p) { this.flash = 1; onPress?.(p, this); },
    tick(dt) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      const k = (this.lit ? 1 : 0.32) + (this.hover ? 0.2 : 0) + this.flash * 0.9;
      mat.color.copy(this.base).multiplyScalar(k);
      mesh.position.y = h / 2 - this.flash * 0.007;
    },
  };
  mesh.userData.item = it; items.push(it);
  if (label) it.label(label, sub);
  return it;
}

function makeText(parent, text, x, z, w, h, { color = '#d9c8ff', y = 0.0012, size = 0.62 } = {}) {
  const cv = makeCanvas(256, Math.max(32, Math.round(256 * h / w)));
  const { ctx } = cv;
  ctx.fillStyle = color; ctx.font = `800 ${cv.h * size}px system-ui,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cv.w / 2, cv.h / 2); cv.update();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: cv.tex, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); parent.add(m);
  return m;
}

function makeKnob(parent, { x, z, label, value = 0.5, onChange }) {
  const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.026, 28), metal); cap.position.y = 0.013; g.add(cap);
  const ind = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.002, 0.02), neon(true)); ind.position.set(0, 0.0135, -0.014); cap.add(ind);
  const ringBase = new THREE.Mesh(new THREE.RingGeometry(0.034, 0.038, 40, 1, -Math.PI / 4, Math.PI * 1.5), neon()); ringBase.rotation.x = -Math.PI / 2; ringBase.position.y = 0.001; g.add(ringBase);
  makeText(parent, label, x, z + 0.052, 0.09, 0.02);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16), hidden); hit.position.y = 0.02; g.add(hit);
  const it = {
    kind: 'drag', mesh: hit, frame: parent, value,
    onDragStart(l) { this.s = l.clone(); this.v0 = this.value; },
    onDrag(l) { this.value = clamp(this.v0 + (l.x - this.s.x) * 6 - (l.z - this.s.z) * 6, 0, 1); onChange?.(this.value); },
    tick() { cap.rotation.y = -(this.value - 0.5) * 1.5 * Math.PI; cap.scale.setScalar(this.hover || this.dragging ? 1.1 : 1); },
  };
  hit.userData.item = it; items.push(it);
  return it;
}

function makeFader(parent, { axis, at, from, to, value = 0, onChange, onEnd }) {
  const len = Math.abs(to - from), mid = (from + to) / 2, along = axis === 'z';
  const box = (a, b, c) => along ? new THREE.BoxGeometry(a, b, c) : new THREE.BoxGeometry(c, b, a);
  const slot = new THREE.Mesh(box(0.012, 0.004, len + 0.02), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  if (along) slot.position.set(at, 0.002, mid); else slot.position.set(mid, 0.002, at);
  parent.add(slot);
  const glow = new THREE.Mesh(box(0.003, 0.001, len), neon());
  glow.position.copy(slot.position); glow.position.y = 0.0045; parent.add(glow);
  const cap = new THREE.Mesh(box(0.05, 0.024, 0.026), metal); parent.add(cap);
  const capLine = new THREE.Mesh(box(0.052, 0.002, 0.004), new THREE.MeshBasicMaterial({ color: 0xffffff })); capLine.position.y = 0.0125; cap.add(capLine);
  const hit = new THREE.Mesh(box(0.08, 0.05, len + 0.06), hidden); hit.position.copy(slot.position); hit.position.y = 0.02; parent.add(hit);
  const it = {
    kind: 'drag', mesh: hit, frame: parent, value,
    onDragStart(l) { this.onDrag(l); },
    onDrag(l) { this.value = clamp(((along ? l.z : l.x) - from) / (to - from), 0, 1); onChange?.(this.value); },
    onDragEnd() { onEnd?.(this.value); },
    tick() {
      const c = from + (to - from) * this.value;
      if (along) cap.position.set(at, 0.014, c); else cap.position.set(c, 0.014, at);
      cap.scale.setScalar(this.hover || this.dragging ? 1.08 : 1);
    },
  };
  hit.userData.item = it; items.push(it);
  return it;
}

// A vertical panel whose local +y faces the user (pads sit on it like on the desk).
function makePanel(parent, { pos, yaw = 0, lean = 0.3, w, h, title }) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw; parent.add(g);
  const face = new THREE.Group(); face.rotation.x = Math.PI / 2 - lean; g.add(face);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, h), metal); back.position.y = -0.007; face.add(back);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.012, h)), new THREE.LineBasicMaterial({ color: 0xff2bd6 }));
  edge.position.y = -0.007; face.add(edge); edgeLines.push(edge.material);
  if (title) makeText(face, title, 0, -h / 2 + 0.03, w * 0.9, 0.035, { color: '#ffffff' });
  return { g, face };
}
const edgeLines = [];

// ---------------------------------------------------------------- the booth
const booth = new THREE.Group(); booth.position.set(0, 0, -0.5); scene.add(booth);
const top = new THREE.Group(); top.rotation.x = 0.14; booth.add(top);   // desk surface, tilted toward you

const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 0.52), metal); booth.add(body);
const bodyEdges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0xff2bd6 }));
body.add(bodyEdges); edgeLines.push(bodyEdges.material);

{
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.05, 0.68), metal); slab.position.y = -0.025; top.add(slab);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.002, 0.64), dark); plate.position.y = 0.0005; top.add(plate);
  for (const [w, d, x, z] of [[1.58, 0.008, 0, 0.342], [1.58, 0.008, 0, -0.342], [0.008, 0.68, 0.792, 0], [0.008, 0.68, -0.792, 0]]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, d), neon(z < 0)); s.position.set(x, -0.006, z); top.add(s);
  }
}

// Platters: deck A on the left, deck B on the right. The ON AIR deck plays now;
// the other one holds what's up next in your queue.
const groove = (() => {
  const cv = makeCanvas(512, 512), { ctx } = cv;
  ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, 512, 512);
  for (let r = 70; r < 256; r += 3) {
    ctx.strokeStyle = `rgba(255,255,255,${0.025 + 0.045 * Math.random()})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(256, 256, r, 0, TAU); ctx.stroke();
  }
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(0, 256, 256);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.1, 'rgba(255,255,255,.12)'); g.addColorStop(0.2, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,.12)'); g.addColorStop(0.7, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(256, 256, 255, 0, TAU); ctx.fill();
  }
  cv.update(); return cv.tex;
})();

const decks = [0, 1].map(i => {
  const x = i ? 0.47 : -0.47, z = -0.055;
  const g = new THREE.Group(); g.position.set(x, 0, z); top.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.008, 48), dark); base.position.y = 0.004; g.add(base);
  const spin = new THREE.Group(); spin.position.y = 0.008; g.add(spin);
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.01, 64), [
    new THREE.MeshStandardMaterial({ color: 0x030305, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ map: groove, roughness: 0.28, metalness: 0.35 }), dark]);
  vinyl.position.y = 0.005; spin.add(vinyl);
  const lab = makeCanvas(256, 256);
  const label = new THREE.Mesh(new THREE.CircleGeometry(0.064, 48), new THREE.MeshBasicMaterial({ map: lab.tex, toneMapped: false }));
  label.rotation.x = -Math.PI / 2; label.position.y = 0.0102; spin.add(label);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0012, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  mark.position.set(0, 0.0105, -0.11); spin.add(mark);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.168, 0.18, 72), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0085; g.add(ring);
  const tag = makeCanvas(512, 112);
  const tagMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.0745), new THREE.MeshBasicMaterial({ map: tag.tex, transparent: true, toneMapped: false }));
  tagMesh.position.set(0, 0.045, -0.215); tagMesh.rotation.x = -0.45; g.add(tagMesh);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.04, 24), hidden); hit.position.y = 0.02; g.add(hit);
  const it = {
    kind: 'drag', touch: true, cx: x, cz: z, r: 0.175, mesh: hit, frame: top, i, spin, ring, ringMat, lab, tag, track: undefined, role: null, frac: -1, acc: 0, a0: 0,
    ang(l) { return Math.atan2(l.z - z, l.x - x); },
    onDragStart(l) {
      this.a0 = this.ang(l); this.acc = 0;
      if (S.deck === i && S.st?.track) S.scrub = { deck: i, start: progressNow(), ms: progressNow() };
    },
    onDrag(l) {
      const a = this.ang(l);
      const d = ((a - this.a0 + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.a0 = a; this.acc += d; spin.rotation.y -= d;
      if (S.scrub?.deck === i) {
        const dur = S.st?.track?.durationMs || 0;
        S.scrub.ms = clamp(S.scrub.start + this.acc * SCRUB_PER_RAD, 0, Math.max(0, dur - 1500));
      }
    },
    onDragEnd() {
      if (S.scrub?.deck !== i) return;
      const ms = S.scrub.ms; S.scrub = null;
      if (S.st) { S.st.progressMs = ms; S.st.fetchedAt = performance.now(); }
      act(b => b.seek(ms), 700);
    },
  };
  hit.userData.item = it; items.push(it);
  return it;
});

function setRing(dk, frac) {
  frac = clamp(frac, 0, 1);
  if (Math.abs(frac - dk.frac) < 0.002) return;
  dk.frac = frac;
  const L = Math.max(0.0005, frac) * TAU;
  dk.ring.geometry.dispose();
  dk.ring.geometry = new THREE.RingGeometry(0.168, 0.18, 72, 1, Math.PI / 2 - L, L);
}

function drawDeck(dk) {
  const t = dk.track;
  const { ctx } = dk.lab;
  ctx.clearRect(0, 0, 256, 256);
  ctx.save(); ctx.beginPath(); ctx.arc(128, 128, 128, 0, TAU); ctx.clip();
  if (t) drawCover(ctx, getImage(t.art), 0, 0, 256, 256, t.name, FX.hue);
  else { ctx.fillStyle = '#16121f'; ctx.fillRect(0, 0, 256, 256); }
  ctx.restore();
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(128, 128, 9, 0, TAU); ctx.fill();
  dk.lab.update();

  const g = dk.tag, c = g.ctx, live = dk.i === S.deck;
  c.clearRect(0, 0, g.w, g.h);
  c.fillStyle = 'rgba(8,2,16,.78)'; c.beginPath(); c.roundRect(0, 0, g.w, g.h, 18); c.fill();
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillStyle = live ? '#ff4fe0' : '#4feaff'; c.font = '900 30px system-ui,sans-serif';
  c.fillText(`DECK ${dk.i ? 'B' : 'A'}  ·  ${live ? 'ON AIR' : 'UP NEXT'}`, 16, 10);
  c.fillStyle = '#fff'; c.font = '800 40px system-ui,sans-serif';
  c.fillText(ellipsize(c, t ? t.name : (live ? 'Nothing playing' : 'Queue empty'), g.w - 32), 16, 54);
  g.update();
}

function updateDecks() {
  const want = [null, null];
  want[S.deck] = S.st?.track || null;
  want[1 - S.deck] = S.queue[0] || null;
  decks.forEach((dk, i) => {
    const t = want[i], role = i === S.deck ? 'live' : 'next';
    if (dk.track?.id === t?.id && dk.track !== undefined && dk.role === role) return;
    dk.track = t; dk.role = role; drawDeck(dk);
    if (t?.art) whenImage(t.art).then(() => { if (dk.track?.id === t.id) drawDeck(dk); });
  });
}

// Deck pads
const padPlay = makePad(top, { x: -0.47, z: 0.215, w: 0.09, d: 0.09, label: '▶', sub: 'PLAY', color: 0x39ff88, onPress: () => playPause() });
makePad(top, { x: -0.58, z: 0.215, w: 0.09, d: 0.09, label: '◀◀', sub: 'BACK', color: 0xff2bd6, onPress: () => act(b => b.prev()) });
makePad(top, { x: -0.36, z: 0.215, w: 0.09, d: 0.09, label: '▶▶', sub: 'SKIP', color: 0xff2bd6, onPress: () => act(b => b.next()) });
const padShuf = makePad(top, { x: 0.36, z: 0.215, w: 0.09, d: 0.09, label: 'SHUF', sub: 'off', color: 0x2be8ff, onPress: () => toggleShuffle() });
const padRep = makePad(top, { x: 0.47, z: 0.215, w: 0.09, d: 0.09, label: 'LOOP', sub: 'off', color: 0x2be8ff, onPress: () => cycleRepeat() });
const padLike = makePad(top, { x: 0.58, z: 0.215, w: 0.09, d: 0.09, label: '♥', sub: 'SAVE', color: 0xff3366, onPress: () => toggleLike() });

// Mixer
const volFader = makeFader(top, {
  axis: 'z', at: -0.2, from: 0.125, to: -0.115, value: 0.7,
  onChange: v => { S.baseVol = Math.round(v * 100); S.volTouch = performance.now(); pushVolume(); },
  onEnd: () => pushVolume(true),
});
makeText(top, 'VOL', -0.2, 0.16, 0.06, 0.02);
const xFader = makeFader(top, {
  axis: 'x', at: 0.185, from: -0.13, to: 0.13, value: 0,
  onChange: v => { S.xf = v; S.volTouch = performance.now(); crossfade(); },
  onEnd: () => pushVolume(true),
});
makeText(top, 'A', -0.162, 0.185, 0.03, 0.03, { color: '#ff4fe0' });
makeText(top, 'B', 0.162, 0.185, 0.03, 0.03, { color: '#4feaff' });
makeText(top, 'SLIDE ACROSS TO MIX THE NEXT TRACK', 0, 0.228, 0.26, 0.016, { size: 0.7 });

makeKnob(top, { x: -0.1, z: -0.205, label: 'COLOR', value: 0, onChange: v => { S.fx.color = v; } });
makeKnob(top, { x: 0.0, z: -0.205, label: 'LASERS', value: S.fx.laser, onChange: v => { S.fx.laser = v; } });
makeKnob(top, { x: 0.1, z: -0.205, label: 'SPEED', value: S.fx.speed, onChange: v => { S.fx.speed = v; } });

const padTap = makePad(top, { x: -0.1, z: -0.085, w: 0.075, d: 0.075, label: 'TAP', sub: '124 BPM', color: 0xffb02b, onPress: () => { const b = beat.tap(); padTap.label('TAP', b + ' BPM'); } });
const padMic = makePad(top, { x: 0.0, z: -0.085, w: 0.075, d: 0.075, label: 'MIC', sub: 'off', color: 0xffb02b, onPress: () => toggleMic() });
makePad(top, { x: 0.1, z: -0.085, w: 0.075, d: 0.075, label: 'DROP', sub: '8 sec', color: 0xff2b4f, onPress: () => longDrop() });
makePad(top, { x: -0.1, z: 0.02, w: 0.075, d: 0.075, label: 'DEVICE', sub: 'speaker', color: 0x8b5cff, onPress: () => toggleDevices() });
makePad(top, { x: 0.0, z: 0.02, w: 0.075, d: 0.075, label: '▲', sub: 'desk up', color: 0x6a6a8a, onPress: () => setDeskH(deskH + 0.03) });
makePad(top, { x: 0.1, z: 0.02, w: 0.075, d: 0.075, label: '▼', sub: 'desk down', color: 0x6a6a8a, onPress: () => setDeskH(deskH - 0.03) });

// ---------------------------------------------------------------- MC mic
// Pick it up (pinch it, squeeze the grip, or point and pull the trigger), talk, and the
// crowd answers when you stop. Only listens while it's in your hand.
const voice = new Voice();
const MIC_STAND = new THREE.Vector3(0.73, 0.145, -0.22);
const micGlow = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
const mic = new THREE.Group(); scene.add(mic);
{
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0105, 0.14, 16), dark); handle.position.y = -0.072; mic.add(handle);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.0145, 0.022, 18), metal); collar.position.y = 0.006; mic.add(collar);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0168, 0.0028, 8, 28), micGlow); ring.rotation.x = Math.PI / 2; ring.position.y = 0.017; mic.add(ring);
  const grille = new THREE.Mesh(new THREE.SphereGeometry(0.028, 20, 14), new THREE.MeshStandardMaterial({ color: 0xb8b8c8, metalness: 0.85, roughness: 0.4 }));
  grille.position.y = 0.04; mic.add(grille);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.0285, 12, 8), new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.5 }));
  mesh.position.y = 0.04; mic.add(mesh);
  const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.02, 24), metal); cradle.position.set(MIC_STAND.x, 0.01, MIC_STAND.z); top.add(cradle);
  const cradleRing = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.002, 6, 32), neon(true)); cradleRing.rotation.x = Math.PI / 2; cradleRing.position.set(MIC_STAND.x, 0.021, MIC_STAND.z); top.add(cradleRing);
  makeText(top, 'MC MIC', MIC_STAND.x, MIC_STAND.z + 0.06, 0.07, 0.018, { color: '#ffd27a' });
}
const micHit = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.075), hidden); micHit.position.y = -0.03; mic.add(micHit);
const UP = new THREE.Vector3(0, 1, 0), _mp = new THREE.Vector3(), _md = new THREE.Vector3(), _mq = new THREE.Quaternion();
const micItem = {
  kind: 'drag', hold: true, mesh: micHit, frame: top,
  onDragStart(l, p) { grabMic(p); },
  onHold(p) {
    input.holdPoint(p, _mp);
    mic.position.lerp(_mp, 0.7);
    _md.setFromMatrixPosition(camera.matrixWorld).sub(mic.position).normalize();
    _mq.setFromUnitVectors(UP, _md);
    mic.quaternion.slerp(_mq, 0.5);
  },
  onDragEnd() { dropMic(); },
};
micHit.userData.item = micItem; items.push(micItem);

function grabMic(p) {
  S.micHeld = p.id;
  voice.wake();
  if (voice.micOn) { toast('Mic is live - talk to the crowd'); return; }
  voice.enableMic().then(ok => {
    if (!S.micHeld) { voice.disableMic(); return; }
    toast(ok ? 'Mic is live - talk to the crowd' : 'Mic blocked: exit VR, allow the microphone for this site, grab it again');
  });
}
function dropMic() { S.micHeld = null; voice.disableMic(); }
function micTick(dt) {
  if (!S.micHeld) {      // glide back to the cradle
    top.updateMatrixWorld();
    _mp.copy(MIC_STAND).applyMatrix4(top.matrixWorld);
    top.getWorldQuaternion(_mq);
    mic.position.lerp(_mp, Math.min(1, dt * 10));
    mic.quaternion.slerp(_mq, Math.min(1, dt * 10));
  } else voice.update(dt);
  const lv = voice.talking ? 1 : clamp((voice.level - voice.floor) * 6, 0, 1);
  micGlow.color.setHSL(FX.hue, 1, 0.35 + 0.35 * lv).multiplyScalar(S.micHeld ? 1 + lv * 1.5 : 0.6);
  mic.scale.setScalar(micItem.hover && !S.micHeld ? 1.1 : 1);
}
voice.onStart = () => { S.listenSince = performance.now(); };
voice.onEnd = dur => {
  if (dur < 0.3) return;
  const size = clamp(0.35 + dur * 0.1 + (voice.peak - voice.floor - 0.11) * 2, 0.3, 1);
  hype(size);
};
// The crowd answers: a roar you can hear, everyone jumping, and pyro on the big ones.
function hype(size) {
  S.cheer = Math.max(S.cheer, size);
  voice.cheer(size);
  if (size > 0.6) { fx.fire(0.6 + size); fx.co2(1); }
  if (size > 0.85) fx.fireworks(4, 2.5, FX.hue);
  toast(size > 0.85 ? 'The whole stadium is screaming' : size > 0.6 ? 'Crowd goes wild' : 'Crowd cheers');
}

// Little LCD above the mixer
const lcd = makeCanvas(640, 140);
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.1), new THREE.MeshBasicMaterial({ map: lcd.tex, toneMapped: false }));
  m.position.set(0, 0.07, -0.305); m.rotation.x = -0.35; top.add(m);
}

// Crate: your playlists, 8 per page, to the left of the booth
const crate = makePanel(booth, { pos: new THREE.Vector3(-0.98, 1.27, 0.14), yaw: 1.1, lean: 0.35, w: 0.62, h: 0.5, title: 'CRATE  ·  YOUR PLAYLISTS' });
const cratePads = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
  const pad = makePad(crate.face, { x: -0.21 + c * 0.14, z: -0.115 + r * 0.14, w: 0.125, d: 0.125, color: 0xffffff, onPress: () => {
    if (!pad.pl) return;
    toast('Playing ' + pad.pl.name);
    const pl = pad.pl;
    act(b => pl.uris ? b.playUris(pl.uris) : b.playContext(pl.uri), 700);
  } });
  pad.cv = makeCanvas(256, 256);
  pad.mesh.children[0].material.map = pad.cv.tex;
  cratePads.push(pad);
}
makePad(crate.face, { x: -0.2, z: 0.19, w: 0.12, d: 0.055, label: '◀', color: 0x8b5cff, onPress: () => turnPage(-1) });
makePad(crate.face, { x: 0.2, z: 0.19, w: 0.12, d: 0.055, label: '▶', color: 0x8b5cff, onPress: () => turnPage(1) });
const pageCv = makeCanvas(256, 64);
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: pageCv.tex, transparent: true, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.002, 0.19); crate.face.add(m);
}

function drawHitsTile(ctx) {
  const g = ctx.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, '#ff2a00'); g.addColorStop(0.45, '#ff8a00'); g.addColorStop(1, '#2a0040');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(255,240,180,.9)';
  for (let k = 0; k < 7; k++) {          // little flame tongues
    const x = 18 + k * 37, h = 70 + (k % 3) * 28;
    ctx.beginPath(); ctx.moveTo(x - 16, 256); ctx.quadraticCurveTo(x - 10, 256 - h * 0.6, x, 256 - h); ctx.quadraticCurveTo(x + 10, 256 - h * 0.6, x + 16, 256); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.font = '900 44px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('VIRAL', 128, 60); ctx.fillText('HOUSE', 128, 108);
}
function drawCratePad(pad) {
  const pl = pad.pl, { ctx } = pad.cv;
  ctx.clearRect(0, 0, 256, 256);
  if (!pl) { ctx.fillStyle = '#120d1c'; ctx.fillRect(0, 0, 256, 256); pad.cv.update(); pad.base.setRGB(0.35, 0.3, 0.45); return; }
  if (pl.hits) drawHitsTile(ctx); else drawCover(ctx, getImage(pl.art), 0, 0, 256, 256, pl.name, FX.hue);
  const g = ctx.createLinearGradient(0, 150, 0, 256); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
  ctx.fillStyle = g; ctx.fillRect(0, 150, 256, 106);
  ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(ellipsize(ctx, pl.name, 232), 12, 244);
  pad.cv.update();
  pad.base.setRGB(1, 1, 1);
}
function renderCrate() {
  const pages = Math.max(1, Math.ceil(S.playlists.length / 8));
  S.page = ((S.page % pages) + pages) % pages;
  cratePads.forEach((pad, k) => {
    const pl = S.playlists[S.page * 8 + k] || null;
    pad.pl = pl; pad.lit = !!pl; drawCratePad(pad);
    if (pl?.art) whenImage(pl.art).then(() => { if (pad.pl === pl) drawCratePad(pad); });
  });
  const { ctx } = pageCv; ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = '#d9c8ff'; ctx.font = '800 34px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(S.playlists.length ? `${S.page + 1} / ${pages}` : 'no playlists', 128, 32); pageCv.update();
}
function turnPage(d) { S.page += d; renderCrate(); }

// Device picker, pops up over the mixer
const devPanel = makePanel(booth, { pos: new THREE.Vector3(0, 1.4, -0.2), yaw: 0, lean: 0.25, w: 0.56, h: 0.46, title: 'PLAY ON WHICH SPEAKER?' });
devPanel.g.visible = false;
const devPads = [0, 1, 2, 3, 4].map(k => makePad(devPanel.face, { x: 0, z: -0.14 + k * 0.072, w: 0.5, d: 0.06, color: 0x8b5cff, onPress: (p, pad) => {
  if (!pad.dev) return;
  devPanel.g.visible = false;
  toast('Switching to ' + pad.dev.name);
  act(b => b.transfer(pad.dev.id), 1200);
} }));
makePad(devPanel.face, { x: 0, z: 0.2, w: 0.2, d: 0.04, label: 'CLOSE', color: 0x6a6a8a, onPress: () => { devPanel.g.visible = false; } });

async function toggleDevices() {
  if (!S.backend) return toast('Connect Spotify first');
  if (devPanel.g.visible) { devPanel.g.visible = false; return; }
  devPanel.g.visible = true;
  devPads.forEach(p => { p.dev = null; p.lit = false; p.label('Looking for speakers…'); });
  try { S.devices = await S.backend.getDevices(); } catch (e) { handleErr(e); S.devices = []; }
  devPads.forEach((p, k) => {
    const d = S.devices[k];
    p.dev = d || null; p.lit = !!d?.active;
    if (d) p.label(d.name, (d.active ? 'playing here · ' : '') + d.type);
    else p.label(k === 0 ? 'No speakers found' : '', k === 0 ? 'Open Spotify on your phone or Mac first' : '');
  });
}

// FX: fire and light cannons, to the right of the booth
const fxPanel = makePanel(booth, { pos: new THREE.Vector3(0.98, 1.27, 0.14), yaw: -1.1, lean: 0.35, w: 0.62, h: 0.5, title: 'FX  ·  FIRE & LIGHTS' });
const fxDefs = [
  ['FIRE', 'flames', 0xff6a00, () => fx.fire(2.5)],
  ['CO2', 'jets', 0x9fe8ff, () => fx.co2(2.5)],
  ['BOOM', 'fireworks', 0xffd400, () => fx.fireworks(10, 6)],
  ['DROP', '8 seconds', 0xff2b4f, () => longDrop()],
  ['AUTO', 'fire on beat', 0xff2bd6, () => { S.auto = !S.auto; toast(S.auto ? 'Auto pyro on: fire every bar' : 'Auto pyro off'); }],
  ['BEAMS', 'sky lights', 0x2be8ff, () => { S.beams = !S.beams; }],
];
const fxPads = fxDefs.map(([label, sub, color, fn], k) => {
  const pad = makePad(fxPanel.face, { x: -0.195 + (k % 3) * 0.195, z: -0.085 + Math.floor(k / 3) * 0.17, w: 0.17, d: 0.14, label, sub, color, onPress: fn });
  pad.lit = true;
  return pad;
});
const padAuto = fxPads[4], padBeams = fxPads[5];

// Big LED screen over the dance floor
const scr = makeCanvas(1024, 576);
{
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.19), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false, fog: false }));
  screen.position.set(0, 4.8, -9); screen.scale.setScalar(1.7); scene.add(screen);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.02, 2.31, 0.06), dark); frame.position.set(0, 4.8, -9.06); frame.scale.set(1.7, 1.7, 1); scene.add(frame);
}

let deskH = 0.95;
try { deskH = Number(localStorage.getItem('neonbooth.deskH')) || 0.95; } catch {}
function setDeskH(h) {
  deskH = clamp(h, 0.55, 1.3);
  top.position.y = deskH;
  body.scale.y = Math.max(0.1, deskH - 0.07);
  body.position.set(0, (deskH - 0.07) / 2, -0.04);
  crate.g.position.y = deskH + 0.32;
  devPanel.g.position.y = deskH + 0.45;
  fxPanel.g.position.y = deskH + 0.32;
  try { localStorage.setItem('neonbooth.deskH', String(deskH)); } catch {}
}
setDeskH(deskH);

// ---------------------------------------------------------------- Spotify glue
function toast(msg) { S.toast = msg; S.toastUntil = performance.now() + 2800; }

function handleErr(e, quiet = false) {
  console.warn(e);
  const r = e?.reason || '', st = e?.status;
  let msg;
  if (st === 404 || r === 'NO_ACTIVE_DEVICE') msg = 'No speaker is active. Press DEVICE to pick one.';
  else if (r === 'PREMIUM_REQUIRED' || (st === 403 && /premium/i.test(e.message))) msg = 'Spotify Premium is needed to control playback';
  else if (r === 'VOLUME_CONTROL_DISALLOW') msg = 'This speaker does not allow remote volume';
  else if (st === 401) msg = 'Spotify login expired. Reconnect in the menu.';
  else if (st === 429) msg = 'Spotify says slow down - try again in a sec';
  else msg = e?.message || 'Spotify error';
  const now = performance.now();
  if (quiet && now - (S.errAt[msg] || 0) < 15000) return;
  S.errAt[msg] = now;
  toast(msg);
}

async function act(fn, after = 400) {
  if (!S.backend) { toast('Connect Spotify (or start the demo) in the menu'); return; }
  try { await fn(S.backend); } catch (e) { handleErr(e); }
  setTimeout(poll, after);
}

function progressNow() {
  const st = S.st;
  if (!st?.track) return 0;
  if (S.scrub) return S.scrub.ms;
  const p = st.progressMs + (st.isPlaying ? performance.now() - st.fetchedAt : 0);
  return Math.min(p, st.track.durationMs || p);
}

function playPause() {
  const was = !!S.st?.isPlaying;
  if (S.st) { S.st.progressMs = progressNow(); S.st.fetchedAt = performance.now(); S.st.isPlaying = !was; }
  act(b => was ? b.pause() : b.play());
}
function toggleShuffle() { const on = !S.st?.shuffle; if (S.st) S.st.shuffle = on; act(b => b.shuffle(on)); toast(on ? 'Shuffle on' : 'Shuffle off'); }
function cycleRepeat() {
  const order = ['off', 'context', 'track'];
  const m = order[(order.indexOf(S.st?.repeat || 'off') + 1) % 3];
  if (S.st) S.st.repeat = m;
  act(b => b.repeat(m));
  toast({ off: 'Loop off', context: 'Looping the playlist', track: 'Looping this track' }[m]);
}
function toggleLike() {
  const t = S.st?.track; if (!t) return toast('Nothing playing to save');
  S.saved = !S.saved;
  toast(S.saved ? 'Saved to your library' : 'Removed from your library');
  act(b => S.saved ? b.save(t.uri) : b.unsave(t.uri), 300);
}
async function toggleMic() {
  if (beat.micOn) { beat.disableMic(); $('mic').checked = false; toast('Mic off - lights follow the tap tempo'); return; }
  const ok = await beat.enableMic();
  $('mic').checked = ok;
  toast(ok ? 'Mic on - lights follow the music in the room' : 'Mic blocked - allow it in the browser');
}

// Volume follows the master fader times the crossfader curve. Remote volume calls are
// slow, so they are throttled; the last value always goes out.
let volSentAt = 0, volPending = false, lastVol = -1;
const targetVol = () => S.baseVol;
function pushVolume(force = false) {
  if (!S.backend || !S.st?.device || S.fading) return;
  if (S.st.device.supportsVolume === false) { handleErr({ reason: 'VOLUME_CONTROL_DISALLOW' }, true); return; }
  const now = performance.now();
  if (!force && now - volSentAt < 250) { volPending = true; return; }
  volSentAt = now; volPending = false;
  const v = targetVol();
  if (v === lastVol && !force) return;
  lastVol = v;
  S.backend.volume(v).catch(e => handleErr(e, true));
}

// Sliding the crossfader across fades the ON AIR deck down; past the far side the
// next track drops in at full volume and the decks swap roles.
// Crossing the middle of the crossfader starts a real mix: the volume ramps down over
// ~3 s, the next track drops in, and the volume ramps back up. Spotify only lets us
// change volume in steps, and phones/some speakers block remote volume entirely.
const sleep = ms => new Promise(r => setTimeout(r, ms));
function crossfade() {
  if (S.transitioning || !S.st?.track || Math.abs(S.xf - S.deck) < 0.5) return;
  mixToNext();
}
async function mixToNext() {
  S.transitioning = true;
  const b = S.backend, nextDeck = 1 - S.deck, from = S.baseVol;
  const canFade = S.st?.device?.supportsVolume !== false;
  try {
    if (canFade) {
      S.fading = true;
      toast(`Mixing into deck ${nextDeck ? 'B' : 'A'}…`);
      for (let k = 1; k <= 8; k++) {
        const v = Math.round(from * Math.pow(1 - k / 8, 1.3));
        S.mixVol = v;
        await b.volume(v).catch(() => {});
        await sleep(330);
      }
    } else {
      toast('This speaker blocks volume, so it can only cut. Use the Mac or a computer to hear fades.');
    }
    await b.next();
    S.deck = nextDeck;
    if (S.queue[0] && S.st) { S.st.track = S.queue.shift(); S.st.progressMs = 0; S.st.fetchedAt = performance.now(); }
    fx.fire(1.2); fx.co2(1.5); FX.drop = 1;
    S.cheer = Math.max(S.cheer, 0.6); voice.cheer(0.5);
    if (canFade) {
      for (let k = 1; k <= 6; k++) {
        const v = Math.round(from * (k / 6));
        S.mixVol = v;
        await b.volume(v).catch(() => {});
        await sleep(280);
      }
    }
    toast(`Deck ${nextDeck ? 'B' : 'A'} is on air`);
  } catch (e) {
    handleErr(e);
    if (canFade) b.volume(from).catch(() => {});
  } finally {
    S.fading = false; S.mixVol = null; S.transitioning = false;
    S.volTouch = performance.now();
    setTimeout(poll, 400);
  }
}

function longDrop() {
  S.dropUntil = performance.now() + 8000;
  fx.co2(2); fx.fire(1); fx.fireworks(8, 7, FX.hue);
  S.cheer = 1; voice.cheer(0.8);
  toast('DROP!');
}

let polling = false;
async function poll() {
  if (!S.backend || polling) return;
  polling = true;
  const b = S.backend;
  try {
    const st = await b.getState();
    if (b !== S.backend) return;
    S.st = st;
    const id = st?.track?.id || null;
    if (id !== S.lastTrackId) { S.lastTrackId = id; onTrackChange(); }
    const d = st?.device;
    if (d?.volume != null && !volFader.dragging && !xFader.dragging && performance.now() - S.volTouch > 4000 && !S.fading) {
      S.baseVol = d.volume; volFader.value = d.volume / 100;
    }
  } catch (e) { handleErr(e, true); } finally { polling = false; }
}
async function refreshQueue() {
  if (!S.backend) return;
  try { S.queue = (await S.backend.getQueue()).filter(Boolean); } catch (e) { handleErr(e, true); }
}
async function onTrackChange() {
  refreshQueue();
  const t = S.st?.track;
  S.saved = false;
  if (!t) return;
  whenImage(t.art).then(img => { if (S.st?.track?.id === t.id) S.albumHue = img ? hueOf(img) : null; });
  try { const saved = await S.backend.isSaved(t.uri); if (S.st?.track?.id === t.id) S.saved = saved; } catch {}
}
setInterval(poll, 1500);
setInterval(refreshQueue, 7000);

async function useBackend(b) {
  S.backend = b; S.st = null; S.lastTrackId = null; S.queue = []; S.page = 0;
  S.playlists = [];
  renderCrate();
  poll();
  S.playlists = [HITS];
  renderCrate();
  try { S.playlists = [HITS, ...await b.getPlaylists()]; } catch (e) { handleErr(e); }
  renderCrate();
}

// ---------------------------------------------------------------- screen + LCD drawing
function drawScreen() {
  const { ctx, w, h } = scr, hue = FX.hue, st = S.st, tr = st?.track;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, hsl(hue, 0.85, 0.13)); g.addColorStop(1, '#040108');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  if (!S.backend || !tr) {
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '900 84px system-ui,sans-serif'; ctx.fillText('NEON BOOTH', w / 2, 250);
    ctx.font = '600 32px system-ui,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
    const msg = !S.backend ? 'Connect Spotify in the menu, or try demo mode'
      : st === null ? 'Nothing playing. Press DEVICE on the booth, or a playlist in the crate.' : 'Loading…';
    ctx.fillText(msg, w / 2, 320);
    scr.update(); return;
  }

  ctx.save();
  ctx.shadowColor = hsl(hue, 1, 0.6); ctx.shadowBlur = 40;
  drawCover(ctx, getImage(tr.art), 56, 96, 384, 384, tr.name, hue);
  ctx.restore();

  const x = 480, live = S.deck ? 'B' : 'A';
  ctx.fillStyle = hsl(hue, 1, 0.7); ctx.font = '900 26px system-ui,sans-serif';
  ctx.fillText(`${st.isPlaying ? 'ON AIR' : 'PAUSED'}  ·  DECK ${live}`, x, 128);
  ctx.fillStyle = '#fff'; ctx.font = '900 56px system-ui,sans-serif';
  ctx.fillText(ellipsize(ctx, tr.name, w - x - 40), x, 192);
  ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.font = '600 32px system-ui,sans-serif';
  ctx.fillText(ellipsize(ctx, tr.artists, w - x - 40), x, 238);

  const pos = progressNow(), dur = tr.durationMs || 1, bw = w - x - 48;
  ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.roundRect(x, 268, bw, 12, 6); ctx.fill();
  ctx.fillStyle = hsl(hue, 1, 0.62); ctx.beginPath(); ctx.roundRect(x, 268, Math.max(12, bw * clamp(pos / dur, 0, 1)), 12, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '600 24px system-ui,sans-serif';
  ctx.fillText(fmtTime(pos), x, 312);
  ctx.textAlign = 'right'; ctx.fillText(fmtTime(dur), x + bw, 312); ctx.textAlign = 'left';
  if (S.scrub) { ctx.fillStyle = '#fff'; ctx.font = '900 24px system-ui,sans-serif'; ctx.fillText('SCRUBBING', x + bw / 2 - 64, 312); }

  ctx.fillStyle = hsl(hue + 0.45, 1, 0.7); ctx.font = '900 22px system-ui,sans-serif';
  ctx.fillText('UP NEXT', x, 364);
  S.queue.slice(0, 3).forEach((q, k) => {
    const y = 380 + k * 56;
    drawCover(ctx, getImage(q.art), x, y, 46, 46, q.name, hue);
    ctx.fillStyle = '#fff'; ctx.font = '700 24px system-ui,sans-serif';
    ctx.fillText(ellipsize(ctx, q.name, bw - 70), x + 60, y + 22);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '500 19px system-ui,sans-serif';
    ctx.fillText(ellipsize(ctx, q.artists, bw - 70), x + 60, y + 44);
  });

  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 22px system-ui,sans-serif';
  ctx.fillText(`${st.device?.name || 'no speaker'}  ·  ${beat.micOn ? 'MIC SYNC' : beat.bpm + ' BPM'}  ·  ${S.backend.label}`, 56, 540);
  ctx.textAlign = 'right'; ctx.fillStyle = hsl(hue, 1, 0.7); ctx.font = '900 24px system-ui,sans-serif';
  ctx.fillText('NEON BOOTH', w - 48, 540);
  scr.update();
}

function drawLCD() {
  const { ctx, w, h } = lcd, now = performance.now(), hue = FX.hue;
  ctx.fillStyle = '#040107'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hsl(hue, 1, 0.55, 0.8); ctx.lineWidth = 4; ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = hsl(hue, 1, 0.7); ctx.font = '900 54px ui-monospace,Menlo,monospace';
  ctx.fillText(S.micHeld ? 'MC' : beat.micOn ? 'MIC' : String(beat.bpm), 22, h / 2 - 10);
  ctx.font = '700 20px ui-monospace,Menlo,monospace'; ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.fillText(S.micHeld ? 'LIVE' : beat.micOn ? 'SYNC' : 'BPM', 24, h - 26);
  if (S.micHeld) {     // voice meter
    const lv = clamp((voice.level - voice.floor) * 4, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(180, h - 22, w - 210, 8);
    ctx.fillStyle = voice.talking ? '#39ff88' : hsl(hue, 1, 0.6); ctx.fillRect(180, h - 22, (w - 210) * lv, 8);
  }
  // beat dot
  ctx.fillStyle = hsl(hue + 0.45, 1, 0.6, 0.25 + 0.75 * beat.pulse);
  ctx.beginPath(); ctx.arc(150, h / 2, 12, 0, TAU); ctx.fill();
  const msg = now < S.toastUntil ? S.toast
    : S.micHeld ? (voice.talking ? 'The crowd is listening…' : voice.micOn ? 'Talk to the crowd, then pause' : 'Waiting for the mic…')
    : !S.backend ? 'Open the menu: connect Spotify'
    : S.st?.device ? `Speaker: ${S.st.device.name}  ·  vol ${targetVol()}%` : 'Press DEVICE to pick a speaker';
  ctx.fillStyle = now < S.toastUntil ? '#fff' : 'rgba(255,255,255,.8)';
  ctx.font = `${now < S.toastUntil ? 800 : 600} 30px system-ui,sans-serif`;
  ctx.fillText(ellipsize(ctx, msg, w - 200), 180, h / 2);
  lcd.update();
}

// ---------------------------------------------------------------- XR sessions
let calib = 0;
async function enterXR(mode) {
  if (renderer.xr.isPresenting) return;
  const ar = mode === 'immersive-ar';
  const name = ar ? 'mixed reality' : 'VR';
  if (!navigator.xr) { setStatus(`Can't start ${name}: this browser has no WebXR. Use the Meta Quest browser.`); return; }
  setStatus(`Starting ${name}…`);
  let session;
  try {
    // Everything optional so the headset can't refuse the session over a feature.
    session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  } catch (e) {
    setStatus(`Headset refused ${name} (${e.name}: ${e.message}). If the Quest asked to allow VR, choose Allow, then try again.`);
    return;
  }
  scene.background = ar ? null : BG; scene.fog = ar ? null : FOG;
  world.env.visible = !ar;
  renderer.setClearAlpha(ar ? 0 : 1);
  session.addEventListener('end', () => {
    scene.background = BG; scene.fog = FOG; world.env.visible = true; renderer.setClearAlpha(1); desktopCam();
    setStatus(`Left ${name}`);
  });
  try {
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
  } catch (e) {
    try {   // no floor tracking: fall back to a head-relative space
      renderer.xr.setReferenceSpaceType('local');
      await renderer.xr.setSession(session);
    } catch (e2) {
      setStatus(`Could not start ${name}: ${e2.name}: ${e2.message}`);
      session.end().catch(() => {});
      return;
    }
  }
  calib = 40;     // measure head height after the pose settles
}
const _head = new THREE.Vector3();
function calibrate() {
  _head.setFromMatrixPosition(camera.matrixWorld);
  if (_head.y > 0.6 && _head.y < 2.3) setDeskH(_head.y - 0.58);
}

// ---------------------------------------------------------------- frame loop
const clock = new THREE.Clock();
let lastScreen = 0, lastLCD = 0;
const tmpC = new THREE.Color();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  const presenting = renderer.xr.isPresenting;
  if (!presenting) camera.rotation.set(pitch, yaw, 0);
  if (presenting && calib > 0 && --calib === 0) calibrate();

  const onBeat = beat.update();
  const playing = S.backend ? !!S.st?.isPlaying : true;    // attract mode before you connect
  const dropping = now < S.dropUntil;
  FX.drop = dropping ? 1 : Math.max(0, FX.drop - dt * 0.6);
  if (onBeat && dropping) fx.fire(0.35);
  if (onBeat && S.auto && playing) {
    S.beatN++;
    if (S.beatN % 4 === 0) fx.fire(0.3);
    if (S.beatN % 16 === 0) fx.co2(1.2);
  }
  fx.update(dt, presenting ? 1000 : renderer.domElement.height * 0.5);
  const target = ((S.albumHue ?? 0.86) + S.fx.color) % 1;
  let dh = target - FX.hue; dh -= Math.round(dh);
  FX.hue = (FX.hue + dh * Math.min(1, dt * 1.5) + 1) % 1;
  const pulse = beat.pulse * (playing ? 1 : 0.15);

  S.cheer = Math.max(0, S.cheer - dt * 0.28);
  voice.cheerGain = S.cheer;
  world.update(t, dt, { hue: FX.hue, pulse: beat.pulse, laser: S.fx.laser, speed: S.fx.speed, playing, drop: Math.min(1, FX.drop), beams: S.beams, cheer: S.cheer, listen: voice.talking ? 1 : 0 });

  tmpC.setHSL(FX.hue, 1, 0.5);
  for (const m of neonA) m.color.copy(tmpC).multiplyScalar(0.7 + 0.5 * pulse);
  tmpC.setHSL((FX.hue + 0.45) % 1, 1, 0.5);
  for (const m of neonB) m.color.copy(tmpC).multiplyScalar(0.7 + 0.5 * pulse);
  for (const m of edgeLines) m.color.setHSL(FX.hue, 1, 0.45 + 0.2 * pulse);
  boothLight.color.setHSL(FX.hue, 1, 0.6);
  boothLight.intensity = 1.5 + 3 * pulse + 3 * FX.drop;

  updateDecks();
  decks.forEach(dk => {
    const live = dk.i === S.deck;
    if (live && S.st?.isPlaying && !dk.dragging) dk.spin.rotation.y -= 3.49 * dt;   // 33⅓ rpm
    const dur = S.st?.track?.durationMs || 0;
    setRing(dk, live ? (dur ? progressNow() / dur : 0) : 1);
    dk.ringMat.color.setHSL(live ? FX.hue : (FX.hue + 0.45) % 1, 1, live ? 0.55 + 0.15 * pulse : 0.18);
  });

  padPlay.lit = !!S.st?.isPlaying;
  padShuf.lit = !!S.st?.shuffle;
  padRep.lit = !!S.st && S.st.repeat !== 'off';
  padLike.lit = S.saved;
  padMic.lit = beat.micOn;
  padAuto.lit = S.auto;
  padBeams.lit = S.beams;
  for (const it of items) it.tick?.(dt);
  micTick(dt);

  input.update(presenting);
  if (volPending && now - volSentAt > 250) pushVolume();

  if (now - lastScreen > 160) { drawScreen(); lastScreen = now; }
  if (now - lastLCD > 100) { drawLCD(); lastLCD = now; }
  renderer.render(scene, camera);
});

// Labels whose text depends on state
let lastLabels = '';
setInterval(() => {
  const key = [S.st?.isPlaying, S.st?.shuffle, S.st?.repeat, S.saved, beat.micOn].join();
  if (key === lastLabels) return;
  lastLabels = key;
  padPlay.label(S.st?.isPlaying ? '❚❚' : '▶', S.st?.isPlaying ? 'PAUSE' : 'PLAY');
  padShuf.label('SHUF', S.st?.shuffle ? 'on' : 'off');
  padRep.label('LOOP', { off: 'off', context: 'playlist', track: 'track' }[S.st?.repeat || 'off']);
  padLike.label('♥', S.saved ? 'SAVED' : 'SAVE');
  padMic.label('MIC', beat.micOn ? 'on' : 'off');
}, 200);

// ---------------------------------------------------------------- page UI
const ui = { status: $('status'), connect: $('connect'), demo: $('demo'), vr: $('vr'), mr: $('mr'), mic: $('mic'), hint: $('hint') };
function setStatus(text) { ui.status.textContent = text; }

ui.connect.onclick = () => {
  if (sp.hasLogin()) { sp.logout(); S.backend = null; S.st = null; ui.connect.textContent = 'Connect Spotify'; setStatus('Logged out'); return; }
  sp.login();
};
ui.demo.onclick = () => {
  voice.wake();
  if (S.backend?.label === 'Demo') return;
  useBackend(new DemoBackend());
  setStatus('Demo mode: fake tracks, no Spotify needed');
};
ui.vr.onclick = () => { voice.wake(); enterXR('immersive-vr'); };
ui.mr.onclick = () => { voice.wake(); enterXR('immersive-ar'); };
ui.mic.onchange = async () => {
  if (ui.mic.checked) { const ok = await beat.enableMic(); ui.mic.checked = ok; if (!ok) setStatus('Mic was blocked. Allow it in the browser to use mic sync.'); }
  else beat.disableMic();
};
$('hide').onclick = () => { $('panel').hidden = true; $('show').hidden = false; };
$('show').onclick = () => { $('panel').hidden = false; $('show').hidden = true; };

if (navigator.xr) {
  // Buttons stay clickable; a failed start reports the real reason instead of a dead button.
  ui.vr.disabled = false; ui.mr.disabled = false;
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (!ok) ui.hint.textContent = 'This browser says it has no VR headset. On the Quest, open this page in the Meta Quest browser.'; }).catch(() => {});
} else {
  ui.hint.textContent = window.isSecureContext
    ? 'Open this page in the Meta Quest browser to enter VR. Here: drag to look, click the controls.'
    : 'VR needs an https:// address. Here: drag to look, click the controls.';
}

(async () => {
  const r = await sp.handleRedirect().catch(e => ({ error: e.message }));
  if (r.error) setStatus('Spotify login failed: ' + r.error);
  if (!sp.hasLogin()) return;
  ui.connect.textContent = 'Log out of Spotify';
  const b = new sp.SpotifyBackend();
  try {
    const name = await b.me();
    setStatus(`Connected to Spotify as ${name}`);
    useBackend(b);
  } catch (e) {
    setStatus('Spotify: ' + e.message);
    if (e.status === 401) { ui.connect.textContent = 'Connect Spotify'; }
  }
})();

// Handy for debugging from the console
window.booth = { S, beat, voice, items, setDeskH, fx, longDrop, mixToNext, hype, micItem };
