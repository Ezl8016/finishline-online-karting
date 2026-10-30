// Floodlights: tall galvanised steel poles, each with a cross-arm of four
// lamp heads aimed at the tarmac. Where the real ones stand (REAL_POLES,
// found in the aerial photo by their cross-arms and shadows): a line of nine
// on the west boundary fence, between the service road and the circuit,
// lighting across it, and one tall pole in the north-east corner. In the day they're just poles; at
// night (world.js 'night') the lamps glow and light the track: the nearest
// few poles to the camera are real lights (spotlights, the closest casting
// shadows), the rest glow and add a soft pool of light on the ground under
// them, so the whole circuit reads lit without hundreds of lights.

import * as THREE from 'three';

// the real poles: [x, z, the way the lamps face (x, z)] (world m)
export const REAL_POLES = [[-72.9, -101.1], [-70.3, -87.8], [-73.5, -52.8], [-70.3, -26.3], [-74.1, -8.0], [-73.5, 18.1],
  [-72.9, 30.6], [-72.9, 45.8], [-72.2, 68.4]].map(([x, z]) => ({ x, z, ax: 1, az: 0 }))
  .concat([{ x: 65.2, z: -120.1, ax: -0.81, az: 0.58 }]);
const SPACING = 34;            // m between poles along the track (polePositions)
const OFFSET = 6.0;            // m from the centreline (track half-width 3.4 + room)
const CLEAR = 4.7;             // m every pole keeps from any track's centreline
const HEIGHT = 12;             // m: the lamps' height
const LIVE = 10;               // poles near the camera that are real lights (all of the real ones)
const SHADOWED = 2;            // of those, how many cast shadows

