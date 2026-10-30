import * as THREE from 'three';
import RAPIER from 'rapier';
import { buildWorld, GRASS_DROP, KERB_HEIGHT } from './world.js';
import { KartPhysics, KART, draftOf } from './physics/kart.js';
import { loadKartModel, finishKart } from './kartModel.js';
import { Garage } from './garage.js';
import { HELMET_DEFAULT, DESIGNS, OWN_DESIGNS, LIMITED_DESIGNS, SHOP_DESIGNS, designAllowed, VISORS, FINISHES, ADMIN_FINISHES } from './driver.js';
import { HATS, ADMIN_HATS, hatAllowed } from './hats.js';
import { SUITS, SHOP_SUITS } from './suits.js';
import { POINTS as SHOP_POINTS, priceOf, TESTERS, KINDS, THEME_NAMES, shopItems, nextReset, balance, owns, itemId, parseItem, MUSIC } from './shop.js';
import { lookPicture } from './wardrobe.js';
import { Walker } from './walk.js';
import { Effects } from './effects.js';
import { Post } from './post.js';
import { Floodlights, REAL_POLES } from './floodlights.js';
import { tierOf } from './rarity.js';
import { RacingDriver } from './driverModel.js';
import { Flagman, FLAG_NAMES } from './flagman.js';
import { hitboxOf, boxHull } from './hitbox.js';
import { Contacts, CONTACT } from './contact.js';
import { PARKED } from './parking.js';
import { PATIO_TABLES, PATIO_SLAB, FENCE_RUNS, WALKWAY, tyreGeometry, buildCones } from './buildings.js';
import { buildPits, parkKarts } from './pits.js';
import { Ghost } from './ghost.js';
import { Bots, botSpec } from './bots.js';
import { Stats, ACHIEVEMENTS } from './profile.js';
import { Input } from './input.js';
import { KartAudio } from './audio.js';
import { Ambience } from './ambience.js';
import { LapTimer, fmt } from './timing.js';
import { Leaderboard } from './leaderboard.js';
import { Podium } from './podium.js';
import { Account } from './account.js';
import { kartThumb, kartPicture } from './thumbs.js';
import { Showroom } from './showroom.js';
import { applyPaint, PAINT_DEFAULT, PAINT_FINISHES, LIVERIES, SHOP_LIVERIES, liveryKey } from './paint.js';
import { Hud } from './hud.js';
import { Music, ARTISTS } from './music.js';
import { TYRE_TEMP, gripFromTemp } from './physics/tire.js';
import { Net, newCode, cleanCode, MAX_PLAYERS } from './net.js';
import { RemoteKart } from './remoteKart.js';
import { TouchControls } from './touch.js';
import { Voice } from './voice.js';
import { Admin, ADMIN_UIDS } from './admin.js';

const STEP = 1 / 240;
const $ = (id) => document.getElementById(id);
const status = (t) => { $('loadState').textContent = t; };

// ---------------------------------------------------------------- renderer
const canvas = $('view');
// ?shots: render a fixed tour of viewpoints and send them to the local server
// (tools/shots/), to check how the circuit looks without driving it
const SHOTS = new URLSearchParams(location.search).has('shots');
// local testing only: ?norender runs the game without drawing it (headless
// browsers draw in software, far too slowly to drive)
const NORENDER = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('norender');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: SHOTS });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // Retina at 2x costs ~4x the pixels
const dyn = { pr: 1, max: 1, min: 0.6, t: 0, n: 0, smooth: 0, upAt: -1e9, hold: 0 };   // the resolution kept to the frame rate (keepFrameRate)
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.56;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 6000);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- data
status('Loading track data…');
const track = await (await fetch('assets/track.json', { cache: 'no-store' })).json();
// Layouts: the short track (Tidal Turns) and the others, each run either
// way round. The data runs clockwise; counter-clockwise flips it, keeping
// index 0 on the timing line. PLAY asks which; the last choice is remembered.
const LAYOUTS = track.layouts?.length ? track.layouts : [{ id: 'short', name: 'Tidal Turns' }];
const SHORT_LINE = track.centerline;
const DIR_KEY = 'tidalturns.direction', LAYOUT_KEY = 'tidalturns.layout';
let direction = 'cw', layoutId = 'short';
try {
  direction = localStorage.getItem(DIR_KEY) === 'ccw' ? 'ccw' : 'cw';
  layoutId = LAYOUTS.some(l => l.id === localStorage.getItem(LAYOUT_KEY)) ? localStorage.getItem(LAYOUT_KEY) : 'short';
} catch { /* defaults */ }
const layoutOf = (id) => LAYOUTS.find(l => l.id === id) || LAYOUTS[0];
// leaderboards and best laps: the short track keeps its original keys
const boardKey = (id = layoutId, dir = direction) => (id === 'short' ? dir : `${id}.${dir}`);
let N = 0;
function setTrackLine() {
  const line = layoutOf(layoutId).centerline || SHORT_LINE;
  track.centerline = direction === 'ccw' ? [line[0], ...line.slice(1).reverse()] : line;
  N = track.centerline.length;
  track.direction = direction;
  track.layout = layoutId;
  track.sectors = [Math.round(N / 3), Math.round((2 * N) / 3)];
}
setTrackLine();

// surface and grass-drop maps -> lookups
async function pixels(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}
const [surf, drop, kerbH, hill] = await Promise.all([pixels('assets/surface.png'), pixels('assets/grass_drop.png'),
  pixels('assets/kerb_height.png'), pixels('assets/terrain.png')]);
const HILL = track.hillHeight ?? 0;
const [dx0, dz0] = track.detailRect;
function surfaceAt(x, z) {
  const i = Math.floor((x - dx0) / track.surfaceRes), j = Math.floor((z - dz0) / track.surfaceRes);
  if (i < 0 || j < 0 || i >= surf.w || j >= surf.h) return 'grass';
  const v = surf.data[(j * surf.w + i) * 4];
  return v > 190 ? 'asphalt' : v > 60 ? 'kerb' : 'grass';
}
// ground height: the grass sits GRASS_DROP below the pavement, the kerbs
// stand up to KERB_HEIGHT above it, and the clubhouse and pit staging sit on
// a hill HILL high (bilinear, so edges are short ramps the tyres roll over,
// not cliffs)
function sampler(map) {
  return (x, z) => {
    const u = (x - dx0) / track.surfaceRes - 0.5, v = (z - dz0) / track.surfaceRes - 0.5;
    const i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= map.w - 1 || j >= map.h - 1) return null;
    const fu = u - i, fv = v - j, d = map.data, at = (a, b) => d[(b * map.w + a) * 4];
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
    const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
    return (top + (bot - top) * fv) / 255;
  };
}
const dropAt = sampler(drop), kerbAt = sampler(kerbH), hillFrac = sampler(hill);
const hillAt = (x, z) => HILL * (hillFrac(x, z) ?? 0);
function groundAt(x, z) {
  const g = dropAt(x, z);
  if (g == null) return -GRASS_DROP;
  return KERB_HEIGHT * kerbAt(x, z) - GRASS_DROP * g + hillAt(x, z);
}

status('Building Biloxi…');
const world3d = await buildWorld(scene, renderer, track, groundAt);
// tyre smoke, exhaust, grass dust and skid marks (effects.js), and the
// picture's finish: bloom, film tone mapping and grade (post.js)
const effects = new Effects(scene, groundAt);
// the floodlight poles round the circuit, lit at night
const floodlights = new Floodlights(scene, track.railings?.length ? REAL_POLES : [], groundAt, world3d.envMap);
const post = new Post(renderer);
// the steward in the flag stand, waving the session's flag (flagNow)
const flagman = track.flagStand ? new Flagman(track.flagStand, track.finish || track.centerline[0], groundAt, world3d.envMap) : null;
if (flagman) scene.add(flagman.object);
const ghost = new Ghost(scene);

// ---------------------------------------------------------------- physics
status('Starting physics…');
await RAPIER.init();
const physWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
physWorld.timestep = STEP;
// the chassis collider only catches rollovers; keep it below the lowered grass
physWorld.createCollider(RAPIER.ColliderDesc.cuboid(3000, 1, 3000).setTranslation(0, -1 - GRASS_DROP, 0).setFriction(0.6));
// ...and the same for the hill: a 1 m mesh of it, just under the tyres' ground
{
  const step = 1, [x0, z0, x1, z1] = track.detailRect;
  const nx = Math.floor((x1 - x0) / step), nz = Math.floor((z1 - z0) / step);
  const verts = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    verts.push(x, hillAt(x, z) - GRASS_DROP - 0.01, z);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    if (Math.max(verts[a * 3 + 1], verts[b * 3 + 1], verts[c * 3 + 1], verts[d * 3 + 1]) <= -GRASS_DROP) continue;
    idx.push(a, c, b, b, c, d);
  }
  if (idx.length) physWorld.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.6));
}
// an invisible wall round the Gridline property (from the aerial: the road
// on the west, the tree line by the RV park on the east, the field by the
// road to the north, Beach Boulevard to the south), so nobody drives off it
const PROPERTY = [-76, -172, 68, 238];
{
  const [x0, z0, x1, z1] = PROPERTY, T = 0.5, H = 4;
  const side = (cx, cz, hx, hz) => physWorld.createCollider(RAPIER.ColliderDesc.cuboid(hx, H, hz).setTranslation(cx, H - 1, cz).setFriction(0.1).setRestitution(0.3));
  side((x0 + x1) / 2, z0 - T, (x1 - x0) / 2 + 2 * T, T);
  side((x0 + x1) / 2, z1 + T, (x1 - x0) / 2 + 2 * T, T);
  side(x0 - T, (z0 + z1) / 2, T, (z1 - z0) / 2 + 2 * T);
  side(x1 + T, (z0 + z1) / 2, T, (z1 - z0) / 2 + 2 * T);
}
// buildings on the property are solid (their footprint's outline, on the ground)
for (const b of track.buildings) {
  const [x0, z0, x1, z1] = PROPERTY;
  const [cx, cz] = b.ring[0];
  if (cx < x0 - 20 || cx > x1 + 20 || cz < z0 - 20 || cz > z1 + 20) continue;
  const base = Math.min(...b.ring.map(([x, z]) => groundAt(x, z)));
  const pts = [];
  for (const [x, z] of b.ring) pts.push(x, base - 0.5, z, x, base + b.h, z);
  const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
  if (hull) physWorld.createCollider(hull.setFriction(0.5).setRestitution(0.2));
}
// each layout's cones and barriers are solid, but only while it's the one
// being driven: they close the rest of the complex off from it
const layoutColliders = {};
for (const lay of LAYOUTS) {
  const list = layoutColliders[lay.id] = [];
  for (const [cx, cz] of lay.cones || (lay.id === 'short' ? track.cones : []) || []) {
    list.push(physWorld.createCollider(RAPIER.ColliderDesc.cylinder(0.25, 0.16).setTranslation(cx, groundAt(cx, cz) + 0.25, cz).setFriction(0.4).setRestitution(0.1)));
  }
  for (const [bx, bz, h] of lay.barriers || (lay.id === 'short' ? track.barriers : []) || []) {
    const q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
    list.push(physWorld.createCollider(RAPIER.ColliderDesc.cuboid(0.22, 0.4, 0.6).setTranslation(bx, groundAt(bx, bz) + 0.4, bz).setRotation(q).setFriction(0.5).setRestitution(0.15)));
  }
}
// invisible walls a few metres off the track edges (and down the middle of
// narrow grass strips), so nobody cuts across the infield; none in the pits
// (tools/build_walls.py)
const wallColliders = {};
for (const lay of LAYOUTS) {
  const list = wallColliders[lay.id] = [];
  for (const line of lay.walls || []) for (let k = 1; k < line.length; k++) {
    const [ax, az] = line[k - 1], [bx, bz] = line[k];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, h = Math.atan2(bx - ax, bz - az);
    const q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
    list.push(physWorld.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 1.2, len / 2 + 0.05)
      .setTranslation(mx, groundAt(mx, mz) + 0.4, mz).setRotation(q).setFriction(0.1).setRestitution(0.2)));
  }
}
const showLayoutColliders = () => {
  for (const [id, list] of Object.entries(layoutColliders)) for (const c of list) c.setEnabled(id === layoutId);
  for (const [id, list] of Object.entries(wallColliders)) for (const c of list) c.setEnabled(id === layoutId);
};
showLayoutColliders();
// tyre walls are solid
for (const [tx, tz] of track.tyres || []) {
  // tyres give a little: bouncier than the barriers
  physWorld.createCollider(RAPIER.ColliderDesc.cylinder(0.26, 0.28).setTranslation(tx, groundAt(tx, tz) + 0.26, tz).setFriction(0.8).setRestitution(0.35));
}
// the car-park guardrail is solid
for (const line of track.railings || []) for (let k = 1; k < line.length; k++) {
  const [ax, az] = line[k - 1], [bx, bz] = line[k];
  const len = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2, h = Math.atan2(bx - ax, bz - az);
  physWorld.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 0.45, len / 2 + 0.05).setTranslation(mx, groundAt(mx, mz) + 0.4, mz)
    .setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }).setFriction(0.3).setRestitution(0.2));
}
// and so are the parked cars
// the patio tables (with their chairs round them)
if (track.railings?.length) for (const [x, z] of PATIO_TABLES) physWorld.createCollider(RAPIER.ColliderDesc.cylinder(0.4, 1.0).setTranslation(x, groundAt(x, z) + 0.4, z).setFriction(0.5).setRestitution(0.2));
// the patio fence
for (const [ax, az, bx, bz] of world3d.patioFence?.segments || []) {
  const L = Math.hypot(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2;
  physWorld.createCollider(RAPIER.ColliderDesc.cuboid(L / 2 + 0.02, 0.55, 0.04).setTranslation(mx, groundAt(mx, mz) + 0.55, mz)
    .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(bz - az), bx - ax))).setFriction(0.3).setRestitution(0.2));
}
// an invisible wall all round the patio: karts stay off it
{
  const { x0, z0, x1, z1, r } = PATIO_SLAB, pts = [];
  const arc = (cx, cz, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  arc(x1 - r, z1 - r, 0); arc(x0 + r, z1 - r, Math.PI / 2); arc(x0 + r, z0 + r, Math.PI); arc(x1 - r, z0 + r, -Math.PI / 2);
  if (track.railings?.length) pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (L < 0.05) return;
    physWorld.createCollider(RAPIER.ColliderDesc.cuboid(L / 2 + 0.05, 1.0, 0.1).setTranslation(mx, groundAt(mx, mz) + 0.9, mz)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(b[1] - a[1]), b[0] - a[0]))).setFriction(0.3).setRestitution(0.25));
  });
}
// the floodlight poles
for (const p of floodlights.solids) physWorld.createCollider(RAPIER.ColliderDesc.cylinder(p.h / 2, p.r).setTranslation(p.x, p.y + p.h / 2, p.z).setFriction(0.3).setRestitution(0.2));
if (track.railings?.length) for (const c of PARKED) {
  physWorld.createCollider(RAPIER.ColliderDesc.cuboid(c.w / 2, c.h / 2, c.l / 2).setTranslation(c.x, groundAt(c.x, c.z) + c.h / 2, c.z)
    .setRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) }).setFriction(0.4).setRestitution(0.15));
}
// the flag stand is solid too
if (track.flagStand) {
  const [fx, fz] = track.flagStand;
  physWorld.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 1.9, 0.9).setTranslation(fx, groundAt(fx, fz) + 1.9, fz).setFriction(0.5));
}
const kart = new KartPhysics(RAPIER, physWorld, surfaceAt, groundAt);

function trackPose(i) {
  const c = track.centerline;
  const a = c[(i - 2 + N) % N], b = c[(i + 2) % N];
  return { x: c[i][0], z: c[i][1], heading: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])) };
}
function placePose(p) {
  kart.place(p.x, p.z, p.heading);
  prevPose.p.set(p.x, groundAt(p.x, p.z) + KART.cgHeight, p.z);
  prevPose.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
  currPose.p.copy(prevPose.p); currPose.q.copy(prevPose.q);
}
const placeAt = (i) => placePose(trackPose(i));
// sessions start in the pit staging lane on the hill, pointing at the pit
// exit for the chosen direction (or ~12 m before the line on older data).
// In a server each driver gets their own spot (slot): a line of four behind
// the pit start, then four more beside them on the side away from the building.
function placePit(slot = 0) {
  const s = track.pitStart?.[direction];
  if (!s) { placeAt((N - 24 - slot * 7 + N) % N); return; }
  // (two rows of six: room for a full server)
  const back = (slot % 6) * 3.2, side = slot >= 6 ? (direction === 'cw' ? 3 : -3) : 0;
  placePose({ x: s[0] + Math.sin(s[2]) * back + Math.cos(s[2]) * side, z: s[1] + Math.cos(s[2]) * back - Math.sin(s[2]) * side, heading: s[2] });
}
const prevPose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const currPose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
placePit();

// ---------------------------------------------------------------- kart model
// the kart lives in the garage studio until PLAY moves it onto the track
const showroom = new Showroom(canvas);
const kartGroup = new THREE.Group();
showroom.scene.add(kartGroup);
let visual = null;
const driver = new RacingDriver();
driver.setEnvMap(world3d.envMap);
kartGroup.add(driver.object);

// kart paint from the garage, applied to whichever model is loaded
const PAINT = 'tidalturns.paint.v1';
let paint = { ...PAINT_DEFAULT };
try { paint = { ...paint, ...JSON.parse(localStorage.getItem(PAINT)) }; } catch { /* defaults */ }
paint.livery = liveryKey(paint.livery);     // (a design from before they were redone)
let paintCounts = { paint: 0, trim: 0 };
// a catalog entry may name which of its materials are paint and trim
const paintNames = (e) => (e?.paintMaterials || e?.paintMasks ? { paint: e.paintMaterials || [], trim: e.trimMaterials || [], masks: e.paintMasks } : null);
let menusReady = false;     // the menu pages are wired up at the end of this file
const setPlayable = (on) => { $('playBtn').disabled = $('garagePlay').disabled = !on; };
const garage = await new Garage().load();
// the pits made lived-in (pits.js): the mechanics' things, spare tyres, cones,
// sponsor banners, and a row of parked rental karts; all solid
if (track.railings?.length) buildPits(track, groundAt, world3d.envMap, tyreGeometry(), buildCones).then(async (pits) => {
  scene.add(pits.group);
  try {
    const { src, opts } = await garage.source(garage.entries.find(e => e.kind === 'bundled'));
    const v = await loadKartModel(src, opts);
    finishKart(v.object, world3d.envMap);
    parkKarts(pits.group, v.object, groundAt, KART.cgHeight, pits.solids);
  } catch (e) { console.warn('parked karts', e); }
  for (const b of pits.solids) {
    physWorld.createCollider(RAPIER.ColliderDesc.cuboid(b.hx, b.h / 2, b.hz).setTranslation(b.x, groundAt(b.x, b.z) + b.h / 2, b.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw)).setFriction(0.5).setRestitution(0.25));
  }
}, (e) => console.warn('pits', e));
let loadSeq = 0;
let shownKart = null;        // id of the kart model on screen

async function showKart(entry) {
  if (!entry) return;
  const seq = ++loadSeq;
  status(`Loading ${entry.name}…`);
  setPlayable(false);
  try {
    const { src, opts } = await garage.source(entry);
    const v = await loadKartModel(src, opts);
    if (seq !== loadSeq) return;            // a newer pick won
    if (visual) kartGroup.remove(visual.object);
    visual = v;
    finishKart(v.object, world3d.envMap);
    kartGroup.add(v.object);
    paintCounts = applyPaint(v.object, paint, paintNames(entry));
    shownKart = entry.id;
    if (menusReady) showLivery();
    if (menusReady) v.setNumber(helmet.number);     // (at start-up the helmet is read further down)
    showPaintNote();
    $('modelCredit').textContent = v.credit;
    status(`${entry.name} ready${v.wheelCount ? '' : ' (wheels are part of the body on this model, so they won\'t turn)'}.`);
  } catch (err) {
    console.error(err);
    status(`Could not read ${entry.name}: ${err.message}`);
  }
  setPlayable(!!visual);
  if (menusReady) renderHome();
}

function renderGarage() {
  const list = $('kartList');
  list.innerHTML = '';
  for (const e of garage.entries) {
    const el = document.createElement('div');
    el.className = 'kartCard' + (e.id === garage.selected ? ' sel' : '');
    el.innerHTML = `<div class="kInfo"><b></b><small></small><img class="kartThumb" alt=""></div>`;
    el.querySelector('b').textContent = e.name;
    // a little picture of the kart under its name
    const img = el.querySelector('img');
    img.alt = e.name;
    garage.source(e).then(({ src, opts }) => kartThumb(`${e.id}:${opts.yawDegrees}`, src, opts, world3d.envMap))
      .then((url) => { img.src = url; img.classList.add('ready'); })
      .catch((err) => { console.warn('thumbnail', e.name, err); img.remove(); });
    el.querySelector('small').textContent = e.kind === 'imported' ? 'Imported model' : `${e.note} · ${e.license}`;
    if (e.kind === 'imported') {
      const x = document.createElement('button');
      x.className = 'del'; x.textContent = '×'; x.title = 'Remove this model';
      x.onclick = async (ev) => { ev.stopPropagation(); await garage.remove(e.id); renderGarage(); showKart(garage.current()); };
      el.appendChild(x);
    }
    el.onclick = () => { if (garage.selected === e.id) return; garage.select(e.id); renderGarage(); showKart(e); syncUp(); };
    list.appendChild(el);
  }
  const miss = garage.missingOptional[0];
  $('optionalHint').classList.toggle('hidden', !miss);
  if (miss) {
    const a = $('optionalHint').querySelector('a');
    a.href = miss.url; a.textContent = miss.name;
    $('optionalHint').querySelector('code').textContent = miss.file;
  }
}

async function importFile(f) {
  if (!f || !/\.(glb|gltf)$/i.test(f.name)) { status('Please choose a .glb file.'); return; }
  const e = await garage.import(f);
  garage.select(e.id);
  renderGarage();
  await showKart(e);
}

renderGarage();
await showKart(garage.current());

$('importKart').addEventListener('change', (ev) => { importFile(ev.target.files[0]); ev.target.value = ''; });
$('turnKart').addEventListener('click', () => { const e = garage.current(); if (!e) return; garage.turn(e.id); showKart(e); });
// drag-and-drop a .glb anywhere
addEventListener('dragover', (e) => { e.preventDefault(); $('garage').classList.add('over'); });
addEventListener('dragleave', () => $('garage').classList.remove('over'));
addEventListener('drop', (e) => {
  e.preventDefault();
  $('garage').classList.remove('over');
  importFile([...e.dataTransfer.files].find(f => /\.(glb|gltf)$/i.test(f.name)));
});

// ---------------------------------------------------------------- systems
const input = new Input();
const touch = new TouchControls(input);
const audio = new KartAudio();
const ambience = new Ambience(audio);   // birds, wind, rain and the other karts (ambience.js)
let timer = new LapTimer(track);
const hud = new Hud(track);

// ---------------------------------------------------------------- cameras
const CAMS = ['CHASE', 'COCKPIT', 'BUMPER', 'TV', 'HELI'];
let camIdx = 0;
hud.setCamera(CAMS[camIdx]);
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camDir = new THREE.Vector3();
const tvSpots = [];
function placeTvSpots() {
  tvSpots.length = 0;
  for (let i = 0; i < N; i += 70) {
    const a = track.centerline[(i - 3 + N) % N], b = track.centerline[(i + 3) % N];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    // alternate sides, stand ~10 m off the centreline at head height on a stand
    const side = (i / 70) % 2 ? 1 : -1;
    tvSpots.push(new THREE.Vector3(track.centerline[i][0] - (tz / l) * 10 * side, 3.2, track.centerline[i][1] + (tx / l) * 10 * side));
  }
}
placeTvSpots();

// switch layout and direction without reloading: lap line, timing, minimap,
// TV cameras, and which barriers and cones stand
function chooseLayout(id, dir) {
  layoutId = layoutOf(id).id; direction = dir === 'ccw' ? 'ccw' : 'cw';
  try { localStorage.setItem(LAYOUT_KEY, layoutId); localStorage.setItem(DIR_KEY, direction); } catch { /* ignore */ }
  setTrackLine();
  timer = new LapTimer(track);
  hud.prepMinimap();
  placeTvSpots();
  showLayoutColliders();
  world3d.setLayout(layoutId);
  hud.setTrack(layoutOf(layoutId).name, direction);
  bots?.setLine(track.centerline);
}
world3d.setLayout(layoutId);
hud.setTrack(layoutOf(layoutId).name, direction);
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), fwdV = new THREE.Vector3();
let shake = 0;

