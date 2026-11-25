// Pyro: flame cannons, CO2 jets and fireworks, all as cheap additive point particles.
import * as THREE from 'three';
import { FIELD_Y } from './world.js';

class Particles {
  constructor(parent, count, { gravity = 0, drag = 1 } = {}) {
    this.n = count; this.next = 0; this.gravity = gravity; this.drag = drag;
    this.pos = new Float32Array(count * 3); this.col = new Float32Array(count * 3); this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3); this.age = new Float32Array(count).fill(1); this.life = new Float32Array(count).fill(1);
    this.size0 = new Float32Array(count); this.base = new Float32Array(count * 3); this.kind = new Uint8Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 aColor; attribute float aSize; uniform float uScale; varying vec3 vC;
        void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * a, a); }`,
    });
    const pts = new THREE.Points(g, this.mat); pts.frustumCulled = false; parent.add(pts);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, gr, b, kind = 0) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.base.set([r, gr, b], i * 3);
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size; this.kind[i] = kind;
  }
  update(dt, shade) {
    const { pos, vel, col, size, age, life } = this;
    const dragK = Math.pow(this.drag, dt * 60);
    for (let i = 0; i < this.n; i++) {
      if (age[i] >= 1) { size[i] = 0; continue; }
      age[i] += dt / life[i];
      const j = i * 3;
      vel[j + 1] += this.gravity * dt;
      vel[j] *= dragK; vel[j + 1] *= dragK; vel[j + 2] *= dragK;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      shade(i, Math.min(1, age[i]));
    }
    this.g.attributes.position.needsUpdate = true;
    this.g.attributes.aColor.needsUpdate = true;
    this.g.attributes.aSize.needsUpdate = true;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export function createFX(parent, { pyro, co2 }) {
  const fire = new Particles(parent, 1800, { gravity: -2.5, drag: 0.975 });
  const smoke = new Particles(parent, 1400, { gravity: -1.0, drag: 0.955 });
  const sparks = new Particles(parent, 3600, { gravity: -3.5, drag: 0.985 });
  const st = { fireUntil: 0, co2Until: 0, rockets: [], pending: [] };
  const c = new THREE.Color();

  fire.shadeFn = (i, a) => {
    const P = fire, j = i * 3;
    let r, g, b;
    if (a < 0.18) { const k = a / 0.18; r = 1; g = 0.95 - 0.35 * k; b = 0.6 - 0.5 * k; }
    else if (a < 0.6) { const k = (a - 0.18) / 0.42; r = 1; g = 0.6 - 0.45 * k; b = 0.1 - 0.08 * k; }
    else { const k = (a - 0.6) / 0.4; r = 1 - 0.6 * k; g = 0.15 - 0.12 * k; b = 0.02; }
    const f = (1 - a) * 1.2;
    P.col[j] = r * f; P.col[j + 1] = g * f; P.col[j + 2] = b * f;
    P.size[i] = P.size0[i] * (0.6 + a * 1.6);
  };
  smoke.shadeFn = (i, a) => {
    const P = smoke, j = i * 3, f = Math.pow(1 - a, 1.8) * 0.22;
    P.col[j] = 0.85 * f; P.col[j + 1] = 0.9 * f; P.col[j + 2] = 1.0 * f;
    P.size[i] = P.size0[i] * (0.4 + a * 1.8);
  };
  sparks.shadeFn = (i, a) => {
    const P = sparks, j = i * 3;
    const tw = P.kind[i] === 1 ? 0.7 + 0.3 * Math.sin(a * 60 + i) : 1;
    const f = Math.pow(1 - a, 1.3) * tw;
    P.col[j] = P.base[j] * f; P.col[j + 1] = P.base[j + 1] * f; P.col[j + 2] = P.base[j + 2] * f;
    P.size[i] = P.size0[i];
  };

  function launch(hue) {
    const side = Math.random() < 0.5 ? -1 : 1;
    st.rockets.push({
      p: new THREE.Vector3(side * rnd(8, 26), FIELD_Y + 2, rnd(-48, -14)),
      v: new THREE.Vector3(rnd(-2, 2), rnd(21, 26), rnd(-2, 2)),
      fuse: rnd(1.0, 1.4), hue: hue ?? Math.random(),
    });
  }
  function burst(r) {
    const n = 170, big = rnd(7, 10);
    c.setHSL(r.hue, 1, 0.6);
    const c2 = new THREE.Color().setHSL((r.hue + 0.12) % 1, 1, 0.7);
    for (let k = 0; k < n; k++) {
      const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), s = Math.sqrt(1 - u * u), sp = big * rnd(0.85, 1.05);
      const cc = k % 3 ? c : c2;
      sparks.spawn(r.p.x, r.p.y, r.p.z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp, rnd(1.6, 2.4), 0.55, cc.r, cc.g, cc.b, 1);
    }
  }

  return {
    fire(sec = 2) { st.fireUntil = Math.max(st.fireUntil, performance.now() + sec * 1000); },
    co2(sec = 2.5) { st.co2Until = Math.max(st.co2Until, performance.now() + sec * 1000); },
    fireworks(count = 10, overSec = 6, hue) {
      const now = performance.now();
      for (let k = 0; k < count; k++) st.pending.push({ at: now + (k / count) * overSec * 1000 + rnd(0, 300), hue });
    },
    update(dt, scale) {
      const now = performance.now();
      fire.mat.uniforms.uScale.value = smoke.mat.uniforms.uScale.value = sparks.mat.uniforms.uScale.value = scale;
      if (now < st.fireUntil) {
        for (const e of pyro) for (let k = 0; k < 3; k++) {
          fire.spawn(e.x + rnd(-0.12, 0.12), e.y + 0.1, e.z + rnd(-0.12, 0.12), rnd(-0.5, 0.5), rnd(7, 10.5), rnd(-0.5, 0.5), rnd(0.65, 1.05), rnd(0.7, 1.1), 1, 1, 1);
        }
      }
      if (now < st.co2Until) {
        for (const e of co2) for (let k = 0; k < 3; k++) {
          smoke.spawn(e.x + rnd(-0.08, 0.08), e.y + 0.2, e.z, rnd(-0.9, 0.9), rnd(10, 13), rnd(-0.9, 0.9), rnd(1.0, 1.5), rnd(0.5, 0.8), 1, 1, 1);
        }
      }
      st.pending = st.pending.filter(q => { if (now >= q.at) { launch(q.hue); return false; } return true; });
      st.rockets = st.rockets.filter(r => {
        r.v.y -= 6 * dt; r.p.addScaledVector(r.v, dt); r.fuse -= dt;
        sparks.spawn(r.p.x, r.p.y, r.p.z, rnd(-0.3, 0.3), rnd(-1, 0), rnd(-0.3, 0.3), 0.45, 0.35, 1, 0.75, 0.35);
        if (r.fuse <= 0) { burst(r); return false; }
        return true;
      });
      fire.update(dt, fire.shadeFn);
      smoke.update(dt, smoke.shadeFn);
      sparks.update(dt, sparks.shadeFn);
    },
  };
}
