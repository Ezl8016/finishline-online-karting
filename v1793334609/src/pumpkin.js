// The Halloween 2026 pumpkin helmet: a pumpkin over the driver's head in
// place of the helmet (models/helmets/pumpkin.glb, made by
// tools/pumpkin2glb.py), a jack-o'-lantern face carved in the front, lit
// from inside. Only accounts made by the end of 1 November 2026 may wear it
// (driver.js: LIMITED_DESIGNS); everyone sees it on those who do.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

let model = null;
const load = () => (model ||= new GLTFLoader().loadAsync('models/helmets/pumpkin.glb').then(g => g.scene));

// the face: triangle eyes and nose, a toothy grin, glowing yellow at the
// middle of each hole, deeper orange at its cut edge
let faceTex = null;
function face() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  const hole = (draw) => {
    g.save(); draw(); g.clip();
    const gr = g.createRadialGradient(256, 300, 20, 256, 300, 300);
    gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.45, '#ffc93a'); gr.addColorStop(1, '#ff7a10');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.restore();
    draw(); g.lineWidth = 10; g.strokeStyle = 'rgba(150, 50, 0, 0.9)'; g.lineJoin = 'round'; g.stroke();
  };
  const poly = (pts) => () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  hole(poly([[70, 205], [200, 205], [148, 95]]));                 // eyes, tipped in a little
  hole(poly([[312, 205], [442, 205], [364, 95]]));
  hole(poly([[226, 290], [286, 290], [256, 238]]));               // nose
  // the grin: a wide crescent with three square teeth
  hole(() => {
    g.beginPath();
    g.moveTo(60, 315);
    g.quadraticCurveTo(256, 520, 452, 315);
    g.lineTo(400, 352); g.lineTo(372, 352); g.lineTo(372, 385); g.lineTo(316, 400); g.lineTo(316, 366);
    g.quadraticCurveTo(256, 382, 196, 366);
    g.lineTo(196, 400); g.lineTo(140, 385); g.lineTo(140, 352); g.lineTo(112, 352);
    g.closePath();
  });
  faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = 4;
  return faceTex;
}

// A pumpkin helmet: a group with the pumpkin centred on the origin, 1 wide
// (scale it to the helmet), its face to the front (-Z).
export async function pumpkinHelmet() {
  const src = await load();
  const p = src.clone(true);
  const box = new THREE.Box3().setFromObject(p), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  p.position.sub(mid);
  const g = new THREE.Group();
  g.add(p);
  g.scale.setScalar(1 / size.x);
  let skin = null;
  p.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.material = o.material.clone();
    if (o.material.name === 'pumpkin') { skin = o; o.material.roughness = 0.5; }
  });
  // the face, cut where a ray from the front meets the skin
  g.updateMatrixWorld(true);
  if (skin) {
    const h = size.y / size.x;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, -h * 0.04, -3), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObject(skin, false)[0];
    if (hit) {
      const look = new THREE.Object3D(); look.position.copy(hit.point); look.lookAt(hit.point.clone().add(new THREE.Vector3(0, 0, -1)));
      const geo = new DecalGeometry(skin, hit.point, look.rotation, new THREE.Vector3(0.78, 0.78, 0.8));
      // (the decal is made in the scaled group's world: bring it back into the pumpkin's own space)
      geo.applyMatrix4(new THREE.Matrix4().copy(p.matrixWorld).invert());
      const t = face();
      p.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, emissive: '#ffb02e', emissiveMap: t, emissiveIntensity: 1.3,
        transparent: true, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.6 })));
    }
  }
  return g;
}
