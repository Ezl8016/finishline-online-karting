// The top three on Fastest Drivers, standing on a podium in their own helmet
// and suit, each doing a celebration picked at random every time the board
// opens.

import * as THREE from 'three';
import { RacingDriver, EMOTES } from './driverModel.js';
import { HELMET_DEFAULT, DESIGNS, VISORS, FINISHES } from './driver.js';

// rank order: 1st centre and highest, 2nd on screen left, 3rd on screen right
// (the camera looks along +Z, so world +X is screen left)
const SPOTS = [
  { x: 0, h: 0.62 },
  { x: 1.15, h: 0.42 },
  { x: -1.15, h: 0.26 },
];

function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = n === 1 ? '#d42a2a' : '#22262b';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#fff';
  g.font = 'italic 900 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A stable made-up look for drivers who set their time before looks were saved.
function lookFor(name) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0) / 4294967296;
  const pick = (o) => { const k = Object.keys(o); return k[Math.floor(rnd() * k.length)]; };
  const col = () => `hsl(${Math.floor(rnd() * 360)}, ${55 + Math.floor(rnd() * 35)}%, ${35 + Math.floor(rnd() * 25)}%)`;
  const hex = (css) => '#' + new THREE.Color().setStyle(css).getHexString();
  return { ...HELMET_DEFAULT, design: pick(DESIGNS), visor: pick(VISORS), finish: pick(FINISHES),
    primary: hex(col()), secondary: hex(col()), accent: hex(col()), suit: hex(col()), gloves: hex(col()),
    number: String(1 + Math.floor(rnd() * 99)) };
}

// A bright photo-studio surround: soft white above, warm grey floor, and a
// few light panels, so glossy visors and helmets have something to reflect.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  const g = new THREE.SphereGeometry(20, 32, 16);
  const col = [], p = g.attributes.position, c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 20;
    c.setRGB(...(y > 0 ? [0.95 - 0.25 * y, 0.96 - 0.2 * y, 1.0] : [0.62, 0.6, 0.57]));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, w, h] of [[0, 12, -6, 14, 5], [-12, 6, 4, 6, 8], [12, 6, 4, 6, 8]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    panel.position.set(x, y, z); panel.lookAt(0, 0, 0);
    panel.material.color.multiplyScalar(3);
    env.add(panel);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  return tex;
}

export class Podium {
  constructor(canvas, envMap) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // reflections for visors and paint, made with this renderer: textures
    // from the game's own renderer can't be used here (separate WebGL context)
    envMap = studioEnvironment(this.renderer);
    const scene = this.scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcac2, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(1.5, 5, -4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
    const rim = new THREE.DirectionalLight(0xffe2d6, 1.0);
    rim.position.set(-3, 3, 4);
    scene.add(key, rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.2 }));
    floor.receiveShadow = true;
    scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(30, 2.4, 0.1, 50);
    this.camera.position.set(0, 1.55, -5.6);
    this.camera.lookAt(0, 1.22, 0);

    this.slots = SPOTS.map((s, i) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(1.0, s.h, 0.9),
        [0, 0, 0, 0, 0, 0].map((_, f) => new THREE.MeshStandardMaterial({
          color: f === 5 ? 0xffffff : 0xf2f1ee, roughness: 0.6, map: f === 5 ? numberTexture(i + 1) : null })));
      block.position.set(s.x, s.h / 2, 0);
      block.castShadow = block.receiveShadow = true;
      scene.add(block);
      const driver = new RacingDriver();
      if (envMap) driver.setEnvMap(envMap);
      driver.object.position.set(s.x, s.h, 0);          // drivers face -Z, towards the camera
      scene.add(driver.object);
      return { block, driver, emote: 'wave', phase: 0 };
    });
    this.running = false;
    this.t0 = performance.now();
  }

  // rows: [{ name, look }...] best first
  show(rows) {
    const names = Object.keys(EMOTES);
    const pool = names.slice().sort(() => Math.random() - 0.5);   // three different celebrations
    this.slots.forEach((slot, i) => {
      const r = rows[i];
      slot.block.visible = true;
      slot.driver.object.visible = !!r;
      if (!r) return;
      slot.driver.setHelmet(r.look || lookFor(r.name));
      slot.emote = pool[i % pool.length];
      slot.phase = Math.random() * 6;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return;
      if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      const t = (performance.now() - this.t0) / 1000;
      for (const s of this.slots) if (s.driver.object.visible) s.driver.stand(s.emote, t + s.phase);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stop() { this.running = false; }
}