function updateCamera(dt, pose) {
  const fwd = fwdV.set(0, 0, -1).applyQuaternion(pose.q);
  const flatFwd = tmpV.set(fwd.x, 0, fwd.z).normalize();
  const mode = CAMS[camIdx];
  if (mode === 'CHASE') {
    // ride along at a fixed distance and swing round behind the kart with
    // exponential smoothing: stable at any frame rate (the old spring blew
    // up on slow frames and shook)
    if (camDir.lengthSq() < 0.5 || camDir.dot(flatFwd) < -0.2) camDir.copy(flatFwd);
    camDir.lerp(flatFwd, 1 - Math.exp(-5 * dt)).normalize();
    camPos.copy(pose.p).addScaledVector(camDir, -3.3).add(new THREE.Vector3(0, 1.25, 0));
    camera.position.copy(camPos);
    camLook.copy(pose.p).addScaledVector(camDir, 2.5).add(new THREE.Vector3(0, 0.25, 0));
    camera.lookAt(camLook);
    camera.fov = 62;
  } else if (mode === 'COCKPIT' || mode === 'BUMPER') {
    const local = mode === 'COCKPIT' ? new THREE.Vector3(0, 0.66, 0.18) : new THREE.Vector3(0, -0.06, -0.92);
    camera.position.copy(local.applyQuaternion(pose.q).add(pose.p));
    // vibration from the engine and surface
    const vib = (kart.pt.rpm / 4000) * 0.0012 + shake;
    camera.position.x += (Math.random() - 0.5) * vib;
    camera.position.y += (Math.random() - 0.5) * vib;
    camera.quaternion.copy(pose.q);
    // head leans against lateral g
    camera.rotateZ(THREE.MathUtils.clamp(kart.accel.x * 0.04, -0.06, 0.06));
    camera.rotateX(mode === 'COCKPIT' ? -0.10 : -0.02);
    camera.fov = mode === 'COCKPIT' ? 78 : 72;
  } else if (mode === 'TV') {
    let best = tvSpots[0], bd = Infinity;
    for (const s of tvSpots) { const d = s.distanceToSquared(pose.p); if (d < bd) { bd = d; best = s; } }
    camera.position.copy(best);
    camera.lookAt(tmpV.copy(pose.p).add(new THREE.Vector3(0, 0.3, 0)));
    camera.fov = THREE.MathUtils.clamp(2 * Math.atan(4.5 / Math.sqrt(bd)) * 180 / Math.PI, 8, 60);
  } else {
    camera.position.copy(pose.p).add(new THREE.Vector3(-18, 30, 22));
    camera.lookAt(pose.p);
    camera.fov = 45;
  }
  camera.updateProjectionMatrix();
}

const showPads = () => { $('padStatus').textContent = input.describe(); };

// ---------------------------------------------------------------- loop
let page = 'home';
let running = false, paused = false, simTime = 0, acc = 0, last = performance.now(), lastSpeed = 0;
const lipPrev = [null, null, null, null];   // each wheel's ground height last frame, for the grass-lip thump

// skip render interpolation after a teleport
function snapPose() {
  const t = kart.body.translation(), r = kart.body.rotation();
  currPose.p.set(t.x, t.y, t.z); currPose.q.set(r.x, r.y, r.z, r.w);
  prevPose.p.copy(currPose.p); prevPose.q.copy(currPose.q);
}

function resetToTrack() {
  const p = kart.body.translation();
  placeAt(timer.locate(p.x, p.z));
  if (timer.lapStart != null) timer.invalid = true;   // a reset lap can't count
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  keepFrameRate(dt, now);
  // stewarding: out of the kart, watching the others on the cameras
  const sw = running && stewarding();
  for (const a of input.takeActions()) {
    if (a === 'pause') {
      if (!$('layoutPick').classList.contains('hidden')) $('layoutPick').classList.add('hidden');
      else if (!$('inputCfg').classList.contains('hidden')) { $('inputCfg').classList.add('hidden'); showPads(); }
      else if (!$('raceResults').classList.contains('hidden')) $('raceResults').classList.add('hidden');
      else if (running && net?.inRoom) toggleRoomPanel();
      else if (running) setPaused(!paused);
      else if (page !== 'home') go('home');
    }
    if (a === 'music') { music.toggle(); $('musicOn').checked = music.enabled; }
    if (a === 'camera' && sw) watchAngle();
    else if (a === 'camera') { camIdx = (camIdx + 1) % CAMS.length; hud.setCamera(CAMS[camIdx]); }
    if (sw && /^cam\d$/.test(a)) watchKey(+a[3]);
    if (sw && (a === 'watchPrev' || a === 'watchNext')) watchStep(a === 'watchNext' ? 1 : -1);
    if (sw && a.startsWith('flag:')) setFlag(a.slice(5));
    if (sw && a === 'reset') setFlag('red');
    if (a === 'reset' && running && !sw && !frozen()) { resetToTrack(); ghostUntil = simTime + GHOST_TIME; }
    if (a === 'turnaround' && running && !sw && !frozen()) { kart.turnAround(); if (timer.lapStart != null) timer.invalid = true; snapPose(); ghostUntil = simTime + GHOST_TIME; }
    if (a === 'mute') audio.toggleMute();
    if (a === 'telemetry') $('telemetry').classList.toggle('hidden');
  }
  if (running && !paused && (sw || club)) {
    input.poll(dt, 0);               // (only for the pad's buttons)
    if (club) { clubTick(dt); audio.park(); }   // (your kart's engine off while you walk)
    // (in a race against the AI they keep driving while you watch)
    if (bots) {
      acc += dt;
      while (acc >= STEP) { const tNow = now - (acc - STEP) * 1000; botContacts(humanKarts(tNow), tNow); bots.step(STEP, botTraffic()); physWorld.step(); acc -= STEP; }
    }
    simTime += dt;
    if (sw) stewardHud(now);
    if (net?.inRoom) onlineTick(dt, now);
  } else if (running && !paused) {
    let cmd = input.poll(dt, kart.speed || 0);
    lastThrottle = cmd.throttle || 0;
    // in someone's slipstream (physics/kart.js draftOf), eased in and out
    {
      const v = kart.body.linvel(), t = kart.body.translation(), list = [];
      for (const r of remotes.values()) if (r.last && r.group.visible && !r.hidden) list.push({ x: r.p.x, z: r.p.z, vx: r.last.v[0], vz: r.last.v[2] });
      const want = list.length ? draftOf({ x: t.x, z: t.z, vx: v.x, vz: v.z }, list) : 0;
      kart.draft = (kart.draft || 0) + (want - (kart.draft || 0)) * Math.min(1, dt * 1.2);
      $('draftTag').classList.toggle('on', kart.draft > 0.04);
    }
    // assists for controller, keyboard and touch (never a steering wheel)
    kart.assist = settings.assists && !input.onWheel() ? ASSISTS_ON : null;
    // on the grid until the lights go out, and coasting with the server menu open
    // on the grid the gas works (so a start can be jumped: rules()), but once
    // caught, or before the race, the brakes hold you
    if (frozen() && (race.jumped || !race.spot)) cmd = { steer: cmd.steer, throttle: 0, brake: 1 };
    else if (!$('roomPanel').classList.contains('hidden')) cmd = { steer: 0, throttle: 0, brake: 0.4 };
    acc += dt;
    while (acc >= STEP) {
      prevPose.p.copy(currPose.p); prevPose.q.copy(currPose.q);
      if (remotes.size) bump(now - (acc - STEP) * 1000);
      kart.step(STEP, cmd);
      if (bots) { const v = kart.body.linvel(), t = kart.body.translation(); bots.step(STEP, [{ id: 'me', x: t.x, z: t.z, vx: v.x, vz: v.z }, ...botTraffic()]); }
      physWorld.step();
      simTime += STEP;
      acc -= STEP;
      const t = kart.body.translation(), r = kart.body.rotation();
      currPose.p.set(t.x, t.y, t.z); currPose.q.set(r.x, r.y, r.z, r.w);
      if (!race && timer.lapStart != null) ghost.record(simTime - timer.lapStart, t, r);
    }
    const p = kart.body.translation();
    knocks(p);
    stats.drive(dt, kart.speed);
    const off = kart.wheels.every(w => w.surface === 'grass');
    timer.update(simTime, dt, p.x, p.z, off);
    // valid laps go on the fastest-drivers board
    for (const ev of timer.events.slice()) {
      if (ev.type === 'lap') { raceLap(ev); if (!race) ghost.lap(ev.valid, ev.time); }
      if (ev.type === 'lap') {
        const c = net?.inRoom && net.room?.cond ? net.room.cond : settings;
        const pb = stats.lap({ valid: ev.valid, time: ev.time, layout: layoutId, dir: direction, kart: driving()?.name ?? '', weather: c.weather, tod: c.time });
        if (pb) ev.pb = true;
        achievements();
      }
      if (ev.type !== 'lap' || !ev.valid) continue;
      const rank = board.record(boardKey(), driverName(), ev.time, driving()?.name, { ...helmet });
      if (rank && rank <= 10) { stats.data.top10 = true; if (rank === 1) stats.data.top1 = true; achievements(); }
      { const key = boardKey(), kart = driving()?.name; account.postLap(key, ev.time, kart, { ...helmet }).then(() => { if (ev.pb) boardPoints(key, kart); }); }
      if (rank && rank <= 10) timer.events.push({ type: 'board', rank });
    }
    hud.others = [];
    for (const r of remotes.values()) if (r.group.visible) hud.others.push({ x: r.p.x, z: r.p.z });
    hud.update(dt, simTime, kart, cmd, timer);
    audio.update(kart);
    // controller rumble: engine buzz, kerbs rattle, grass rumbles and the
    // lip down onto it (or back up) thumps, sliding tyres hum, a locked rear
    // axle chatters, hits thump. Triggers (where supported) buzz with
    // wheelspin and a locked brake.
    {
      let weak = 0.12 * kart.pt.rpm / 4700, strong = 0, lip = 0, spin = 0, lock = 0;
      kart.wheels.forEach((w, i) => {
        if (!w.contact) { lipPrev[i] = null; return; }
        if (w.surface === 'kerb') weak += 0.35;
        if (w.surface === 'grass') strong += 0.25;
        weak += Math.max(0, w.util - 0.95) * 0.5;
        if (!w.front) { spin += Math.max(0, w.kappa - 0.15); lock += Math.max(0, -w.kappa - 0.25); }
        // the step between grass and pavement, not the slope of the hill
        const g = w.cp[1] - hillAt(w.cp[0], w.cp[2]);
        if (lipPrev[i] != null) lip += Math.abs(g - lipPrev[i]) / GRASS_DROP;
        lipPrev[i] = g;
      });
      const sp = Math.min(1, kart.speed / 10);
      lock *= sp;
      weak += Math.min(0.5, lock);
      const lt = Math.min(1, lock * 1.5), rt = Math.min(1, spin * 2);
      const jolt = Math.abs(kart.speed - lastSpeed) / Math.max(dt, 1e-3);   // m/s^2
      if (jolt > 30) input.rumble(Math.min(1, jolt / 80), 0.6, 220);
      else if (lip > 0.25 && kart.speed > 2) input.rumble(Math.min(1, 0.3 + lip * 0.5) * sp, 0.4 * sp, 110);
      else input.rumble(strong * sp, Math.min(1, weak) * Math.max(sp, 0.3), 60, lt, rt);
      lastSpeed = kart.speed;
    }
    shake = kart.wheels.some(w => w.surface !== 'asphalt' && w.contact) ? 0.004 * Math.min(1, kart.speed / 8) : 0;
    if (net?.inRoom) { onlineTick(dt, now); watchHit(); rules(dt); }
  }
  // interpolated render pose
  const alpha = running ? acc / STEP : 1;
  const pose = { p: new THREE.Vector3().lerpVectors(prevPose.p, currPose.p, alpha), q: new THREE.Quaternion().slerpQuaternions(prevPose.q, currPose.q, alpha) };
  if (visual) visual.animate(kart, kart.steer / KART.maxSteer);
  if (running) {
    kartGroup.visible = !sw && !club;
    kartGroup.position.copy(pose.p);
    kartGroup.quaternion.copy(pose.q);
    driver.update(kart.steer / KART.maxSteer, kart.accel.x, CAMS[camIdx]);
    bots?.frame(dt, now);
    for (const r of remotes.values()) r.render(dt, now);
    conditions();
    renderer.toneMappingExposure = world3d.exposure;
    // the ghost of your best lap, if it's on (practice only)
    ghost.use(`${boardKey()}@${driving()?.name ?? ''}`);
    if (visual && shownKart) ghost.setModel(visual.object, shownKart);
    ghost.show(settings.ghost && !race && !sw, timer.lapStart != null ? simTime - timer.lapStart : null);
    let focus = pose.p;
    if (sw) focus = stewardCamera(dt);
    else if (club) { club.walker.camera(camera); camera.fov = 70; camera.updateProjectionMatrix(); focus = camera.position; clubTv(dt); }
    else updateCamera(dt, pose);
    world3d.followSun(focus);
    world3d.tick(camera.position, now / 1000);
    if (flagman) { flagman.set(flagNow()); flagman.update(dt); }
    smokeAndMarks(dt, sw || !!club);
    // the inside of the clubhouse only near it (seen through its windows) or in it
    if (world3d.interior) world3d.interior.group.visible = !!club || Math.hypot(camera.position.x - track.clubhouse[0], camera.position.z - track.clubhouse[1]) < 32;
    floodlights.setOn(world3d.night ? 1 : 0);
    floodlights.update(camera.position);
    {
      const [time, weather] = (world3d.conditions || 'afternoon|dry').split('|'), karts = [];
      for (const r of remotes.values()) if (r.last && r.group.visible && !r.hidden) karts.push({ id: r.id, x: r.p.x, y: r.p.y, z: r.p.z, vx: r.last.v[0], vz: r.last.v[2] });
      ambience.update({ cam: camera, time, rain: weather === 'rain', indoors: !!club && world3d.interior.inside(club.walker.x, club.walker.z), karts });
    }
    if (!NORENDER) post.render(scene, camera, now / 1000);
  } else if (page === 'garage') {
    // studio: kart on the turntable, framed beside the garage panel
    kartGroup.visible = true;
    kartGroup.position.set(0, KART.cgHeight, 0);
    kartGroup.quaternion.identity();
    driver.update(0, 0, 'MENU');
    kartGroup.updateMatrixWorld(true);
    driver.headPosition(tmpV);
    renderer.toneMappingExposure = 1.0;
    // frame the kart in what the garage panel leaves (beside it, or above it on a narrow screen)
    const gp = document.querySelector('#pgGarage .gPanel')?.getBoundingClientRect();
    showroom.render(renderer, dt, kartGroup, tmpV, !gp ? {} : gp.top > 10 ? { bottom: innerHeight - gp.top } : { right: innerWidth - gp.left });
  }
  // the other menu pages cover the screen (a picture of the circuit), so nothing is drawn behind them
}
{
  const t = kart.body.translation(), r = kart.body.rotation();
  currPose.p.set(t.x, t.y, t.z); currPose.q.set(r.x, r.y, r.z, r.w);
  prevPose.p.copy(currPose.p); prevPose.q.copy(currPose.q);
  camPos.copy(currPose.p).add(new THREE.Vector3(0, 1.5, 4));
}
window.__sim = { flagman, flagNow: () => flagNow(), input, get voice() { return voice; }, get admin() { return admin; }, world: world3d, get contactStats() { return contactStats; }, get solids() { return contacts.solids; }, banner: (...a) => banner(...a), get net() { return net; }, get remotes() { return remotes; }, get bots() { return bots; }, get club() { return club; }, get paused() { return paused; }, get running() { return running; }, post, effects, get race() { return race; }, get simTime() { return simTime; }, camera, kart, prevPose, currPose, renderer, scene, physWorld, get music() { return music; }, ambience };   // for automated checks
requestAnimationFrame(frame);

// ---------------------------------------------------------------- menus
const account = new Account();
const admin = new Admin(account);
const SETTINGS = 'tidalturns.settings.v1';
// a phone: lighter graphics to start with (changeable in Settings)
const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
let settings = { balance: 0, weightLb: 175, name: '', units: 'mph', quality: PHONE ? 'low' : 'high', telemetry: true, sfx: 0.55, assists: true, time: 'afternoon', weather: 'dry', ghost: false };
// your record and achievements (profile.js), for your profile page
const stats = new Stats();
// owned: bought in the shop (or every item, for a tester's account)
const iOwn = (kind, theme) => owns(stats.data, kind, theme) || TESTERS.has(account.user?.id);
// a rarity label (rarity.js) on a card: its name in its colour, and the colour for the card's edge
function rarityTag(el, kind, id) {
  const t = tierOf(kind, id);
  let tag = el.querySelector('.rar');
  if (!tag) { tag = document.createElement('em'); tag.className = 'rar'; (el.querySelector('span') || el).appendChild(tag); }
  tag.textContent = t.name.toUpperCase();
  el.style.setProperty('--rc', t.colour);
}
// (time of day and weather: conditions())
const TIMES = { afternoon: 'Afternoon', evening: 'Evening', overcast: 'Overcast', night: 'Night (floodlights)' }, WEATHER = { dry: 'Dry', rain: 'Rain' };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS)) }; } catch { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { /* ignore */ } syncUp(); };
const driverName = () => account.name || (settings.name || '').trim() || 'Driver';
const fillSelect = (el, opts) => { el.innerHTML = Object.entries(opts).map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); };
const music = new Music();
music.owns = (id) => iOwn('music', id);   // (the artists bought in the Shop)
// what's playing, bottom left
music.onTrack = (t) => {
  $('nowPlaying').classList.toggle('hidden', !t);
  if (!t) return;
  $('npTitle').textContent = t.title;
  $('npArtist').textContent = t.artist;
};
const board = new Leaderboard();
const podium = new Podium($('podium'), world3d.envMap);
window.__podium = podium;   // for automated checks
// a best lap set before the board existed counts for the current driver
if (timer.best != null && !board.top(boardKey(), 1, garage.current()?.name).length) board.record(boardKey(), driverName(), timer.best, garage.current()?.name);

// ---- pages: home, garage, fastest drivers, settings
const PAGES = { home: 'pgHome', garage: 'pgGarage', board: 'pgBoard', settings: 'pgSettings', multi: 'pgMulti', profile: 'pgProfile', shop: 'pgShop' };
function go(to) {
  if (page === 'multi' && to !== 'multi') net?.unwatchLobby();
  page = to;
  for (const [k, id] of Object.entries(PAGES)) $(id).classList.toggle('hidden', k !== to);
  showroom.active = to === 'garage';
  if (to === 'board') podium.start(); else podium.stop();
  if (to !== 'profile') pfPodium?.stop();
  if (to === 'home') renderHome();
  if (to === 'board') renderBoard();
  if (to === 'settings') showPads();
  if (to === 'multi') openMulti();
  if (to === 'shop') renderShop();
}
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

function renderHome() {
  const box = $('homeInfo');
  box.innerHTML = '';
  const line = (...parts) => {
    const d = document.createElement('div');
    for (const [txt, bold] of parts) {
      const el = document.createElement(bold ? 'b' : 'span');
      el.textContent = txt;
      d.appendChild(el);
    }
    box.appendChild(d);
  };
  line(['Racing as ', false], [driverName(), true], [' in the ', false], [garage.current()?.name ?? 'kart', true]);
  const best = board.best(boardKey(), driverName(), garage.current()?.name);
  const dir = direction === 'ccw' ? 'counter-clockwise' : 'clockwise';
  line([`Your best lap (${layoutOf(layoutId).name}, ${dir}): `, false], [best != null ? fmt(best) : 'none yet', true]);
  if (account.enabled && !account.signedIn) line(['Sign in to put your times on the worldwide Fastest Drivers board.', false]);
  else if (!account.enabled && !settings.name) line(['Set your name in the Garage to go on Fastest Drivers.', false]);
}

// ---- shop points for the worldwide Fastest Drivers board: into (or up) a
// top 10, and to the top of one (each time it's taken, not for staying there)
async function boardPoints(key, kart) {
  if (!account.signedIn) return;
  try {
    const rows = await account.top(key, 10, kart || '');
    const rank = rows.findIndex(r => r.user_id === account.user.id) + 1;
    if (!rank) return;
    const ranks = stats.data.ranks ||= {}, bk = `${key}@${kart || ''}`, was = ranks[bk] ?? Infinity;
    if (rank >= was) return;
    ranks[bk] = rank;
    if (rank === 1) stats.earn(SHOP_POINTS.top1, 'top1');
    else stats.earn(SHOP_POINTS.top10, 'top10');
    syncUp();
  } catch (e) { console.warn('board points', e.message); }
}
const EARN_TOAST = { best: 'Personal best', fastestLap: 'Fastest lap of the race', top10: 'Into the Fastest Drivers top 10', top1: 'Fastest driver on the board' };
stats.onEarn = (n, why) => { if (EARN_TOAST[why]) toast(`+${n} points · ${EARN_TOAST[why]}`); };

// ---- driver profiles: anyone's (by account), or your own (uid null); opened
// from a name on Fastest Drivers
let pfPodium = null, pfFrom = 'home', pfSeq = 0;
$('pfBack').addEventListener('click', () => go(pfFrom));
async function openProfile(uid, from = page) {
  pfFrom = from === 'profile' ? pfFrom : from;
  const seq = ++pfSeq;
  go('profile');
  pfPodium ??= new Podium($('pfPodium'), null);
  let name = driverName(), look = { ...helmet }, rec = stats.data, since = null, laps = null;
  if (uid) {
    $('pfName').textContent = 'LOADING…';
    const { data } = await account.sb.from('profiles').select('username, look, settings, updated_at').eq('id', uid).maybeSingle();
    if (seq !== pfSeq) return;
    name = data?.username ?? 'Driver'; look = data?.look || {}; rec = data?.settings?.stats || null; since = data?.updated_at;
  }
  // best laps: from the worldwide laps (signed-in drivers), else this computer's record
  const who = uid ?? account.user?.id;
  if (who && account.sb) {
    const { data } = await account.sb.from('laps').select('dir, time, kart').eq('user_id', who).order('time').limit(500);
    if (seq !== pfSeq) return;
    laps = data || [];
  }
  $('pfName').textContent = name.toUpperCase();
  pfPodium.show([{ name, time: 0, look: allowedLook(look, who, ADMIN_UIDS.has(who)) }]);
  pfPodium.start();
  // their record, plus what their laps on the boards show (counts, karts,
  // layouts, best times), so lap achievements show even before a record
  const r = { laps: 0, validLaps: 0, km: 0, seconds: 0, karts: {}, layouts: {}, dirs: {}, best: {}, unlocked: {}, ...(rec || {}) };
  r.karts = { ...r.karts }; r.layouts = { ...r.layouts }; r.dirs = { ...r.dirs }; r.best = { ...r.best }; r.unlocked = { ...r.unlocked };
  if (laps?.length) {
    r.validLaps = Math.max(r.validLaps, laps.length);
    for (const l of laps) {
      const [lay, way] = l.dir.includes('.') ? l.dir.split('.') : ['short', l.dir];
      r.karts[l.kart] = 1; r.layouts[lay] = 1; r.dirs[way] = 1;
      const k = `${l.dir}@${l.kart}`;
      if (!(r.best[k] <= l.time)) r.best[k] = l.time;
    }
  }
  for (const a of ACHIEVEMENTS) if (!r.unlocked[a.id] && a.test({ races: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, cleanRaces: 0, comebacks: 0, hardWins: 0, rainWins: 0, crowdRaces: 0, topSpeed: 0, rainLaps: 0, eveningLaps: 0, ...r })) r.unlocked[a.id] = '';
  $('pfSub').textContent = !rec ? `${r.validLaps} valid laps on the boards. The full race record starts with this driver's next session in the game.`
    : `${Math.round(r.validLaps || 0)} valid laps · ${(r.km || 0).toFixed(1)} km · ${Math.floor((r.seconds || 0) / 3600)} h ${Math.round(((r.seconds || 0) % 3600) / 60)} min driving${since && uid ? ` · last seen ${since.slice(0, 10)}` : ''}`;
  const tiles = [['RACES', r.races], ['WINS', r.wins], ['PODIUMS', r.podiums], ['POLES', r.poles], ['FASTEST LAPS', r.fastestLaps],
    ['WIN RATE', r.races ? `${Math.round(100 * (r.wins || 0) / r.races)}%` : '–'], ['TOP SPEED', r.topSpeed ? `${Math.round(r.topSpeed * (settings.units === 'kmh' ? 3.6 : 2.23694))} ${settings.units === 'kmh' ? 'km/h' : 'mph'}` : '–'],
    ['LAPS', Math.round(r.validLaps)]];
  $('pfStats').innerHTML = '';
  for (const [k, v] of tiles) { const d = document.createElement('div'); d.innerHTML = '<b></b><small></small>'; d.children[0].textContent = v ?? 0; d.children[1].textContent = k; $('pfStats').appendChild(d); }
  // the best lap on each board (layout, way round, kart)
  const best = new Map();
  for (const [k, t] of Object.entries(r.best)) { const [dir, kart] = k.split('@'); best.set(`${dir}|${kart}`, t); }
  const ol = $('pfBests');
  ol.innerHTML = '';
  if (!best.size) ol.innerHTML = '<li class="empty">No valid laps yet.</li>';
  for (const [k, t] of [...best.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [dir, kart] = k.split('|'), [lay, way] = dir.includes('.') ? dir.split('.') : ['short', dir];
    const li = document.createElement('li');
    li.innerHTML = '<div class="who"><b></b><small></small></div><div class="time"></div>';
    li.querySelector('b').textContent = kart || 'Kart';
    li.querySelector('small').textContent = trackLabel(lay, way);
    li.querySelector('.time').textContent = fmt(t);
    ol.appendChild(li);
  }
  // achievements: unlocked first
  const got = r.unlocked;
  $('pfAchHead').textContent = `ACHIEVEMENTS · ${ACHIEVEMENTS.filter(a => a.id in got).length} OF ${ACHIEVEMENTS.length}`;
  const box = $('pfAch');
  box.innerHTML = '';
  for (const a of [...ACHIEVEMENTS].sort((x, y) => (y.id in got ? 1 : 0) - (x.id in got ? 1 : 0))) {
    const d = document.createElement('div');
    if (a.id in got) d.className = 'got';
    d.innerHTML = '<i>🏆</i><b></b><small></small>';
    d.querySelector('b').textContent = a.name;
    d.querySelector('small').textContent = got[a.id] ? `${a.desc} · ${got[a.id]}` : a.desc;
    box.appendChild(d);
  }
}

// ---- fastest drivers: a board for each layout, direction and kart
let boardDir = direction, boardLayout = layoutId, boardKart = null;
document.querySelectorAll('#boardDir button').forEach(b => b.addEventListener('click', () => { boardDir = b.dataset.dir; renderBoard(); }));
{
  const nav = $('boardKart');
  for (const e of garage.entries.filter(x => x.kind === 'bundled')) {
    const b = document.createElement('button');
    b.textContent = e.name.toUpperCase(); b.dataset.kart = e.name;
    b.addEventListener('click', () => { boardKart = e.name; renderBoard(); });
    nav.appendChild(b);
  }
}
{
  const nav = $('boardLayout');
  for (const lay of LAYOUTS) {
    const b = document.createElement('button');
    b.textContent = lay.name.toUpperCase(); b.dataset.layout = lay.id;
    b.addEventListener('click', () => { boardLayout = lay.id; renderBoard(); });
    nav.appendChild(b);
  }
  nav.classList.toggle('hidden', LAYOUTS.length < 2);
}
let boardSeq = 0;
async function renderBoard() {
  document.querySelectorAll('#boardDir button').forEach(b => b.classList.toggle('on', b.dataset.dir === boardDir));
  document.querySelectorAll('#boardLayout button').forEach(b => b.classList.toggle('on', b.dataset.layout === boardLayout));
  // (the kart you're in, until you pick another)
  boardKart ??= garage.current()?.name ?? garage.entries[0]?.name ?? '';
  document.querySelectorAll('#boardKart button').forEach(b => b.classList.toggle('on', b.dataset.kart === boardKart));
  const key = boardKey(boardLayout, boardDir), lname = `${layoutOf(boardLayout).name} in the ${boardKart}`;
  const seq = ++boardSeq;
  let rows = null;
  if (account.enabled) {
    try { rows = await account.top(key, 10, boardKart); } catch (e) { console.warn('online board:', e.message); }
  }
  if (seq !== boardSeq) return;
  const online = !!rows;
  $('boardNote').textContent = online
    ? `Top 10 valid laps of ${lname} worldwide, one per driver. Sign in to put your times on it.`
    : account.enabled ? 'Couldn\'t reach the online board, so these are the times kept on this computer.'
      : `Top 10 valid laps of ${lname}, one per driver, kept on this computer.`;
  // laps the online board doesn't have (rejected, or set offline) still
  // count: merge this computer's times in, best per driver
  const local = board.top(key, 10, boardKart);
  if (rows) {
    const best = new Map(rows.map(r => [r.name, r]));
    for (const r of local) if (!best.has(r.name) || r.time < best.get(r.name).time) best.set(r.name, r);
    rows = [...best.values()].sort((a, b) => a.time - b.time).slice(0, 10);
  }
  rows ??= local;
  // (your place on it, for your record)
  { const at = rows.findIndex(r => r.name === driverName()); if (at >= 0) { stats.data.top10 = true; if (at === 0) stats.data.top1 = true; achievements(); } }
  const list = $('boardList');
  list.innerHTML = '';
  // the top three on the podium, in their own colours (yours as they are now)
  // (anyone else's look as they may wear it: admin items only on an admin's laps)
  const top3 = rows.slice(0, 3).map(r => ({ ...r, look: r.name === driverName() ? { ...helmet } : allowedLook(r.look || {}, r.user_id, ADMIN_UIDS.has(r.user_id)) }));
  podium.show(top3);
  $('podiumWrap').classList.toggle('hidden', !rows.length);
  const names = $('podNames');
  names.innerHTML = '';
  for (const i of [1, 0, 2]) {
    const d = document.createElement('div');
    d.className = 'pod' + (i === 0 ? ' first' : '');
    if (top3[i]) d.innerHTML = '<b></b><span></span>';
    if (top3[i]) { d.querySelector('b').textContent = top3[i].name; d.querySelector('span').textContent = fmt(top3[i].time); }
    names.appendChild(d);
  }
  if (!rows.length) {
    list.innerHTML = `<li class="empty">No valid laps in the ${boardKart} this way round yet. Hit PLAY and set the first time.</li>`;
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.name === driverName()) li.className = 'me';
    li.innerHTML = '<div class="who"><b></b><small></small></div><div class="time"></div>';
    li.querySelector('b').textContent = r.name;
    if (r.user_id || r.name === driverName()) {
      li.querySelector('b').classList.add('link');
      li.querySelector('b').addEventListener('click', () => openProfile(r.user_id && r.user_id !== account.user?.id ? r.user_id : null, 'board'));
    }
    li.querySelector('small').textContent = [r.kart, r.date].filter(Boolean).join(' · ');
    li.querySelector('.time').textContent = fmt(r.time);
    // admins: take a lap off the board (cheated or glitched)
    if (admin.me && r.user_id) {
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = 'DELETE';
      del.title = `Delete ${r.name}'s ${fmt(r.time)} from Fastest Drivers`;
      del.addEventListener('click', async () => {
        if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'SURE?'; setTimeout(() => { delete del.dataset.sure; del.textContent = 'DELETE'; }, 3000); return; }
        try { const n = await admin.deleteLap(key, r.user_id, r.time); toast(n ? `Deleted ${r.name}'s ${fmt(r.time)}` : 'Nothing deleted: run supabase/admin.sql in Supabase first'); renderBoard(); }
        catch (e) { toast(e.message); }
      });
      li.querySelector('.time').appendChild(del);
    }
    list.appendChild(li);
  }
}

