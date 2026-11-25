// The club: sky dome, neon grid floor, crowd, speaker stacks, light rings, lasers, sparks.
// `env` is hidden in mixed reality so the booth and lasers float in the real room.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

export function createWorld(scene) {
  const env = new THREE.Group();   // VR-only surroundings
  const show = new THREE.Group();  // lasers + sparks, shown in VR and MR
  scene.add(env, show);
  const C1 = new THREE.Color(), C2 = new THREE.Color(), tmp = new THREE.Color();

  // Sky dome
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uTop; uniform vec3 uBot; varying vec3 vP; void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(uBot, uTop, smoothstep(-0.05, 0.8, h)), 1.0); }',
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), domeMat));

  // Stars
  {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = Math.acos(Math.random() * 0.85);
      pos.set([Math.sin(v) * Math.cos(u) * 80, Math.cos(v) * 80, Math.sin(v) * Math.sin(u) * 80], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    env.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.25, color: 0xffffff, transparent: true, opacity: 0.75, fog: false })));
  }

  // Neon grid floor with a ripple that rides the beat
  const floorMat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uColor: { value: new THREE.Color() }, uColor2: { value: new THREE.Color() }, uPulse: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uColor2; uniform float uPulse; uniform float uTime; varying vec3 vW;
      void main(){
        vec2 p = vW.xz * 0.8;
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        float d = length(vW.xz - vec2(0.0, -3.0));
        float fade = exp(-d * 0.07);
        float wave = pow(0.5 + 0.5 * sin(d * 1.6 - uTime * 5.0), 6.0);
        vec3 col = vec3(0.012, 0.0, 0.03)
          + uColor * line * fade * (0.35 + 1.1 * uPulse)
          + uColor2 * wave * fade * 0.22 * (0.3 + uPulse);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), floorMat);
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);

  // Light rings framing the big screen
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(2.35 + i * 0.42, 0.022, 8, 120), additive(0xffffff, 0.8));
    m.position.set(0, 3.05, -5.5 - i * 0.6);
    env.add(m); rings.push(m);
  }

  // Speaker stacks
  const cones = [];
  {
    const cab = new THREE.MeshStandardMaterial({ color: 0x0d0b14, metalness: 0.4, roughness: 0.6 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0x1b1b22, metalness: 0.2, roughness: 0.8 });
    for (const sx of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(sx * 2.9, 0, -2.9); g.rotation.y = -sx * 0.35; env.add(g);
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.8), cab); box.position.y = 1.3; g.add(box);
      for (const [y, r] of [[2.05, 0.3], [1.25, 0.42], [0.48, 0.3]]) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.45, 0.14, 28), coneMat);
        cone.rotation.x = Math.PI / 2; cone.position.set(0, y, 0.38); g.add(cone);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.018, 6, 40), additive(0xffffff));
        ring.position.set(0, y, 0.41); g.add(ring);
        cones.push({ cone, ring, r });
      }
    }
  }

  // Crowd: two instanced silhouettes (arms up / arms down), one draw call each
  const crowd = [];
  {
    const body = new THREE.CapsuleGeometry(0.17, 0.95, 4, 8); body.translate(0, 0.67, 0);
    const head = new THREE.SphereGeometry(0.12, 10, 8); head.translate(0, 1.5, 0);
    const armL = new THREE.CylinderGeometry(0.035, 0.04, 0.62, 6); armL.rotateZ(0.45); armL.translate(-0.3, 1.6, 0);
    const armR = armL.clone(); armR.rotateY(Math.PI);
    const up = mergeGeometries([body, head, armL, armR]);
    const down = mergeGeometries([body.clone(), head.clone()]);
    const mat = new THREE.MeshBasicMaterial({ color: 0x110018 });
    const spots = [];
    for (let row = 0; row < 7; row++) {
      for (let k = 0; k < 15; k++) {
        const x = (k - 7) * 0.62 + (Math.random() - 0.5) * 0.35 + (row % 2) * 0.3;
        const z = -2.7 - row * 0.85 - Math.random() * 0.3;
        if (Math.abs(x) > 2.3 && z > -3.6) continue;    // keep clear of the speakers
        spots.push({ x, z, s: 0.88 + Math.random() * 0.25, ph: Math.random() * Math.PI * 2, j: 0.5 + Math.random() * 0.5, rot: (Math.random() - 0.5) * 0.6 });
      }
    }
    const ups = spots.filter((_, i) => i % 3 === 0), downs = spots.filter((_, i) => i % 3 !== 0);
    for (const [geo, list] of [[up, ups], [down, downs]]) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.frustumCulled = false;
      env.add(im); crowd.push({ im, list });
    }
    crowd.mat = mat;
  }

  // Lasers from a truss above the dance floor, sweeping toward the booth
  const lasers = [];
  {
    const geo = new THREE.CylinderGeometry(0.01, 0.01, 30, 5, 1, true); geo.translate(0, -15, 0);
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      g.position.set((i - 5.5) * 0.62, 3.9, -7.2);
      const m = new THREE.Mesh(geo, additive(0xffffff, 0.6));
      g.add(m); show.add(g);
      lasers.push({ g, m, i });
    }
    const truss = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0x222230, metalness: 0.7, roughness: 0.4 }));
    truss.position.set(0, 3.98, -7.2); env.add(truss);
  }

  // Rising sparks
  const sparks = (() => {
    const n = 420, pos = new Float32Array(n * 3), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 14, Math.random() * 6, -1.5 - Math.random() * 10], i * 3); spd[i] = 0.15 + Math.random() * 0.5; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.045, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; show.add(pts);
    return { pos, spd, g, mat, n };
  })();

  const dummy = new THREE.Object3D();

  function update(t, dt, fx) {
    const { hue, pulse, laser, playing, drop } = fx;
    const live = playing ? 1 : 0.12;
    const p = Math.min(1, pulse * live + drop * 0.8);
    C1.setHSL(hue, 1, 0.56); C2.setHSL((hue + 0.45) % 1, 1, 0.56);

    domeMat.uniforms.uTop.value.setHSL(hue, 0.8, 0.035 + 0.03 * p);
    domeMat.uniforms.uBot.value.setHSL((hue + 0.05) % 1, 0.9, 0.012);
    floorMat.uniforms.uColor.value.copy(C1);
    floorMat.uniforms.uColor2.value.copy(C2);
    floorMat.uniforms.uPulse.value = p;
    floorMat.uniforms.uTime.value = t;

    rings.forEach((r, i) => {
      const k = Math.exp(-(((t * 2 + i * 0.25) % 1)) * 3) * live;
      r.material.color.copy(i % 2 ? C2 : C1).multiplyScalar(0.25 + 0.9 * Math.max(p, k * 0.6));
      r.scale.setScalar(1 + 0.03 * p);
      r.rotation.z = t * (i % 2 ? 0.15 : -0.1);
    });

    for (const c of cones) {
      c.cone.scale.y = 1 + p * 1.2 * (c.r > 0.35 ? 1 : 0.5);
      c.ring.material.color.copy(C1).multiplyScalar(0.2 + 0.9 * p);
    }

    crowd.mat.color.setHSL(hue, 0.8, 0.003 + 0.012 * p);   // linear space: keep them silhouettes
    for (const { im, list } of crowd) {
      list.forEach((s, i) => {
        const jump = playing ? Math.pow(pulse, 1.5) * 0.18 * s.j + drop * 0.25 * s.j : 0;
        dummy.position.set(s.x, jump, s.z);
        dummy.rotation.set(0, s.rot + Math.sin(t * 0.7 + s.ph) * 0.15, Math.sin(t * 2.1 + s.ph) * (playing ? 0.08 : 0.03));
        dummy.scale.setScalar(s.s);
        dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }

    const lz = playing ? laser : 0;
    const speed = 0.25 + (fx.speed ?? 0.5) * 2.6 + drop * 2;
    for (const L of lasers) {
      const on = lz > 0.02 || drop > 0.05;
      L.g.visible = on;
      if (!on) continue;
      const i = L.i;
      L.g.rotation.x = -1.18 + Math.sin(t * speed * 0.6 + i * 0.7) * 0.22;
      L.g.rotation.z = Math.sin(t * speed * 0.45 + i * 1.3) * 0.55;
      tmp.copy(i % 2 ? C2 : C1);
      L.m.material.color.copy(tmp);
      L.m.material.opacity = Math.min(1, (lz * (0.18 + 0.82 * pulse)) + drop);
    }

    const sp = sparks;
    for (let i = 0; i < sp.n; i++) {
      let y = sp.pos[i * 3 + 1] + sp.spd[i] * dt * (0.4 + 2.5 * p);
      if (y > 6) y = 0;
      sp.pos[i * 3 + 1] = y;
    }
    sp.g.attributes.position.needsUpdate = true;
    sp.mat.color.copy(C2).lerp(C1, 0.5 + 0.5 * Math.sin(t));
    sp.mat.size = 0.035 + 0.04 * p;
  }

  return { env, show, update };
}
