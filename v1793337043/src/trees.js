// Trees seeded from the satellite canopy: Gulf Coast live oaks (short trunk,
// heavy limbs spreading wide, a broad crown) and southern pines (tall bare
// trunk, crown bunched at the top), grown with ez-tree (vendor/ez-tree: real
// branching, bark and leaf textures). Colours come from the photo.
//
// 2,200 full trees would be far too many triangles, so only the trees near
// the camera are drawn as 3D trees; the rest are pictures of the same trees
// (impostors) standing upright and turned to face the camera. Which trees are
// near is worked out again as the camera moves.

import * as THREE from 'three';
import { Tree } from '../vendor/ez-tree/tree.js';

let NEAR = 120;            // m: closer than this, a tree is a real 3D tree (see setNear)
const NEAR_MAX = 140;      // at most this many 3D trees per kind
const IMPOSTOR_PX = 256;   // impostor picture width

// The kinds: two live oaks and two southern pines (ez-tree preset + tweaks;
// leaves dense enough that a crown reads solid from the track, not see-through)
const KINDS = [
  { kind: 'oak', preset: 'Oak Large', set: { seed: 777, 'branch.angle.1': 62, 'branch.start.1': 0.28, 'branch.length.0': 34, 'branch.length.1': 34,
    'branch.children.0': 6, 'branch.force.strength': -0.035, 'leaves.count': 20, 'leaves.size': 4.8 } },
  { kind: 'oak', preset: 'Oak Large', set: { seed: 3141, 'branch.angle.1': 56, 'branch.start.1': 0.3, 'branch.length.0': 36, 'branch.length.1': 30,
    'branch.children.0': 7, 'branch.force.strength': -0.02, 'leaves.count': 20, 'leaves.size': 4.8 } },
  { kind: 'pine', preset: 'Pine Large', set: { seed: 4242, 'branch.start.1': 0.62, 'branch.children.0': 45, 'branch.length.1': 16, 'branch.angle.1': 95,
    'branch.radius.0': 1.1, 'leaves.count': 24, 'leaves.size': 3.8 } },
  { kind: 'pine', preset: 'Pine Large', set: { seed: 9191, 'branch.start.1': 0.55, 'branch.children.0': 50, 'branch.length.1': 19, 'branch.angle.1': 105,
    'leaves.count': 24, 'leaves.size': 4.0 } },
];
// fewer rings and segments than the presets: they're seen from a kart, not up close
const LEAN = { 'branch.sections.0': 10, 'branch.segments.0': 8, 'branch.sections.1': 6, 'branch.segments.1': 4, 'branch.sections.2': 4, 'branch.segments.2': 3 };

const setPath = (o, path, v) => { const k = path.split('.'); let t = o; while (k.length > 1) t = t[k.shift()]; t[k[0]] = v; };

// grow a tree; returns its branch and leaf geometry (base at the origin) and size
function grow(spec) {
  const t = new Tree();
  t.loadPreset(spec.preset);
  for (const [k, v] of Object.entries({ ...LEAN, ...spec.set })) setPath(t.options, k, v);
  t.generate();
  const wood = t.branchesMesh.geometry, leaves = t.leavesMesh.geometry;
  // leaves lit as one rounded crown (half their own facing, half outwards
  // from the crown's middle), so the shaded side isn't flat black
  leaves.computeBoundingBox();
  const mid = leaves.boundingBox.getCenter(new THREE.Vector3());
  const pos = leaves.attributes.position, nor = leaves.attributes.normal, v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(mid).normalize();
    n.fromBufferAttribute(nor, i).multiplyScalar(0.4).add(v.multiplyScalar(0.6)).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  const box = new THREE.Box3().setFromBufferAttribute(wood.attributes.position).union(leaves.boundingBox);
  return { wood, leaves, size: box.getSize(new THREE.Vector3()),
    barkMaps: t.branchesMesh.material, leafMap: t.leavesMesh.material.map, tint: t.leavesMesh.material.color.clone() };
}