// ---- garage: tabs
const tabBtns = document.querySelectorAll('.gPanel .tabs button');
tabBtns.forEach(b => b.addEventListener('click', () => {
  tabBtns.forEach(t => t.classList.toggle('on', t === b));
  $('tabKart').classList.toggle('hidden', b.dataset.tab !== 'kart');
  $('tabDriver').classList.toggle('hidden', b.dataset.tab !== 'driver');
  $('tabMusic').classList.toggle('hidden', b.dataset.tab !== 'music');
  if (b.dataset.tab === 'music') renderMusicPicks();
}));

// ---- garage: music on track (the EDM, and the artists you've bought in the Shop)
function renderMusicPicks() {
  const box = $('musicPicks'), on = new Set(music.picked());
  box.innerHTML = '';
  for (const [id, name, n] of [['edm', 'Gridline EDM', null], ...Object.entries(ARTISTS).map(([id, a]) => [id, a.name, a.songs.length])]) {
    const mine = id === 'edm' || iOwn('music', id);
    const el = document.createElement('label');
    el.className = 'musicPick' + (mine ? '' : ' locked') + (on.has(id) ? ' on' : '');
    el.innerHTML = '<i>♪</i><span><b></b><small></small></span>';
    el.querySelector('b').textContent = name;
    el.querySelector('small').textContent = id === 'edm' ? 'Upbeat EDM, everyone has it' : mine ? `${n} songs · yours` : `Locked · ${MUSIC[id].price.toLocaleString()} points in the Shop`;
    if (mine) {
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on.has(id);
      cb.addEventListener('change', () => {
        let picks = music.picked().filter(p => p !== id);
        if (cb.checked) picks.push(id);
        if (!picks.length) picks = ['edm'];          // (always something on)
        music.setPicks(picks); renderMusicPicks();
      });
      el.prepend(cb);
    } else {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mini'; b.textContent = 'SHOP';
      b.addEventListener('click', (e) => { e.preventDefault(); go('shop'); });
      el.appendChild(b);
    }
    box.appendChild(el);
  }
}

// ---- garage: kart paint
fillSelect($('kFinish'), PAINT_FINISHES);
const PFIELDS = { kPaintOn: 'paintOn', kPaint: 'paint', kTrimOn: 'trimOn', kTrim: 'trim', kFinish: 'finish', kLivery2: 'livery2' };
// the paint saved, its controls and the livery card up to date
function savePaint() {
  for (const [id, k] of Object.entries(PFIELDS)) { const el = $(id); if (el.type === 'checkbox') el.checked = !!paint[k]; else el.value = paint[k]; }
  showLivery();
  try { localStorage.setItem(PAINT, JSON.stringify(paint)); } catch { /* ignore */ }
  syncUp();
}
let liveryAt = 0;
function showLivery() {
  $('liveryNow').querySelector('b').textContent = { ...LIVERIES, ...SHOP_LIVERIES }[paint.livery] || 'None';
  rarityTag($('liveryNow'), 'livery', paint.livery || 'none');
  clearTimeout(liveryAt);
  liveryAt = setTimeout(() => { const img = $('liveryNow').querySelector('img'); picture('livery', paint.livery).then((u) => { img.src = u; }).catch(() => {}); }, 400);
}
for (const [id, k] of Object.entries(PFIELDS)) {
  const el = $(id);
  if (el.type === 'checkbox') el.checked = !!paint[k]; else el.value = paint[k];
  el.addEventListener('input', () => {
    paint[k] = el.type === 'checkbox' ? el.checked : el.value;
    // picking a colour switches that colour on
    if (id === 'kPaint') paint.paintOn = $('kPaintOn').checked = true;
    if (id === 'kTrim') paint.trimOn = $('kTrimOn').checked = true;
    // a livery goes over custom paint, so picking its colour switches paint on
    if (id === 'kLivery2') paint.paintOn = $('kPaintOn').checked = true;
    if (visual) paintCounts = applyPaint(visual.object, paint, paintNames(garage.current()));
    showPaintNote();
    savePaint();
  });
}
function showPaintNote() {
  const miss = [];
  if (!paintCounts.paint) miss.push('no coloured bodywork to repaint');
  if (!paintCounts.trim) miss.push('no light trim');
  $('paintNote').textContent = visual && miss.length ? `This model has ${miss.join(' and ')}.` : '';
}
showPaintNote();
// a random livery in random colours
$('kRandom').addEventListener('click', () => {
  const designs = Object.keys(LIVERIES).filter(k => k !== 'none');
  const col = () => '#' + new THREE.Color().setHSL(Math.random(), 0.55 + Math.random() * 0.4, 0.3 + Math.random() * 0.4).getHexString();
  Object.assign(paint, { paintOn: true, paint: col(), livery: designs[Math.floor(Math.random() * designs.length)],
    livery2: Math.random() < 0.4 ? '#f4f4f4' : Math.random() < 0.5 ? '#141414' : col() });
  if (visual) paintCounts = applyPaint(visual.object, paint, paintNames(garage.current()));
  showPaintNote();
  savePaint();
});

// ---- garage: handling
const BAL_LABELS = { '-3': 'Lots of understeer', '-2': 'More understeer', '-1': 'Slight understeer', '0': 'Rental default',
  '1': 'Slight oversteer', '2': 'More oversteer', '3': 'Lots of oversteer' };
const showBalance = () => { $('balanceVal').textContent = BAL_LABELS[String(settings.balance)]; };
$('balance').value = String(settings.balance);
showBalance();
$('balance').addEventListener('input', () => { settings.balance = +$('balance').value; showBalance(); saveSettings(); });

// ---- garage: driver name and weight
$('driverName').value = settings.name;
$('driverName').addEventListener('input', () => { settings.name = $('driverName').value; saveSettings(); });
const showWeight = () => {
  const lb = settings.weightLb, total = Math.round(lb + (garage.current()?.chassisKg ?? KART.chassisMass) * 2.2046);
  $('weightVal').textContent = `${lb} lb (${Math.round(lb * 0.4536)} kg) · with kart ${total} lb`;
};
$('weight').value = String(settings.weightLb);
showWeight();
$('weight').addEventListener('input', () => { settings.weightLb = +$('weight').value; showWeight(); driver.setWeight(settings.weightLb); saveSettings(); });
driver.setWeight(settings.weightLb);

// ---- garage: helmet and suit, painted live on the driver
const HELMET = 'tidalturns.helmet.v1';
let helmet = { ...HELMET_DEFAULT };
try { helmet = { ...helmet, ...JSON.parse(localStorage.getItem(HELMET)) }; } catch { /* defaults */ }
// finishes and hats: the gold ones only in an admin's lists, account-only
// hats and helmets only in their owner's, limited ones for accounts made in time
// (strip: also take off what this account may not wear; not before we know
// who's signed in, or an admin would lose their gold on every reload)
function fillLookOptions(uid = null, admin = false, strip = true) {
  fillSelect($('hFinish'), admin ? { ...FINISHES, ...ADMIN_FINISHES } : FINISHES);
  if (strip) helmet = allowedLook(helmet, uid, admin, myCreated());
  if (strip && SHOP_LIVERIES[paint.livery] && !iOwn('livery', paint.livery)) {
    paint.livery = 'none';
    if (visual) paintCounts = applyPaint(visual.object, paint, paintNames(garage.current()));
    savePaint();
  }
}
// when this account was made (null: not signed in), for the limited designs
const myCreated = () => (account.user ? account.user.created_at ?? null : null);
// a look with anything this account may not wear taken off (created: see
// designAllowed; left out for someone else's look)
function allowedLook(look, uid, admin, created) {
  const l = { ...look };
  if (ADMIN_FINISHES[l.finish] && !admin) l.finish = 'gloss';
  if (!designAllowed(l.design, uid, created)) l.design = 'stripe';
  // (your own look: the shop's designs only once bought)
  if (created !== undefined && SHOP_DESIGNS[l.design] && !iOwn('helmet', l.design)) l.design = 'stripe';
  if (created !== undefined && SHOP_SUITS[l.suitDesign] && !iOwn('suit', l.suitDesign)) l.suitDesign = 'classic';
  if (l.hat && !hatAllowed(l.hat, uid, admin)) l.hat = 'none';
  return l;
}
fillLookOptions(null, false, false);
const HFIELDS = { hFinish: 'finish', hNumber: 'number',
  hPrimary: 'primary', hSecondary: 'secondary', hAccent: 'accent', hSuit: 'suit', hSuit2: 'suit2', hSuit3: 'suit3', hGloves: 'gloves' };
const showHelmet = () => {
  for (const [id, k] of Object.entries(HFIELDS)) $(id).value = helmet[k];
  // the hat's own colour, or the helmet's main colour while "Match helmet" is ticked
  $('hHatMatch').checked = !helmet.hatColor;
  $('hHatColor').value = helmet.hatColor || helmet.primary;
  driver.setHelmet(helmet);
  visual?.setNumber(helmet.number);
  showWorn();
};
// the hat and suit you have on, with their pictures (a moment after a change: they take a little drawing)
let wornAt = 0;
function showWorn() {
  $('helmetNow').querySelector('b').textContent = { ...DESIGNS, ...OWN_DESIGNS, ...LIMITED_DESIGNS, ...SHOP_DESIGNS }[helmet.design] || 'Helmet';
  rarityTag($('helmetNow'), 'helmet', helmet.design); rarityTag($('visorNow'), 'visor', helmet.visor);
  rarityTag($('hatNow'), 'hat', helmet.hat || 'none'); rarityTag($('suitNow'), 'suit', helmet.suitDesign || 'classic');
  $('visorNow').querySelector('b').textContent = `${VISORS[helmet.visor] || 'Visor'} visor`;
  $('hatNow').querySelector('b').textContent = HATS[helmet.hat] || 'No hat';
  $('suitNow').querySelector('b').textContent = { ...SUITS, ...SHOP_SUITS }[helmet.suitDesign] || SUITS.classic;
  clearTimeout(wornAt);
  wornAt = setTimeout(() => {
    for (const [id, kind] of [['helmetNow', 'helmet'], ['visorNow', 'visor'], ['hatNow', 'hat'], ['suitNow', 'suit']]) {
      const img = $(id).querySelector('img');
      lookPicture(picLook(kind, helmet), VIEW[kind]).then((u) => { img.src = u; }).catch(() => {});
    }
  }, 400);
}
const saveHelmet = () => { try { localStorage.setItem(HELMET, JSON.stringify(helmet)); } catch { /* ignore */ } syncUp(); };
for (const [id, k] of Object.entries(HFIELDS)) {
  $(id).addEventListener('input', () => { helmet[k] = $(id).value;
    driver.setHelmet(helmet); visual?.setNumber(helmet.number); if (helmet.hatColor === '') $('hHatColor').value = helmet.primary; showWorn(); saveHelmet(); });
}
$('hHatColor').addEventListener('input', () => { helmet.hatColor = $('hHatColor').value; $('hHatMatch').checked = false; driver.setHelmet(helmet); showWorn(); saveHelmet(); });
$('hHatMatch').addEventListener('change', () => { helmet.hatColor = $('hHatMatch').checked ? '' : $('hHatColor').value; showHelmet(); saveHelmet(); });
$('hRandom').addEventListener('click', () => {
  const pick = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
  const col = () => '#' + new THREE.Color().setHSL(Math.random(), 0.55 + Math.random() * 0.4, 0.25 + Math.random() * 0.5).getHexString();
  const hats = Object.keys(HATS).filter(k => hatAllowed(k, account.user?.id, false));
  helmet = { ...helmet, design: pick(DESIGNS), visor: pick(VISORS), finish: pick(FINISHES),
    primary: col(), secondary: Math.random() < 0.5 ? '#f4f4f4' : col(), accent: col(), number: String(1 + Math.floor(Math.random() * 99)),
    hat: Math.random() < 0.4 ? 'none' : hats[Math.floor(Math.random() * hats.length)], hatColor: Math.random() < 0.5 ? '' : col(),
    suit: col(), suitDesign: pick(SUITS), suit2: col(), suit3: Math.random() < 0.5 ? '#f4f4f4' : '#141414', gloves: col() };
  showHelmet(); saveHelmet();
});
$('hReset').addEventListener('click', () => { helmet = { ...HELMET_DEFAULT }; showHelmet(); saveHelmet(); });
showHelmet();
// the studio camera moves in on the helmet while it's being edited
let helmetBlur = 0;
const focusHelmet = (on) => {
  if (picking) return;               // (the picker says where to look)
  clearTimeout(helmetBlur);
  if (on) showroom.wantFocus = 1; else helmetBlur = setTimeout(() => { showroom.wantFocus = 0; }, 1200);
};
$('helmetBox').addEventListener('pointerenter', () => focusHelmet(true));
$('helmetBox').addEventListener('pointerleave', () => focusHelmet(false));
$('helmetBox').addEventListener('focusin', () => focusHelmet(true));
$('helmetBox').addEventListener('focusout', () => focusHelmet(false));

// ---- garage: the hat and suit pickers. Every one, pictured on your driver
// in your colours; picking one tries it on the driver in the studio, PUT ON
// keeps it. The admins' crown and the beta testers' cowboy hat show, locked,
// to everyone else; a hat that's one person's own shows only to them.
let picking = null;                  // { kind: 'livery' | 'helmet' | 'visor' | 'hat' | 'suit', sel }
const FIELD = { helmet: 'design', visor: 'visor', hat: 'hat', suit: 'suitDesign' };
// the shop's items in a picker: the ones you've bought, and (locked) the ones in the shop now
function shopPicks(kind, names) {
  const inShop = new Set(shopItems().filter(i => i.kind === kind).map(i => i.theme));
  return Object.entries(names).flatMap(([id, name]) => iOwn(kind, id) ? [{ id, name }]
    : inShop.has(id) ? [{ id, name, lock: `In the shop: ${priceOf(kind, id).toLocaleString()} points` }] : []);
}
const VIEW = { helmet: 'helmet', visor: 'hat', hat: 'hat', suit: 'suit' };
// the look in a picture: helmets and visors bare, without the hat
const picLook = (kind, look) => (kind === 'helmet' || kind === 'visor' ? { ...look, hat: 'none' } : { ...look });
function pickItems(kind) {
  if (kind === 'livery') return [...Object.entries(LIVERIES).map(([id, name]) => ({ id, name })), ...shopPicks('livery', SHOP_LIVERIES)];
  if (kind === 'suit') return [...Object.entries(SUITS).map(([id, name]) => ({ id, name })), ...shopPicks('suit', SHOP_SUITS)];
  if (kind === 'visor') return Object.entries(VISORS).map(([id, name]) => ({ id, name }));
  if (kind === 'helmet') {
    const uid = account.user?.id ?? null, created = myCreated();
    return [
      ...Object.entries(DESIGNS).map(([id, name]) => ({ id, name })),
      ...Object.entries(OWN_DESIGNS).filter(([id]) => designAllowed(id, uid)).map(([id, name]) => ({ id, name: name.replace(/ \(yours\)$/, '') })),
      ...shopPicks('helmet', SHOP_DESIGNS),
      // the limited ones: locked for accounts made too late (or nobody signed in)
      ...Object.entries(LIMITED_DESIGNS).map(([id, name]) => ({ id, name, lock: designAllowed(id, uid, created) ? null
        : uid ? 'Halloween 2026: accounts made by 1 Nov' : 'Sign in: accounts made by 1 Nov' })),
    ];
  }
  const uid = account.user?.id ?? null, adm = !!admin.me;
  return Object.entries(HATS).flatMap(([id, name]) => {
    if (hatAllowed(id, uid, adm)) return [{ id, name: id === 'none' ? 'No hat' : name.replace(/ \((admin|Beta tester)\)$/, '') }];
    if (ADMIN_HATS.has(id)) return [{ id, name: name.replace(/ \(admin\)$/, ''), lock: 'Admins only' }];
    if (id === 'fcowboy') return [{ id, name: name.replace(/ \(Beta tester\)$/, ''), lock: 'Beta testers only' }];
    return [];
  });
}
// the look with one thing tried on (the shark helmet comes with its gold visor)
const pickLook = (kind, id) => ({ ...helmet, [FIELD[kind]]: id, ...(kind === 'helmet' && id === 'shark' ? { visor: 'gold' } : {}) });
const worn = (kind) => (kind === 'livery' ? paint.livery || 'none' : helmet[FIELD[kind]] || { helmet: 'stripe', visor: 'smoke', hat: 'none', suit: 'classic' }[kind]);
// the kart's paint with a livery on (a livery goes over custom paint, so that comes on too)
const livPaint = (id) => ({ ...paint, livery: id, ...(id !== 'none' ? { paintOn: true } : {}) });
function picture(kind, id) {
  if (kind !== 'livery') return lookPicture(picLook(kind, pickLook(kind, id)), VIEW[kind]);
  const e = garage.current();
  return garage.source(e).then(({ src, opts }) => kartPicture(`${e.id}:${opts.yawDegrees}`, src, opts, livPaint(id), paintNames(e), helmet.number, world3d.envMap));
}
function tryOn(kind, id) {
  if (kind !== 'livery') driver.setHelmet(pickLook(kind, id));
  else if (visual) applyPaint(visual.object, livPaint(id), paintNames(garage.current()));
}
function openPicker(kind) {
  picking = { kind, sel: worn(kind) };
  $('pkTitle').textContent = { livery: 'LIVERIES', helmet: 'HELMETS', visor: 'VISORS', hat: 'HATS', suit: 'SUITS' }[kind];
  $('pkNote').textContent = {
    livery: 'Pick a livery to try it on your kart. PUT ON keeps it. Its colours are set under PAINT and LIVERY.',
    helmet: 'Pick a helmet to try it on your driver. PUT ON keeps it. Its three colours are set under HELMET.',
    visor: 'Pick a visor to try it on your driver. PUT ON keeps it.',
    hat: 'Pick a hat to try it on your driver. PUT ON keeps it. Its colour is set under HAT.',
    suit: 'Pick a suit to try it on your driver. PUT ON keeps it. Its three colours are set under SUIT.' }[kind];
  const grid = $('pkGrid');
  grid.innerHTML = '';
  grid.classList.toggle('wide', kind === 'livery');
  for (const it of pickItems(kind)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pk'; b.dataset.id = it.id;
    b.innerHTML = '<img alt=""><span></span><small></small>';
    b.querySelector('span').textContent = it.name;
    b.querySelector('small').textContent = it.lock ? `🔒 ${it.lock}` : '';
    rarityTag(b, kind, it.id);
    b.disabled = !!it.lock;
    const img = b.querySelector('img');
    picture(kind, it.id).then((u) => { img.src = u; img.classList.add('ready'); }).catch(() => {});
    b.addEventListener('click', () => { picking.sel = it.id; markPicks(); tryOn(kind, it.id); });
    grid.appendChild(b);
  }
  markPicks();
  document.querySelector('.gPanel').classList.add('picking');
  $('picker').classList.remove('hidden');
  clearTimeout(helmetBlur);
  showroom.wantFocus = kind === 'suit' || kind === 'livery' ? 0 : 1;
  showroom.roomy = kind === 'hat';
  grid.querySelector('.pk.sel')?.scrollIntoView({ block: 'nearest' });
}
function markPicks() {
  for (const b of $('pkGrid').children) { b.classList.toggle('sel', b.dataset.id === picking.sel); b.classList.toggle('on', b.dataset.id === worn(picking.kind)); }
  $('pkWear').disabled = picking.sel === worn(picking.kind);
}
function closePicker(keep) {
  if (!picking) return;
  const kind = picking.kind;
  if (keep && kind === 'livery') { Object.assign(paint, livPaint(picking.sel)); savePaint(); }
  else if (keep) { helmet = pickLook(kind, picking.sel); saveHelmet(); }
  picking = null;
  if (kind === 'livery' && visual) paintCounts = applyPaint(visual.object, paint, paintNames(garage.current()));
  document.querySelector('.gPanel').classList.remove('picking');
  $('picker').classList.add('hidden');
  showroom.wantFocus = 0; showroom.roomy = false;
  showHelmet();
}
for (const [id, kind] of [['liveryBrowse', 'livery'], ['liveryNow', 'livery'], ['helmetNow', 'helmet'], ['visorNow', 'visor'], ['hatBrowse', 'hat'], ['hatNow', 'hat'], ['suitBrowse', 'suit'], ['suitNow', 'suit']]) $(id).addEventListener('click', () => openPicker(kind));
$('pkWear').addEventListener('click', () => closePicker(true));
$('pkCancel').addEventListener('click', () => closePicker(false));
$('pkClose').addEventListener('click', () => closePicker(false));
document.querySelector('#pgGarage .back').addEventListener('click', () => closePicker(false));

