// Builds a table-top AR model of the current plan: real terrain (USGS 1 m DEM via the 3 m planning grid), HiRISE colour
// with the walk-home zone painted on, the planned route as a tube, habitat + stops as markers, solid side walls on a base.
// The model is cropped to a square window around the plan so the walk fills the table.
// Exported as GLB (Android Scene Viewer) and USDZ (iOS AR Quick Look) by exportAr().
import * as THREE from 'three';
import type { Dataset } from '../data';
import type { Fields, Budget } from '../store';
import type { Leg } from '../planner/worker';

export const AR_WIDTH_M = 0.5;      // model footprint on the table
export const AR_VERT_EXAG = 1.5;    // vertical exaggeration (stated on the AR page)
const SEG = 140;                    // mesh resolution per side
const TEX = 2048;                   // texture size
const BASE_H = 0.025;               // base height (m)

export interface ArWindow { x0: number; y0: number; n: number; metres: number }

/** Square window (in planning cells) around habitat + stops + route, at least 1.2 km wide, clamped to the grid. */
export function planWindow(d: Dataset, legs: Leg[], base: number | null, stops: number[]): ArWindow {
  const { w, h, res } = d.meta;
  const cells = [...(base != null ? [base] : []), ...stops, ...legs.flatMap((l) => l.cells)];
  if (!cells.length) return { x0: 0, y0: 0, n: Math.min(w, h), metres: Math.min(w, h) * res };
  let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
  for (const c of cells) { const x = c % w, y = Math.floor(c / w); xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y); }
  const pad = Math.round(300 / res);
  let n = Math.max(Math.round(1200 / res), xb - xa + 2 * pad, yb - ya + 2 * pad);
  n = Math.min(n, w, h);
  const cx = (xa + xb) / 2, cy = (ya + yb) / 2;
  const x0 = Math.max(0, Math.min(w - n, Math.round(cx - n / 2))), y0 = Math.max(0, Math.min(h - n, Math.round(cy - n / 2)));
  return { x0, y0, n, metres: n * res };
}

function paintTexture(d: Dataset, win: ArWindow, fields: Fields | null, budget: Budget, legs: Leg[], base: number | null, stops: number[]) {
  const cv = document.createElement('canvas'); cv.width = TEX; cv.height = TEX;
  const g = cv.getContext('2d')!;
  const { w, h } = d.meta;
  const ow = d.ortho.naturalWidth || d.ortho.width, oh = d.ortho.naturalHeight || d.ortho.height;
  g.drawImage(d.ortho, (win.x0 / w) * ow, (win.y0 / h) * oh, (win.n / w) * ow, (win.n / h) * oh, 0, 0, TEX, TEX);
  if (fields) {
    const usable = budget.evaHours * 3600 * (1 - budget.reservePct / 100), work = budget.workMinPerStop * 60;
    const n = win.n; const ov = document.createElement('canvas'); ov.width = n; ov.height = n;
    const o = ov.getContext('2d')!; const im = o.createImageData(n, n);
    const inside = (i: number) => fields.outT[i] + fields.homeT[i] + work <= usable;
    for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
      const i = (win.y0 + yy) * w + (win.x0 + xx), p = (yy * n + xx) * 4;
      if (!isFinite(fields.homeT[i])) continue;
      const r = xx + 1 < n ? i + 1 : i, dn = yy + 1 < n ? i + w : i, ins = inside(i);
      if ((isFinite(fields.homeT[r]) && inside(r) !== ins) || (isFinite(fields.homeT[dn]) && inside(dn) !== ins)) {
        im.data[p] = 127; im.data[p + 1] = 227; im.data[p + 2] = 255; im.data[p + 3] = 255;       // tether limit
      } else if (!ins) { im.data[p] = 150; im.data[p + 1] = 20; im.data[p + 2] = 24; im.data[p + 3] = 110; }
      else { im.data[p] = 79; im.data[p + 1] = 209; im.data[p + 2] = 139; im.data[p + 3] = 34; }
    }
    o.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(ov, 0, 0, TEX, TEX);
  }
  const s = TEX / win.n;
  const px = (c: number) => ((c % w) - win.x0 + 0.5) * s, py = (c: number) => (Math.floor(c / w) - win.y0 + 0.5) * s;
  g.lineJoin = 'round'; g.lineCap = 'round';
  legs.forEach((leg, li) => {
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 12; g.beginPath();
    leg.cells.forEach((c, k) => (k ? g.lineTo(px(c), py(c)) : g.moveTo(px(c), py(c))));
    g.stroke(); g.strokeStyle = li === legs.length - 1 ? '#7fe3ff' : '#ffb35c'; g.lineWidth = 6; g.stroke();
  });
  const dot = (c: number, col: string, r: number) => { g.fillStyle = col; g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.arc(px(c), py(c), r, 0, 7); g.fill(); g.stroke(); };
  stops.forEach((c) => dot(c, '#ffd27a', 16));
  if (base != null) dot(base, '#7fe3ff', 20);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  tex.userData.mimeType = 'image/jpeg';   // GLTFExporter: JPEG keeps the GLB small for phones
  return tex;
}

export interface ArOptions { room?: boolean }
export const ROOM_WIDTH_M = 6;   // room-scale model: Mount Sharp spread across the floor
export const ROOM_VERT_EXAG = 1.0; // true height at room scale (buttes up to about chest height)

