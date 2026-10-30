// The modelled ground around the circuit: asphalt, grass, dirt and concrete
// drawn from scanned tileable textures (Poly Haven, CC0; imported by
// tools/import_textures.py), blended by a map of what's where
// (traced from the satellite photo) and tinted by the photo's broad colour so
// worn grass and the rubbered line look like the real place. On top of it:
// painted edge lines, the kerb blocks and the pond. Built by
// tools/build_ground.py into assets/ground/.

import * as THREE from 'three';
import { packedNormal } from './packed.js';
import { buildGrass } from './grass.js';

const loader = new THREE.TextureLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

const SURFACES = ['asphalt', 'grass', 'dirt', 'concrete'];
const TILE = { asphalt: 2.0, grass: 2.0, dirt: 4.0, concrete: 3.0 };   // metres per texture tile (each scan's real size)
const ROUGH = [1.05, 1.35, 1.15, 1.4];                                  // each scan's roughness (in its normal map's blue) scaled by
const BUMP = [0.55, 0.8, 0.7, 0.35];                                    // normal-map strength
const EDGE_FADE = 4;      // m: blend into the wide satellite ground (textured too, world.js) at the edge of the model

export async function buildGround(scene, renderer, track, groundAt, photo, envMap) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const [weights, tint, feats, ...tex] = await Promise.all([
    load('assets/ground/weights.png'), load('assets/ground/tint.png'),
    fetch('assets/ground/features.json').then(r => r.json()),
    ...SURFACES.flatMap(s => [load(`assets/ground/${s}_albedo.jpg`), load(`assets/ground/${s}_normal.jpg`)]),
    load('assets/ground/water_normal.jpg'),
  ]);
  for (const t of [weights, tint]) { t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  const albedo = [], normal = [];
  SURFACES.forEach((_, i) => {
    const a = tex[i * 2], n = tex[i * 2 + 1];
    a.colorSpace = THREE.SRGBColorSpace; n.colorSpace = THREE.NoColorSpace;
    for (const t of [a, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; }
    albedo.push(a); normal.push(n);
  });
  const waterN = tex[tex.length - 1];
  waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping; waterN.colorSpace = THREE.NoColorSpace;

  const group = new THREE.Group();
  const ground = groundMesh(track, groundAt, { weights, tint, albedo, normal, photo, envMap }, feats.pond);
  group.add(ground);
  group.add(lineMesh(feats.lines, groundAt));
  const kerbs = kerbMesh(feats.kerbs, groundAt, albedo[3], normal[3]);
  group.add(kerbs);
  // the rain: the track wet (world.js setConditions); painted kerbs go slick
  group.userData.setWet = (k) => { ground.userData.setWet(k); kerbs.material.roughness = 1.4 - 0.9 * k; };
  group.userData.tick = ground.userData.tick;
  group.add(pondMesh(feats.pond, groundAt, waterN, envMap));
  // grass blades along the track's edges
  const grass = buildGrass(track, groundAt, { weights, tint, albedo: albedo[1], tile: 1 / TILE.grass, envMap });
  group.add(grass.group);
  group.userData.grass = grass;
  scene.add(group);
  return group;
}

// ---------------------------------------------------------------- ground
// Is (x, z) inside the polygon? Returns the distance to its edge if so, else 0.
function insideBy(poly, x, z) {
  let inside = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const ex = xj - xi, ez = zj - zi, L = ex * ex + ez * ez || 1;
    const f = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / L));
    d = Math.min(d, Math.hypot(xi + ex * f - x, zi + ez * f - z));
  }
  return inside ? d : 0;
}