// ---- the shop (shop.js): this month's sets, each piece pictured on your
// kart or driver, bought with points (tap BUY, then again to be sure)
function renderShop() {
  const bal = balance(stats.data);
  $('shBal').textContent = bal.toLocaleString();
  $('shEarned').textContent = `${(stats.data.points || 0).toLocaleString()} earned in all`;
  const now = new Date(), next = nextReset(now), days = Math.ceil((next - now) / 86400e3);
  $('shMonth').textContent = now.toLocaleString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  $('shReset').textContent = `New sets in ${days} day${days === 1 ? '' : 's'}`;
  const box = $('shSets');
  box.innerHTML = '';
  const items = shopItems(now);
  for (const theme of [...new Set(items.map(i => i.theme))]) {
    const set = document.createElement('div');
    set.className = 'shSet';
    set.innerHTML = '<h3></h3><div class="shItems"></div>';
    set.querySelector('h3').textContent = THEME_NAMES[theme].toUpperCase();
    for (const it of items.filter(i => i.theme === theme)) {
      const mine = iOwn(it.kind, theme);
      const el = document.createElement('div');
      el.className = 'shItem' + (mine ? ' own' : '');
      el.innerHTML = '<img alt=""><div class="shTxt"><b></b><small></small></div><button class="btn"></button>';
      el.querySelector('b').textContent = `${THEME_NAMES[theme]} ${KINDS[it.kind].toLowerCase()}`;
      el.querySelector('small').textContent = mine ? 'Yours: wear it from the Garage' : `${it.price.toLocaleString()} points`;
      rarityTag(el.querySelector('.shTxt'), it.kind, theme);
      el.style.setProperty('--rc', tierOf(it.kind, theme).colour);
      const b = el.querySelector('button');
      if (mine) { b.textContent = 'OWNED'; b.disabled = true; }
      else if (bal < it.price) { b.textContent = `${(it.price - bal).toLocaleString()} MORE`; b.disabled = true; }
      else {
        b.textContent = 'BUY'; b.classList.add('primary');
        b.addEventListener('click', () => {
          if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'SURE?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'BUY'; } }, 3000); return; }
          if (balance(stats.data) < it.price || iOwn(it.kind, theme)) return;
          stats.buy(it.id, it.price);
          syncUp();
          toast(`Bought: ${THEME_NAMES[theme]} ${KINDS[it.kind].toLowerCase()}. It's in your Garage.`);
          renderShop();
        });
      }
      const img = el.querySelector('img');
      const pic = it.kind === 'livery' ? picture('livery', theme)
        : lookPicture(it.kind === 'helmet' ? { ...helmet, design: theme, hat: 'none' } : { ...helmet, suitDesign: theme }, it.kind === 'helmet' ? 'helmet' : 'suit');
      pic.then((u) => { img.src = u; }).catch(() => {});
      set.querySelector('.shItems').appendChild(el);
    }
    box.appendChild(set);
  }
  // the artists' music: always in, each artist on their own
  const set = document.createElement('div');
  set.className = 'shSet';
  set.innerHTML = '<h3>MUSIC</h3><div class="shItems"></div>';
  for (const [id, { price }] of Object.entries(MUSIC)) {
    const a = ARTISTS[id], mine = iOwn('music', id);
    const el = document.createElement('div');
    el.className = 'shItem shMusic' + (mine ? ' own' : '');
    el.innerHTML = '<div class="shArt"><i>♪</i><span></span></div><div class="shTxt"><b></b><small></small></div><button class="btn"></button>';
    el.querySelector('.shArt span').textContent = a.name.toUpperCase();
    el.querySelector('b').textContent = `${a.name} · ${a.songs.length} songs`;
    el.querySelector('small').textContent = mine ? 'Yours: pick it in the Garage (MUSIC)' : `${price.toLocaleString()} points`;
    const b = el.querySelector('button');
    if (mine) { b.textContent = 'OWNED'; b.disabled = true; }
    else if (bal < price) { b.textContent = `${(price - bal).toLocaleString()} MORE`; b.disabled = true; }
    else {
      b.textContent = 'BUY'; b.classList.add('primary');
      b.addEventListener('click', () => {
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'SURE?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'BUY'; } }, 3000); return; }
        if (balance(stats.data) < price || iOwn('music', id)) return;
        stats.buy(itemId('music', id), price);
        syncUp();
        // (bought to be heard: on the track's playlist straight away)
        music.setPicks([...music.picked(), id]);
        toast(`Bought: ${a.name}. Their songs now play on track (pick your music in the Garage).`);
        renderShop();
      });
    }
    set.querySelector('.shItems').appendChild(el);
  }
  box.appendChild(set);
  const earn = $('shEarn');
  earn.innerHTML = '';
  for (const [what, n] of [['A valid lap', SHOP_POINTS.lap], ['A new personal best (each layout, way round and kart)', SHOP_POINTS.best],
    ['The fastest lap of a race', SHOP_POINTS.fastestLap], ['Into, or up, a Fastest Drivers top 10', SHOP_POINTS.top10], ['To the top of a Fastest Drivers board', SHOP_POINTS.top1]]) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><b></b>';
    li.querySelector('span').textContent = what; li.querySelector('b').textContent = `+${n}`;
    earn.appendChild(li);
  }
  $('shNote').textContent = account.signedIn ? 'Your points and what you buy go with your account, to any computer.'
    : 'Sign in to keep your points with your account, and for the Fastest Drivers points (the worldwide boards).';
}

// ---- settings
$('musicVol').value = String(music.volume);
$('musicOn').checked = music.enabled;
$('musicVol').addEventListener('input', () => music.setVolume(+$('musicVol').value));
$('musicOn').addEventListener('change', () => { if ($('musicOn').checked !== music.enabled) music.toggle(); });
$('sfxVol').value = String(settings.sfx);
audio.setVolume(settings.sfx);
$('sfxVol').addEventListener('input', () => { settings.sfx = +$('sfxVol').value; audio.setVolume(settings.sfx); saveSettings(); });
// Keeping the frame rate up while driving: when it drops below ~48 fps the
// picture is drawn at a little lower resolution (down to 60% of the
// setting's), and after a while running smoothly it creeps back up. A step
// up that brings the drops back isn't tried again for a minute.
function keepFrameRate(dt, now) {
  if (!running || paused || document.hidden) { dyn.t = dyn.n = dyn.smooth = 0; return; }
  dyn.t += dt; dyn.n++;
  if (dyn.t < 1.5) return;
  const avg = dyn.t / dyn.n;
  dyn.t = dyn.n = 0;
  let pr = dyn.pr;
  if (avg > 1 / 48) {
    dyn.smooth = 0;
    pr = Math.max(dyn.min, pr - 0.1);
    if (now - dyn.upAt < 6000) dyn.hold = now + 60000;
  } else if (avg < 1 / 57) {
    dyn.smooth += 1.5;
    if (dyn.smooth >= 9 && pr < dyn.max && now > dyn.hold) { pr = Math.min(dyn.max, pr + 0.05); dyn.upAt = now; dyn.smooth = 0; }
  } else dyn.smooth = 0;
  if (Math.abs(pr - dyn.pr) > 1e-3) { dyn.pr = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
}
function applyQuality() {
  // (a phone's small screen keeps its full 1x even on low: below that it blurs)
  dyn.max = dyn.pr = { high: Math.min(devicePixelRatio, 1.5), medium: 1, low: PHONE ? 1 : 0.75 }[settings.quality] ?? 1;
  dyn.min = Math.max(0.6, dyn.max * 0.6);
  renderer.setPixelRatio(dyn.pr);
  renderer.setSize(innerWidth, innerHeight);
  world3d.sun.castShadow = settings.quality !== 'low';
  post.setQuality(settings.quality);
  effects.setLevel({ high: 1, medium: 0.7, low: 0.4 }[settings.quality] ?? 0.7);
  // high: a sharper shadow map
  const sm = settings.quality === 'high' ? 4096 : 2048, sh = world3d.sun.shadow;
  if (sh.mapSize.x !== sm) { sh.mapSize.set(sm, sm); sh.map?.dispose(); sh.map = null; }
  world3d.trees.setNear({ high: 120, medium: 80, low: 50 }[settings.quality] ?? 80);
  world3d.grass.setRange({ high: 45, medium: 25, low: 0 }[settings.quality] ?? 25);
}
$('quality').value = settings.quality;
applyQuality();
$('quality').addEventListener('change', () => { settings.quality = $('quality').value; applyQuality(); saveSettings(); });
fillSelect($('timeOfDay'), TIMES); fillSelect($('weather'), WEATHER);
$('timeOfDay').value = settings.time; $('weather').value = settings.weather;
$('timeOfDay').addEventListener('change', () => { settings.time = $('timeOfDay').value; saveSettings(); });
$('weather').addEventListener('change', () => { settings.weather = $('weather').value; saveSettings(); });
$('units').value = settings.units;
hud.setUnits(settings.units);
$('units').addEventListener('change', () => { settings.units = $('units').value; hud.setUnits(settings.units); saveSettings(); });
$('assistsOn').checked = settings.assists;
$('assistsOn').addEventListener('change', () => { settings.assists = $('assistsOn').checked; saveSettings(); });
$('ghostOn').checked = !!settings.ghost;
$('ghostOn').addEventListener('change', () => { settings.ghost = $('ghostOn').checked; saveSettings(); });
$('telemetryOn').checked = settings.telemetry;
$('telemetryOn').addEventListener('change', () => { settings.telemetry = $('telemetryOn').checked; saveSettings(); });
$('openInput').addEventListener('click', () => input.openConfig($('inputCfg')));
$('closeInput').addEventListener('click', () => { $('inputCfg').classList.add('hidden'); showPads(); });
addEventListener('gamepadconnected', showPads);
addEventListener('gamepaddisconnected', showPads);
showPads();
setInterval(() => { if (!running) showPads(); }, 1000);   // controllers appear after their first press

// browsers only allow audio after a click or key press
const startLobbyMusic = () => { if (!running) music.play('lobby'); };
addEventListener('pointerdown', startLobbyMusic, { once: true });
addEventListener('keydown', startLobbyMusic, { once: true });

// ---- play: a fresh session from the grid, cold tyres, new out lap
// ---- smoke and skid marks: our kart's tyres and exhaust, and the others'
// (theirs worked out from how they move: sliding when they travel at an
// angle to the way they point)
let lastThrottle = 0;
const EXHAUST = new THREE.Vector3(0.3, 0.02, 0.62);     // kart frame: right, low, behind the engine
const REAR = [new THREE.Vector3(0.56, 0, 0.5), new THREE.Vector3(-0.56, 0, 0.5)];
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3();
// how close a kart is to spinning out (0: not at all; up to 1): sliding well
// sideways (past ~25 degrees) or rotating fast, at speed. Only then do its rear
// tyres leave rubber on the track.
function spinning(v, yawRate, fwd) {
  const sp = Math.hypot(v.x, v.z);
  if (sp < 5) return 0;
  const slide = Math.acos(Math.min(1, Math.abs(v.x * fwd.x + v.z * fwd.z) / sp));
  const k = Math.max((slide - 0.44) / 0.5, (Math.abs(yawRate) - 1.9) / 1.5);
  return k > 0 ? Math.min(1, 0.35 + k) : 0;
}
function smokeAndMarks(dt, sw) {
  if (world3d.smokeLight) effects.setLight(world3d.smokeLight);
  effects.wet = !!world3d.conditions?.endsWith('|rain');
  if (!sw && !frozen()) {
    const v = kart.body.linvel(), q = kart.body.rotation();
    _f.set(0, 0, -1).applyQuaternion(q); _r.set(1, 0, 0).applyQuaternion(q);
    const spin = spinning(v, kart.body.angvel().y, _f);
    kart.wheels.forEach((w, i) => {
      if (!w.contact) { effects.tyre(`me${i}`, w.cp, 0, 'air', 0, v, dt, 0, 0); return; }
      // the same slip that makes the tyres squeal (audio.js)
      const slip = Math.min(1, Math.max(0, w.util - 0.85) * 1.6) * Math.min(1, kart.speed / 4);
      effects.tyre(`me${i}`, w.cp, slip, w.surface, kart.speed, v, dt, _r.x, _r.z, w.front ? 0 : spin);
    });
    kartGroup.updateMatrixWorld();
    _e.copy(EXHAUST).setY(EXHAUST.y - KART.cgHeight * 0.4).applyMatrix4(kartGroup.matrixWorld);
    effects.exhaust('me', _e, lastThrottle, v, _f.clone().negate(), dt);
  }
  for (const [id, r] of remotes) {
    const d = r.last;
    if (!d || !r.group.visible || r.hidden) continue;
    const g = r.group, sp = Math.hypot(d.v[0], d.v[2]);
    _f.set(0, 0, -1).applyQuaternion(g.quaternion); _r.set(1, 0, 0).applyQuaternion(g.quaternion);
    const slide = sp > 2 ? Math.acos(Math.min(1, Math.abs(d.v[0] * _f.x + d.v[2] * _f.z) / sp)) : 0;
    const slip = Math.min(1, Math.max(0, slide - 0.09) * 5) * Math.min(1, sp / 5);
    _v.set(d.v[0], 0, d.v[2]);
    g.updateMatrixWorld();
    const spin = spinning(_v, d.w || 0, _f);
    REAR.forEach((p, i) => {
      _e.copy(p).applyMatrix4(g.matrixWorld);
      const cp = [_e.x, groundAt(_e.x, _e.z), _e.z];
      effects.tyre(`${id}${i}`, cp, slip, 'asphalt', sp, _v, dt, _r.x, _r.z, spin);
    });
    _e.copy(EXHAUST).applyMatrix4(g.matrixWorld);
    effects.exhaust(id, _e, 0.25, _v, _f.clone().negate(), dt);       // (their throttle isn't sent: a steady wisp)
  }
  effects.update(dt);
}

function startSession() {
  effects.clear();
  kart.setBalance(settings.balance);
  kart.setDriverMass(settings.weightLb * 0.4536);
  const k = driving();
  kart.pt.setEngine(k?.engine);      // each kart brings its own engine
  kart.setChassisMass(k?.chassisKg);   // and weight
  kart.setDragArea(k?.dragArea);
  kart.setTyreGrip(k?.tyreGrip);       // and tyres
  kart.setFootprint(k?.footprint);     // and its size, for walls and bumping
  const hb = shownKart === k?.id ? hitboxOf(k.id, visual?.object) : null;
  if (hb) kart.setHitbox(hb);          // (its own shape, once its model's loaded)
  placePit(pitSlot());
  for (const w of kart.wheels) { w.temp = TYRE_TEMP.ambient; w.grip = gripFromTemp(w.temp); }
  timer.reset();
  camDir.set(0, 0, 0);
  simTime = 0; acc = 0;
  ghostUntil = GHOST_TIME;
  for (const id of Object.values(PAGES)) $(id).classList.add('hidden');
  page = 'race';
  showroom.active = false;
  scene.add(kartGroup);
  $('hud').classList.remove('hidden');
  $('telemetry').classList.toggle('hidden', !settings.telemetry);
  audio.start();
  audio.resume();
  music.play('race');
  $('nowPlaying').classList.add('racing');
  running = true; paused = false; last = performance.now();
  document.body.classList.add('driving');
  syncSteward();
}

function play() {
  if (!visual) return;
  // an unknown wheel's pedals need a quick calibration before they work
  if (input.needsCalibration()) { input.openConfig($('inputCfg')); return; }
  // unlock sound inside the click (browsers require it), but keep the engine
  // silent until the session actually starts
  audio.start();
  audio.suspend();
  openLayoutPicker();
}

// PLAY: pick the layout and which way round, then onto the track
function openLayoutPicker() {
  const list = $('layoutList');
  list.innerHTML = '';
  for (const lay of LAYOUTS) {
    const card = document.createElement('div');
    card.className = 'layoutCard' + (lay.id === layoutId ? ' sel' : '');
    const len = lay.lapLength ?? track.lapLength;
    card.innerHTML = '<canvas width="150" height="150"></canvas><div><b></b><small></small><span class="dirBtns"></span></div>';
    card.querySelector('b').textContent = lay.name;
    card.querySelector('small').textContent = `${Math.round(len)} m lap`;
    drawLayoutThumb(card.querySelector('canvas'), lay.centerline || SHORT_LINE);
    for (const [dir, label] of [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']]) {
      const best = board.best(boardKey(lay.id, dir), driverName(), garage.current()?.name);
      const b = document.createElement('button');
      b.className = 'btn' + (lay.id === layoutId && dir === direction ? ' primary' : '');
      b.innerHTML = `${label}<small>${best != null ? 'Best ' + fmt(best) : 'No lap yet'}</small>`;
      b.addEventListener('click', () => {
        $('layoutPick').classList.add('hidden');
        if (lay.id !== layoutId || dir !== direction) chooseLayout(lay.id, dir);
        $('fade').classList.add('on');
        setTimeout(() => { startSession(); setTimeout(() => $('fade').classList.remove('on'), 50); setTimeout(soloTick, 3000); }, 300);
      });
      card.querySelector('.dirBtns').appendChild(b);
    }
    list.appendChild(card);
  }
  $('layoutPick').classList.remove('hidden');
}
function drawLayoutThumb(cv, line) {
  const g = cv.getContext('2d'), W = cv.width, pad = 10;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of SHORT_LINE.concat(line)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const s = (W - 2 * pad) / Math.max(x1 - x0, z1 - z0);
  const P = ([x, z]) => [pad + (x - x0) * s + (W - 2 * pad - (x1 - x0) * s) / 2, pad + (z - z0) * s + (W - 2 * pad - (z1 - z0) * s) / 2];
  g.clearRect(0, 0, W, W);
  g.lineJoin = 'round'; g.strokeStyle = '#d42a2a'; g.lineWidth = 4;
  g.beginPath(); line.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.stroke();
  const [a, b] = P(line[0]); g.fillStyle = '#141414'; g.fillRect(a - 4, b - 4, 8, 8);
}
$('layoutBack').addEventListener('click', () => $('layoutPick').classList.add('hidden'));
$('playBtn').addEventListener('click', play);
$('garagePlay').addEventListener('click', play);

// Esc: leave the session and go back to the menu
// ---- the pause menu, driving on your own (on a server Esc opens the server
// menu instead, and nothing stops)
function setPaused(on) {
  paused = on;
  $('pauseMenu').classList.toggle('hidden', !on);
  if (on) audio.suspend(); else { audio.resume(); last = performance.now(); }
}
$('pmResume').addEventListener('click', () => setPaused(false));
$('pmPits').addEventListener('click', () => { setPaused(false); placePit(pitSlot()); snapPose(); timer.reset(); hud.resetSectors(); ghost.restart(); });
$('pmQuit').addEventListener('click', () => { setPaused(false); toLobby(); });

function toLobby() {
  if (reloadWhenFree) { location.reload(); return; }
  if (club) leaveClub(false);
  running = false;
  soloEnd();
  if (paused) setPaused(false);
  document.body.classList.remove('driving');
  touch.release();
  audio.suspend();
  music.play('lobby');
  $('nowPlaying').classList.remove('racing');
  placePit();
  $('hud').classList.add('hidden');
  showroom.scene.add(kartGroup);
  go('home');
}

go('home');
menusReady = true;
showLivery();

async function runShots() {
  const q = new URLSearchParams(location.search);
  if (q.get('layout')) chooseLayout(q.get('layout'), q.get('dir') || 'cw');
  openLayoutPicker();
  const cards = [...document.querySelectorAll('#layoutList .layoutCard')];
  fetch('/__log', { method: 'POST', body: `[picker] ${cards.map(c => c.querySelector('b').textContent + ' (' + c.querySelector('small').textContent + '): ' + [...c.querySelectorAll('.dirBtns .btn')].map(b => b.textContent).join(' | ')).join(' ;; ')} | lap points ${N}, layout ${layoutId}, ${direction}` });
  $('layoutPick').classList.add('hidden');
  const want = q.get('kart');
  const pick = want && garage.entries.find(e => e.id === want);
  if (pick && pick.id !== garage.current()?.id) { garage.select(pick.id); await showKart(pick); }
  for (const id of Object.values(PAGES)) $(id).classList.add('hidden');
  page = 'shots';
  scene.add(kartGroup);
  placePit();
  snapPose();
  kartGroup.position.copy(currPose.p); kartGroup.quaternion.copy(currPose.q);
  driver.update(0, 0, 'CHASE');
  renderer.toneMappingExposure = 0.56;
  const c = track.centerline, at = (i) => c[((i % N) + N) % N];
  const eye = (i, h = 0.95, ahead = 24) => {
    const p = at(i), q = at(i + ahead);
    return { pos: [p[0], groundAt(p[0], p[1]) + h, p[1]], look: [q[0], groundAt(q[0], q[1]) + 0.3, q[1]], fov: 70 };
  };
  const feats = await (await fetch('assets/ground/features.json')).json();
  const views = [];
  const k = currPose.p, fq = new THREE.Vector3(0, 0, -1).applyQuaternion(currPose.q);
  views.push({ name: 'pit_chase', pos: [k.x - fq.x * 3.3, k.y + 1.25, k.z - fq.z * 3.3], look: [k.x + fq.x * 2.5, k.y + 0.25, k.z + fq.z * 2.5], fov: 62 });
  views.push({ name: 'pit_top', pos: [k.x, k.y + 22, k.z + 0.01], look: [k.x, k.y, k.z], fov: 55 });
  { // the kart up close: side, front three-quarter, and painted
    const rt = new THREE.Vector3(fq.z, 0, -fq.x);
    views.push({ name: 'kart_side', pos: [k.x + rt.x * 3.2, k.y + 0.5, k.z + rt.z * 3.2], look: [k.x, k.y, k.z], fov: 45 });
    views.push({ name: 'kart_front', pos: [k.x + fq.x * 2.6 + rt.x * 1.6, k.y + 0.9, k.z + fq.z * 2.6 + rt.z * 1.6], look: [k.x, k.y, k.z], fov: 45 });
    views.push({ name: 'kart_painted', pos: [k.x - fq.x * 2.2 + rt.x * 2.0, k.y + 1.0, k.z - fq.z * 2.2 + rt.z * 2.0], look: [k.x, k.y, k.z], fov: 45,
      before: () => visual && applyPaint(visual.object, { paintOn: true, paint: '#d42a2a', trimOn: true, trim: '#20c040', finish: 'gloss' }, paintNames(garage.current())),
      after: () => visual && applyPaint(visual.object, paint, paintNames(garage.current())) });
    const up = (o) => [k.x + fq.x * o[0] + rt.x * o[1], k.y + o[2], k.z + fq.z * o[0] + rt.z * o[1]];
    const head = [k.x - fq.x * 0.1, k.y + 0.25, k.z - fq.z * 0.1];
    views.push({ name: 'drv_front', pos: up([1.6, 0, 0.6]), look: head, fov: 40 });
    views.push({ name: 'drv_top', pos: up([0, 0.001, 2.2]), look: [k.x, k.y, k.z], fov: 45 });
    views.push({ name: 'drv_side', pos: up([0, 1.5, 0.35]), look: [k.x, k.y + 0.05, k.z], fov: 45 });
    fetch('/__log', { method: 'POST', body: `[kart] ${garage.current()?.name}: ${visual?.wheelCount} wheels found, paint mats ${paintCounts.paint}, trim mats ${paintCounts.trim}` });
  }
  for (const i of [0, 40, 80, 120, 160, 240, 330, 430, 540, 650, 760, 870]) views.push({ name: `lap_${i}`, ...eye(i) });
  { // the first turn from above
    const p = at(110);
    views.push({ name: 'turn1_top', pos: [p[0] + 0.1, 55, p[1]], look: [p[0], 0, p[1]], fov: 50 });
  }
  const kr = feats.kerbs.reduce((a, b) => (b.pts.length > a.pts.length ? b : a));
  const m = kr.pts[Math.floor(kr.pts.length / 2)], n = kr.n[Math.floor(kr.pts.length / 2)];
  views.push({ name: 'kerb_close', pos: [m[0] - n[0] * 4, groundAt(m[0], m[1]) + 1.1, m[1] - n[1] * 4], look: [m[0] + n[0], groundAt(m[0], m[1]), m[1] + n[1]], fov: 60 });
  views.push({ name: 'kerb_driver', ...eye(c.reduce((bi, p, i) => (Math.hypot(p[0] - m[0], p[1] - m[1]) < Math.hypot(at(bi)[0] - m[0], at(bi)[1] - m[1]) ? i : bi), 0) - 30) });
  const pc = feats.pond.reduce((a, p) => [a[0] + p[0] / feats.pond.length, a[1] + p[1] / feats.pond.length], [0, 0]);
  views.push({ name: 'pond', pos: [pc[0] + 6, groundAt(pc[0] + 6, pc[1] + 14) + 2.5, pc[1] + 14], look: [pc[0], groundAt(pc[0], pc[1]), pc[1]], fov: 60 });
  views.push({ name: 'aerial', pos: [5, 150, 60], look: [5, 0, -5], fov: 55 });
  if (track.barriers?.length) {
    const [bx, bz] = track.barriers[Math.floor(track.barriers.length / 3)], by = groundAt(bx, bz);
    views.push({ name: 'barriers', pos: [bx + 5, by + 2.2, bz + 5], look: [bx, by + 0.4, bz], fov: 55 });
  }
  { // the turn at the bottom right, from the driver's seat and from above the tree
    const W = 1560, [x0, z0, x1] = track.detailRect, mpp = (x1 - x0) / W, R = (rx, ry) => [x0 + (W - 1 - ry) * mpp, z0 + rx * mpp];
    const [ax, az] = R(1590, 1150), [bx, bz] = R(1450, 1200);
    views.push({ name: 'turn12', pos: [bx, groundAt(bx, bz) + 1.6, bz], look: [ax, groundAt(ax, az) + 0.3, az], fov: 70 });
  }
  if (track.tyres?.length) {
    const [tx, tz] = track.tyres[Math.floor(track.tyres.length / 2)], ty = groundAt(tx, tz);
    views.push({ name: 'tyres', pos: [tx + 4, ty + 1.8, tz + 4], look: [tx, ty + 0.3, tz], fov: 55 });
  }
  if (track.cones?.length) {
    const [cx, cz] = track.cones[Math.floor(track.cones.length / 2)], cy = groundAt(cx, cz);
    views.push({ name: 'cones', pos: [cx + 5, cy + 2.2, cz + 6], look: [cx, cy + 0.3, cz], fov: 55 });
  }
  if (track.flagStand) {
    const [fx, fz] = track.flagStand, fy = groundAt(fx, fz);
    views.push({ name: 'flagstand', pos: [fx - 7, fy + 2.5, fz - 9], look: [fx, fy + 2, fz], fov: 50 });
    views.push({ name: 'finish_driver', ...eye((N - 30) % N) });
  }
  if (track.clubhouse) {
    const [hx, hz] = track.clubhouse, hy = groundAt(hx, hz);
    views.push({ name: 'clubhouse', pos: [hx - 10, hy + 3, hz - 32], look: [hx, hy + 3.5, hz], fov: 55 });
  }
  views.push({ name: 'low_wide', pos: [40, 6, 45], look: [-10, 0, 0], fov: 60 });
  for (const v of views) {
    v.before?.();
    camera.position.set(...v.pos);
    camera.lookAt(...v.look);
    camera.fov = v.fov;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    world3d.followSun(new THREE.Vector3(...v.look));
    renderer.render(scene, camera);
    await new Promise(r => setTimeout(r, 200));
    renderer.render(scene, camera);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
    await fetch('/__shot/' + v.name, { method: 'POST', body: blob });
    v.after?.();
  }
  // frame time from a driver's-eye view, the heaviest common case
  const v = views[1];
  camera.position.set(...v.pos); camera.lookAt(...v.look); camera.fov = v.fov; camera.updateProjectionMatrix();
  const frames = [];
  let prev = performance.now();
  await new Promise((done) => {
    const tick = (t) => {
      renderer.render(scene, camera);
      frames.push(t - prev); prev = t;
      if (frames.length < 150) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  frames.sort((a, b) => a - b);
  const med = frames[75], p90 = frames[135];
  const info = renderer.info.render;
  fetch('/__log', { method: 'POST', body: `[perf] median frame ${med.toFixed(1)} ms (${(1000 / med).toFixed(0)} fps), 90th pct ${p90.toFixed(1)} ms, ${info.calls} draw calls, ${(info.triangles / 1e6).toFixed(2)} M triangles, ${innerWidth}x${innerHeight} @${renderer.getPixelRatio()}` });
  { // the Fastest Drivers podium, three different visors
    go('board');
    podium.show([{ name: 'A', look: { ...helmet, visor: 'gold' } }, { name: 'B', look: { ...helmet, visor: 'smoke' } }, { name: 'C', look: { ...helmet, visor: 'blue' } }]);
    await new Promise(r => setTimeout(r, 1500));
    podium.renderer.render(podium.scene, podium.camera);
    const blob = await new Promise(r => podium.canvas.toBlob(r, 'image/jpeg', 0.9));
    if (blob) await fetch('/__shot/podium', { method: 'POST', body: blob });
    go('home');
  }
  $('pgHome').classList.remove('hidden');
  page = 'home';
  status(`Sent ${views.length} screenshots to Claude. You can close this tab.`);
}
if (SHOTS) runShots().catch((e) => console.error(e));

// ---------------------------------------------------------------- accounts
// What follows the player between computers (controller setup stays per computer).
function syncUp() {
  if (!account.signedIn) return;
  const { name, ...rest } = settings;
  account.save('settings', { ...rest, stats: stats.data });
  account.save('look', { ...helmet });
  account.save('kart', { pick: garage.selected, paint: { ...paint } });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const filled = (o) => o && Object.keys(o).length > 0;
async function applyProfile() {
  const p = account.profile;
  if (!p) return;
  if (!filled(p.settings) && !filled(p.look) && !filled(p.kart)) { syncUp(); await account.flush(); return; }   // new account: keep this computer's setup
  // bring the account's setup onto this computer, then restart the page once to use it
  const { name, ...localSettings } = settings;
  // (the record merges in; it isn't a setting)
  const { stats: theirs, ...remote } = p.settings || {};
  stats.merge(theirs);
  const want = { settings: { ...localSettings, ...remote }, look: { ...helmet, ...p.look }, paint: { ...paint, ...p.kart?.paint }, pick: p.kart?.pick ?? garage.selected };
  if (same(want.settings, localSettings) && same(want.look, helmet) && same(want.paint, paint) && want.pick === garage.selected) return;
  try {
    localStorage.setItem(SETTINGS, JSON.stringify({ ...want.settings, name }));
    localStorage.setItem(HELMET, JSON.stringify(want.look));
    localStorage.setItem(PAINT, JSON.stringify(want.paint));
    if (want.pick && garage.entries.some(e => e.id === want.pick)) garage.select(want.pick);   // the garage's own key
  } catch { return; }
  // restart once to use it; never loop if something still doesn't stick
  if (running || SHOTS) return;
  try { if (sessionStorage.getItem('tt.synced')) return; sessionStorage.setItem('tt.synced', '1'); } catch { /* no storage: reload once anyway */ }
  location.reload();
}

function showAccount() {
  const bar = $('acctBar');
  bar.classList.toggle('hidden', !account.enabled);
  if (!account.enabled) return;
  const t = $('acctText');
  t.innerHTML = '';
  if (account.signedIn) {
    t.append('Signed in as ');
    const b = document.createElement('b'); b.textContent = account.name; t.append(b);
    $('acctBtn').textContent = 'Sign out';
  } else {
    t.textContent = 'Not signed in: times stay on this computer.';
    $('acctBtn').textContent = 'Sign in';
  }
  // the Garage name is the account's driver name
  const nm = $('driverName');
  nm.disabled = account.signedIn;
  nm.value = account.signedIn ? account.name : settings.name;
  nm.title = account.signedIn ? 'Your account\'s driver name. Change it from the sign-in screen.' : '';
  if (menusReady) renderHome();
  if (page === 'board') renderBoard();
}

// ---- sign-in dialog
let acctMode = 'name', acctSignup = false;
function acctView() {
  document.querySelectorAll('#acctTabs button').forEach(b => b.classList.toggle('on', b.dataset.m === acctMode));
  document.querySelector('#acctForm [data-for="name"]').classList.toggle('hidden', acctMode !== 'name');
  document.querySelector('#acctForm [data-for="email"]').classList.toggle('hidden', acctMode !== 'email');
  $('acctTitle').textContent = acctSignup ? 'Create an account' : 'Sign in';
  $('acctGo').textContent = acctSignup ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('acctMode').textContent = acctSignup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('aPw').autocomplete = acctSignup ? 'new-password' : 'current-password';
  $('acctErr').textContent = '';
}
function openAccount(rename = false) {
  $('acctDlg').classList.remove('hidden');
  acctSignup = false;                       // always opens on Sign in
  const r = rename || account.needsName;
  for (const id of ['acctTabs', 'acctForm']) $(id).classList.toggle('hidden', r);
  document.querySelector('.acctSwitch').classList.toggle('hidden', r);
  // Google only once it's switched on in the project
  $('acctGoogle').classList.toggle('hidden', r || !account.google);
  document.querySelector('.acctOr').classList.toggle('hidden', r || !account.google);
  $('acctRename').classList.toggle('hidden', !r);
  $('acctClose').textContent = r ? 'Later' : 'Play without an account';
  if (r) { $('acctTitle').textContent = 'Your driver name'; $('aNewName').value = account.needsName ? '' : account.name; $('aNewName').focus(); }
  else acctView();
}
const closeAccount = () => $('acctDlg').classList.add('hidden');
document.querySelectorAll('#acctTabs button').forEach(b => b.addEventListener('click', () => { acctMode = b.dataset.m; acctView(); }));
$('acctMode').addEventListener('click', (e) => { e.preventDefault(); acctSignup = !acctSignup; acctView(); });
$('acctClose').addEventListener('click', (e) => { e.preventDefault(); closeAccount(); });
$('acctForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('acctErr'), go = $('acctGo');
  err.textContent = ''; go.disabled = true;
  const pw = $('aPw').value;
  try {
    if (pw.length < 6) throw new Error('Passwords need at least 6 characters.');
    if (acctMode === 'name') {
      const n = $('aName').value.trim();
      if (acctSignup) await account.signUpName(n, pw); else await account.signInName(n, pw);
    } else {
      const em = $('aEmail').value.trim();
      if (acctSignup) {
        const { confirm } = await account.signUpEmail(em, pw);
        if (confirm) { err.textContent = 'Check your inbox and click the link to finish signing up.'; return; }
      } else await account.signInEmail(em, pw);
    }
    $('aPw').value = '';
    closeAccount();
  } catch (x) { err.textContent = x.message || String(x); }
  finally { go.disabled = false; }
});
$('acctGoogle').addEventListener('click', async () => {
  try { await account.signInGoogle(); } catch (x) { $('acctErr').textContent = x.message; }
});
$('acctRename').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('renameErr').textContent = '';
  try { await account.rename($('aNewName').value.trim()); closeAccount(); } catch (x) { $('renameErr').textContent = x.message; }
});
$('acctBtn').addEventListener('click', async () => {
  if (account.signedIn) await account.signOut(); else openAccount();
});
$('acctText').addEventListener('click', () => { if (account.signedIn) openAccount(true); });

account.onChange(async () => {
  showAccount();
  if (account.signedIn) {
    await applyProfile();
    if (account.needsName) openAccount(true);
  }
  // what this account may wear, and (admins) the admin panel
  fillLookOptions(account.user?.id ?? null, admin.me);
  showHelmet();
  $('mpAdmin').classList.toggle('hidden', !admin.me);
  admin.listen();
});
// an announcement from an admin: a banner on track, a notice in the menus
admin.onAnnounce = (text) => {
  if (running) { banner('ANNOUNCEMENT', text.toUpperCase().slice(0, 60), 6000); toast(text); }
  let el = $('announce');
  if (!el) { el = document.createElement('div'); el.id = 'announce'; document.body.appendChild(el); }
  el.innerHTML = '<small>ANNOUNCEMENT</small><span></span>';
  el.querySelector('span').textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el.t); el.t = setTimeout(() => el.classList.add('hidden'), 10000);
};
if (admin.me) { fillLookOptions(null, true, false); showHelmet(); $('mpAdmin').classList.remove('hidden'); }
showAccount();
account.init().catch((e) => console.warn('accounts:', e.message));
addEventListener('beforeunload', () => { account.flush(); });

// ---------------------------------------------------------------- online
// Servers: drive the same track as other signed-in drivers, see and bump
// their karts, and race them when the server's host starts a race.
const ASSISTS_ON = { abs: true, tc: true };
const GHOST_TIME = 4;            // s see-through after joining, a reset or a turn-around
const SEND_EVERY = 0.05;         // s between position updates (20 a second)
let net = null;
let club = null;                 // walking round the clubhouse: { walker, ... } (see enterClub)
let bots = null;                 // the AI drivers we drive, as the host of a server with some (bots.js)
// local testing only: ?guest=Name joins servers without an account
const GUEST = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? new URLSearchParams(location.search).get('guest') : null;
const onlineName = () => account.name ?? GUEST;
const remotes = new Map();       // player id -> RemoteKart
const apart = new Map();         // player id -> been clear of each other since either was see-through
let ghostUntil = 0, sendAt = 0;
// this computer's view of the current race
let race = null;                 // { id, laps, grid, t0, hold, goAt, done, fin: Map(id -> { name, time, best }) }
// my spot in the pits: the order I joined the server in
function pitSlot() {
  if (!net?.inRoom || !net.meta) return 0;
  return [...net.members.values()].filter(m => !m.bot && m.since < net.meta.since).length % MAX_PLAYERS;
}
// the kart I'm driving: the host's pick for everyone on the server, or my own
function driving() {
  const k = net?.inRoom && net.room?.kart;
  return (k && garage.entries.find(e => e.id === k)) || garage.current();
}
const kartLabel = (id) => (id ? garage.entries.find(e => e.id === id)?.name ?? id : 'Drivers\' choice');
const frozen = () => !!race && race.inGrid && race.goAt == null;
const trackLabel = (id, dir) => `${layoutOf(id).name}, ${dir === 'ccw' ? 'counter-clockwise' : 'clockwise'}`;
const nameOf = (id) => (id === net?.id ? onlineName() : net?.members.get(id)?.name ?? remotes.get(id)?.name ?? 'Driver');

// ---- contact between karts (contact.js): their karts, shaped like their
// models, where they are now; a hit pushes ours by its share
const BIG_HIT = 4;                       // m/s closing: the steward hears about it
const SPIN_RATE = 2.6;                   // rad/s of yaw, or sliding 70 degrees sideways: a spin
const footprintOf = (id) => garage.entries.find(e => e.id === id)?.footprint || [1.40, 1.94, 0.02];
const massOf = (id, lb) => (garage.entries.find(e => e.id === id)?.chassisKg ?? KART.chassisMass) + (lb ? lb * 0.4536 : CONTACT.driverKg);
const contacts = new Contacts(RAPIER, physWorld);
const contactStats = contacts.stats;     // (for automated checks)
const dropSolid = (id) => contacts.drop(id);
const others = new Map();                // remote id -> what contacts.step needs

function bump(tNow) {
  contacts.step(kart, humanKarts(tNow), tNow, noteHit);
  if (bots) botContacts(others.size ? [...others.values()].filter(o => o.live) : [], tNow);
}
// the other karts where they are now, as contacts.step takes them (not the
// AI we drive: those are real karts in our physics world, they hit back by themselves)
function humanKarts(tNow) {
  const list = [];
  for (const o of others.values()) o.live = false;
  for (const r of remotes.values()) {
    if (!r.last || bots?.has(r.id)) continue;
    const shownId = r.shownId ?? r.kartId, hulls = hitboxOf(shownId, r.visual?.object);
    let o = others.get(r.id);
    if (!o) others.set(r.id, o = { id: r.id, p: new THREE.Vector3(), q: new THREE.Quaternion() });
    o.hulls = hulls || boxHull(footprintOf(shownId));
    o.key = `${hulls ? 'model' : 'box'}:${shownId}`;
    o.solid = r.solid && !r.hidden;
    r.predict(tNow, o.p, o.q);
    o.v = r.last.v; o.w = r.last.w || 0; o.kg = massOf(shownId, r.meta?.lb);
    o.sent = r.last.t + r.off;          // (their clock to ours)
    o.live = true;
    list.push(o);
  }
  return list;
}
// the AI we drive against the players' karts: each takes its share of a hit as ours does
const aiContacts = new Contacts(RAPIER, physWorld);
function botContacts(list, tNow) {
  if (!list.length) return;
  for (const b of bots.list) if (b.k.hitColliders?.length) aiContacts.step(b.k, list, tNow);
}
// where the players are, for the AI to drive round
function botTraffic() {
  const out = [];
  for (const r of remotes.values()) if (r.last && !bots?.has(r.id) && r.group.visible) out.push({ id: r.id, x: r.p.x, z: r.p.z, vx: r.last.v[0], vz: r.last.v[2] });
  return out;
}

// who hit whom: the kart that drove into the other is at fault. A big hit
// goes to the steward; a spin caused by someone costs them a second
// (race or qualifying), and the steward can take it back.
let hitBy = null;
function noteHit(id, vn, nx, nz, o) {
  if (simTime < ghostUntil) return;
  const v = kart.body.linvel();
  const mine = v.x * nx + v.z * nz, theirs = -(o.v[0] * nx + o.v[2] * nz);
  if (theirs < mine + 0.5) return;                   // we ran into them (their game reports it)
  if (vn < 1.2) return;                              // (rubbing, not a hit)
  if (hitBy?.id === id && simTime - hitBy.at < 1.5) { hitBy.vn = Math.max(hitBy.vn, vn); return; }
  hitBy = { id, at: simTime, vn, spun: false, told: false };
}
function watchHit() {
  if (!hitBy || !net?.inRoom) return;
  const age = simTime - hitBy.at;
  const v = kart.body.linvel(), w = kart.body.angvel(), q = kart.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)), sp = Math.hypot(v.x, v.z);
  const slide = sp > 2 ? Math.acos(Math.max(-1, Math.min(1, (v.x * fx + v.z * fz) / (sp * Math.hypot(fx, fz))))) : 0;
  if (!hitBy.spun && age < 2 && (Math.abs(w.y) > SPIN_RATE || slide > 1.22)) {
    hitBy.spun = true;
    reportContact({ by: hitBy.id, spin: true, mph: Math.round(hitBy.vn * 2.237) });
  } else if (!hitBy.told && age > 2) {
    if (hitBy.vn > BIG_HIT) reportContact({ by: hitBy.id, spin: false, mph: Math.round(hitBy.vn * 2.237) });
    hitBy = null;
  }
  if (hitBy?.spun) hitBy = null;
}
function reportContact(c) {
  const m = { type: 'contact', from: net.id, by: c.by, spin: c.spin, mph: c.mph };
  net.send(m);
  if (net.isHost) onContact(m);
}
// (the host: penalties; and the steward or owner hears about it)
const incidents = [];
function onContact(m) {
  if (!net?.isHost || !net.members.has(m.by) && m.by !== net.id) return;
  const live = !!race && race.phase !== 'done';
  const pen = (m.spin || m.rule) && live && !net.admins.has(m.by);
  if (pen) givePenalty(m.by, 1);
  incidents.push({ ...m, at: Date.now() });
  if (!maySteward()) return;
  const what = m.rule === 'jump' ? `Jump start: ${nameOf(m.by)}` : m.rule === 'limits' ? `Track limits: ${nameOf(m.by)} (${m.n} times)`
    : `Contact: ${nameOf(m.by)} ${m.spin ? 'spun' : 'hit'} ${nameOf(m.from)} (${m.mph} mph)`;
  const text = `${what}${pen ? ' · +1 s' : ''}`;
  incidentToast(text, pen ? [['CANCEL +1 S', () => givePenalty(m.by, -1)]] : live ? [['+1 S', () => givePenalty(m.by, 1)]] : []);
}
function incidentToast(text, actions) {
  const d = document.createElement('div');
  d.className = 'incident';
  d.textContent = text;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { fn(); d.remove(); });
    d.appendChild(b);
  }
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), 10000);
}