// where the poles go: [{ x, z, ax, az }] (ax, az: the way the lamps face, towards the track)
// extra: more spots to try ([x, z]: the pits), the lamps facing the nearest track
// keepOut: [x0, z0, x1, z1], an area with no poles (the clubhouse and its patio)
export function polePositions(lines, main, extra = [], keepOut = null) {
  const near = (x, z) => {
    let best = Infinity;
    for (const line of lines) for (let i = 0; i < line.length; i += 2) {
      const d = (line[i][0] - x) ** 2 + (line[i][1] - z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const out = [];
  let run = SPACING * 0.5;
  for (let i = 0; i < main.length; i++) {
    const a = main[i], b = main[(i + 1) % main.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    run += seg;
    if (run < SPACING) continue;
    const tx = (b[0] - a[0]) / (seg || 1), tz = (b[1] - a[1]) / (seg || 1);
    // both sides: the one further from any track wins, if it's clear
    let pick = null;
    for (const s of [1, -1]) {
      const x = a[0] - tz * OFFSET * s, z = a[1] + tx * OFFSET * s, d = near(x, z);
      const out_ = keepOut && x > keepOut[0] && x < keepOut[2] && z > keepOut[1] && z < keepOut[3];
      if (!out_ && d >= CLEAR && (!pick || d > pick.d)) pick = { x, z, d, ax: tz * s, az: -tx * s };
    }
    if (pick && !out.some(p => Math.hypot(p.x - pick.x, p.z - pick.z) < SPACING * 0.6)) { out.push(pick); run = 0; }
  }
  // (and a pole or two by the pits, lamps towards the nearest bit of track)
  for (const [x, z] of extra) {
    if (near(x, z) < CLEAR - 1.5 || out.some(p => Math.hypot(p.x - x, p.z - z) < 14)) continue;
    let bx = 0, bz = 0, bd = Infinity;
    for (const line of lines) for (const q of line) { const d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; bx = q[0]; bz = q[1]; } }
    const l = Math.hypot(bx - x, bz - z) || 1;
    out.push({ x, z, ax: (bx - x) / l, az: (bz - z) / l });
  }
  return out;
}

// the lamps' glow (a soft round halo, brightest in the middle)
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,246,225,0.55)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Floodlights {
  constructor(scene, positions, groundAt, envMap) {
    this.group = new THREE.Group();
    this.group.name = 'floodlights';
    scene.add(this.group);
    this.poles = positions.map(p => ({ ...p, y: groundAt(p.x, p.z) }));
    const steel = new THREE.MeshStandardMaterial({ color: 0x9ea3a8, metalness: 0.85, roughness: 0.42, envMap, envMapIntensity: 0.6 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.6, roughness: 0.5, envMap });
    this.lens = new THREE.MeshStandardMaterial({ color: 0xdedcd6, emissive: 0xfff3dd, emissiveIntensity: 0, roughness: 0.2 });
    // one of each part, instanced over every pole
    const n = this.poles.length, m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const inst = (geo, mat, per, place) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n * per);
      let k = 0;
      for (const p of this.poles) for (let j = 0; j < per; j++) mesh.setMatrixAt(k++, place(p, j));
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const yaw = (p) => Math.atan2(p.ax, p.az);
    // the pole: tapered, on a concrete footing, the arm at the top
    inst(new THREE.CylinderGeometry(0.09, 0.16, HEIGHT, 12).translate(0, HEIGHT / 2, 0), steel, 1, (p) => m.makeTranslation(p.x, p.y, p.z));
    inst(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 12).translate(0, 0.1, 0), new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 }), 1, (p) => m.makeTranslation(p.x, p.y, p.z));
    inst(new THREE.BoxGeometry(2.4, 0.1, 0.1), steel, 1, (p) => m.compose(new THREE.Vector3(p.x, p.y + HEIGHT - 0.25, p.z), q.setFromAxisAngle(Y, yaw(p)), one));
    // four lamp heads along the arm, tipped down towards the track
    const head = new THREE.BoxGeometry(0.5, 0.36, 0.14).translate(0, 0, 0.07);
    const face = new THREE.PlaneGeometry(0.44, 0.3).translate(0, 0, 0.142);
    const lampAt = (p, j) => {
      const r = new THREE.Quaternion().setFromAxisAngle(Y, yaw(p)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.75));
      const off = new THREE.Vector3((j - 1.5) * 0.58, 0, 0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(Y, yaw(p)));
      return m.compose(new THREE.Vector3(p.x + off.x, p.y + HEIGHT, p.z + off.z), r, one);
    };
    inst(head, housing, 4, lampAt);
    inst(face, this.lens, 4, lampAt);
    // night: a glow at each pole's lamps, and a soft pool of light on the ground
    this.glow = new THREE.Points(new THREE.BufferGeometry().setFromPoints(this.poles.map(p => new THREE.Vector3(p.x, p.y + HEIGHT, p.z))),
      new THREE.PointsMaterial({ size: 4.5, map: glowTexture(), color: 0xfff2dc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, sizeAttenuation: true, fog: false }));
    this.group.add(this.glow);
    const pool = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0d8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: -3 });
    this.pools = inst(new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI / 2), pool, 1, (p) => m.makeTranslation(p.x + p.ax * 6, groundAt(p.x + p.ax * 6, p.z + p.az * 6) + 0.05, p.z + p.az * 6));
    this.pools.castShadow = this.pools.receiveShadow = false;
    this.pools.renderOrder = 2;
    // the real lights, moved to the poles nearest the camera each frame
    this.lights = [];
    for (let i = 0; i < Math.min(LIVE, n); i++) {
      const l = new THREE.SpotLight(0xf3f1ff, 0, 180, 0.9, 0.7, 0.75);       // (LED white; they light right across the circuit: little falloff)
      l.castShadow = i < SHADOWED;
      if (l.castShadow) { l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0006; l.shadow.normalBias = 0.04; l.shadow.camera.near = 2; l.shadow.camera.far = 170; }
      this.group.add(l, l.target);
      this.lights.push(l);
    }
    this.on = 0;
  }

  // 0 off (day) .. 1 full (night)
  setOn(k) {
    this.on = k;
    this.lens.emissiveIntensity = 6 * k;
    this.glow.material.opacity = 0.9 * k;
    this.pools.material.opacity = 0.05 * k;
    for (const l of this.lights) l.visible = k > 0;
  }

  // poles that have something to collide with: [{ x, z, r }]
  get solids() { return this.poles.map(p => ({ x: p.x, z: p.z, y: p.y, r: 0.2, h: HEIGHT })); }

  update(cam) {
    if (!this.on) return;
    const order = this.poles.map((p, i) => [(p.x - cam.x) ** 2 + (p.z - cam.z) ** 2, i]).sort((a, b) => a[0] - b[0]);
    this.lights.forEach((l, k) => {
      const p = this.poles[order[k]?.[1]];
      if (!p) { l.visible = false; return; }
      l.position.set(p.x, p.y + HEIGHT, p.z);
      l.target.position.set(p.x + p.ax * 60, p.y, p.z + p.az * 60);
      l.intensity = 115 * this.on;
    });
  }
}