// a gentle breeze in the leaves: the higher up the crown, the more they move
function sway(mat) {
  const u = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
          float k = clamp(position.y / 40.0, 0.0, 1.0);
          transformed.x += k * (0.35 * sin(uTime * 1.3 + ph + position.y * 0.05) + 0.15 * sin(uTime * 3.1 + ph * 1.7));
          transformed.z += k * 0.25 * sin(uTime * 1.1 + ph * 0.6 + position.x * 0.05);
        }`);
  };
  return u;
}

// the picture of a tree for far away: rendered once from the side, then
// drawn standing on each far tree's spot, turned to face the camera
function impostor(renderer, t, wood, leaves) {
  const aspect = t.size.y / t.size.x;
  const W = IMPOSTOR_PX, H = Math.min(1024, Math.round(W * aspect));
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.LinearSRGBColorSpace, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  // even light from the sky and a sun up behind the camera: it's seen from every side
  scene.add(new THREE.HemisphereLight(0xdcebff, 0x4f5a3a, 1.4));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.8); sun.position.set(0.4, 1, 1); scene.add(sun);
  scene.add(new THREE.Mesh(t.wood, wood), new THREE.Mesh(t.leaves, leaves));
  const half = t.size.x / 2;
  const cam = new THREE.OrthographicCamera(-half, half, t.size.y, 0, -500, 500);
  cam.position.set(0, 0, 100); cam.lookAt(0, 0, 0);
  const prev = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), color: renderer.getClearColor(new THREE.Color()) };
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x2c3a24, 0);                 // (a leafy colour at the cut-out edges)
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.color, prev.alpha);
  return rt.texture;
}

// a texture's image has arrived
const loaded = (tex) => new Promise((res) => {
  const check = () => (tex?.image?.width ? res() : setTimeout(check, 40));
  check();
});

export async function buildTrees(list, track, groundAt, renderer) {
  const group = new THREE.Group();
  const grown = KINDS.map(grow);
  // the bark and leaf pictures must be in before the far-away pictures are taken
  await Promise.all(grown.flatMap(t => [t.leafMap, t.barkMaps.map, t.barkMaps.normalMap, t.barkMaps.aoMap, t.barkMaps.roughnessMap].filter(Boolean).map(loaded)));
  const kinds = KINDS.map((k, i) => {
    const t = grown[i];
    const bark = new THREE.MeshStandardMaterial({ map: t.barkMaps.map, normalMap: t.barkMaps.normalMap, aoMap: t.barkMaps.aoMap,
      roughnessMap: t.barkMaps.roughnessMap, color: k.kind === 'pine' ? 0xb8a898 : 0xa89c8c, roughness: 1 });
    const leafSpec = { map: t.leafMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8,
      // light through the leaves: shaded parts of a crown aren't black
      emissive: 0x16210d, emissiveIntensity: 1 };
    const leaf = new THREE.MeshStandardMaterial(leafSpec);
    const windU = sway(leaf);
    // (the far-away picture is taken with still leaves)
    return { ...k, ...t, bark, leaf, leafStill: new THREE.MeshStandardMaterial(leafSpec), windU };
  });

  // which kind each tree is: the tall ones are often pines
  const kindOf = (tr) => {
    const h = Math.abs(Math.sin(tr[0] * 12.9898 + tr[1] * 78.233) * 43758.5453) % 1;
    if (tr[3] > 10 && h < 0.45) return h < 0.22 ? 2 : 3;
    return h < 0.5 ? 0 : 1;
  };
  const trees = list.map((tr) => {
    const [x, z, r, h, cr, cg, cb] = tr;
    const ki = kindOf(tr), K = kinds[ki];
    const pine = K.kind === 'pine';
    const H = pine ? h * 1.35 : h * 0.95;                 // pines stand taller
    const R = pine ? r * 0.85 : r * 1.25;                 // oaks spread wider
    const sy = H / K.size.y, sxz = (2 * R) / Math.max(K.size.x, K.size.z);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (x * 7.7 + z * 3.1) % 6.28),
      new THREE.Vector3(sxz, sy, sxz));
    // the photo sees the sunlit top of the crown; keep its hue, settle the brightness
    const col = new THREE.Color().setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
    const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
    col.multiplyScalar(0.55 / Math.max(lum, 0.02)).lerp(new THREE.Color(1, 1, 1), 0.35);
    return { x, z, ki, m, col };
  });

  // the 3D trees (refilled as the camera moves) and the pictures (all the others)
  for (const K of kinds) {
    const n = trees.filter(t => t.ki === kinds.indexOf(K)).length;
    K.nearWood = new THREE.InstancedMesh(K.wood, K.bark, NEAR_MAX);
    K.nearLeaves = new THREE.InstancedMesh(K.leaves, K.leaf, NEAR_MAX);
    K.nearLeaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NEAR_MAX * 3), 3);
    for (const mesh of [K.nearWood, K.nearLeaves]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
    }
    const tex = impostor(renderer, K, K.bark, K.leafStill);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uSize: { value: new THREE.Vector2() } }]),
      vertexShader: IMPOSTOR_VS, fragmentShader: IMPOSTOR_FS, fog: true,
    });
    mat.uniforms.map.value = tex;
    mat.uniforms.uSize.value.set(K.size.x, K.size.y);
    const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    K.far = new THREE.InstancedMesh(plane, mat, n);
    K.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    K.far.count = 0; K.far.frustumCulled = false;
    group.add(K.far);
  }

  let lastX = Infinity, lastZ = Infinity;
  const fill = (cx, cz) => {
    const near = new Set(
      trees.map((t, i) => [i, (t.x - cx) ** 2 + (t.z - cz) ** 2]).filter(([, d]) => d < NEAR * NEAR)
        .sort((a, b) => a[1] - b[1]).map(([i]) => i));
    const used = kinds.map(() => 0), far = kinds.map(() => 0);
    trees.forEach((t, i) => {
      const K = kinds[t.ki];
      if (near.has(i) && used[t.ki] < NEAR_MAX) {
        const j = used[t.ki]++;
        K.nearWood.setMatrixAt(j, t.m); K.nearLeaves.setMatrixAt(j, t.m); K.nearLeaves.setColorAt(j, t.col);
      } else {
        const j = far[t.ki]++;
        K.far.setMatrixAt(j, t.m); K.far.setColorAt(j, t.col);
      }
    });
    kinds.forEach((K, k) => {
      K.nearWood.count = K.nearLeaves.count = used[k];
      K.far.count = far[k];
      for (const m of [K.nearWood, K.nearLeaves, K.far]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
  };
  fill(0, 0);

  return {
    group,
    // how far out trees are 3D (the Graphics setting): fewer is faster
    setNear(m) { NEAR = m; lastX = Infinity; },
    // each frame: the camera's position, and the time for the breeze
    update(cam, time) {
      for (const K of kinds) K.windU.uTime.value = time;
      if ((cam.x - lastX) ** 2 + (cam.z - lastZ) ** 2 < 15 * 15) return;
      lastX = cam.x; lastZ = cam.z;
      fill(cam.x, cam.z);
    },
  };
}

const IMPOSTOR_VS = `
  #include <common>
  #include <fog_pars_vertex>
  uniform vec2 uSize;
  varying vec2 vUv;
  varying vec3 vTint;
  void main() {
    vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
    vec3 to = cameraPosition - base; to.y = 0.0;
    to = normalize(to + vec3(1e-4, 0.0, 0.0));
    vec3 right = vec3(to.z, 0.0, -to.x);
    vec3 wp = base + right * position.x * sx * uSize.x + vec3(0.0, position.y * sy * uSize.y, 0.0);
    vUv = uv;
    vTint = instanceColor;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const IMPOSTOR_FS = `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec3 vTint;
  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.5) discard;
    gl_FragColor = vec4(t.rgb / max(t.a, 1e-3) * vTint, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
