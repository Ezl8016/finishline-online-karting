// Garage studio: the kart and driver on a plain backdrop with soft studio
// light, turning slowly. Drag to spin it, scroll to zoom; the camera moves in
// on the helmet while the driver is being customised.

import * as THREE from 'three';

function backdrop() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#fbfbfa');
  grad.addColorStop(0.62, '#ecebe8');
  grad.addColorStop(1, '#d9d8d4');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Showroom {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.scene.background = backdrop();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcac2, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2.5, 5, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -2; sc.right = sc.top = 2; sc.near = 0.5; sc.far = 15;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0005;
    const rim = new THREE.DirectionalLight(0xffe2d6, 1.2);
    rim.position.set(-3, 2.5, -4);
    this.scene.add(key, rim);
    // shadow catcher: only the kart's shadow shows on the backdrop
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.yaw = 0.7; this.pitch = 0.22; this.dist = 3.6;
    this.focus = 0;            // 0 = whole kart, 1 = helmet close-up
    this.wantFocus = 0;
    this.roomy = false;        // the close-up backed off to fit a hat (trying hats on)
    this.grabbedAt = -1e9;
    this.active = false;
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag.x) * 0.008;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - drag.y) * 0.005, 0.02, 1.2);
      drag = { x: e.clientX, y: e.clientY };
      this.grabbedAt = performance.now();
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 1.8, 7);
      this.grabbedAt = performance.now();
    }, { passive: false });
  }

  // panel: { right, bottom } pixels of the screen covered by the garage panel,
  // so the kart is framed in the space that's left
  render(renderer, dt, kartGroup, headPos, panel) {
    if (!this.wantFocus && performance.now() - this.grabbedAt > 4000) this.yaw += dt * 0.25;
    this.focus += (this.wantFocus - this.focus) * (1 - Math.exp(-4 * dt));
    const f = this.focus;
    const target = new THREE.Vector3(0, 0.3, 0).lerp(headPos.clone().add(new THREE.Vector3(0, this.roomy ? 0.14 : 0, 0)), f);
    // a tall, narrow space (a phone upright): back off so the whole kart fits across
    const room = (innerWidth - (panel.right || 0)) / Math.max(1, innerHeight - (panel.bottom || 0));
    const d = this.dist * Math.max(1, 1.3 / room, 1.15 * innerHeight / innerWidth) * (1 - f) + (this.roomy ? 1.7 : 1.05) * f;
    const p = this.pitch * (1 - f) + 0.12 * f;
    // the close-up swings round to look at the visor from the front quarter
    const toFront = ((Math.PI * 0.8 - this.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    const yaw = this.yaw + toFront * f;
    this.camera.position.set(target.x + Math.sin(yaw) * Math.cos(p) * d, target.y + Math.sin(p) * d, target.z + Math.cos(yaw) * Math.cos(p) * d);
    this.camera.lookAt(target);
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, (panel.right || 0) / 2, (panel.bottom || 0) / 2, w, h);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