// new achievements: news, then the record goes up to the account
function achievements() {
  for (const a of stats.check()) toast(`🏆 Achievement: ${a.name}`);
  stats.save();
  syncUp();
}

// ---- race rules, each driver's game watching its own driver:
// - a jump start: rolling off your grid spot before the lights go out. You're
//   put back on it and held there, and it's +1 s.
// - track limits: all four wheels off the track (timing.js decides) is a
//   warning; the third and every one after is +1 s.
// - blue flags: a kart a lap or more up the road, close behind you: let it by.
function rules(dt) {
  if (!race || !race.inGrid || race.phase !== 'race' && race.phase !== 'grid' || stewarding()) return;
  const t = kart.body.translation();
  if (race.goAt == null && race.spot && !race.jumped && Math.hypot(t.x - race.spot.x, t.z - race.spot.z) > 1.0) {
    race.jumped = true;
    placePose(race.spot.pose); snapPose();
    banner('JUMP START', '+1 SECOND', 2600);
    reportRule({ rule: 'jump' });
  }
  if (race.goAt == null || race.mine) { blueFlag(false); return; }
  // (a lap the timer has written off: all four off for more than a moment)
  if (timer.invalid && !race.wasOff) {
    race.off = (race.off || 0) + 1;
    if (race.off < 3) banner('TRACK LIMITS', `WARNING ${race.off} OF 2`, 2000);
    else { banner('TRACK LIMITS', '+1 SECOND', 2400); reportRule({ rule: 'limits', n: race.off }); }
  }
  race.wasOff = timer.invalid;
  // blue flag: someone at least a lap up on you, within 25 m behind
  const mine = myProgress();
  let blue = false;
  for (const [id, r] of remotes) {
    const d = r.last;
    if (!d || d.r !== race.id || !d.pr || d.pr - mine < 0.75) continue;
    const dx = d.p[0] - t.x, dz = d.p[2] - t.z, q = kart.body.rotation();
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    if (Math.hypot(dx, dz) < 25 && dx * fx + dz * fz < 2) blue = true;
    void id;
  }
  blueFlag(blue);
}
function reportRule(r) {
  const m = { type: 'contact', from: net.id, by: net.id, ...r };
  net.send(m);
  if (net.isHost) onContact(m);
}
let blueOn = false;
function blueFlag(on) {
  if (on === blueOn) return;
  blueOn = on;
  $('blueFlag').classList.toggle('hidden', !on);
}

// ---- time of day and weather: your own (Settings), or on a server the
// host's, for everyone. Rain takes grip away (kart.js).
function conditions() {
  const c = net?.inRoom && net.room?.cond ? net.room.cond : settings;
  const time = TIMES[c.time] ? c.time : 'afternoon', weather = WEATHER[c.weather] ? c.weather : 'dry';
  world3d.setConditions(time, weather);
  kart.wet = weather === 'rain';
}

// knocks: a sudden change of speed (a wall, tyres, a parked car or another
// kart) is heard, and felt through the controller; a reset or a trip to the
// pits (the kart jumping somewhere) isn't
const knock = { v: null, p: null, at: 0 };
function knocks(p) {
  const v = kart.body.linvel();
  if (knock.v && knock.p && Math.hypot(p.x - knock.p.x, p.z - knock.p.z) < 3) {
    const dv = Math.hypot(v.x - knock.v.x, v.z - knock.v.z);
    if (dv > 1.6 && simTime - knock.at > 0.15) {
      knock.at = simTime;
      const k = Math.min(1, (dv - 1.6) / 7);
      audio.hit(k);
      input.rumble(0.5 + 0.5 * k, 0.4 + 0.6 * k, 90 + 160 * k);
    }
  }
  knock.v = { x: v.x, z: v.z }; knock.p = { x: p.x, z: p.z };
}

function toast(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), 4200);
}

// ---- penalties and kicks, both set by the host (public and private servers)
// Time penalties are seconds added to a driver's race time, or to their best
// lap in qualifying, kept per session in the room: pens['<race id>:quali'] or
// pens['<race id>:race'] = { player id: seconds }. A kick removes a driver for
// KICK_MINUTES (not a ban): every game drops them, and they can't rejoin that
// server (by session or by account) until it runs out.
const KICK_MINUTES = 5;
let lastRace = null;             // the last session that ended, for penalties after the flag
const sessionKind = (r) => (r.kind ?? (r.phase === 'quali' ? 'quali' : 'race'));
const penOf = (r, id) => (r && !net?.admins.has(id) ? net?.room?.pens?.[`${r.id}:${sessionKind(r)}`]?.[id] ?? 0 : 0);
function kickedUntil(id, uid = net?.members.get(id)?.uid) {
  if (net?.admins.has(id) || (id === net?.id && admin.me)) return 0;
  let until = 0;
  for (const [kid, k] of Object.entries(net?.room?.kick || {})) if (k.until > Date.now() && (kid === id || (uid && k.uid === uid))) until = Math.max(until, k.until);
  return until;
}
const isKicked = (id) => kickedUntil(id) > 0;
const isAdminId = (id) => !!net?.admins.has(id);
// a player's admin status, checked once when they appear
function checkAdmin(id, meta) {
  admin.isAdminSession(id, meta).then((ok) => {
    if (!ok || !net?.members.has(id)) return;
    net.setAdmin(id, true);
    remotes.get(id)?.setAdmin(meta.look);
    renderRoomPanel();
  });
}
// the session penalties go to: the one running, or the one that just ended
const penSession = () => (race && race.phase !== 'done' ? race : lastRace);
function givePenalty(id, secs) {
  const r = penSession();
  if (!r || !net?.isHost) return;
  const key = `${r.id}:${sessionKind(r)}`, pens = { ...(net.room.pens || {}) };
  // only this race's penalties are kept
  for (const k of Object.keys(pens)) if (!k.startsWith(`${r.id}:`)) delete pens[k];
  const now = { ...(pens[key] || {}) };
  if (secs) now[id] = (now[id] || 0) + secs; else delete now[id];
  pens[key] = now;
  net.setRoom({ pens });
}
function kick(id) {
  if (!net?.isHost || id === net.id) return;
  const kick = {};
  for (const [kid, k] of Object.entries(net.room.kick || {})) if (k.until > Date.now()) kick[kid] = k;
  kick[id] = { uid: net.members.get(id)?.uid ?? null, name: nameOf(id), until: Date.now() + KICK_MINUTES * 60e3 };
  net.setRoom({ kick });
}

function addRemote(id, meta) {
  if (remotes.has(id) || !meta) return;
  const shown = { ...meta, look: allowedLook(meta.look || {}, meta.uid, false) };
  remotes.set(id, new RemoteKart({ id, meta: shown, scene, envMap: world3d.envMap, garage, kart: net.room?.kart || null }));
}
function dropRemote(id) {
  remotes.get(id)?.dispose();
  dropSolid(id); aiContacts.drop(id); others.delete(id);
  remotes.delete(id);
  apart.delete(id);
}

