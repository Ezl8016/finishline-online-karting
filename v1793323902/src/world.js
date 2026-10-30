// Scene: the modelled circuit (ground.js) inside the satellite-draped
// surroundings, extruded OSM buildings, trees seeded from the imagery, timing
// line, sky and sun for Biloxi.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildGround } from './ground.js';
import { buildTrees } from './trees.js';
import { buildParking } from './parking.js';
import { buildInterior } from './clubhouse.js';
import { buildBuildings, buildFlagStand, buildCones, buildBarriers, buildTyres, buildRailing, buildPatio, PATIO_TABLES, buildPatioFence, buildWalkway, buildPatioSlab } from './buildings.js';

// How far the grass sits below the pavement (m): two inches, enough to
// feel the lip when you run wide.
export const GRASS_DROP = 0.0508;
// Height of the block kerbs above the track (m); each white block is a ridge.
export const KERB_HEIGHT = 0.02;

const loader = new THREE.TextureLoader();
const loadTex = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

// Tileable value-noise texture used for close-range surface detail.
function noiseTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rnd = (x, y, s) => {
    const n = Math.sin((x % s) * 127.1 + (y % s) * 311.7 + s * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const smooth = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi, s), b = rnd(xi + 1, yi, s), c2 = rnd(xi, yi + 1, s), d = rnd(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c2 - a) * v + (a - b - c2 + d) * u * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // R: fine grain (asphalt aggregate), G: medium blotches, B: coarse
    const r = rnd(x, y, size);
    let gsum = 0, amp = 1, tot = 0;
    for (let o = 0; o < 4; o++) {
      const s = 8 << o;
      gsum += smooth(x * s / size, y * s / size, s) * amp; tot += amp; amp *= 0.5;
    }
    const b = smooth(x * 4 / size, y * 4 / size, 4);
    const i = (y * size + x) * 4;
    img.data[i] = r * 255; img.data[i + 1] = (gsum / tot) * 255; img.data[i + 2] = b * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// The scanned grass and asphalt (assets/ground), laid over the wide photo
// ground as detail; each divided by its average (linear) colour, so the photo
// keeps the colour and they add only texture. Off until both have loaded.
const wideDetail = (() => {
  const L = new THREE.TextureLoader(), u = {
    uGrassT: { value: null }, uAsphT: { value: null }, uDetailOn: { value: 0 },
    uGrassM: { value: new THREE.Vector3(0.061, 0.106, 0.021) }, uAsphM: { value: new THREE.Vector3(0.098, 0.098, 0.097) },
  };
  let n = 0;
  for (const [k, f] of [['uGrassT', 'grass'], ['uAsphT', 'asphalt']]) {
    u[k].value = L.load(`assets/ground/${f}_albedo.jpg`, () => { if (++n === 2) u.uDetailOn.value = 1; });
    u[k].value.colorSpace = THREE.SRGBColorSpace; u[k].value.wrapS = u[k].value.wrapT = THREE.RepeatWrapping; u[k].value.anisotropy = 8;
  }
  return { uniforms: u };
})();

// Ground material: satellite colour + world-scale detail driven by the surface map.
function groundMaterial(map, rect, surfaceTex, noise, detailRect) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: noise };
    sh.uniforms.uSurf = { value: surfaceTex };
    sh.uniforms.uDetailRect = { value: new THREE.Vector4(...detailRect) };
    Object.assign(sh.uniforms, wideDetail.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWorldXZ;
        uniform sampler2D uNoise; uniform sampler2D uSurf; uniform vec4 uDetailRect;
        uniform sampler2D uGrassT, uAsphT; uniform vec3 uGrassM, uAsphM; uniform float uDetailOn;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 su = (vWorldXZ - uDetailRect.xy) / (uDetailRect.zw - uDetailRect.xy);
          float inside = step(0.0, su.x) * step(su.x, 1.0) * step(0.0, su.y) * step(su.y, 1.0);
          float s = texture2D(uSurf, vec2(su.x, 1.0 - su.y)).r * inside;
          float asphalt = smoothstep(0.6, 0.95, s);
          float kerb = (1.0 - abs(s - 0.5) * 4.0) * inside;
          float fine = texture2D(uNoise, vWorldXZ * 1.7).r;
          float med = texture2D(uNoise, vWorldXZ * 0.11).g;
          float big = texture2D(uNoise, vWorldXZ * 0.013).b;
          // asphalt: aggregate speckle + subtle patching
          vec3 aCol = diffuseColor.rgb * (0.86 + 0.22 * fine) * (0.92 + 0.16 * med);
          // grass: blade noise and patchy colour so it doesn't look painted
          float blades = texture2D(uNoise, vWorldXZ * 4.3).r;
          vec3 gCol = diffuseColor.rgb * (0.78 + 0.36 * blades) * (0.85 + 0.3 * med) * mix(vec3(1.0), vec3(0.95, 1.05, 0.9), big);
          diffuseColor.rgb = mix(gCol, aCol, asphalt);
          // the scanned grass and asphalt's own detail, over the photo's colour
          // (green in the photo takes grass, the rest asphalt), sharp from the track
          if (uDetailOn > 0.5) {
            vec3 ph = diffuseColor.rgb;
            float green = smoothstep(0.355, 0.4, ph.g / max(ph.r + ph.g + ph.b, 1e-4));
            vec3 gd = texture2D(uGrassT, vWorldXZ * 0.5).rgb / uGrassM, ad = texture2D(uAsphT, vWorldXZ * 0.5).rgb / uAsphM;
            diffuseColor.rgb = ph * clamp(mix(ad, gd, green), 0.35, 2.2);
          }
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec2 su = (vWorldXZ - uDetailRect.xy) / (uDetailRect.zw - uDetailRect.xy);
          float s = texture2D(uSurf, vec2(su.x, 1.0 - su.y)).r;
          roughnessFactor = mix(1.0, 0.82, smoothstep(0.6, 0.95, s));
        }`);
  };
  return mat;
}

// The wide photo ground as a frame around the modelled circuit (hole =
// holeRect), with UVs over the whole wide photo.
function frameGeometry(rect, hole, y) {
  const [x0, z0, x1, z1] = rect, [h0, k0, h1, k1] = hole;
  const xs = [x0, h0, h1, x1], zs = [z0, k0, k1, z1];
  const pos = [], uv = [], idx = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    pos.push(xs[i], y, zs[j]);
    uv.push((xs[i] - x0) / (x1 - x0), 1 - (zs[j] - z0) / (z1 - z0));
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    if (i === 1 && j === 1) continue;            // the hole
    const a = j * 4 + i, b = a + 1, c = a + 4, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function planeForRect(rect, y, cell = 0) {
  const [x0, z0, x1, z1] = rect;
  const seg = (len) => cell ? Math.ceil(len / cell) : 1;
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, seg(x1 - x0), seg(z1 - z0));
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}


// groundAt(x, z): ground height (grass drop, kerbs, the hill), shared with the physics
export async function buildWorld(scene, renderer, track, groundAt = () => 0) {
  const [wideTex, detailTex, surfTex] = await Promise.all([
    loadTex('assets/aerial_wide.jpg'), loadTex('assets/aerial_detail.jpg'), loadTex('assets/surface.png'),
  ]);
  for (const t of [wideTex, detailTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  surfTex.colorSpace = THREE.NoColorSpace;
  surfTex.minFilter = THREE.LinearFilter;
  const noise = noiseTexture();

  // far ground beyond the imagery
  const far = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5e6b4a, roughness: 1 }));
  far.position.y = -0.12;
  far.receiveShadow = true;
  scene.add(far);

  // the surroundings: satellite photo around (not under) the modelled
  // circuit, level with its grass at the seam
  const wide = new THREE.Mesh(frameGeometry(track.wideRect, track.detailRect, -GRASS_DROP), groundMaterial(wideTex, track.wideRect, surfTex, noise, track.detailRect));
  wide.receiveShadow = true;
  scene.add(wide);

  scene.add(buildBuildings(track.buildings, track.wideRect, wideTex, groundAt, { clubhouse: track.clubhouse }));
  // inside the clubhouse (clubhouse.js)
  const clubSpec = scene.getObjectByName('clubhouse')?.userData.spec;
  const interior = clubSpec ? buildInterior(clubSpec) : null;
  if (interior) scene.add(interior.group);
  const trees = await buildTrees(track.trees, track, groundAt, renderer);
  scene.add(trees.group);
  // the starter's flag stand beside the finish line, facing it
  if (track.flagStand) scene.add(buildFlagStand(track.flagStand, track.finish || track.centerline[0], groundAt));
  if (track.railings?.length) scene.add(buildRailing(track.railings, groundAt));
  // the patio's tables and chairs, by the clubhouse
  if (track.railings?.length) scene.add(buildPatio(PATIO_TABLES, groundAt));
  const patioFence = track.railings?.length ? buildPatioFence(groundAt) : null;
  if (patioFence) scene.add(patioFence.group);
  if (track.railings?.length) scene.add(buildWalkway(groundAt), buildPatioSlab(groundAt));
  // cones closing the full track off from the short track
  // each layout's cones and barriers, shown only while it's the one driven
  const layoutGroups = {};
  for (const lay of track.layouts?.length ? track.layouts : [{ id: 'short', cones: track.cones, barriers: track.barriers }]) {
    const g = layoutGroups[lay.id] = new THREE.Group();
    if (lay.cones?.length) g.add(buildCones(lay.cones, groundAt));
    if (lay.barriers?.length) g.add(await buildBarriers(lay.barriers, groundAt));
    scene.add(g);
  }
  // red-and-white barriers across the openings to the full track, and the tyre walls
  if (track.tyres?.length) scene.add(buildTyres(track.tyres, groundAt));

  // chequered timing line across the track at centerline[0]
  const c = track.centerline, n = c.length;
  const dx = c[1][0] - c[n - 1][0], dz = c[1][1] - c[n - 1][1];
  const heading = Math.atan2(dx, dz);
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8;
  const cg = cv.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cg.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; cg.fillRect(i * 4, j * 4, 4, 4); }
  const ct = new THREE.CanvasTexture(cv); ct.magFilter = THREE.NearestFilter; ct.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.Mesh(new THREE.PlaneGeometry(track.trackWidth, 0.5).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: ct, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.position.set(c[0][0], groundAt(c[0][0], c[0][1]) + 0.005, c[0][1]);
  line.rotation.y = heading;          // plane's X axis ends up across the track
  line.receiveShadow = true;
  scene.add(line);

  // sky + sun (Biloxi, late afternoon in summer: sun in the WSW)
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const u = sky.material.uniforms;
  // clear Gulf Coast air: deep blue overhead, a pale band at the horizon
  u.turbidity.value = 2.4; u.rayleigh.value = 1.3; u.mieCoefficient.value = 0.0035; u.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 48), THREE.MathUtils.degToRad(250));
  u.sunPosition.value.copy(sunDir);
  gradeSky(sky.material);
  scene.add(sky);
  const clouds = buildClouds(sunDir);
  scene.add(clouds.mesh);

  // image-based lighting from the same sky, so paint, plastic and metal on
  // the kart pick up real reflections instead of looking flat (the ground
  // and scenery keep the plain sun + sky light they're tuned for)
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value;
  gradeSky(envSky.material);
  envScene.add(envSky);
  envScene.add(new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x55604a })));       // ground bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(envScene, 0.02).texture;   // the kart's and the pond's reflections
  // the car park's parked cars (they arrive a moment later)
  if (track.railings?.length) buildParking(groundAt, envMap).then(g => scene.add(g), (e) => console.warn('parked cars', e));
  pmrem.dispose();

  // the circuit itself: modelled ground, painted lines, kerbs, pond
  const grass = (await buildGround(scene, renderer, track, groundAt, detailTex, envMap)).userData.grass;

  // sky light from the same sky: shaded walls, trunks and the undersides of
  // crowns get soft blue-white skylight and a little green ground bounce
  scene.environment = envMap;
  scene.environmentIntensity = 0.55;
  const hemi = new THREE.HemisphereLight(0xcbd6e4, 0x5d6544, 0.5);
  scene.add(hemi);
  // warm afternoon sun
  const sun = new THREE.DirectionalLight(0xffecd2, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // blue distance haze, the colour of the sky at the horizon
  scene.fog = new THREE.Fog(0xa9c7e3, 450, 2600);

  // ---- the time of day and the weather (setConditions)
  const rain = buildRain();
  scene.add(rain.mesh);
  const world = {
    sun, sunDir, envMap, trees, grass, exposure: 0.56, patioFence, interior,
    // each frame: the trees near the camera, the breeze, drifting clouds, rain
    tick(cam, time) {
      trees.update(cam, time);
      grass.tick(cam, time);
      clouds.update(cam, time);
      rain.update(cam, time);
    },
    // time: 'afternoon' | 'evening' | 'overcast'; weather: 'dry' | 'rain'
    setConditions(time, weather) {
      const key = `${time}|${weather}`;
      if (key === this.conditions) return;
      this.conditions = key;
      const c = { ...LIGHT[weather === 'rain' && time !== 'evening' && time !== 'night' ? 'overcast' : time] || LIGHT.afternoon };
      if (weather === 'rain') Object.assign(c, { cover: 1, grey: 1, fog: [c.fog[0], 180, 1100], sunI: c.sunI * 0.7, hemiI: c.hemiI * 0.9, exposure: c.exposure * 0.92 });
      this.night = !!c.night;
      // (at night the "sun" is the moon: light from high up, never from below the ground)
      const lightDir = c.night ? new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(120)) : null;
      sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - c.elev), THREE.MathUtils.degToRad(c.az));
      for (const sk of [sky, envSky]) {
        const su = sk.material.uniforms;
        su.sunPosition.value.copy(sunDir);
        su.turbidity.value = c.turbidity; su.rayleigh.value = c.rayleigh; su.mieCoefficient.value = c.mie;
      }
      clouds.mat.uniforms.uSun.value.copy(sunDir);
      clouds.mat.uniforms.uCover.value = c.cover; clouds.mat.uniforms.uGrey.value = c.grey;
      clouds.mat.uniforms.uDim.value = c.night ? 0.07 : 1;       // (at night: faint, lit by the moon and the town)
      sun.color.set(c.sunC); sun.intensity = c.sunI;
      this.moonDir = lightDir;
      hemi.color.set(c.hemiC); hemi.intensity = c.hemiI;
      // how much the sky's light fills in (on everything that takes it from the
      // scene, the karts and drivers and buildings): kept below the sun's on a
      // clear day, so shapes and shadows read
      scene.environmentIntensity = c.envI ?? 1;
      // how lit smoke and dust are: the sun's light and the sky's (effects.js)
      this.smokeLight = new THREE.Color(c.sunC).multiplyScalar(c.sunI * 0.2).add(new THREE.Color(c.hemiC).multiplyScalar(c.hemiI * 0.55));
      if (c.night) this.smokeLight.add(new THREE.Color(0.55, 0.52, 0.48));      // (the floodlights)
      scene.fog.color.set(c.fog[0]); scene.fog.near = c.fog[1]; scene.fog.far = c.fog[2];
      this.exposure = c.exposure;
      rain.mesh.visible = weather === 'rain';
      // reflections from the new sky, swapped in wherever the old ones were used
      const pm = new THREE.PMREMGenerator(renderer);
      const fresh = pm.fromScene(envScene, 0.02).texture;
      pm.dispose();
      const old = this.envMap;
      scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m.envMap === old) m.envMap = fresh; });
      if (scene.environment === old) scene.environment = fresh;
      this.envMap = fresh;
      this.onEnvMap?.(fresh, old);
      old.dispose();
    },
    setLayout(id) { for (const [k, g] of Object.entries(layoutGroups)) g.visible = k === id; },
    followSun(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(this.moonDir || sunDir, 150);
    },
  };
  return world;
}

// The light for each time of day: sun height and bearing (degrees), the sky's
// haze, the sun and sky light, cloud cover, distance haze and exposure.
const LIGHT = {
  afternoon: { elev: 48, az: 250, turbidity: 2.4, rayleigh: 1.3, mie: 0.0035, sunC: 0xffe8c8, sunI: 3.7, hemiC: 0xcbd6e4, hemiI: 0.32, envI: 0.6,
    cover: 0, grey: 0, fog: [0xa9c7e3, 450, 2600], exposure: 0.56 },
  // golden hour: the sun low in the west, long shadows, warm light
  evening: { elev: 7, az: 262, turbidity: 4.5, rayleigh: 2.4, mie: 0.006, sunC: 0xffa860, sunI: 2.8, hemiC: 0xc8b8d8, hemiI: 0.35, envI: 0.7,
    cover: 0.25, grey: 0, fog: [0xd8b49a, 380, 2200], exposure: 0.66 },
  // a grey day: the sun behind cloud, soft light and faint shadows
  overcast: { elev: 42, az: 250, turbidity: 10, rayleigh: 3.2, mie: 0.02, sunC: 0xe6ebf0, sunI: 0.9, hemiC: 0xd6dde6, hemiI: 1.15,
    cover: 0.85, grey: 0.85, fog: [0xb7bec6, 260, 1700], exposure: 0.62 },
  // night: the sun well down, a deep blue sky and a little moonlight; the
  // floodlights light the track (floodlights.js)
  night: { elev: -14, az: 262, turbidity: 2, rayleigh: 0.6, mie: 0.002, sunC: 0x8fa6d6, sunI: 0.14, hemiC: 0x4a5878, hemiI: 0.16,
    cover: 0.15, grey: 0.6, fog: [0x10161f, 200, 1500], exposure: 0.62, night: true },
};

// Rain: streaks falling round the camera, slanted by the wind.
function buildRain() {
  const N = 4000, R = 32, H = 22;
  const pos = new Float32Array(N * 6), seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) seed.set([Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0.32, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    update(cam, time) {
      if (!mesh.visible) return;
      for (let i = 0; i < N; i++) {
        const sx = seed[i * 3], sy = seed[i * 3 + 1], sz = seed[i * 3 + 2];
        const y = cam.y + H * 0.5 - ((sy * H + time * 11) % H);
        const x = cam.x + sx * R + (y - cam.y) * 0.12, z = cam.z + sz * R;
        pos.set([x, y, z, x - 0.05, y - 0.45, z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Fair-weather cumulus: a layer of clouds 900 m up, drawn with layered noise,
// sunlit on top and grey underneath, drifting slowly and fading out towards
// the horizon so there's no edge.
function buildClouds(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: { value: sunDir.clone() }, uCam: { value: new THREE.Vector3() }, uCover: { value: 0 }, uGrey: { value: 0 }, uDim: { value: 1 } },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime, uCover, uGrey, uDim; uniform vec3 uSun, uCam;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz / 1400.0 + vec2(uTime * 0.004, uTime * 0.0015);
        float n = fbm(p);
        float d = smoothstep(0.52 - uCover * 0.42, 0.78 - uCover * 0.3, n);   // scattered cumulus (or, covered over, a grey deck)
        if (d < 0.01) discard;
        // thicker middles are darker underneath; tops toward the sun are bright
        float edge = fbm(p + (uSun.xz) * 0.03);
        float lit = clamp(0.55 + (n - edge) * 4.0, 0.25, 1.0);
        vec3 col = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.98, 0.95), lit) * 2.2;
        col = mix(col, vec3(0.6, 0.63, 0.67) * (1.2 + 0.5 * lit), uGrey);
        // fade with distance so the layer melts into the horizon haze
        float dist = length(vWorld.xz - uCam.xz);
        float fade = 1.0 - smoothstep(3000.0, 9000.0, dist);
        gl_FragColor = vec4(col * uDim, d * 0.92 * fade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(Math.PI / 2), mat);
  mesh.position.y = 900;
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh, mat,
    update(cam, time) {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uCam.value.copy(cam);
      mesh.position.x = cam.x; mesh.position.z = cam.z;
    },
  };
}

// The physical sky model comes out pale once tone-mapped; grade it towards a
// real clear day: more colour, and deeper blue overhead than at the horizon.
function gradeSky(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', `
      float skyLum = dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 graded = max( mix( vec3( skyLum ), retColor, 1.55 ), 0.0 );
      graded *= mix( 1.0, 0.72, smoothstep( 0.04, 0.55, direction.y ) );
      gl_FragColor = vec4( graded, 1.0 );`);
  };
}
