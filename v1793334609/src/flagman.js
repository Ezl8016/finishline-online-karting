// The flag marshal: a driver in white standing in the flag stand by the
// finish line, STEWARD across the back, waving the session's flag. Which
// flag is main.js's to say (flagNow): green, yellow, red, white (last lap)
// or chequered (the finish).

import * as THREE from 'three';
import { RacingDriver } from './driverModel.js';

export const FLAG_NAMES = { green: 'Green', yellow: 'Yellow', red: 'Red', white: 'White', chequered: 'Chequered' };
const COLOURS = { green: '#1f9e3a', yellow: '#f2c200', red: '#d42a2a', white: '#f4f4f4' };
const WHITE = { design: 'solid', primary: '#f4f4f4', secondary: '#f4f4f4', accent: '#f4f4f4', suit: '#f4f4f4',
  gloves: '#f4f4f4', visor: 'smoke', finish: 'gloss', number: '', hat: 'none' };
// where the marshal stands on the stand's deck (its local space: -Z towards the track)
const SPOT = [0.15, 1.54, -0.3];
const FLAG_W = 0.62, FLAG_H = 0.45, STICK = 0.7;

function chequered() {
  const c = document.createElement('canvas'); c.width = 96; c.height = 72;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; g.fillRect(i * 12, j * 12, 12, 12); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}
function backName(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 96px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#111';
  g.fillText(text, 256, 68, 500);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }));
  m.name = 'backName';
  return m;
}

// arm out over the rail, the flag swung side to side in front
const WAVE = 6.5;
const pose = (t) => ({ R: [0.08 + 0.12 * Math.sin(t * WAVE), 0.22, -0.42], L: [0.06, -0.52, -0.04], look: 0 });

export class Flagman {
  // at: the stand's [x, z]; facing: the [x, z] it faces (as buildFlagStand)
  constructor(at, facing, groundAt, envMap) {
    this.object = new THREE.Group();
    this.object.position.set(at[0], groundAt(at[0], at[1]), at[1]);
    this.object.rotation.y = Math.atan2(-(facing[0] - at[0]), -(facing[1] - at[1]));
    this.driver = new RacingDriver();
    this.driver.setHelmet(WHITE);
    if (envMap) this.driver.setEnvMap(envMap);
    this.driver.object.position.set(...SPOT);
    this.object.add(this.driver.object);
    // the flag: a stick, and a cloth that ripples
    this.flag = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, STICK, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.7 }));
    stick.position.y = STICK / 2 - 0.08;
    this.cloth = new THREE.Mesh(new THREE.PlaneGeometry(FLAG_W, FLAG_H, 10, 4),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 }));
    this.cloth.geometry.translate(FLAG_W / 2, -FLAG_H / 2, 0);
    this.cloth.position.y = STICK - 0.08;
    this.base = Float32Array.from(this.cloth.geometry.attributes.position.array);
    stick.castShadow = this.cloth.castShadow = true;
    this.flag.add(stick, this.cloth);
    this.chequer = chequered();
    this.kind = null;
    this.set('green');
    this.t = 0;
  }

  set(kind) {
    if (!FLAG_NAMES[kind] || kind === this.kind) return;
    this.kind = kind;
    const m = this.cloth.material;
    m.map = kind === 'chequered' ? this.chequer : null;
    m.color.set(kind === 'chequered' ? '#ffffff' : COLOURS[kind]);
    m.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    const d = this.driver;
    d.stand(pose, this.t);
    if (!d.ready) return;
    if (!this.dressed) {
      this.dressed = true;
      // STEWARD across the back, and the flag in the right hand
      // (on the back of the chest: the torso's own bounds, in the upper body's space)
      const box = new THREE.Box3();
      d.upper.updateMatrixWorld(true);
      const inv = d.upper.matrixWorld.clone().invert();
      for (const m of d.torsoMeshes) m.traverse((o) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o).applyMatrix4(inv)); });
      const name = backName('STEWARD');
      name.position.set((box.min.x + box.max.x) / 2, box.min.y + (box.max.y - box.min.y) * 0.78, box.max.z + 0.01);
      d.upper.add(name);
      d.holder.add(this.flag);
    }
    // in the hand, leaning with the swing
    const h = d.hands.R, sw = Math.sin(this.t * WAVE);
    this.flag.position.copy(h);
    this.flag.rotation.set(-0.7, Math.PI / 2, 0, 'YXZ');
    this.flag.rotateZ(-0.5 * sw);
    // the cloth trails the swing and ripples
    const p = this.cloth.geometry.attributes.position, b = this.base;
    const lag = Math.cos(this.t * WAVE);
    for (let i = 0; i < p.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1], k = x / FLAG_W;
      p.setXYZ(i, x, y - 0.06 * k * k, (0.05 * Math.sin(x * 9 - this.t * 12) + 0.25 * lag) * k);
    }
    p.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
  }
}