// ---- voice chat: push to talk; proximity on track, everyone before and
// after sessions, and everyone hears the steward (and the steward everyone).
// Private servers have it ready; on a public one each player switches it on.
const voice = new Voice();
const VOICE_NEAR = 10, VOICE_FAR = 60;   // m: full volume within, silent beyond
let voiceWanted = false;                 // switched on in this (public) server
const mutedByMe = new Set();             // players I've muted
const voiceOn = () => !!net?.inRoom && !net.offline && (!net.room?.public || voiceWanted);
const hostMuted = (id) => !!net?.room?.vmute?.[id] && !net?.admins.has(id);
voice.onMic = (t) => net?.setMicTrack(t);
// how much voice has gone each way per player (for the menu's readout)
const voiceFlow = new Map();       // id -> { sent, recv, up, down }
setInterval(async () => {
  if (!net?.inRoom || !voiceOn() || $('roomPanel').classList.contains('hidden')) return;
  let changed = false;
  for (const id of net.members.keys()) {
    const e = await net.voiceEnergy(id);
    if (!e) continue;
    const was = voiceFlow.get(id);
    // (sound energy: silence adds ~nothing; where the browser doesn't report
    // what goes out, our own microphone level stands in)
    const up = voice.talking && (e.out != null ? !!was && e.out - (was.out ?? 0) > 1e-4 : voice.micLevel() > 0.05);
    // (what we hear: the same measure as the 🔊 talking indicator)
    voice.speaking();
    const down = (voice.voices.get(id)?.level ?? 0) > 0.02;
    if (!was || was.up !== up || was.down !== down) changed = true;
    voiceFlow.set(id, { ...e, up, down });
  }
  if (changed) renderRoomPanel();
}, 2000);
// (on its own timer, not the frames: a window in the background draws no
// frames but should still play voices)
setInterval(() => { if (running) voiceTick(performance.now()); }, 50);
let voiceShownAt = 0, micDenied = false;
function voiceTick(now) {
  if (!net?.inRoom) return;
  const on = voiceOn();
  // everyone at once: waiting for a session, on the grid, and with the results up
  const allTalk = !race || race.phase === 'done' || (race.phase === 'grid' && race.goAt == null) || !$('raceResults').classList.contains('hidden');
  const sw = stewardOf(), meSw = stewarding();
  const t = kart.body.translation(), q = kart.body.rotation();
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  for (const [id, r] of remotes) {
    let vol = 0, pan = 0;
    if (on && !mutedByMe.has(id) && !hostMuted(id) && !isKicked(id)) {
      if (allTalk || meSw || id === sw) vol = 1;
      else if (r.last) {
        const dx = r.last.p[0] - t.x, dz = r.last.p[2] - t.z, d = Math.hypot(dx, dz);
        const k = Math.max(0, Math.min(1, (VOICE_FAR - d) / (VOICE_FAR - VOICE_NEAR)));
        vol = k * k * (3 - 2 * k);
        // which side they're on: to my right is (-fz, fx)
        if (d > 0.5) pan = 0.8 * ((-fz) * dx + fx * dz) / d;
      }
    }
    voice.set(id, vol, pan);
  }
  // push to talk (the microphone is asked for the first time it's held)
  const can = on && !hostMuted(net.id);
  const held = can && input.talkHeld();
  if (held && !voice.mic && !voice.asking && !micDenied) voice.enableMic().then((ok) => { if (!ok) { micDenied = true; toast('The microphone is blocked: allow it for this site to talk'); } });
  voice.talk(held);
  // the talking indicator, ten times a second
  if (now - voiceShownAt < 100) return;
  voiceShownAt = now;
  const chip = $('voiceChip');
  chip.classList.toggle('hidden', !on);
  $('tTalk').classList.toggle('hidden', !on);
  if (!on) return;
  const key = input.source === 'touch' ? 'TALK' : input.source === 'pad' ? 'A' : 'V';
  const talkers = voice.speaking().map(nameOf);
  chip.classList.toggle('live', voice.talking);
  chip.innerHTML = '<b></b><small></small>';
  // (while talking, a meter of how loud the microphone picks you up)
  const meter = voice.talking ? ' ' + '▮'.repeat(Math.round(voice.micLevel() * 8)).padEnd(8, '▯') : '';
  chip.querySelector('b').textContent = hostMuted(net.id) ? 'MUTED BY THE HOST' : voice.talking ? `● TALKING${meter}` : `HOLD ${key} TO TALK`;
  if (voice.blocked) chip.querySelector('b').textContent = 'CLICK OR PRESS A KEY TO HEAR VOICES';
  chip.querySelector('small').textContent = talkers.length ? `🔊 ${talkers.join(', ')}` : allTalk ? 'everyone can hear everyone' : 'drivers near you hear you';
}

// (offline: a server of your own against the AI, which needs no account)
function setupNet(offline = false) {
  if (net || (!account.enabled && !offline)) return net;
  net = new Net(account.sb ?? null);
  net.on.track = (id, stream) => voice.add(id, stream);
  net.on.state = (id, d) => {
    const r = remotes.get(id);
    if (!net.members.has(id) || !r || isKicked(id)) return;
    r.push(d, performance.now());
    // their time at their latest timing point, for the gaps
    if (race && d.r === race.id && d.ci != null && d.ct != null) (r.cps ||= new Map()).set(d.ci, d.ct);
  };
  net.on.joined = (id, m) => { addRemote(id, m); checkAdmin(id, m); toast(`${m.name} joined`); renderRoomPanel(); };
  net.on.left = (id) => {
    if (!isKicked(id)) toast(`${remotes.get(id)?.name ?? 'A driver'} left`);
    dropRemote(id);
    voice.remove(id);
    net.setAdmin(id, false);
    renderRoomPanel();
  };
  let host = null;
  net.on.members = () => {
    if (host && net.hostId !== host && net.meta) toast(net.isHost ? 'You\'re the host now' : `${nameOf(net.hostId)} is the host now`);
    host = net.hostId;
    syncBots();
    renderRoomPanel(); showRoomTag();
  };
  net.on.room = (r) => { syncBots(); applyRoom(r); };
  net.on.msg = (m) => {
    if (m.type === 'chat') { chatIn(m); return; }
    if (m.type === 'contact') onContact(m);
    if (m.type === 'fin' && race && m.race === race.id && !race.fin.has(m.from)) {
      race.fin.set(m.from, { name: m.name, time: m.time, best: m.best });
      if (race.fin.size === 1) banner('CHEQUERED FLAG', `${m.name.toUpperCase()} WINS`, 3000);
    }
    // the qualifying clock, from the host
    if (m.type === 'qclock' && running) {
      if (race?.id === m.race && race.phase === 'quali') race.qEnd = wall() + m.left;
      else if (net.room?.race?.id === m.race && net.room.race.phase === 'quali' && !race) startQualiLocal(net.room.race, m.left);
    }
  };
  return net;
}

// ---- admin panel (Multiplayer page): every server, announcements, bans
async function renderAdmin() {
  if (!admin.me) return;
  $('adErr').textContent = '';
  const ul = $('adServers');
  ul.innerHTML = '<li class="empty">Looking…</li>';
  try {
    const list = await admin.servers();
    ul.innerHTML = list.length ? '' : '<li class="empty">No servers open right now.</li>';
    for (const r of list) {
      const li = document.createElement('li');
      li.innerHTML = '<div><b></b><small></small></div><span class="n"></span><button class="btn primary">JOIN</button>';
      li.querySelector('b').textContent = `${r.name || r.code} · ${r.code}`;
      li.querySelector('small').textContent = r.solo ? `Driving on their own${r.layout ? ' · ' + trackLabel(r.layout, r.dir) : ''} · they'll see you join`
        : `${r.public ? 'Public' : 'Private'} · host ${r.host_name}${r.layout ? ' · ' + trackLabel(r.layout, r.dir) : ''}${r.racing ? ' · racing now' : ''}`;
      li.querySelector('.n').textContent = `${r.n}/${MAX_PLAYERS}`;
      li.querySelector('button').addEventListener('click', () => (r.solo ? joinSolo(r.code) : enterRoom(r.code)));
      ul.appendChild(li);
    }
  } catch (e) { ul.innerHTML = ''; $('adErr').textContent = `Servers: ${e.message} (run supabase/admin.sql in Supabase once)`; }
  const bl = $('adBans');
  bl.innerHTML = '';
  try {
    for (const b of await admin.bans()) {
      const li = document.createElement('li');
      li.innerHTML = '<div><b></b><small></small></div><span></span><button class="btn">UNBAN</button>';
      li.querySelector('b').textContent = b.name;
      li.querySelector('small').textContent = `${b.until ? 'until ' + new Date(b.until).toLocaleString() : 'for good'}${b.reason ? ' · ' + b.reason : ''}`;
      li.querySelector('button').addEventListener('click', async () => { try { await admin.unban(b.user_id); renderAdmin(); } catch (e) { $('adErr').textContent = e.message; } });
      bl.appendChild(li);
    }
  } catch (e) { $('adErr').textContent = `Bans: ${e.message} (run supabase/admin.sql in Supabase once)`; }
}
$('adRefresh').addEventListener('click', renderAdmin);
$('adAnnounceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('adAnnounce').value.trim();
  if (!text) return;
  try { await admin.announce(text); $('adAnnounce').value = ''; $('adErr').textContent = 'Announcement sent.'; }
  catch (err) { $('adErr').textContent = `Announcement: ${err.message}`; }
});
$('adBanForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('adBanName').value.trim();
  if (!name) return;
  try {
    const u = await admin.userByName(name);
    if (!u) throw new Error(`No driver called ${name}.`);
    const days = $('adBanFor').value === '' ? null : +$('adBanFor').value;
    await admin.ban(u.id, days, $('adBanWhy').value);
    $('adBanName').value = ''; $('adBanWhy').value = '';
    renderAdmin();
  } catch (err) { $('adErr').textContent = err.message; }
});

// ---- a signed-in player driving on their own is listed for admins too
// (the server list only admins can read: supabase/admin.sql), with a code of
// its own; an admin's JOIN asks their game, over a channel of that code, to
// turn the session into a private server, checks the asker really is an
// admin (by their registered session), says so, and lets them in.
let solo = null;                 // { code, ch }
function soloTick() {
  const want = running && !net?.inRoom && !stewarding() && account.signedIn && !!account.sb && !admin.me;
  if (!want) { soloEnd(); return; }
  if (!solo) {
    solo = { code: newCode() };
    solo.ch = account.sb.channel(`tt-solo-${solo.code}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'admin' }, ({ payload }) => soloAdmin(payload)).subscribe();
  }
  admin.listServer({ code: solo.code, name: `${onlineName() || 'Driver'} (on their own)`.slice(0, 40), public: false, host_name: onlineName() || '',
    n: 1, layout: layoutId, dir: direction, racing: false, solo: true });
}
function soloEnd() {
  if (!solo) return;
  admin.unlistServer(solo.code);
  account.sb?.removeChannel(solo.ch);
  solo = null;
}
setInterval(soloTick, 30000);
async function soloAdmin(p) {
  if (!solo || !running || net?.inRoom) return;
  if (!(await admin.isAdminSession(p.sid, { uid: p.uid, name: p.name }))) return;
  const code = solo.code;
  soloEnd();
  toast(`${p.name} (admin) is joining your session`);
  setupNet();
  await enterRoom(code, { name: `${onlineName() || 'Driver'}'s session`.slice(0, 30), public: false, layout: layoutId, dir: direction, kart: null });
}
// an admin: join someone driving on their own (see above)
async function joinSolo(code) {
  if (!admin.me || !setupNet()) return;
  $('adErr').textContent = 'Asking their game to open a server for you…';
  await admin.registerSession(net.id);
  const ch = account.sb.channel(`tt-solo-${code}`);
  await new Promise((res) => { const t = setTimeout(res, 6000); ch.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(t); res(); } }); });
  ch.send({ type: 'broadcast', event: 'admin', payload: { sid: net.id, uid: account.user.id, name: onlineName() } });
  setTimeout(() => account.sb.removeChannel(ch), 4000);
  // their server takes a few seconds to open
  for (let i = 0; i < 6 && !net?.inRoom; i++) {
    await new Promise(r => setTimeout(r, 3000));
    await enterRoom(code);
  }
  if (!net?.inRoom) $('adErr').textContent = 'They didn\'t open a server: they may have stopped driving. Refresh the list.';
}

// the host keeps its server's line in the admins' list of every server
setInterval(() => {
  if (!net?.inRoom || !net.isHost || !net.room || net.offline) return;
  const r = net.room;
  admin.listServer({ code: net.code, name: r.name || '', public: !!r.public, host_name: onlineName() || '', n: net.members.size + 1,
    layout: r.layout || '', dir: r.dir || '', racing: !!(r.race && r.race.phase !== 'done') });
}, 30000);

// ---- the multiplayer page
let mpVis = 'public';
function fillTrackSelect(sel, id = layoutId, dir = direction) {
  sel.innerHTML = '';
  for (const lay of LAYOUTS) for (const d of ['cw', 'ccw']) {
    const o = document.createElement('option');
    o.value = `${lay.id}|${d}`; o.textContent = trackLabel(lay.id, d);
    sel.appendChild(o);
  }
  sel.value = `${id}|${dir}`;
}
function openMulti() {
  fillTrackSelect($('aiTrack')); $('aiErr').textContent = '';
  const on = account.enabled && !!onlineName();
  $('mpOffline').classList.toggle('hidden', account.enabled);
  $('mpSignedOut').classList.toggle('hidden', !account.enabled || on);
  $('mpBody').classList.toggle('hidden', !on);
  $('mpErr').textContent = '';
  if (!on) return;
  if (!$('mpName').value) $('mpName').value = `${onlineName()}'s server`.slice(0, 30);
  fillTrackSelect($('mpTrack'));
  if (!$('mpKart').options.length) {
    $('mpKart').innerHTML = '<option value="">Drivers\' choice</option>';
    for (const e of garage.entries.filter(x => x.kind === 'bundled')) $('mpKart').insertAdjacentHTML('beforeend', `<option value="${e.id}"></option>`);
    [...$('mpKart').options].forEach(o => { if (o.value) o.textContent = `${kartLabel(o.value)} for everyone`; });
  }
  renderServerList(null);
  setupNet().watchLobby(renderServerList);
  renderAdmin();
}
function renderServerList(list) {
  const ul = $('mpList');
  ul.innerHTML = '';
  if (!list) { ul.innerHTML = '<li class="empty">Looking for servers…</li>'; return; }
  if (!list.length) { ul.innerHTML = '<li class="empty">No public servers right now. Create one below and your friends can join it.</li>'; return; }
  for (const r of list) {
    const li = document.createElement('li');
    li.innerHTML = '<div><b></b><small></small></div><span class="n"></span><button class="btn primary">JOIN</button>';
    li.querySelector('b').textContent = r.name;
    li.querySelector('small').textContent = trackLabel(r.layout, r.dir) + (r.kart ? ` · ${kartLabel(r.kart)} only` : '') + (r.racing ? ' · racing now' : '');
    li.querySelector('.n').textContent = `${r.n}/${MAX_PLAYERS}`;
    const b = li.querySelector('button');
    b.disabled = r.n >= MAX_PLAYERS;
    b.addEventListener('click', () => enterRoom(r.code));
    ul.appendChild(li);
  }
}
$('mpSignIn').addEventListener('click', () => openAccount());
$('mpRefresh').addEventListener('click', () => { renderServerList(null); net?.watchLobby(renderServerList); });
document.querySelectorAll('#mpVis button').forEach(b => b.addEventListener('click', () => {
  mpVis = b.dataset.v;
  document.querySelectorAll('#mpVis button').forEach(x => x.classList.toggle('on', x === b));
}));
$('mpCode').addEventListener('input', () => { $('mpCode').value = cleanCode($('mpCode').value); });
$('mpJoinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = cleanCode($('mpCode').value);
  if (code.length !== 5) { $('mpErr').textContent = 'Server codes are 5 letters and numbers.'; return; }
  enterRoom(code);
});
$('mpCreateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const [lid, dir] = $('mpTrack').value.split('|');
  const name = $('mpName').value.trim() || `${onlineName()}'s server`;
  enterRoom(newCode(), { name: name.slice(0, 30), public: mpVis === 'public', layout: lid, dir, kart: $('mpKart').value || null });
});

// race the AI: an offline server with computer drivers
for (const id of ['aiCount', 'aiLevel']) document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
}));
$('aiForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const [lid, dir] = $('aiTrack').value.split('|');
  const n = +document.querySelector('#aiCount button.on').dataset.v, difficulty = document.querySelector('#aiLevel button.on').dataset.v;
  const specs = [];
  for (let i = 0; i < n; i++) specs.push(botSpec(garage.selected || null, specs.map(b => b.name)));
  enterRoom(`AI${Date.now().toString(36).slice(-3).toUpperCase()}`, { name: 'Race the AI', public: false, layout: lid, dir, kart: garage.selected || null, bots: specs, aiLevel: difficulty }, true);
});

let entering = false;
// ai: an offline server against the AI (its drivers in `create`)
async function enterRoom(code, create = null, ai = false) {
  if (entering || !visual || (!ai && !onlineName()) || !setupNet(!!ai)) return;
  if (input.needsCalibration()) { input.openConfig($('inputCfg')); return; }
  entering = true;
  const errEl = ai ? $('aiErr') : $('mpErr');
  voice.unlock();                 // (from this click: voices then play even with only a controller after)
  errEl.textContent = create ? 'Creating your server…' : 'Joining…';
  audio.start(); audio.suspend();
  try {
    const myName = onlineName() || driverName();
    const me = { name: myName, uid: account.user?.id ?? `guest:${myName}`, look: { ...helmet }, kart: garage.selected, paint: { ...paint }, lb: settings.weightLb };
    const ban = ai ? null : await admin.myBan();
    if (ban) throw new Error(ban.until ? `You're banned from multiplayer until ${ban.until.toLocaleString()}.${ban.reason ? ` (${ban.reason})` : ''}` : `You're banned from multiplayer.${ban.reason ? ` (${ban.reason})` : ''}`);
    const room = await net.join(code, me, create, { anyway: admin.me, offline: !!ai });
    if (admin.me && !ai) { admin.registerSession(net.id); net.setAdmin(net.id, true); }
    for (const [id, m] of net.members) checkAdmin(id, m);
    const until = kickedUntil(net.id, me.uid);
    if (until) {
      await net.leave();
      throw new Error(`The host removed you from that server. You can join it again in ${Math.max(1, Math.ceil((until - Date.now()) / 60e3))} min.`);
    }
    if (!ai) net.unwatchLobby();
    for (const [id, m] of net.members) addRemote(id, m);
    if (room.layout !== layoutId || room.dir !== direction) chooseLayout(room.layout, room.dir);
    roomKart = room.kart || null;
    if (driving()?.id !== shownKart) await showKart(driving());
    syncBots();                     // (the AI drivers, if we're the host)
    errEl.textContent = '';
    $('fade').classList.add('on');
    setTimeout(() => {
      startSession();
      showRoomTag();
      // a session already running: join qualifying, or watch the race
      if (room.race?.phase === 'quali') startQualiLocal(room.race, null);
      else if (room.race?.phase === 'grid') startRaceLocal(room.race);
      if (create) setTimeout(() => toggleRoomPanel(true), 600);
      setTimeout(() => $('fade').classList.remove('on'), 50);
    }, 300);
  } catch (err) {
    errEl.textContent = err.message;
    if (page === 'multi' && !ai) net.watchLobby(renderServerList);
  } finally { entering = false; }
}

async function leaveRoom() {
  if (club) leaveClub(false);
  const offline = !!net?.offline;
  if (net?.isHost && net.code && !offline) admin.unlistServer(net.code);
  bots?.clear(); bots = null;     // (if others stay, the next host lists it again, and drives the AI)
  admin.unregisterSession(net?.id);
  voice.removeAll();
  voice.disableMic();
  voiceWanted = false;
  $('voiceChip').classList.add('hidden');
  $('roomPanel').classList.add('hidden');
  $('raceResults').classList.add('hidden');
  endRaceLocal();
  for (const id of [...remotes.keys()]) dropRemote(id);
  await net?.leave();
  $('roomTag').classList.add('hidden');
  // back in my own kart
  if (garage.selected !== shownKart) showKart(garage.current());
  toLobby();
  syncSteward();
  go('multi');
}

// ---- the AI drivers in a server (room.bots): the host drives them. A new
// host takes them over where they are (their positions, until then, came
// on the old host's clock).
let botHost = null;
function syncBots() {
  const want = net?.inRoom && net.isHost ? net.room?.bots || [] : [];
  if (want.length && !bots) {
    bots = new Bots({ RAPIER, world: physWorld, surfaceAt, groundAt, garage, remote: (id) => remotes.get(id), race: () => race,
      line: () => track.centerline, trackWidth: track.trackWidth || 6.8, gridPose, CP, simTime: () => simTime, name: nameOf,
      msg: (m) => { net.on.msg(m); net.sendAs(m); }, state: (id, d) => net.on.state(id, d), send: (B) => net.sendBots(B),
      wet: () => kart.wet, online: !net.offline });
  }
  const h = net?.inRoom ? net.hostId : null;
  if (h !== botHost) { botHost = h; for (const [id, r] of remotes) if (net.members.get(id)?.bot) r.off = null; }
  if (!bots) return;
  if (!want.length) { bots.clear(); bots = null; return; }
  bots.sync(want, net.room.aiLevel || 'medium', net.room.kart || null);
}
const AI_LEVELS = ['easy', 'medium', 'hard'];

