// The stadium: you DJ from a raised stage at one end of a packed bowl.
// `env` is hidden in mixed reality; `show` (lasers, beams, pyro) stays in your room.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FIELD_Y = -1.8;                       // the pitch sits below the stage
const BOWL = { cx: 0, cz: -30, r0: 38, r1: 62, h: 26 };
export const PYRO = [-7.5, -5.5, -3.5, -1.6, 1.6, 3.5, 5.5, 7.5].map(x => new THREE.Vector3(x, 0.05, -2.75));
export const CO2 = [-6.5, -2.5, 2.5, 6.5].map(x => new THREE.Vector3(x, 0.05, -2.62));

const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

// Soft light-beam cone: bright at the source, fading out along its length.
function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0.2 } },
    vertexShader: 'varying float vV; void main(){ vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vV; void main(){ float a = pow(vV, 2.2) * uOpacity; gl_FragColor = vec4(uColor * a, a); }',
  });
}

function gridMaterial(dim) {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uPulse: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uColor2; uniform float uPulse; uniform float uTime; varying vec3 vW;
      void main(){
        vec2 p = vW.xz * ${dim ? '0.35' : '1.0'};
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float d = length(vW.xz);
        float fade = exp(-d * ${dim ? '0.03' : '0.12'});
        float wave = pow(0.5 + 0.5 * sin(d * 0.9 - uTime * 5.0), 8.0);
        vec3 col = vec3(0.008, 0.0, 0.02)
          + uColor * line * fade * (${dim ? '0.12' : '0.3'} + 0.9 * uPulse)
          + uColor2 * wave * fade * 0.18 * (0.3 + uPulse);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function createWorld(scene) {
  const env = new THREE.Group(), show = new THREE.Group();
  scene.add(env, show);
  const C1 = new THREE.Color(), C2 = new THREE.Color(), WHITE = new THREE.Color(1, 1, 1);
  const steel = new THREE.MeshStandardMaterial({ color: 0x15151d, metalness: 0.7, roughness: 0.45 });

  // Night sky + stars
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(uBot, uTop, smoothstep(-0.05, 0.7, h)), 1.0); }',
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), domeMat));
  {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(0.25 + Math.random() * 0.75);
      pos.set([Math.sin(v) * Math.cos(u) * 160, Math.cos(v) * 160, Math.sin(v) * Math.sin(u) * 160], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    env.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, color: 0xffffff, transparent: true, opacity: 0.7, fog: false })));
  }

  // Stage: top at y=0, front edge at z=-2.8
  const stage = new THREE.Mesh(new THREE.BoxGeometry(17, 1.8, 7.2), steel); stage.position.set(0, -0.9, 0.8); env.add(stage);
  const stageMat = gridMaterial(false);
  const stageTop = new THREE.Mesh(new THREE.PlaneGeometry(17, 7.2), stageMat);
  stageTop.rotation.x = -Math.PI / 2; stageTop.position.set(0, 0.003, 0.8); env.add(stageTop);
  const edgeMats = [];
  for (const [w, h, d, x, y, z] of [[17, 0.05, 0.05, 0, -0.02, -2.82], [17, 0.05, 0.05, 0, -1.78, -2.82], [0.05, 1.8, 0.05, -8.5, -0.9, -2.82], [0.05, 1.8, 0.05, 8.5, -0.9, -2.82]]) {
    const m = additive(0xffffff); edgeMats.push(m);
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); s.position.set(x, y, z); env.add(s);
  }
  for (const p of PYRO) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), steel); b.position.set(p.x, 0.06, p.z); env.add(b); }
  for (const p of CO2) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.2, 10), steel); b.position.set(p.x, 0.1, p.z); env.add(b); }

  // Towers, roof truss, hanging speaker arrays
  for (const x of [-8.3, 8.3]) for (const z of [-2.4, 3.9]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 13.5, 0.5), steel); t.position.set(x, 6.75, z); env.add(t);
  }
  for (const z of [-2.4, 3.9]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(17.2, 0.5, 0.5), steel); tr.position.set(0, 13.2, z); env.add(tr); }
  for (const x of [-7.2, 7.2]) {
    const arr = new THREE.Group(); arr.position.set(x, 10.5, -2.1); env.add(arr);
    for (let k = 0; k < 7; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.9), steel); b.position.y = -k * 0.58; b.rotation.x = k * 0.04; arr.add(b); }
  }

  // Giant LED wall behind you
  const wallMat = new THREE.ShaderMaterial({
    fog: false, uniforms: { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uTime: { value: 0 }, uPulse: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uTime; uniform float uPulse; varying vec2 vUv;
      void main(){ vec2 c = vUv - vec2(0.5, 0.35); float r = length(c * vec2(1.6, 1.0));
        float rings = pow(0.5 + 0.5 * sin(r * 40.0 - uTime * 6.0), 6.0);
        vec2 px = fract(vUv * vec2(170.0, 120.0)); float dots = step(0.25, px.x) * step(0.25, px.y);
        vec3 col = mix(uColor2, uColor, rings) * (0.15 + 0.85 * uPulse * (1.0 - r)) * dots;
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(17, 12), wallMat);
  wall.rotation.y = Math.PI; wall.position.set(0, 6.5, 4.35); env.add(wall);

  // Pitch + stands
  const fieldMat = gridMaterial(true);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), fieldMat);
  field.rotation.x = -Math.PI / 2; field.position.y = FIELD_Y; env.add(field);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(BOWL.r1, BOWL.r0, BOWL.h, 72, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x07050d, side: THREE.BackSide }));
  bowl.position.set(BOWL.cx, FIELD_Y + BOWL.h / 2, BOWL.cz); env.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(BOWL.r1, 0.35, 6, 160), additive(0xffffff, 0.6));
  rim.rotation.x = Math.PI / 2; rim.position.set(BOWL.cx, FIELD_Y + BOWL.h, BOWL.cz); env.add(rim);

  // Crowd in the stands and at the back of the pitch: points (cheap), plus phone lights
  function cloud(n, place, size, colorFn) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) { pos.set(place(), i * 3); colorFn(c); col.set([c.r, c.g, c.b], i * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, fog: false });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; env.add(pts);
    return m;
  }
  const inStands = () => {
    let th; do { th = Math.random() * Math.PI * 2; } while (Math.cos(th) > 0.88);   // gap behind the stage
    const t = 0.03 + Math.pow(Math.random(), 0.85) * 0.92;
    const r = BOWL.r0 + (BOWL.r1 - BOWL.r0) * t - 0.6;
    return [BOWL.cx + Math.sin(th) * r, FIELD_Y + BOWL.h * t + 0.5, BOWL.cz + Math.cos(th) * r];
  };
  const backPitch = () => {
    for (;;) {
      const x = (Math.random() - 0.5) * 70, z = -28 - Math.random() * 40;
      if (Math.hypot(x - BOWL.cx, z - BOWL.cz) < BOWL.r0 - 1) return [x, FIELD_Y + 1.3 + Math.random() * 0.4, z];
    }
  };
  const crowdTint = c => c.setHSL(0.6 + Math.random() * 0.3, 0.4, 0.12 + Math.random() * 0.15);
  const standsMat = cloud(14000, inStands, 0.55, crowdTint);
  const pitchMat = cloud(5000, backPitch, 0.5, crowdTint);
  const phoneMat = cloud(2600, () => Math.random() < 0.7 ? inStands() : backPitch(), 0.22, c => c.setRGB(1, 1, 0.95));

  // Front crowd on the pitch: instanced people facing the stage, jumping on the beat
  const crowd = [];
  {
    const body = new THREE.CapsuleGeometry(0.18, 0.95, 2, 6); body.translate(0, 0.66, 0);
    const head = new THREE.SphereGeometry(0.12, 6, 4); head.translate(0, 1.48, 0);
    const armL = new THREE.CylinderGeometry(0.035, 0.04, 0.62, 4); armL.rotateZ(0.45); armL.translate(-0.3, 1.58, 0);
    const armR = armL.clone(); armR.rotateY(Math.PI);
    const up = mergeGeometries([body, head, armL, armR]), down = mergeGeometries([body.clone(), head.clone()]);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const spots = [];
    for (let z = -3.8; z > -28; z -= 0.72) {
      const half = Math.min(17, 4.5 + (-z) * 0.55);
      for (let x = -half; x <= half; x += 0.68) {
        spots.push({ x: x + (Math.random() - 0.5) * 0.4, z: z + (Math.random() - 0.5) * 0.3, s: 0.85 + Math.random() * 0.3,
          ph: Math.random() * Math.PI * 2, j: 0.5 + Math.random() * 0.6, rot: (Math.random() - 0.5) * 0.8, wave: x * 0.25 + z * 0.1 });
      }
    }
    const lists = [spots.filter((_, i) => i % 2 === 0), spots.filter((_, i) => i % 2 === 1)];
    const tint = new THREE.Color();
    [up, down].forEach((geo, k) => {
      const list = lists[k];
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.frustumCulled = false;
      list.forEach((_, i) => im.setColorAt(i, tint.setHSL(0.65 + Math.random() * 0.25, 0.5, 0.06 + Math.random() * 0.08)));
      env.add(im); crowd.push({ im, list });
    });
    crowd.mat = mat;
  }

  // Lasers from the roof truss out over the crowd
  const lasers = [];
  {
    const geo = new THREE.CylinderGeometry(0.02, 0.02, 90, 5, 1, true); geo.translate(0, -45, 0);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group(); g.position.set((i - 7.5) * 1.05, 12.8, -2.4);
      const m = new THREE.Mesh(geo, additive(0xffffff, 0.6)); g.add(m); show.add(g);
      lasers.push({ g, m, i });
    }
  }

  // Moving-head spotlights on the truss + searchlights around the stadium rim
  const spots = [], search = [];
  {
    const cone = new THREE.CylinderGeometry(0.12, 2.6, 26, 20, 1, true);   // narrow at the light cone.translate(0, -13, 0);
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group(); g.position.set((i - 4.5) * 1.7, 13, -2.6);
      const mat = beamMaterial(); g.add(new THREE.Mesh(cone, mat)); show.add(g);
      spots.push({ g, mat, i });
    }
    const tall = new THREE.CylinderGeometry(4, 0.5, 140, 16, 1, true); tall.translate(0, 70, 0);
    for (let i = 0; i < 10; i++) {
      const th = (i / 10) * Math.PI * 2 + 0.3;
      const g = new THREE.Group(); g.position.set(BOWL.cx + Math.sin(th) * BOWL.r1, FIELD_Y + BOWL.h, BOWL.cz + Math.cos(th) * BOWL.r1);
      const mat = beamMaterial(); mat.userData.up = true; g.add(new THREE.Mesh(tall, mat)); env.add(g);
      search.push({ g, mat, i });
    }
  }
  // beams fade away from their source: the spot cones' source is the top (uv.y=1),
  // the searchlights' source is the bottom, so flip their fade.
  for (const s of search) s.mat.fragmentShader = s.mat.fragmentShader.replace('pow(vV, 2.2)', 'pow(1.0 - vV, 2.2)');

  const dummy = new THREE.Object3D();

  function update(t, dt, fx) {
    const { hue, pulse, laser, playing, drop, beams } = fx;
    const live = playing ? 1 : 0.12;
    const p = Math.min(1, pulse * live + drop * 0.6);
    C1.setHSL(hue, 1, 0.56); C2.setHSL((hue + 0.45) % 1, 1, 0.56);

    domeMat.uniforms.uTop.value.setHSL((hue + 0.62) % 1, 0.7, 0.03 + 0.02 * p);
    domeMat.uniforms.uBot.value.setHSL((hue + 0.05) % 1, 0.9, 0.02 + 0.03 * p);
    for (const m of [stageMat, fieldMat]) {
      m.uniforms.uColor.value.copy(C1); m.uniforms.uColor2.value.copy(C2);
      m.uniforms.uPulse.value = p; m.uniforms.uTime.value = t;
    }
    wallMat.uniforms.uColor.value.copy(C1); wallMat.uniforms.uColor2.value.copy(C2);
    wallMat.uniforms.uTime.value = t; wallMat.uniforms.uPulse.value = 0.3 + 0.7 * p;
    for (const m of edgeMats) m.color.copy(C1).multiplyScalar(0.5 + p);
    rim.material.color.copy(C2).multiplyScalar(0.3 + 0.7 * p);

    standsMat.color.copy(C1).multiplyScalar(0.25 + 0.9 * p).addScalar(0.35);
    pitchMat.color.copy(standsMat.color);
    phoneMat.opacity = 0.45 + 0.35 * Math.sin(t * 1.3) * Math.sin(t * 0.7) + 0.2 * p;

    crowd.mat.color.copy(C1).multiplyScalar(0.3 + 1.1 * p).addScalar(0.1);
    for (const { im, list } of crowd) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const jump = playing ? Math.pow(Math.max(0, pulse - 0.15 * Math.sin(s.wave)), 1.6) * 0.32 * s.j + drop * 0.3 * s.j * (0.5 + 0.5 * Math.sin(t * 9 + s.ph)) : 0;
        dummy.position.set(s.x, FIELD_Y + jump, s.z);
        dummy.rotation.set(0, Math.PI + s.rot + Math.sin(t * 0.6 + s.ph) * 0.2, Math.sin(t * 2.2 + s.ph) * (playing ? 0.1 : 0.03));
        dummy.scale.setScalar(s.s);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    }

    const lz = playing ? laser : 0;
    const speed = 0.25 + (fx.speed ?? 0.5) * 2.6 + drop * 2;
    for (const L of lasers) {
      const on = lz > 0.02 || drop > 0.05;
      L.g.visible = on;
      if (!on) continue;
      const i = L.i;
      L.g.rotation.x = 1.25 + Math.sin(t * speed * 0.6 + i * 0.7) * 0.22;
      L.g.rotation.z = Math.sin(t * speed * 0.45 + i * 1.3) * 0.6;
      L.m.material.color.copy(i % 2 ? C2 : C1);
      L.m.material.opacity = Math.min(1, lz * (0.18 + 0.82 * pulse) + drop);
    }
    for (const s of spots) {
      s.g.rotation.x = 0.55 + Math.sin(t * speed * 0.35 + s.i) * 0.35;
      s.g.rotation.z = Math.sin(t * speed * 0.3 + s.i * 0.9) * 0.5;
      s.mat.uniforms.uColor.value.copy(s.i % 2 ? C1 : C2);
      s.mat.uniforms.uOpacity.value = (0.06 + 0.22 * p) * (playing ? 1 : 0.4);
    }
    for (const s of search) {
      s.g.visible = beams;
      if (!beams) continue;
      s.g.rotation.x = Math.sin(t * 0.4 + s.i) * 0.45;
      s.g.rotation.z = Math.cos(t * 0.33 + s.i * 1.7) * 0.45;
      s.mat.uniforms.uColor.value.copy(s.i % 2 ? C2 : C1).lerp(WHITE, 0.35);
      s.mat.uniforms.uOpacity.value = 0.1 + 0.15 * p;
    }
  }

  return { env, show, update };
}
