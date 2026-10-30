// Kart picker: bundled models from models/catalog.json plus models the player
// imports (.glb), which are kept in IndexedDB so they survive reloads.

const DB = 'tidalturns';
const PICK = 'tidalturns.kart.v2';   // v2: everyone switched to the R25 once
const YAW = 'tidalturns.kartYaw.v2';   // v1 flips were made before the models' defaults were verified

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('models', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('models', mode);
    const out = fn(t.objectStore('models'));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
}
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export class Garage {
  constructor() {
    this.entries = [];
    this.selected = ls.get(PICK, null);
    this.yaw = ls.get(YAW, {});
  }

  async load() {
    const catalog = await (await fetch('models/catalog.json', { cache: 'no-store' })).json();
    const present = await Promise.all(catalog.map(async (m) => {
      if (!m.optional) return true;
      try { return (await fetch(m.file, { method: 'HEAD', cache: 'no-store' })).ok; } catch { return false; }
    }));
    this.entries = catalog.filter((_, i) => present[i]).map(m => ({ ...m, kind: 'bundled' }));
    this.missingOptional = catalog.filter((m, i) => m.optional && !present[i]);
    try {
      const imported = await tx('readonly', s => s.getAll());
      for (const m of imported || []) this.entries.push({ id: m.id, name: m.name, note: 'Imported', kind: 'imported', yawDegrees: 180 });
    } catch { /* IndexedDB unavailable */ }
    if (!this.entries.some(e => e.id === this.selected)) this.selected = this.entries[0]?.id ?? null;
    return this;
  }

  current() { return this.entries.find(e => e.id === this.selected); }

  select(id) { this.selected = id; ls.set(PICK, id); }

  yawFor(e) { return (e.yawDegrees ?? 180) + (this.yaw[e.id] ?? 0); }

  turn(id) { this.yaw[id] = ((this.yaw[id] ?? 0) + 180) % 360; ls.set(YAW, this.yaw); }

  // what loadKartModel needs: a URL or an ArrayBuffer, plus options
  async source(e) {
    const opts = { yawDegrees: this.yawFor(e), credit: e.author ? `Kart model: "${e.name}" by ${e.author} (${e.license})` : '' };
    if (e.textures) opts.textures = e.textures;
    if (e.sideLogos) opts.sideLogos = e.sideLogos;
    if (e.numbers) opts.numbers = e.numbers;
    if (e.numberBoxes) opts.numberBoxes = e.numberBoxes;
    if (e.kind === 'imported') {
      const data = e._data ?? (await tx('readonly', s => s.get(e.id))).data;
      return { src: data, opts: { ...opts, credit: `Kart model: ${e.name} (imported)` } };
    }
    return { src: e.file, opts };
  }

  async import(file) {
    const data = await file.arrayBuffer();
    const id = 'import-' + Date.now().toString(36);
    const name = file.name.replace(/\.(glb|gltf)$/i, '');
    try { await tx('readwrite', s => s.put({ id, name, data })); } catch { /* keep for this session only */ }
    const e = { id, name, note: 'Imported', kind: 'imported', yawDegrees: 180, _data: data };
    this.entries.push(e);
    return e;
  }

  async remove(id) {
    try { await tx('readwrite', s => s.delete(id)); } catch { /* ignore */ }
    this.entries = this.entries.filter(e => e.id !== id);
    if (this.selected === id) this.select(this.entries[0]?.id);
  }
}