// ---- the server menu (Esc)
function toggleRoomPanel(on) {
  const el = $('roomPanel');
  const show = on ?? el.classList.contains('hidden');
  el.classList.toggle('hidden', !show);
  if (show) renderRoomPanel();
}
function renderRoomPanel() {
  if (!net?.inRoom || $('roomPanel').classList.contains('hidden')) return;
  const r = net.room || {};
  $('rpName').textContent = r.name || 'Server';
  $('rpTrack').textContent = trackLabel(layoutId, direction) + (r.kart ? ` · ${kartLabel(r.kart)} for everyone` : '') + (r.public ? ' · public server' : ' · private server');
  if (!$('rpKart').children.length) {
    for (const id of ['', ...garage.entries.filter(x => x.kind === 'bundled').map(x => x.id)]) {
      const b = document.createElement('button');
      b.dataset.v = id; b.textContent = id ? kartLabel(id).replace(/^Rental Kart /, '').toUpperCase() : 'OWN CHOICE';
      b.addEventListener('click', () => { if (!b.disabled) net.setRoom({ kart: id || null }); });
      $('rpKart').appendChild(b);
    }
  }
  $('rpKart').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === (r.kart || '')); });
  $('rpCode').textContent = net.code;
  // voice chat: ready in a private server, each player's choice in a public one
  $('rpVoiceSeg').classList.toggle('hidden', !r.public);
  $('rpVoiceSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === (voiceWanted ? 1 : 0)));
  const keyName = input.source === 'touch' ? 'TALK' : input.source === 'pad' ? 'A on your controller' : 'V';
  $('rpVoiceNote').textContent = !voiceOn() ? 'Off: you don\'t hear anyone and nobody hears you. Switch it on to talk.'
    : micDenied ? 'Your microphone is blocked: allow it for this site (in the address bar) to talk. You can still hear.'
      : `Hold ${keyName} to talk. On track only drivers near you hear you; before and after a session, everyone does.`;
  $('rpCodeNote').textContent = r.public ? 'Listed under Public Servers, or join with this code.' : 'Share this code: friends type it in Multiplayer → Join a private server.';
  const ids = [net.id, ...[...net.members.keys()].filter(id => !isKicked(id))];
  $('rpCount').textContent = `${ids.length}/${MAX_PLAYERS}`;
  const ul = $('rpPlayers');
  ul.innerHTML = '';
  for (const id of ids) {
    const li = document.createElement('li');
    li.innerHTML = '<span><b></b></span><small></small>';
    li.querySelector('b').textContent = nameOf(id);
    if (id === net.hostId) li.querySelector('span').insertAdjacentHTML('beforeend', '<span class="tag">HOST</span>');
    if (id === net.id) li.querySelector('span').insertAdjacentHTML('beforeend', '<span class="tag" style="background:#141414">YOU</span>');
    const vf = voiceFlow.get(id);
    if (net.members.get(id)?.bot) {
      li.querySelector('small').textContent = `computer driver · ${(net.room?.aiLevel || 'medium').toUpperCase()}`;
      const pen = penOf(penSession(), id);
      if (pen) li.querySelector('span').insertAdjacentHTML('beforeend', `<span class="tag pen">+${pen} S</span>`);
      if (net.isHost && !(race && race.phase !== 'done')) {
        const act = document.createElement('div');
        act.className = 'rpAct';
        const k = document.createElement('button');
        k.textContent = 'REMOVE'; k.className = 'kick';
        k.addEventListener('click', () => net.setRoom({ bots: (net.room.bots || []).filter(b => b.id !== id) }));
        act.appendChild(k);
        li.appendChild(act);
      }
      ul.appendChild(li);
      continue;
    }
    li.querySelector('small').textContent = id === net.id ? '' : net.direct(id)
      ? (voiceOn() ? `direct link · voice ${vf?.up ? '↑ sending' : '↑ —'} ${vf?.down ? '↓ hearing' : '↓ —'}` : 'direct link')
      : (voiceOn() ? 'no direct link yet: voice needs one' : 'connecting / via server');
    const pen = penOf(penSession(), id);
    if (pen) li.querySelector('span').insertAdjacentHTML('beforeend', `<span class="tag pen">+${pen} S</span>`);
    if (hostMuted(id)) li.querySelector('span').insertAdjacentHTML('beforeend', '<span class="tag muted">MUTED</span>');
    if (isAdminId(id)) li.querySelector('span').insertAdjacentHTML('beforeend', '<span class="tag admin">ADMIN</span>');
    // voice: mute anyone for myself
    if (id !== net.id && voiceOn()) {
      const m = document.createElement('button');
      m.className = 'vMute' + (mutedByMe.has(id) ? ' on' : '');
      m.textContent = mutedByMe.has(id) ? 'UNMUTE' : 'MUTE';
      m.title = mutedByMe.has(id) ? `Hear ${nameOf(id)} again` : `Stop hearing ${nameOf(id)} (only for you)`;
      m.addEventListener('click', () => { if (mutedByMe.has(id)) mutedByMe.delete(id); else mutedByMe.add(id); renderRoomPanel(); });
      li.querySelector('span').appendChild(m);
    }
    // the host: time penalties for the session running (or just ended), and kick
    if (net.isHost && id !== net.id && !isKicked(id) && !isAdminId(id)) {
      const act = document.createElement('div');
      act.className = 'rpAct';
      const s = penSession();
      for (const [label, secs] of [['+5 S', 5], ['+10 S', 10], ['CLEAR', 0]]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.disabled = !s || (!secs && !pen);
        b.title = s ? `${secs ? `Add ${secs} seconds to` : 'Take the penalties off'} ${nameOf(id)}'s ${sessionKind(s) === 'quali' ? 'best qualifying lap' : 'race time'}` : 'Penalties are for a qualifying session or a race';
        b.addEventListener('click', () => givePenalty(id, secs));
        act.appendChild(b);
      }
      const vm = document.createElement('button');
      vm.textContent = hostMuted(id) ? 'UNMUTE ALL' : 'MUTE ALL';
      vm.title = hostMuted(id) ? `Let ${nameOf(id)} talk again` : `Nobody hears ${nameOf(id)}'s voice`;
      vm.addEventListener('click', () => { const v = { ...(net.room.vmute || {}) }; if (v[id]) delete v[id]; else v[id] = true; net.setRoom({ vmute: v }); });
      act.appendChild(vm);
      const k = document.createElement('button');
      k.textContent = 'KICK'; k.className = 'kick';
      k.title = `Remove ${nameOf(id)} from the server for ${KICK_MINUTES} minutes`;
      k.addEventListener('click', () => {
        if (k.dataset.sure) { kick(id); return; }
        k.dataset.sure = '1'; k.textContent = 'SURE?';
        setTimeout(() => { delete k.dataset.sure; k.textContent = 'KICK'; }, 3000);
      });
      act.appendChild(k);
      // an admin can also ban them from multiplayer for a week (and out they go)
      if (isAdminId(net.id)) {
        const bn = document.createElement('button');
        bn.textContent = 'BAN'; bn.className = 'ban';
        bn.title = `Ban ${nameOf(id)} from multiplayer for a week (change it on the Multiplayer page)`;
        bn.addEventListener('click', async () => {
          if (!bn.dataset.sure) { bn.dataset.sure = '1'; bn.textContent = 'SURE?'; setTimeout(() => { delete bn.dataset.sure; bn.textContent = 'BAN'; }, 3000); return; }
          const uid = net.members.get(id)?.uid;
          try { if (uid && !uid.startsWith('guest:')) await admin.ban(uid, 7, 'Banned by an admin in a server'); kick(id); toast(`${nameOf(id)} is banned for a week`); }
          catch (e) { toast(e.message); }
        });
        act.appendChild(bn);
      }
      li.appendChild(act);
    }
    ul.appendChild(li);
  }
  const racing = !!race && race.phase !== 'done';
  $('rpHost').classList.toggle('hidden', !net.isHost);
  $('rpTrackSel').disabled = racing;
  $('rpKart').querySelectorAll('button').forEach(b => { b.disabled = racing; });
  // the AI: added and taken away between sessions, while there's room
  {
    const nb = net.room?.bots?.length ?? 0, ai = $('rpAi').querySelectorAll('button');
    ai[0].disabled = racing || !nb; ai[1].disabled = racing || ids.length >= MAX_PLAYERS;
    $('rpAiNote').textContent = racing ? 'Add or remove AI drivers between sessions'
      : `${nb ? `${nb} in the server` : 'None yet'}: computer drivers race with everyone, up to ${MAX_PLAYERS} drivers in all`;
    $('rpAiLevelRow').classList.toggle('hidden', !nb);
    $('rpAiLevel').querySelectorAll('button').forEach(b => { b.disabled = racing; b.classList.toggle('on', b.dataset.v === (net.room?.aiLevel || 'medium')); });
  }
  $('rpStewardNote').textContent = maySteward() ? 'Leave your kart and watch every driver on the cameras' : 'Only the server\'s owner can steward a public server';
  $('rpSteward').querySelectorAll('button').forEach(b => { b.disabled = racing || !maySteward(); b.classList.toggle('on', +b.dataset.v === (stewarding() ? 1 : 0)); });
  $('rpFlagRow').classList.toggle('hidden', !maySteward());
  { const c = net.room?.cond || {}; $('rpTime').value = c.time || 'afternoon'; $('rpWeather').value = c.weather || 'dry'; $('rpTime').disabled = $('rpWeather').disabled = !net.isHost; }
  $('rpChamp').querySelectorAll('button').forEach(b => { b.disabled = !net.isHost; if (b.dataset.v !== 'reset') b.classList.toggle('on', +b.dataset.v === (net.room?.champ?.on ? 1 : 0)); });
  showFlagBtns();
  $('rpStart').classList.toggle('hidden', racing);
  $('rpClose').classList.toggle('hidden', !isAdminId(net.id));
  $('rpEnd').classList.toggle('hidden', !racing);
  if (net.isHost && document.activeElement !== $('rpTrackSel')) fillTrackSelect($('rpTrackSel'));
  const now = !race ? '' : race.phase === 'quali' ? 'Qualifying is running.' : 'A race is running.';
  $('rpWait').textContent = net.isHost
    ? (racing ? `${now} END SESSION stops it and shows the results.` : ids.length < 2 ? 'You can start on your own, or wait for others to join.' : '')
    : racing ? now : `Waiting for ${nameOf(net.hostId)} (the host) to start. Drive around until then.`;
}
function showRoomTag() {
  if (!net?.inRoom) return;
  const el = $('roomTag');
  el.classList.remove('hidden');
  el.innerHTML = '<b></b><small></small>';
  el.querySelector('b').textContent = net.room?.name ?? 'Server';
  el.querySelector('small').textContent = `${net.code} · ${net.members.size + 1} driver${net.members.size ? 's' : ''} · Esc menu`;
}
$('rpAi').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (!net?.isHost || b.disabled) return;
  const list = net.room.bots || [];
  if (+b.dataset.v < 0) { net.setRoom({ bots: list.slice(0, -1) }); return; }
  if (net.members.size + 1 >= MAX_PLAYERS) return;
  const names = [onlineName() || '', ...[...net.members.values()].map(m => m.name)];
  net.setRoom({ bots: [...list, botSpec(garage.selected || null, names)], aiLevel: net.room.aiLevel || 'medium' });
}));
$('rpAiLevel').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (net?.isHost && !b.disabled) net.setRoom({ aiLevel: b.dataset.v });
}));
$('rpResume').addEventListener('click', () => toggleRoomPanel(false));
$('rpLeave').addEventListener('click', leaveRoom);
$('rpTrackSel').addEventListener('change', () => {
  const [lid, dir] = $('rpTrackSel').value.split('|');
  net.setRoom({ layout: lid, dir });
});
// the server's time of day and weather (the host)
fillSelect($('rpTime'), TIMES); fillSelect($('rpWeather'), WEATHER);
for (const id of ['rpTime', 'rpWeather']) $(id).addEventListener('change', () => {
  if (net?.isHost) net.setRoom({ cond: { time: $('rpTime').value, weather: $('rpWeather').value } });
});
// championship on, off, or back to zero (the host)
document.querySelectorAll('#rpChamp button').forEach(b => b.addEventListener('click', () => {
  if (!net?.isHost) return;
  const c = net.room?.champ || {};
  if (b.dataset.v === 'reset') { net.setRoom({ champ: { on: !!c.on, pts: {}, got: {}, races: 0, last: null } }); toast('Championship reset'); return; }
  net.setRoom({ champ: { ...c, on: b.dataset.v === '1' } });
}));
// race settings: qualifying minutes and race laps
const segVal = (id) => +document.querySelector(`#${id} button.on`).dataset.v;
for (const id of ['rpQuali', 'rpLaps']) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    $('rpStart').textContent = segVal('rpQuali') ? 'START QUALIFYING' : 'START RACE';
  }));
}
$('rpStart').addEventListener('click', () => {
  const quali = segVal('rpQuali'), laps = segVal('rpLaps'), id = Date.now().toString(36);
  // without qualifying the grid is drawn at random
  if (quali) net.setRoom({ race: { id, laps, quali, phase: 'quali', qDur: quali * 60 } });
  else net.setRoom({ race: { id, laps, quali: 0, phase: 'grid', grid: [net.id, ...net.members.keys()].filter(id => id !== stewardOf()).sort(() => Math.random() - 0.5), hold: 0.3 + Math.random() * 1.2 } });
  toggleRoomPanel(false);
});
$('rpEnd').addEventListener('click', () => {
  toggleRoomPanel(false);
  if (net.room?.race) net.setRoom({ race: { ...net.room.race, phase: 'done', ended: true } });
});
$('rpSteward').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (!b.disabled && net.room && maySteward()) net.setRoom({ steward: +b.dataset.v ? net.id : null });
}));
$('rpVoiceSeg').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  voiceWanted = !!+b.dataset.v;
  if (voiceWanted) voice.enableMic().then((ok) => { if (!ok) micDenied = true; renderRoomPanel(); });
  else voice.disableMic();
  renderRoomPanel();
}));
$('rpClose').addEventListener('click', async () => {
  const b = $('rpClose');
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'CLOSE IT? TAP AGAIN'; setTimeout(() => { delete b.dataset.sure; b.textContent = 'CLOSE SERVER (ADMIN)'; }, 3000); return; }
  delete b.dataset.sure; b.textContent = 'CLOSE SERVER (ADMIN)';
  if (!isAdminId(net.id) || !net.isHost) return;
  const code = net.code;
  net.setRoom({ closed: true });
  admin.unlistServer(code);
});
$('rrClose').addEventListener('click', () => $('raceResults').classList.add('hidden'));

// the host's room settings: track and sessions
let roomKart = null, shownSteward = null;
let shownPens = {}, shownKicks = {};
async function applyRoom(r) {
  champTable($('rrChamp')); champTable($('rpChampTable'));
  if (!running) return;
  if (r.closed) {
    await leaveRoom();
    $('mpErr').textContent = 'An admin closed that server.';
    return;
  }
  // removed by the host: out of the server
  const until = kickedUntil(net.id, net.meta?.uid);
  if (until) {
    await leaveRoom();
    $('mpErr').textContent = `The host removed you from the server. You can join it again in ${KICK_MINUTES} min.`;
    return;
  }
  for (const [kid, k] of Object.entries(r.kick || {})) if (!shownKicks[kid] && k.until > Date.now()) { toast(`${k.name} was removed from the server`); if (remotes.has(kid)) dropRemote(kid); }
  shownKicks = { ...(r.kick || {}) };
  // new penalties: everyone hears, the driver gets a banner
  for (const [key, by] of Object.entries(r.pens || {})) for (const [pid, secs] of Object.entries(by)) {
    const was = shownPens[key]?.[pid] ?? 0;
    if (secs > was) {
      toast(`Penalty: +${secs - was} s for ${nameOf(pid)}${key.endsWith(':quali') ? ' (qualifying)' : ''}`);
      if (pid === net.id) banner('PENALTY', `+${secs - was} SECONDS`, 3200);
    }
  }
  shownPens = JSON.parse(JSON.stringify(r.pens || {}));
  if (lastRace && !$('raceResults').classList.contains('hidden')) showResults(lastRace);
  if ((r.kart || null) !== roomKart) {
    roomKart = r.kart || null;
    for (const [id, rk] of remotes) rk.setKart(roomKart ?? net.members.get(id)?.kart);
    endRaceLocal();
    if (driving()?.id !== shownKart) await showKart(driving());
    startSession();
    banner('KART', (roomKart ? `${kartLabel(roomKart)} for everyone` : 'Drivers\' choice').toUpperCase());
  }
  if (r.layout !== layoutId || r.dir !== direction) {
    endRaceLocal();
    chooseLayout(r.layout, r.dir);
    startSession();
    banner('TRACK CHANGE', layoutOf(r.layout).name.toUpperCase());
  }
  const rc = r.race;
  if (rc?.phase === 'quali' && (!race || race.id !== rc.id)) startQualiLocal(rc, rc.qDur);
  else if (rc?.phase === 'grid' && (!race || race.id !== rc.id || race.phase === 'quali')) startRaceLocal(rc);
  else if (rc?.phase === 'done' && race && race.id === rc.id && race.phase !== 'done') finishRaceLocal();
  const sw = stewardOf();
  if (sw !== shownSteward) {
    if (sw && sw !== net.id && net.members.has(sw)) toast(`${nameOf(sw)} is stewarding: watching on the cameras`);
    shownSteward = sw;
  }
  syncSteward();
  renderRoomPanel(); showRoomTag();
}

