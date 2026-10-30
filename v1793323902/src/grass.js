// Grass blades along the circuit: short, mown tufts on the grass either side
// of the track (what you see from the kart), where the ground's map says
// grass. Each blade takes its colour from the grass texture and the photo's
// tint right under it, so the tufts blend into the ground rather than sit on
// it, and they lean a little in the breeze. Grown in tiles; only the tiles
// near the camera are drawn (the range follows the graphics quality).

import * as THREE from 'three';

const BAND = [0.25, 7.0];   // m from the track's edge where tufts grow
const STEP = 0.22;          // m between tufts (jittered)
const TILE = 12;            // m: tufts are grouped in tiles this size
const BLADES = 9;           // per tuft

// one tuft: thin, slightly curved blades fanned round its root, every
// normal straight up (lit like the ground they grow from)
function tuftGeometry() {
  const pos = [], nrm = [], tip = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + Math.sin(b * 12.7) * 0.6, r = 0.012 + (b % 3) * 0.012;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r, w = 0.008 + (b % 2) * 0.004, h = 0.09 + ((b * 7) % 5) * 0.016;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w, lean = 0.025 + (b % 3) * 0.012;
    // two segments: base, middle (bent outward), tip
    const v = [[ox - px, 0, oz - pz, 0], [ox + px, 0, oz + pz, 0],
      [ox + Math.cos(a) * lean * 0.4 - px * 0.6, h * 0.55, oz + Math.sin(a) * lean * 0.4 - pz * 0.6, 0.55],
      [ox + Math.cos(a) * lean * 0.4 + px * 0.6, h * 0.55, oz + Math.sin(a) * lean * 0.4 + pz * 0.6, 0.55],
      [ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean, 1]];
    for (const t of [[0, 1, 3], [0, 3, 2], [2, 3, 4]]) for (const k of t) { pos.push(v[k][0], v[k][1], v[k][2]); nrm.push(0, 1, 0); tip.push(v[k][3]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  return g;
}

// where the map says grass: the weights image's green, read back on the CPU
function grassAt(weights, rect) {
  const img = weights.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, [x0, z0, x1, z1] = rect;
  return (x, z) => {
    const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
    const i = (Math.floor(v * c.height) * c.width + Math.floor(u * c.width)) * 4;
    return d[i + 1] / 255;
  };
}

export function buildGrass(track, groundAt, t) {
  const rect = track.detailRect, grass = grassAt(t.weights, rect), cl = track.centerline, hw = track.trackWidth / 2;
  // tufts in a band along both edges of the track, where it's grass
  const tiles = new Map();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < cl.length; i++) {
    const a = cl[i], b = cl[(i + 1) % cl.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
    for (let s = 0; s < len; s += STEP) {
      for (const side of [-1, 1]) {
        for (let o = hw + BAND[0]; o < hw + BAND[1]; o += STEP) {
          const along = s + (rnd() - 0.5) * STEP, off = (o + (rnd() - 0.5) * STEP) * side;
          const x = a[0] + tx * along - tz * off, z = a[1] + tz * along + tx * off;
          const w = grass(x, z);
          if (w < 0.55 || rnd() > (w - 0.55) / 0.3) continue;              // (thinning out where the grass meets dirt)
          const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
          let tile = tiles.get(key);
          if (!tile) tiles.set(key, tile = { cx: (Math.floor(x / TILE) + 0.5) * TILE, cz: (Math.floor(z / TILE) + 0.5) * TILE, at: [] });
          tile.at.push(x, groundAt(x, z), z, rnd() * Math.PI * 2, 0.75 + rnd() * 0.6);
        }
      }
    }
  }

  const uniforms = {
    uTime: { value: 0 }, uRect: { value: new THREE.Vector4(...rect) },
    uAlb: { value: t.albedo }, uTint: { value: t.tint }, uTile: { value: t.tile },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, envMap: t.envMap, envMapIntensity: 0.25 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float tip; attribute vec4 tuft;
        uniform float uTime;
        varying vec2 vRoot; varying float vTip;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // turned and sized per tuft, swaying with a breeze that rolls across the field
          float c = cos(tuft.w), s = sin(tuft.w);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          transformed *= tuft.z;
          vec2 root = instanceMatrix[3].xz;
          float gust = sin(uTime * 1.7 + root.x * 0.35 + root.y * 0.2) * 0.5 + sin(uTime * 3.1 + root.x * 1.3) * 0.2;
          transformed.xz += vec2(0.6, 0.35) * gust * 0.018 * tip * tip;
          vRoot = root; vTip = tip;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uAlb, uTint; uniform vec4 uRect; uniform float uTile;
        varying vec2 vRoot; varying float vTip;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // the ground's own colour under the tuft, a little lighter towards the tip
          vec2 uv = (vRoot - uRect.xy) / (uRect.zw - uRect.xy); uv.y = 1.0 - uv.y;
          vec3 g = texture2D(uAlb, vRoot * uTile).rgb * texture2D(uTint, uv).rgb * 2.0;
          diffuseColor.rgb = g * mix(0.7, 1.25, vTip) * vec3(0.97, 1.03, 0.92);
        }`)
      // (both faces lit as facing up, like the ground: a two-sided blade would otherwise go dark on its back)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'grassTufts';

  const geo = tuftGeometry(), group = new THREE.Group(), meshes = [];
  group.name = 'grass';
  const m = new THREE.Matrix4();
  for (const tile of tiles.values()) {
    const n = tile.at.length / 5, g = geo.clone();
    const tuft = new Float32Array(n * 4);
    const mesh = new THREE.InstancedMesh(g, mat, n);
    for (let k = 0; k < n; k++) {
      const [x, y, z, rot, sc] = tile.at.slice(k * 5, k * 5 + 5);
      mesh.setMatrixAt(k, m.makeTranslation(x, y, z));
      tuft.set([0, 0, sc, rot], k * 4);
    }
    g.setAttribute('tuft', new THREE.InstancedBufferAttribute(tuft, 4));
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.frustumCulled = true; mesh.computeBoundingSphere();
    mesh.visible = false;
    mesh.userData.c = [tile.cx, tile.cz];
    group.add(mesh); meshes.push(mesh);
  }
  let range = 40;
  return {
    group,
    count: meshes.reduce((s, x) => s + x.count, 0),
    setRange(r) { range = r; },
    tick(cam, time) {
      uniforms.uTime.value = time;
      for (const mesh of meshes) {
        const [x, z] = mesh.userData.c;
        mesh.visible = range > 0 && (x - cam.x) ** 2 + (z - cam.z) ** 2 < (range + TILE) ** 2;
      }
    },
  };
}