export function buildArScene(d: Dataset, fields: Fields | null, budget: Budget, legs: Leg[], base: number | null, stops: number[], opts: ArOptions = {}): THREE.Scene {
  const { w } = d.meta;
  const room = !!opts.room;
  const W_M = room ? ROOM_WIDTH_M : AR_WIDTH_M;       // model width on the floor / table
  const S = W_M / AR_WIDTH_M;                          // marker scale factor vs the table model
  const BASE = room ? 0 : BASE_H;                      // room model sits directly on the floor
  const win = planWindow(d, legs, base, stops);
  const scene = new THREE.Scene();
  const k = W_M / win.metres;
  let zlo = Infinity;
  if (room) {
    // floor = the lowest ground the walk touches (minus 15 m), so the route lies on the floor and hills rise around it
    const walk = [...(base != null ? [base] : []), ...stops, ...legs.flatMap((l) => l.cells)];
    for (const c of walk) { const z = d.z[c]; if (z < zlo) zlo = z; }
    zlo -= 15;
  }
  if (!isFinite(zlo)) for (let yy = 0; yy < win.n; yy += 4) for (let xx = 0; xx < win.n; xx += 4) { const z = d.z[(win.y0 + yy) * w + win.x0 + xx]; if (z < zlo) zlo = z; }
  const EX = room ? ROOM_VERT_EXAG : AR_VERT_EXAG;
  const zs = (z: number) => (isNaN(z) ? 0 : Math.max(0, z - zlo) * k * EX) + BASE;
  const cellAt = (u: number, v: number) => (win.y0 + Math.min(win.n - 1, Math.round(v * (win.n - 1)))) * w + win.x0 + Math.min(win.n - 1, Math.round(u * (win.n - 1)));
  // terrain surface
  const geo = new THREE.PlaneGeometry(W_M, W_M, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
    const vi = j * (SEG + 1) + i;
    pos.setY(vi, zs(d.z[cellAt(i / SEG, j / SEG)]));
    uv.setXY(vi, i / SEG, j / SEG);
  }
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: paintTexture(d, win, fields, budget, legs, base, stops), roughness: 0.95, metalness: 0 }));
  terrain.name = 'Mount Sharp terrain'; scene.add(terrain);
  // solid side walls from the terrain edge down to the table (table model only)
  if (!room) {
  const wallPos: number[] = [];
  const edge = (pts: [number, number][]) => {
    for (let t = 0; t < pts.length - 1; t++) {
      const [ua, va] = pts[t], [ub, vb] = pts[t + 1];
      const xa = (ua - 0.5) * AR_WIDTH_M, za = (va - 0.5) * AR_WIDTH_M, xb = (ub - 0.5) * AR_WIDTH_M, zb = (vb - 0.5) * AR_WIDTH_M;
      const ya = zs(d.z[cellAt(ua, va)]), yb = zs(d.z[cellAt(ub, vb)]);
      wallPos.push(xa, 0, za, xb, 0, zb, xb, yb, zb, xa, 0, za, xb, yb, zb, xa, ya, za);
    }
  };
  const run = (f: (t: number) => [number, number]) => Array.from({ length: SEG + 1 }, (_, i) => f(i / SEG));
  edge(run((t) => [t, 0])); edge(run((t) => [1, t])); edge(run((t) => [1 - t, 1])); edge(run((t) => [0, 1 - t]));
  const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3)); wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9, side: THREE.DoubleSide }));
  walls.name = 'terrain sides'; scene.add(walls);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(AR_WIDTH_M + 0.02, 0.008, AR_WIDTH_M + 0.02), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7 }));
  slab.position.y = 0.004; slab.name = 'base'; scene.add(slab);
  }
  // cell -> model position
  const at = (cell: number, lift = 0) => {
    const u = ((cell % w) - win.x0) / (win.n - 1), v = (Math.floor(cell / w) - win.y0) / (win.n - 1);
    return new THREE.Vector3((u - 0.5) * W_M, zs(d.z[cell]) + lift * S, (v - 0.5) * W_M);
  };
  const pts: THREE.Vector3[] = [];
  legs.forEach((leg) => leg.cells.forEach((c, i) => { if (i % 2 === 0 || i === leg.cells.length - 1) pts.push(at(c, 0.0025)); }));
  if (pts.length > 2) {
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.min(1500, pts.length * 3), 0.0016 * S, 6, false),
      new THREE.MeshStandardMaterial({ color: 0x7fe3ff, emissive: 0x2a8fb0, roughness: 0.4 }));
    tube.name = 'planned route'; scene.add(tube);
  }
  if (base != null) {
    const hab = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * S, 0.009 * S, 0.012 * S, 24), new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.5 }));
    hab.position.copy(at(base, 0.006)); hab.name = 'habitat'; scene.add(hab);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.0012 * S, 0.0012 * S, 0.03 * S, 8), new THREE.MeshStandardMaterial({ color: 0x7fe3ff, emissive: 0x7fe3ff }));
    beacon.position.copy(at(base, 0.027)); beacon.name = 'habitat beacon'; scene.add(beacon);
  }
  stops.forEach((c, i) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.006 * S, 0.016 * S, 16), new THREE.MeshStandardMaterial({ color: 0xffb35c, roughness: 0.5 }));
    m.rotation.x = Math.PI; m.position.copy(at(c, 0.013)); m.name = `stop ${i + 1}`; scene.add(m);
  });
  scene.userData.arWindow = { ...win, widthM: W_M, vertExag: EX, room };
  return scene;
}

export async function exportAr(scene: THREE.Scene, kind: 'glb' | 'usdz'): Promise<Blob> {
  if (kind === 'usdz') {
    const { USDZExporter } = await import('./USDZExporterJpeg.js');
    const buf = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true, maxTextureSize: 2048 });
    return new Blob([buf], { type: 'model/vnd.usdz+zip' });
  }
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const out = await new GLTFExporter().parseAsync(scene, { binary: true });
  return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' });
}