// ---- stewarding: in a private server the host can leave their kart and
// watch. Number keys ride with each driver (1-8, in the order they joined),
// 0 shows the whole field, C changes the angle.
const STEWARD_CAMS = ['CHASE', 'TV', 'ONBOARD'];
let watchId = null, watchCam = 0, stewardOn = false, sbAt = 0;
const sDir = new THREE.Vector3(), sLook = new THREE.Vector3(), tagV = new THREE.Vector3();
const field = { key: null, x: 0, z: 0, hx: 1, hz: 1 };
// (on a public server only its owner can steward; whoever it is must be here)
function stewardOf() {
  const sw = net?.inRoom ? net.room?.steward ?? null : null;
  return sw && (sw === net.id || net.members.has(sw)) ? sw : null;
}
const isOwner = () => !!net?.room?.owner && net.meta?.uid === net.room.owner;
const maySteward = () => !!net?.isHost && (!net.room?.public || isOwner() || net.admins.has(net.id));
function stewarding() { return !!net?.id && stewardOf() === net.id; }
// the flag in the stand: the steward's (or owner's) pick, or by the session:
// white on the leader's last lap, chequered from the winner home, green the rest
function flagNow() {
  const pick = net?.inRoom ? net.room?.flag : null;
  if (pick && FLAG_NAMES[pick]) return pick;
  if (!race || !net?.inRoom) return 'green';
  if (race.phase === 'done' || race.fin.size) return 'chequered';
  if (race.phase !== 'race') return 'green';
  const lead = Math.max(0, ...standings().map(r => r.pr));
  return lead >= race.laps - 1 ? 'white' : 'green';
}
function setFlag(v) {
  if (!net?.inRoom || !maySteward() || !(v === 'auto' || FLAG_NAMES[v])) return;
  net.setRoom({ flag: v === 'auto' ? null : v });
  toast(v === 'auto' ? 'Flag: automatic' : `${FLAG_NAMES[v]} flag`);
}
function showFlagBtns() {
  const pick = net?.room?.flag || 'auto';
  for (const id of ['sbFlags', 'rpFlag']) $(id).querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === pick); b.disabled = !maySteward(); });
}
for (const id of ['sbFlags', 'rpFlag']) $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => { setFlag(b.dataset.v); showFlagBtns(); }));
// the drivers, in the order they joined: the number keys
function watchList() {
  if (!net?.inRoom) return [];
  return [...net.members.entries()].filter(([id]) => id !== stewardOf() && !isKicked(id)).sort((a, b) => a[1].since - b[1].since).map(([id]) => id);
}
function watchKey(n) {
  const id = n ? watchList()[n - 1] : null;
  if (n && !id) return;
  watchId = id; sDir.set(0, 0, 0);
  hud.setCamera(id ? `${STEWARD_CAMS[watchCam]} · ${nameOf(id)}` : 'WHOLE FIELD');
  sbAt = 0;
}
function watchStep(d) {
  const n = watchList().length + 1, i = watchList().indexOf(watchId) + 1;
  watchKey((i + d + n) % n);
}
function watchAngle() {
  watchCam = (watchCam + 1) % STEWARD_CAMS.length;
  watchKey(watchList().indexOf(watchId) + 1);
}
// in or out of the steward's seat
function syncSteward() {
  const on = running && stewarding();
  $('hud').classList.toggle('steward', on);
  if (!on) $('hud').classList.remove('field');
  $('stewardBar').classList.toggle('hidden', !on);
  if (on) audio.suspend();
  if (on === stewardOn) return;
  stewardOn = on;
  if (on) {
    watchCam = 0; watchKey(0);
    banner('STEWARD', 'KEYS 1–8 · DRIVERS   0 · FIELD', 3400);
  } else {
    $('stewardTags').innerHTML = '';
    for (const r of remotes.values()) r.tag.visible = true;
    hud.setCamera(CAMS[camIdx]);
    if (running) {
      // back in the kart, in the pits
      audio.resume();
      placePit(pitSlot()); snapPose();
      timer.reset(); hud.resetSectors();
      ghostUntil = simTime + GHOST_TIME;
    }
  }
}
// the camera bar along the bottom and the map, a few times a second
function stewardHud(now) {
  showFlagBtns();
  const list = watchList();
  if (watchId && !list.includes(watchId)) watchKey(0);      // they left
  hud.others = [];
  for (const id of list) {
    const r = remotes.get(id);
    if (r?.group.visible) hud.others.push({ x: r.p.x, z: r.p.z, hl: id === watchId });
  }
  hud.drawMinimap(null);
  if (now < sbAt) return;
  sbAt = now + 200;
  const order = !race || race.phase === 'done' ? null : race.phase === 'quali' ? qualiRows().map(r => r.id) : standings().map(r => r.id);
  const kmh = hud.units === 'kmh';
  const tiles = [{ id: null, name: 'Whole field', sub: `${list.length} DRIVER${list.length === 1 ? '' : 'S'}` }, ...list.map((id) => {
    const d = remotes.get(id)?.last, p = order ? order.indexOf(id) + 1 : 0;
    const sp = d ? Math.round(Math.abs(d.sp || 0) * (kmh ? 3.6 : 2.23694)) : 0;
    return { id, name: nameOf(id), sub: `${p ? `P${p} · ` : ''}${sp} ${kmh ? 'KM/H' : 'MPH'}` };
  })];
  const el = $('sbTiles'), key = list.join();
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.innerHTML = '';
    tiles.forEach((t, i) => {
      const b = document.createElement('button');
      b.innerHTML = '<b></b><span></span><em></em>';
      b.children[0].textContent = i;
      b.addEventListener('mousedown', (e) => e.preventDefault());   // (keep the keys for driving the cameras)
      b.addEventListener('click', () => watchKey(i));
      el.appendChild(b);
    });
  }
  tiles.forEach((t, i) => {
    const b = el.children[i];
    b.classList.toggle('on', t.id === watchId);
    b.children[1].textContent = t.name;
    b.children[2].textContent = t.sub;
  });
}
// the steward's camera; returns the point it's looking at
function stewardCamera(dt) {
  const r = watchId && remotes.get(watchId);
  for (const [id, x] of remotes) x.tag.visible = id !== watchId;
  $('hud').classList.toggle('field', !r?.group.visible);
  if (!r?.group.visible) return fieldCamera();
  $('stewardTags').innerHTML = '';
  const p = r.p, q = r.q, mode = STEWARD_CAMS[watchCam];
  if (mode === 'TV') {
    let best = tvSpots[0], bd = Infinity;
    for (const s of tvSpots) { const d = s.distanceToSquared(p); if (d < bd) { bd = d; best = s; } }
    camera.position.copy(best);
    camera.lookAt(sLook.copy(p).add(new THREE.Vector3(0, 0.3, 0)));
    camera.fov = THREE.MathUtils.clamp(2 * Math.atan(4.5 / Math.sqrt(bd)) * 180 / Math.PI, 8, 60);
  } else if (mode === 'ONBOARD') {
    // the camera on the back of the seat, over the driver's shoulders
    camera.position.set(0, 1.15, 1.05).applyQuaternion(q).add(p);
    camera.quaternion.copy(q);
    camera.rotateX(-0.17);
    camera.fov = 70;
  } else {
    const f = fwdV.set(0, 0, -1).applyQuaternion(q);
    f.y = 0; f.normalize();
    if (sDir.lengthSq() < 0.5 || sDir.dot(f) < -0.2) sDir.copy(f);
    sDir.lerp(f, 1 - Math.exp(-5 * dt)).normalize();
    camera.position.copy(p).addScaledVector(sDir, -3.6).add(new THREE.Vector3(0, 1.35, 0));
    camera.lookAt(sLook.copy(p).addScaledVector(sDir, 2.5).add(new THREE.Vector3(0, 0.25, 0)));
    camera.fov = 62;
  }
  camera.updateProjectionMatrix();
  return p;
}
// the whole field: high over the side of the track, its length across the
// screen, every kart named with its key
function fieldCamera() {
  if (field.key !== layoutId) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of track.centerline) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    Object.assign(field, { key: layoutId, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: (x1 - x0) / 2 + 6, hz: (z1 - z0) / 2 + 6 });
  }
  const pitch = 58 * Math.PI / 180, vf = 42 * Math.PI / 180;
  const hf = Math.atan(Math.tan(vf / 2) * camera.aspect);
  const D = Math.max(field.hz / Math.tan(hf), field.hx * Math.sin(pitch) / Math.tan(vf / 2)) * 1.15;
  camera.position.set(field.x + D * Math.cos(pitch), D * Math.sin(pitch), field.z);
  camera.lookAt(field.x, 0, field.z);
  camera.fov = vf * 180 / Math.PI;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const box = $('stewardTags'), seen = new Set();
  watchList().forEach((id, i) => {
    const r = remotes.get(id);
    if (!r?.group.visible) return;
    tagV.copy(r.p).add(new THREE.Vector3(0, 1.2, 0)).project(camera);
    if (tagV.z > 1) return;
    let el = box.querySelector(`[data-id="${id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = id;
      el.innerHTML = '<b></b><span></span>';
      box.appendChild(el);
    }
    el.children[0].textContent = i + 1;
    el.children[1].textContent = r.name;
    el.style.transform = `translate(${((tagV.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - tagV.y) / 2 * innerHeight).toFixed(1)}px)`;
    seen.add(id);
  });
  for (const el of [...box.children]) if (!seen.has(el.dataset.id)) el.remove();
  return tagV.set(field.x, 0, field.z);
}

// a big announcement across the middle of the screen
let bannerTimer = 0;
function banner(kicker, main, ms = 2800) {
  const el = $('banner');
  $('bnSub').textContent = kicker; $('bnMain').textContent = main;
  el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
// session clocks run on real time, so a slow computer's game doesn't stretch them
const wall = () => performance.now() / 1000;
const clockFmt = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---- qualifying: everyone out of the pits, fastest lap before the clock
// runs out sets the grid
function startQualiLocal(rc, left) {
  effects.clear();                 // a new session: a clean track
  $('raceResults').classList.add('hidden');
  race = { id: rc.id, laps: rc.laps, quali: rc.quali, qDur: rc.qDur, phase: 'quali', qEnd: left != null ? wall() + left : null, qBest: null, fin: new Map() };
  if (!stewarding()) { placePit(pitSlot()); snapPose(); }
  timer.reset(); hud.resetSectors();
  ghostUntil = simTime + GHOST_TIME;
  $('raceBox').classList.remove('hidden');
  banner('QUALIFYING', `${rc.quali} MINUTES`, 3200);
  setTimeout(() => { if (race?.phase === 'quali' && !stewarding()) toast('Your fastest lap before the clock runs out sets your grid spot'); }, 3400);
}

// ---- the race
// grid slots behind the line: two by two, staggered, 3.5 m apart
function gridPose(slot) {
  const c = track.centerline;
  let i = 0, dist = 0;
  const want = 7 + slot * 3.5;
  while (dist < want) { const j = (i - 1 + N) % N; dist += Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]); i = j; }
  const pose = trackPose(i);
  const side = slot % 2 ? -1.3 : 1.3;
  // heading points along -Z rotated by heading: right of the kart is (cos, -sin)
  return { x: pose.x + Math.cos(pose.heading) * side, z: pose.z - Math.sin(pose.heading) * side, heading: pose.heading };
}

const CP = 24;                   // timing points per lap, for the gaps between drivers
function startRaceLocal(rc) {
  $('raceResults').classList.add('hidden');
  // a fresh track for the race (qualifying's skid marks off), unless it's
  // the same session going from qualifying to the grid
  if (!race || race.id !== rc.id) effects.clear();
  const slot = rc.grid.indexOf(net.id);
  if (rc.qres && slot === 0 && rc.grid.length >= 2) { stats.data.poles++; achievements(); }
  race = { id: rc.id, laps: rc.laps, quali: rc.quali, phase: 'grid', grid: rc.grid, qres: rc.qres || null, hold: rc.hold ?? 0.8,
    inGrid: slot >= 0, t0: simTime, goAt: null, laps_done: 0, best: null, fin: new Map(), mine: null, firstFinAt: null, cps: new Map(), ci: null };
  for (const r of remotes.values()) r.cps = new Map();
  $('raceBox').classList.remove('hidden');
  if (!race.inGrid) { if (!stewarding()) toast('A race is on: you\'ll be in the next one'); return; }
  // onto the grid behind a quick fade
  $('fade').classList.add('on');
  setTimeout(() => {
    if (club) leaveClub(false);
    placePose(gridPose(slot));
    snapPose();
    { const t = kart.body.translation(); race.spot = { x: t.x, z: t.z, pose: gridPose(slot) }; }
    timer.reset(); hud.resetSectors();
    ghostUntil = 0;
    for (const id of apart.keys()) apart.set(id, false);
    $('lights').classList.remove('hidden', 'go');
    $('lightsSub').textContent = rc.quali ? `GRID P${slot + 1}` : 'RACE START';
    $('lightsText').textContent = '';
    setTimeout(() => $('fade').classList.remove('on'), 50);
  }, 300);
}

// a lap done (any lap, valid or not)
function raceLap(ev) {
  if (!race) return;
  if (race.phase === 'quali') {
    if (!ev.valid || (race.qEnd != null && wall() > race.qEnd)) return;
    if (race.qBest == null || ev.time < race.qBest) { race.qBest = ev.time; banner('PROVISIONAL', `P${qualiRows().findIndex(r => r.id === net.id) + 1} · ${fmt(ev.time)}`, 2400); }
    return;
  }
  if (!race.inGrid || race.goAt == null || race.mine) return;
  race.laps_done++;
  if (ev.valid) race.best = Math.min(race.best ?? Infinity, ev.time);
  if (race.laps_done >= race.laps) {
    const time = simTime - race.goAt;
    race.mine = { time };
    race.fin.set(net.id, { name: onlineName(), time, best: race.best });
    net.send({ type: 'fin', race: race.id, name: onlineName(), time, best: race.best });
    const pos = [...race.fin.values()].sort((a, b) => a.time - b.time).findIndex(f => f.name === onlineName()) + 1;
    banner('CHEQUERED FLAG', `P${pos} · ${fmt(time)}`, 4000);
  } else if (race.laps_done === race.laps - 1) banner('', 'FINAL LAP', 2200);
}

function myProgress() {
  const f = timer.idx / N;
  return timer.lap === 0 ? (f > 0.5 ? f - 1 : f) : timer.lap - 1 + f;
}

// qualifying order: fastest lap first, drivers without a time after
function qualiRows() {
  const rows = stewarding() ? [] : [{ id: net.id, name: onlineName(), best: race.qBest }];
  for (const [id, r] of remotes) {
    const d = r.last;
    if (net.members.has(id) && id !== stewardOf() && !isKicked(id)) rows.push({ id, name: r.name, best: d && d.r === race.id ? d.qb ?? null : null });
  }
  // penalties go on the best lap
  for (const r of rows) { r.pen = penOf(race, r.id); if (r.best != null) r.best += r.pen; }
  // (drivers without a time in the same order on every screen)
  return rows.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || (a.id < b.id ? -1 : 1));
}

// race order: finishers by time, then by distance covered, with the gap to
// the driver ahead measured at the last timing point both have passed
function standings() {
  const rows = [];
  for (const id of race.grid) {
    if (isKicked(id)) continue;
    const raw = race.fin.get(id), pen = penOf(race, id);
    // penalties go on the race time
    const fin = raw && { ...raw, time: raw.time + pen };
    let pr = -1, ci = null, cps = null;
    if (id === net.id) { pr = myProgress(); ci = race.ci; cps = race.cps; }
    else {
      const r = remotes.get(id), d = r?.last;
      if (d && d.r === race.id) { pr = d.pr; ci = d.ci ?? null; cps = r.cps; } else if (!net.members.has(id)) continue;
    }
    rows.push({ id, name: nameOf(id), fin, pr, ci, cps, pen });
  }
  rows.sort((a, b) => (a.fin && b.fin ? a.fin.time - b.fin.time : a.fin ? -1 : b.fin ? 1 : b.pr - a.pr));
  rows.forEach((r, i) => {
    const ahead = rows[i - 1];
    if (i === 0) r.gap = r.fin ? fmt(r.fin.time) : race.goAt == null ? '' : 'LEADER';
    else if (r.fin) r.gap = `+${(r.fin.time - rows[0].fin.time).toFixed(3)}`;
    else if (ahead.ci != null && r.ci != null && ahead.ci - r.ci >= CP) r.gap = `+${Math.floor((ahead.ci - r.ci) / CP)} LAP`;
    else {
      let k = r.ci;
      while (k != null && k >= 0 && !(r.cps?.has(k) && ahead.cps?.has(k))) k--;
      r.gap = k != null && k >= 0 ? `+${(r.cps.get(k) - ahead.cps.get(k)).toFixed(1)}` : '';
    }
  });
  return rows;
}

// ---- championship: points for every race while it's on, kept in the room by
// driver name (so leaving and coming back keeps your points). The host adds
// each race's points at the flag.
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function awardPoints() {
  const c = net.room?.champ;
  if (!net.isHost || !c?.on || c.last === race.id || race.kind === 'quali') return;
  const rows = standings().filter(r => r.fin);
  const bests = rows.map(r => (r.id === net.id ? race.best : r.fin?.best) ?? Infinity);
  const fast = Math.min(...bests);
  const pts = { ...(c.pts || {}) }, got = {};
  rows.forEach((r, i) => {
    const n = (POINTS[i] ?? 0) + (bests[i] === fast && isFinite(fast) ? 1 : 0);
    pts[r.name] = (pts[r.name] || 0) + n; got[r.name] = n;
  });
  net.setRoom({ champ: { ...c, pts, got, last: race.id, races: (c.races || 0) + 1 } });
}
// the standings, in an element (the results card, the server menu)
function champTable(el) {
  const c = net?.room?.champ;
  el.classList.toggle('hidden', !c?.on || !c.races);
  if (!c?.on || !c.races) return;
  const rows = Object.entries(c.pts || {}).sort((a, b) => b[1] - a[1]);
  if (c.races >= 3 && rows[0]?.[0] === onlineName() && !stats.data.champLead) { stats.data.champLead = true; achievements(); }
  el.innerHTML = `<h3>CHAMPIONSHIP · AFTER ${c.races} RACE${c.races > 1 ? 'S' : ''}</h3><ol></ol>`;
  rows.forEach(([name, p], i) => {
    const li = document.createElement('li');
    if (name === onlineName()) li.className = 'me';
    li.innerHTML = '<span></span><span></span><em></em><b></b>';
    li.children[0].textContent = i + 1; li.children[1].textContent = name;
    li.children[2].textContent = c.got?.[name] ? `+${c.got[name]}` : ''; li.children[3].textContent = p;
    el.querySelector('ol').appendChild(li);
  });
}

function finishRaceLocal() {
  race.kind = sessionKind(race);
  race.phase = 'done';
  lastRace = race;
  awardPoints();
  // your result, for your record
  if (race.mine && race.kind !== 'quali') {
    const rows = standings(), i = rows.findIndex(r => r.id === net.id);
    const bests = rows.map(r => (r.id === net.id ? race.best : r.fin?.best) ?? Infinity);
    const people = race.grid.filter(id => id !== net.id && !net.members.get(id)?.bot).length;
    stats.race({ pos: i + 1, of: rows.length, grid: race.grid.indexOf(net.id) + 1, pens: penOf(race, net.id),
      fastest: isFinite(bests[i]) && bests[i] === Math.min(...bests), hardAI: !!net.room?.bots?.length && net.room.aiLevel === 'hard', rain: kart.wet, people });
    achievements();
  }
  $('lights').classList.add('hidden');
  showResults(race);
  $('raceResults').classList.remove('hidden');
  endRaceLocal();
}
// the results table for a session (again after a penalty, if it's open)
function showResults(r) {
  const keep = race;
  race = r;
  try { resultsTable(r.kind === 'quali'); } finally { race = keep; }
}
function resultsTable(quali) {
  const list = $('rrList');
  list.innerHTML = '';
  const row = (pos, name, sub, grid, best, time, me, fl) => {
    const d = document.createElement('div');
    d.className = 'resRow' + (me ? ' me' : '');
    d.innerHTML = '<span class="pos"></span><span><b></b><small></small></span><span></span><span></span><span></span>';
    const c = d.children;
    c[0].textContent = pos; c[1].querySelector('b').textContent = name; c[1].querySelector('small').textContent = sub;
    c[2].textContent = grid; c[3].textContent = best; c[4].textContent = time;
    if (fl) c[3].classList.add('fl');
    list.appendChild(d);
  };
  const kartName = (id) => {
    const k = net.room?.kart || (id === net.id ? garage.selected : net.members.get(id)?.kart);
    const pen = penOf(race, id);
    return (garage.entries.find(e => e.id === k)?.name ?? '') + (pen ? ` · +${pen} s penalty` : '');
  };
  if (quali) {
    const rows = qualiRows();
    rows.forEach((r, i) => row(i + 1, r.name, kartName(r.id), '', r.best != null ? fmt(r.best) : 'NO TIME',
      r.best == null ? '' : i ? `+${(r.best - rows[0].best).toFixed(3)}` : '', r.id === net.id, false));
    $('rrKicker').textContent = 'QUALIFYING'; $('rrTitle').textContent = 'QUALIFYING RESULTS';
    $('rrTrack').textContent = `${trackLabel(layoutId, direction)} · ${race.quali} minutes`;
  } else {
    const rows = standings();
    const bests = rows.map(r => (r.id === net.id ? race.best : r.fin?.best) ?? null);
    const fast = Math.min(...bests.filter(b => b != null));
    rows.forEach((r, i) => row(r.fin ? i + 1 : '–', r.name, kartName(r.id), race.grid.indexOf(r.id) + 1,
      bests[i] != null ? fmt(bests[i]) : '–', !r.fin ? 'DNF' : i === 0 ? fmt(r.fin.time) : r.gap, r.id === net.id, bests[i] === fast));
    $('rrKicker').textContent = 'CLASSIFICATION'; $('rrTitle').textContent = 'RACE RESULTS';
    $('rrTrack').textContent = `${trackLabel(layoutId, direction)} · ${race.laps} laps${isFinite(fast) ? ' · fastest lap in purple' : ''}`;
  }
}
function endRaceLocal() {
  race = null;
  $('raceBox').classList.add('hidden');
  $('lights').classList.add('hidden');
  $('lapOf').textContent = '';
}

// every frame in a server
let qclockAt = 0;
function onlineTick(dt, now) {
  const meGhost = simTime < ghostUntil || (!!race && race.phase !== 'quali' && !race.inGrid);
  const myRace = race && (race.phase === 'quali' || race.inGrid) ? race.id : 0;
  // start lights: one pod a second, then all out after a random hold
  if (race?.phase === 'grid' && race.inGrid) {
    const t = simTime - race.t0;
    const on = Math.max(0, Math.min(5, Math.floor(t - 1)));
    document.querySelectorAll('#lights .pod').forEach((el, i) => el.classList.toggle('on', i < on));
    if (t >= 6 + race.hold) {
      race.goAt = simTime; race.phase = 'race';
      race.ci = Math.floor(myProgress() * CP);
      document.querySelectorAll('#lights .pod').forEach(el => el.classList.remove('on'));
      $('lights').classList.add('go');
      $('lightsText').textContent = 'GO!';
      setTimeout(() => $('lights').classList.add('hidden'), 1400);
    }
  }
  // my time at each timing point, for the gaps
  if (race?.phase === 'race' && race.inGrid && !race.mine) {
    const ci = Math.floor(myProgress() * CP);
    while (race.ci < ci) { race.ci++; race.cps.set(race.ci, simTime - race.goAt); }
  }
  // bump the others: only when neither is see-through, both are in the same
  // session (or neither is), and they've been clear of each other since
  const me = kart.body.translation();
  for (const [id, r] of remotes) {
    const d = r.last;
    r.hidden = id === stewardOf() || isKicked(id);
    if (bots?.has(id)) { r.setSolid(false); r.setGhost(false); continue; }
    const ok = !!d && !r.hidden && !meGhost && !d.g && (d.r || 0) === myRace && r.age < 0.5;
    if (!ok) apart.set(id, false);
    else if (!apart.get(id) && Math.hypot(d.p[0] - me.x, d.p[2] - me.z) > 3.2) apart.set(id, true);
    const solid = ok && apart.get(id);
    r.setSolid(solid);
    r.setGhost(!solid);
  }

  // send our kart
  sendAt -= dt;
  if (sendAt <= 0 && !stewarding() && club) {
    sendAt = SEND_EVERY;
    const w = club.walker.state, r3 = (x) => Math.round(x * 1000) / 1000;
    net.sendState({ t: Math.round(performance.now()), p: [r3(w.x), r3(w.y), r3(w.z)], q: [0, Math.sin(w.yaw / 2), 0, Math.cos(w.yaw / 2)],
      v: [0, 0, 0], w: 0, wk: w.sit ? 2 : 1, yaw: r3(w.yaw), mv: r3(w.moving), g: 1, r: myRace, pr: 0, qb: race?.phase === 'quali' ? race.qBest : null });
  } else if (sendAt <= 0 && !stewarding()) {
    sendAt = SEND_EVERY;
    const t = kart.body.translation(), q = kart.body.rotation(), v = kart.body.linvel(), w = kart.body.angvel();
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const racing = race?.phase === 'race' || race?.phase === 'grid';
    net.sendState({ t: Math.round(performance.now()), p: [r3(t.x), r3(t.y), r3(t.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
      v: [r3(v.x), r3(v.y), r3(v.z)], w: r3(w.y), st: r3(kart.steer), sp: r3(kart.forwardSpeed), lg: r3(kart.accel.x),
      g: meGhost ? 1 : 0, r: myRace,
      pr: racing && race.inGrid ? r3(race.mine ? race.laps + 1 : myProgress()) : 0,
      ci: racing && race.inGrid ? race.ci : null, ct: racing && race.inGrid && race.ci != null ? r3(race.cps.get(race.ci) ?? 0) : null,
      qb: race?.phase === 'quali' ? race.qBest : null });
  }
  if (!race || race.phase === 'done') return;

  // the timing tower: qualifying order, or race order with gaps
  let rows, title, right;
  if (race.phase === 'quali') {
    const left = race.qEnd != null ? race.qEnd - wall() : null;
    rows = qualiRows().map((r, i, all) => ({ id: r.id, name: r.name, pen: r.pen, gap: r.best == null ? 'NO TIME' : i ? `+${(r.best - all[0].best).toFixed(3)}` : fmt(r.best) }));
    title = 'QUALIFYING'; right = left != null ? clockFmt(left) : '--:--';
    $('lapOf').textContent = 'QUALIFYING';
    if (left != null && left <= 60 && race.qDur > 90 && !race.warned) { race.warned = true; banner('QUALIFYING', '1 MINUTE LEFT', 2400); }
    // the host ends qualifying when the clock runs out (and keeps late joiners' clocks right)
    if (net.isHost && race.qEnd != null) {
      if (wall() - qclockAt > 5) { qclockAt = wall(); net.send({ type: 'qclock', race: race.id, left: race.qEnd - wall() }); }
      if (wall() >= race.qEnd + 1.5) {
        const order = qualiRows();
        net.setRoom({ race: { ...net.room.race, phase: 'grid', grid: order.map(r => r.id), qres: order.map(r => ({ id: r.id, best: r.best })), hold: 0.3 + Math.random() * 1.2 } });
      }
    }
  } else {
    rows = standings();
    // (watching: the leader's lap)
    const lead = Math.max(0, ...rows.map(r => r.pr));
    title = race.inGrid ? (race.mine ? 'FINISHED' : race.goAt == null ? 'STARTING GRID' : `LAP ${Math.min(race.laps, race.laps_done + 1)} / ${race.laps}`)
      : lead > 0 ? `LAP ${Math.min(race.laps, Math.floor(lead) + 1)} / ${race.laps}` : 'RACE';
    right = race.inGrid ? `P${rows.findIndex(r => r.id === net.id) + 1}` : `${race.laps} LAPS`;
    $('lapOf').textContent = race.inGrid && race.goAt != null && !race.mine ? 'RACE' : '';
    if (race.fin.size && race.firstFinAt == null) race.firstFinAt = wall();
    // the host ends the race once everyone's home, or 60 s after the winner
    if (net.isHost && (!rows.some(r => !r.fin) || (race.firstFinAt != null && wall() - race.firstFinAt > 60))) net.setRoom({ race: { ...net.room.race, phase: 'done' } });
  }
  $('rbTitle').textContent = title;
  $('rbLap').textContent = right;
  const mine = stewarding() ? watchId : net.id;
  const key = rows.map(r => `${r.id}|${r.gap}|${r.pen}`).join() + mine;
  const ol = $('rbList');
  if (ol.dataset.key !== key) {
    ol.dataset.key = key;
    ol.innerHTML = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.id === mine) li.className = 'me';
      li.innerHTML = '<b></b><span></span><em></em>';
      li.children[0].textContent = i + 1; li.children[1].textContent = r.name; li.children[2].textContent = r.gap ?? '';
      if (r.pen) li.children[1].insertAdjacentHTML('beforeend', `<i class="pen">+${r.pen}s</i>`);
      ol.appendChild(li);
    });
  }
}

// ---- the clubhouse (clubhouse.js, walk.js): from the Esc menu, walk round
// inside and out on the patio. Your kart waits in the pits (see-through to
// everyone); in a server everyone sees you walking about as your driver. A
// qualifying lap you've set stands; a race starting puts you on the grid.
const CLUB_OUT = {
  groundAt,
  fences: FENCE_RUNS.flatMap(run => run.slice(1).map((b, i) => [run[i][0], run[i][1], b[0], b[1]])),
  inPatio(x, z) {
    const { x0, z0, x1, z1, r } = PATIO_SLAB, cx = Math.min(Math.max(x, x0 + r), x1 - r), cz = Math.min(Math.max(z, z0 + r), z1 - r);
    return Math.hypot(x - cx, z - cz) <= r - 0.35 || WALKWAY.some(([x0, z0, x1, z1]) => x > x0 + 0.3 && x < x1 + 0.5 && z > z0 + 0.3 && z < z1 - 0.3);
  },
};
function enterClub() {
  const I = world3d.interior;
  if (!I || !running || club || stewarding()) return;
  if (paused) setPaused(false);
  if (!$('roomPanel').classList.contains('hidden')) toggleRoomPanel(false);
  placePit(pitSlot()); snapPose();
  club = { walker: new Walker(I, CLUB_OUT, canvas), padA: false, tvAt: 0, tvIdx: 0, tvSwitch: 0 };
  club.walker.admin = !!admin.me;
  I.lights.forEach(l => { l.intensity = world3d.night ? 9 : 5; l.visible = true; });
  clubShadows(true);
  document.body.classList.add('walking');
  const hint = document.createElement('div'); hint.id = 'clubHint';
  hint.innerHTML = '<b>WASD</b> walk · <b>Shift</b> hurry · <b>click</b> to look round with the mouse · <b>E</b> sit · <b>Esc</b> menu';
  document.body.appendChild(hint);
  const ch = document.createElement('div'); ch.className = 'crosshair'; ch.id = 'clubCross'; document.body.appendChild(ch);
  setTimeout(() => hint.remove(), 9000);
  showClubBtns();
}
function leaveClub(toPits = true) {
  if (!club) return;
  club.walker.dispose();
  club = null;
  world3d.interior?.lights.forEach(l => { l.intensity = 0; l.visible = false; });
  clubShadows(false);
  document.body.classList.remove('walking');
  $('clubHint')?.remove(); $('clubCross')?.remove();
  camera.fov = 65; camera.updateProjectionMatrix();
  if (toPits) { placePit(pitSlot()); snapPose(); ghostUntil = simTime + GHOST_TIME; }
  showClubBtns();
}
// the clubhouse's furniture casts shadows only while you're inside (out on
// track it's a lot of drawing for shadows nobody sees)
function clubShadows(on) {
  const g = world3d.interior?.group;
  if (!g) return;
  g.userData.shadows = on;
  g.traverse((c) => { if (c.isMesh) c.castShadow = on; });
}
function showClubBtns() { for (const id of ['pmClub', 'rpClub']) { $(id).textContent = club ? 'BACK TO THE TRACK' : 'GO TO THE CLUBHOUSE'; $(id).classList.toggle('hidden', !world3d.interior || stewarding()); } }
for (const id of ['pmClub', 'rpClub']) $(id).addEventListener('click', () => (club ? (setPaused(false), toggleRoomPanel(false), leaveClub()) : enterClub()));
addEventListener('keydown', (e) => {
  if (!club || e.repeat || e.target.closest?.('input, select, textarea')) return;
  if (e.code === 'KeyE') club.walker.sitOrStand();
});
// each frame: walking (keys, or a controller's sticks; A to sit or stand)
function clubTick(dt) {
  const w = club.walker;
  w.paused = paused || !$('roomPanel').classList.contains('hidden');
  if (w.paused) return;
  let pad = null;
  const gp = [...(navigator.getGamepads?.() || [])].find(g => g && g.axes.length >= 4);
  if (gp) {
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    pad = { lx: dz(gp.axes[0]), ly: dz(gp.axes[1]), rx: dz(gp.axes[2]), ry: dz(gp.axes[3]) };
    const a = !!gp.buttons[0]?.pressed;
    if (a && !club.padA) w.sitOrStand();
    club.padA = a;
  }
  w.update(dt, input.keys, pad);
}
// the live TV: someone driving, from behind, switching every 12 s (the race
// leader in a race), drawn into a small picture a few times a second
const tvRT = new THREE.WebGLRenderTarget(512, 288, { colorSpace: THREE.SRGBColorSpace });
const tvCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 2000);
let tvShown = false;
function clubTv(dt) {
  const I = world3d.interior;
  if (!I) return;
  if (!tvShown) { tvShown = true; for (const s of [I.tv, I.tv2]) { s.material = new THREE.MeshBasicMaterial({ map: tvRT.texture, toneMapped: false }); } }
  club.tvAt -= dt; club.tvSwitch -= dt;
  if (club.tvAt > 0) return;
  club.tvAt = 1 / 8;
  const drivers = [...remotes.values()].filter(r => r.last && !r.last.wk && r.group.visible && !r.hidden);
  let target = null;
  if (race?.phase === 'race' && drivers.length) target = drivers.reduce((a, b) => ((b.last.pr || 0) > (a.last.pr || 0) ? b : a));
  else if (drivers.length) { if (club.tvSwitch <= 0) { club.tvIdx++; club.tvSwitch = 12; } target = drivers[club.tvIdx % drivers.length]; }
  if (target) {
    const p = target.group.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(target.group.quaternion);
    tvCam.position.copy(p).addScaledVector(f, -4.5).add(new THREE.Vector3(0, 1.8, 0));
    tvCam.lookAt(p.x + f.x * 6, p.y + 0.5, p.z + f.z * 6);
  } else {
    // nobody driving: the start line from the flag stand
    const fs = track.flagStand || track.centerline[0], fin = track.finish || track.centerline[0];
    tvCam.position.set(fs[0], groundAt(fs[0], fs[1]) + 6, fs[1]); tvCam.lookAt(fin[0], groundAt(fin[0], fin[1]), fin[1]);
  }
  const vis = I.group.visible; I.group.visible = false;
  renderer.setRenderTarget(tvRT); renderer.render(scene, tvCam); renderer.setRenderTarget(null);
  I.group.visible = vis;
}
showClubBtns();

// ---- text chat in a server (online ones, not against the AI): Enter to
// type, Enter to send, Esc to close. Everyone in the server sees it; lines
// fade after a while unless the chat's open. Kicked and muted players' lines
// aren't shown; a line's at most 120 characters, and one goes out at a time.
const CHAT_FADE = 12000;
let chatAt = 0;
function chatShown() { return !!net?.inRoom && !net.offline && running; }
function chatShow() { $('chatBox').classList.toggle('hidden', !chatShown()); if (!chatShown()) chatClose(); }
setInterval(chatShow, 1000);
function chatLine(name, text, mine = false, gold = false) {
  const li = document.createElement('li');
  li.innerHTML = '<b></b><span></span>';
  li.querySelector('b').textContent = name;
  li.querySelector('b').style.color = gold ? '#ffd76a' : mine ? '#7fd1ff' : '#ff7a6e';
  li.querySelector('span').textContent = text;
  $('chatLog').appendChild(li);
  while ($('chatLog').children.length > 40) $('chatLog').firstChild.remove();
  setTimeout(() => li.classList.add('old'), CHAT_FADE);
  $('chatLog').scrollTop = 1e9;
}
function chatIn(m) {
  if (!net?.members.has(m.from) || isKicked(m.from) || mutedByMe.has(m.from)) return;
  const text = String(m.text || '').slice(0, 120).trim();
  if (text) chatLine(nameOf(m.from), text, false, isAdminId(m.from));
}
function chatOpen() {
  if (!chatShown()) return;
  $('chatBox').classList.add('open');
  $('chatForm').classList.remove('hidden');
  input.keys.clear();                       // (stop driving on whatever was held)
  $('chatInput').focus();
}
function chatClose() {
  $('chatBox').classList.remove('open');
  $('chatForm').classList.add('hidden');
  $('chatInput').value = '';
  $('chatInput').blur();
}
$('chatOpen').addEventListener('click', chatOpen);
addEventListener('keydown', (e) => {
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
  if (e.target === $('chatInput') || e.target.closest?.('input, select, textarea, button')) return;
  if (!chatShown() || !$('roomPanel').classList.contains('hidden')) return;
  e.preventDefault();
  chatOpen();
});
$('chatInput').addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); chatClose(); }
});
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatInput').value.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (text && net?.inRoom && performance.now() - chatAt > 700) {
    chatAt = performance.now();
    net.send({ type: 'chat', text });
    chatLine(onlineName() || 'You', text, true, !!admin.me);
  }
  chatClose();
});

// ---- a newer version of the game: the site's front page names its version
// folder (<base href="v…/">); when that's not ours any more, reload: at once
// if you're not on track, otherwise when you leave it (meanwhile a bar
// offers it). An old copy can't show what new ones send (someone walking
// round the clubhouse would show sitting in their kart), so nobody stays on
// one. (The last few versions stay up meanwhile, tools/publish_pages.sh.)
let reloadWhenFree = false;
{
  const mine = (document.baseURI.match(/\/(v\d+)\/?$/) || [])[1];
  let told = false;
  const check = async () => {
    if (!mine || told) return;
    try {
      const html = await (await fetch(new URL('../', document.baseURI), { cache: 'no-store' })).text();
      const now = (html.match(/<base href="\/?(v\d+)\/?"/) || [])[1];
      if (!now || now === mine) return;
      if (!running) { location.reload(); return; }
      told = true; reloadWhenFree = true;
      const el = document.createElement('div');
      el.id = 'updateBar';
      el.innerHTML = '<span>A new version of the game is out.</span><button>RELOAD</button>';
      el.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(el);
    } catch { /* offline: try again later */ }
  };
  setInterval(check, 60000);
  addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