function groundMesh(track, groundAt, t, pond) {
  const [x0, z0, x1, z1] = track.detailRect;
  // 0.25 m grid shaped like the physics ground (grass lip, kerbs, hill)
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / 0.25), Math.ceil((z1 - z0) / 0.25));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = g.attributes.position;
  // the pond bed: a shallow bowl under the water (looks only; you can't drive there)
  const px = pond.map(p => p[0]), pz = pond.map(p => p[1]);
  const [bx0, bx1, bz0, bz1] = [Math.min(...px), Math.max(...px), Math.min(...pz), Math.max(...pz)];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = groundAt(x, z);
    if (x > bx0 && x < bx1 && z > bz0 && z < bz1) y -= 0.6 * Math.min(1, insideBy(pond, x, z) / 2.5);
    pos.setY(i, y);
  }
  g.computeVertexNormals();

  // less sky light on the ground than on upright things: it's what turned
  // the asphalt (and pale concrete in shade) blue
  // (its own env map, so the intensity holds: the scene's environment ignores a material's)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMap: t.envMap, envMapIntensity: 0.25 });
  const wet = { value: 0 }, rainT = { value: 0 };    // wet: 0 dry .. 1 soaked (setWet); the time, for the ripples
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uWet: wet, uRainT: rainT,
      uRect: { value: new THREE.Vector4(x0, z0, x1, z1) },
      uW: { value: t.weights }, uTint: { value: t.tint }, uPhoto: { value: t.photo },
      uA0: { value: t.albedo[0] }, uA1: { value: t.albedo[1] }, uA2: { value: t.albedo[2] }, uA3: { value: t.albedo[3] },
      uN0: { value: t.normal[0] }, uN1: { value: t.normal[1] }, uN2: { value: t.normal[2] }, uN3: { value: t.normal[3] },
      uTile: { value: new THREE.Vector4(...SURFACES.map(s => 1 / TILE[s])) },
      uRough: { value: new THREE.Vector4(...ROUGH) }, uBump: { value: new THREE.Vector4(...BUMP) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        uniform vec4 uRect, uTile, uRough, uBump; uniform float uWet, uRainT;
        float gPud;
        uniform sampler2D uW, uTint, uPhoto, uA0, uA1, uA2, uA3, uN0, uN1, uN2, uN3;
        vec4 gW; vec2 gUV; float gFade;
        // cheap hash noise, to break up texture tiling and soften class edges
        float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y);
        }
        // rain on standing water: rings spreading from where drops land, one
        // to a cell, each on its own beat; returns which way the surface tips
        vec2 ripples(vec2 p) {
          vec2 sum = vec2(0.0);
          for (int k = 0; k < 2; k++) {
            vec2 g = p * (1.3 + float(k) * 0.6) + float(k) * 17.3, id = floor(g), f = fract(g) - 0.5;
            float s = hsh(id + float(k) * 7.0), ph = fract(uRainT * (0.7 + 0.5 * s) + s * 9.0);
            vec2 d = f - (vec2(hsh(id + 1.3), hsh(id + 2.7)) - 0.5) * 0.5;
            float r = length(d) + 1e-3, at = ph * 0.24;
            sum += d / r * sin((r - at) * 60.0) * smoothstep(0.07, 0.0, abs(r - at)) * (1.0 - ph) * (1.0 - ph);
          }
          return sum;
        }
        // each texture sampled twice, at two scales and angles, and blended by
        // low-frequency noise, so the repeat doesn't show from a distance
        vec4 tileTex(sampler2D s, vec2 p, float k) {
          vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p * 0.43 + 17.3;
          return mix(texture2D(s, p * k), texture2D(s, q * k), smoothstep(0.3, 0.7, vnoise(p * 0.07)));
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 xz = vWPos.xz;
          gUV = (xz - uRect.xy) / (uRect.zw - uRect.xy);
          gUV.y = 1.0 - gUV.y;
          vec3 w3 = texture2D(uW, gUV).rgb;
          vec4 w = vec4(w3, max(0.0, 1.0 - w3.r - w3.g - w3.b));
          // ragged, natural edges between surfaces instead of a smooth blur
          float n1 = vnoise(xz * 3.1) * 0.6 + vnoise(xz * 9.7) * 0.4;
          w = pow(max(w, 0.0), vec4(1.4)) * (0.85 + 0.3 * vec4(n1, 1.0 - n1, n1, 1.0 - n1));
          w /= max(dot(w, vec4(1.0)), 1e-3);
          gW = w;
          // only sample the surfaces present here (most pixels are just one)
          // (asphalt warmed a touch: under a blue sky it otherwise reads purple)
          vec3 c = vec3(0.0);
          if (w.x > 0.004) c += tileTex(uA0, xz, uTile.x).rgb * vec3(1.05, 1.0, 0.92) * w.x;
          if (w.y > 0.004) c += tileTex(uA1, xz, uTile.y).rgb * w.y;
          if (w.z > 0.004) c += tileTex(uA2, xz, uTile.z).rgb * w.z;
          if (w.w > 0.004) c += tileTex(uA3, xz, uTile.w).rgb * w.w;
          // grit and small stones dragged onto the tarmac where a dirt run-off meets it
          if (w.x > 0.3) {
            vec2 o = vec2(0.8) / (uRect.zw - uRect.xy);
            float dn = max(max(texture2D(uW, gUV + vec2(o.x, 0.0)).b, texture2D(uW, gUV - vec2(o.x, 0.0)).b),
                           max(texture2D(uW, gUV + vec2(0.0, o.y)).b, texture2D(uW, gUV - vec2(0.0, o.y)).b));
            float grit = smoothstep(0.58, 0.86, vnoise(xz * 7.0) * 0.6 + vnoise(xz * 23.0) * 0.4) * smoothstep(0.15, 0.6, dn) * w.x;
            c = mix(c, tileTex(uA2, xz, uTile.z).rgb * 0.95, grit * 0.85);
          }
          // the photo's broad colour (worn grass, rubber, patches), as a ratio;
          // on the tarmac a little stronger, so the rubbered line reads
          vec3 tint = texture2D(uTint, gUV).rgb * 2.0;
          tint = mix(tint, 1.0 + (tint - 1.0) * 1.45, w.x);
          c *= mix(vec3(1.0), tint, 0.85 - 0.55 * w.w);   // less on concrete: parked karts aren't stains
          // fade into the satellite photo at the edge of the modelled area
          vec2 e = min(xz - uRect.xy, uRect.zw - xz);
          gFade = smoothstep(0.0, ${EDGE_FADE.toFixed(1)}, min(e.x, e.y));
          // wet: tarmac and concrete go dark as water soaks in (grass a little), and
          // water stands in the low patches: puddles, smooth as glass
          float hard = w.x + w.w;
          gPud = uWet * hard * smoothstep(0.58, 0.72, vnoise(xz * 0.31) * 0.7 + vnoise(xz * 1.7) * 0.3);
          c *= 1.0 - uWet * (0.5 * hard + 0.18 * w.y);
          c *= 1.0 - gPud * 0.25;
          diffuseColor.rgb = gFade < 1.0 ? mix(texture2D(uPhoto, gUV).rgb, c, gFade) : c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          // each scan's own roughness (rubber, grit, polished concrete), from its normal map's blue
          vec2 xz = vWPos.xz;
          float r = 0.0;
          if (gW.x > 0.004) r += tileTex(uN0, xz, uTile.x).b * uRough.x * gW.x;
          if (gW.y > 0.004) r += tileTex(uN1, xz, uTile.y).b * uRough.y * gW.y;
          if (gW.z > 0.004) r += tileTex(uN2, xz, uTile.z).b * uRough.z * gW.z;
          if (gW.w > 0.004) r += tileTex(uN3, xz, uTile.w).b * uRough.w * gW.w;
          roughnessFactor = mix(0.95, clamp(r, 0.3, 1.0), gFade);
          // wet: a sheen over the hard surfaces, mirror-smooth in the puddles
          roughnessFactor = mix(roughnessFactor, 0.55, uWet * (gW.x + gW.w) * gFade);
          roughnessFactor = mix(roughnessFactor, 0.2, gPud * gFade);
        }`)
      // a floodlight's reflection in wet tarmac stays a bright sheen, not a white-out through the bloom
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uWet > 0.0) reflectedLight.directSpecular /= 1.0 + dot(reflectedLight.directSpecular, vec3(0.33)) / 0.45;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 xz = vWPos.xz;
          vec2 b = vec2(0.0);
          if (gW.x > 0.004) b += (tileTex(uN0, xz, uTile.x).xy * 2.0 - 1.0) * gW.x * uBump.x;
          if (gW.y > 0.004) b += (tileTex(uN1, xz, uTile.y).xy * 2.0 - 1.0) * gW.y * uBump.y;
          if (gW.z > 0.004) b += (tileTex(uN2, xz, uTile.z).xy * 2.0 - 1.0) * gW.z * uBump.z;
          if (gW.w > 0.004) b += (tileTex(uN3, xz, uTile.w).xy * 2.0 - 1.0) * gW.w * uBump.w;
          // texture x along world +x, texture y (up the image) along world -z
          vec3 nw = normalize(normalize(vWNrm) + vec3(b.x, 0.0, -b.y) * gFade * (1.0 - 0.85 * gPud));   // (water fills the texture)
          if (gPud > 0.01) { vec2 rp = ripples(xz); nw = normalize(nw + vec3(rp.x, 0.0, rp.y) * 0.32 * gPud); }
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  // in tiles, so the ones behind and beside the camera aren't drawn
  const nx = Math.ceil((x1 - x0) / 0.25), nz = Math.ceil((z1 - z0) / 0.25), W = nx + 1, CELLS = 128;   // (32 m tiles)
  const out = new THREE.Group();
  for (let iz0 = 0; iz0 < nz; iz0 += CELLS) {
    for (let ix0 = 0; ix0 < nx; ix0 += CELLS) {
      const ix1 = Math.min(nx, ix0 + CELLS), iz1 = Math.min(nz, iz0 + CELLS), w = ix1 - ix0 + 1;
      const tile = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const src = g.attributes[name], k = src.itemSize, arr = new Float32Array(w * (iz1 - iz0 + 1) * k);
        let o = 0;
        for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const v = (iz * W + ix) * k; for (let c = 0; c < k; c++) arr[o++] = src.array[v + c]; }
        tile.setAttribute(name, new THREE.BufferAttribute(arr, k));
      }
      const idx = [];
      for (let iz = 0; iz < iz1 - iz0; iz++) for (let ix = 0; ix < ix1 - ix0; ix++) {
        const a = iz * w + ix, b = (iz + 1) * w + ix, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
      tile.setIndex(idx);
      tile.computeBoundingSphere();
      const mesh = new THREE.Mesh(tile, mat);
      mesh.receiveShadow = true;
      out.add(mesh);
    }
  }
  g.dispose();
  // wet (rain): darker, shinier, puddles; and the sky reflects more strongly
  out.userData.setWet = (k) => { wet.value = k; mat.envMapIntensity = 0.25 + 0.2 * k; };
  out.userData.tick = (t) => { rainT.value = t % 1000; };
  return out;
}

// ---------------------------------------------------------------- painted lines
// 10 cm ribbons just above the ground; 'r' stretches are the red-and-white
// painted kerbs: 70 cm bands, striped every metre. Slightly worn: paint
// isn't pure white.
function lineMesh(lines, groundAt) {
  const pos = [], col = [], idx = [];
  const white = new THREE.Color(0.80, 0.80, 0.77), red = new THREE.Color(0.62, 0.11, 0.09);
  const HW = 0.05, LIFT = 0.006;
  for (const l of lines) {
    const P = l.pts;
    if (P.length < 2) continue;
    let dist = 0;
    const base = pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i) dist += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const isRed = l.col[i] === 'r';
      const c = isRed && Math.floor(dist) % 2 === 0 ? red : white;
      // the band grows inward (onto the pavement) from the edge line
      const hw = isRed ? 0.35 : HW, inset = isRed ? 0.3 : 0;
      const wear = 0.9 + 0.1 * Math.sin(dist * 7.3) * Math.sin(dist * 2.1);
      for (const s of [-1, 1]) {
        const o = hw * s + inset * (l.in ?? 1);
        const x = P[i][0] - tz * o, z = P[i][1] + tx * o;
        pos.push(x, groundAt(x, z) + LIFT, z);
        col.push(c.r * wear, c.g * wear, c.b * wear);
      }
      // both windings, so one of them always faces up (the other is culled)
      if (i) { const k = base + i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1, k - 2, k - 1, k, k - 1, k + 1, k); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // flat paint: lit as facing up whichever way round each line was traced
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- kerbs
// Concrete kerb blocks, ~1 m long, painted alternately red and white, as
// the real ones are, following the pavement edge. Their tops follow the (already raised)
// ground; the sides drop a few cm so each block reads as a solid slab with
// grout gaps between.
function kerbMesh(runs, groundAt, concrete, concreteN) {
  const pos = [], col = [], uv = [], idx = [];
  const white = new THREE.Color(0.86, 0.86, 0.83), red = new THREE.Color(0.6, 0.08, 0.06);
  const BLOCK = 1.0, GAP = 0.03, LIFT = 0.004, SKIRT = 0.04, ACROSS = 4;
  const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
  let blockNo = 0;
  for (const r of runs) {
    const P = r.pts, Nn = r.n;
    // arc length along the edge
    const s = [0];
    for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = s[s.length - 1];
    const at = (d) => {      // point + outward normal at arc length d
      let i = 1;
      while (i < s.length - 1 && s[i] < d) i++;
      const f = Math.min(1, Math.max(0, (d - s[i - 1]) / ((s[i] - s[i - 1]) || 1)));
      const lerp = (u, v) => u + (v - u) * f;
      let nx = lerp(Nn[i - 1][0], Nn[i][0]), nz = lerp(Nn[i - 1][1], Nn[i][1]);
      const nl = Math.hypot(nx, nz) || 1;
      return [lerp(P[i - 1][0], P[i][0]), lerp(P[i - 1][1], P[i][1]), nx / nl, nz / nl];
    };
    const count = Math.max(1, Math.round(total / BLOCK));
    const len = total / count;
    for (let b = 0; b < count; b++, blockNo++) {
      const c = blockNo % 2 ? red : white;
      const d0 = b * len + GAP / 2, d1 = (b + 1) * len - GAP / 2;
      const STEPS = 3;
      const grid = [];      // [along][across] -> vertex index (top)
      for (let k = 0; k <= STEPS; k++) {
        const [px, pz, nx, nz] = at(d0 + (d1 - d0) * k / STEPS);
        const row = [];
        for (let j = 0; j <= ACROSS; j++) {
          const o = r.offset + r.depth * j / ACROSS;
          const x = px + nx * o, z = pz + nz * o;
          // rounded inner edge: the first strip slopes up from the asphalt
          const y = groundAt(x, z) + LIFT - (j === 0 ? 0.012 : 0);
          row.push(pos.length / 3);
          pos.push(x, y, z); col.push(c.r, c.g, c.b); uv.push(x / 3, z / 3);
        }
        grid.push(row);
      }
      // wind the top to face up, whichever way round this run was traced
      const v = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const [a0, b0, c0] = [v(grid[0][0]), v(grid[0][ACROSS]), v(grid[STEPS][0])];
      const up = (b0[2] - a0[2]) * (c0[0] - a0[0]) - (b0[0] - a0[0]) * (c0[2] - a0[2]) > 0;
      for (let k = 0; k < STEPS; k++) for (let j = 0; j < ACROSS; j++) {
        if (up) quad(grid[k][j], grid[k][j + 1], grid[k + 1][j + 1], grid[k + 1][j]);
        else quad(grid[k][j], grid[k + 1][j], grid[k + 1][j + 1], grid[k][j + 1]);
      }
      // skirts on all four sides, down into the ground
      const skirt = (a, b) => {
        const i0 = pos.length / 3;
        for (const v of [a, b]) {
          pos.push(pos[v * 3], pos[v * 3 + 1] - SKIRT, pos[v * 3 + 2]);
          col.push(c.r * 0.7, c.g * 0.7, c.b * 0.7); uv.push(uv[v * 2], uv[v * 2 + 1]);
        }
        quad(a, i0, i0 + 1, b);
      };
      for (let k = 0; k < STEPS; k++) { skirt(grid[k + 1][0], grid[k][0]); skirt(grid[k][ACROSS], grid[k + 1][ACROSS]); }
      for (let j = 0; j < ACROSS; j++) { skirt(grid[0][j], grid[0][j + 1]); skirt(grid[STEPS][j + 1], grid[STEPS][j]); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = packedNormal(new THREE.MeshStandardMaterial({
    vertexColors: true, map: concrete, normalMap: concreteN, roughness: 1.4, side: THREE.DoubleSide,
  }));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- pond
function pondMesh(outline, groundAt, rippleN, envMap) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(-Math.PI / 2);            // shape's y (= -z) becomes world z
  const rim = Math.min(...outline.map(([x, z]) => groundAt(x, z)));
  const uvs = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) uvs.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
  const mat = new THREE.MeshPhysicalMaterial({
    // murky green water that mirrors the sky, strongest at low angles
    color: 0x1a2e1f, roughness: 0.12, metalness: 0, ior: 1.33, specularIntensity: 0.6,
    normalMap: rippleN, normalScale: new THREE.Vector2(0.12, 0.12), envMap, envMapIntensity: 0.55,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.y = rim - 0.02;          // just below the bank; the bed is well below
  m.receiveShadow = true;
  // a slow drift of the ripples
  m.onBeforeRender = () => { rippleN.offset.set(performance.now() * 0.000012, performance.now() * 0.000007); };
  return m;
}
