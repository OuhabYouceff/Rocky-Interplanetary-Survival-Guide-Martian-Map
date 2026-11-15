// Scene 7 helper: the real ground as a physical model, built from the same data as every other scene
// (3 m planning grid elev.bin, HiRISE colour ortho.jpg) with the shared walk and walk-home rings painted on.
// Model space: metres, X east, Y up, Z south, centred on the window, bottom of the block at y = 0.
import * as THREE from 'three';
import type { Meta } from './world';
import type { Plan } from './plan';

/** A square window of the planning grid, in cells. */
export interface Win { x0: number; y0: number; n: number }

/** Line segments where a field crosses a level (marching squares, the same as scene 2). [x0, y0, x1, y1, ...] in cells. */
function contour(f: (i: number) => number, w: number, h: number, level: number) {
  const out: number[] = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = f(i), b = f(i + 1), c = f(i + w + 1), d = f(i + w);
    if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
    const k = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0); if (k === 0 || k === 15) continue;
    const t = (p: number, q: number) => (level - p) / (q - p), pts: number[] = [];
    if ((k & 1) !== ((k >> 1) & 1)) pts.push(x + t(a, b), y);
    if (((k >> 1) & 1) !== ((k >> 2) & 1)) pts.push(x + 1, y + t(b, c));
    if (((k >> 3) & 1) !== ((k >> 2) & 1)) pts.push(x + t(d, c), y + 1);
    if ((k & 1) !== ((k >> 3) & 1)) pts.push(x, y + t(a, d));
    for (let j = 0; j + 3 < pts.length; j += 4) out.push(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
  }
  return out;
}

export function buildModel(o: {
  meta: Meta; z3: Float32Array; ortho: HTMLImageElement; plan: Plan; win: Win;
  width: number;        // model width, metres
  floorZ: number;       // Mars elevation that sits at the top of the block (or on the floor)
  block: number;        // block thickness under floorZ, metres (0: no sides, terrain lies on the floor)
  step: number;         // mesh vertex every `step` cells
  tex: number;          // texture size, px
  lines: [number, number]; // route and ring widths, Mars metres
}) {
  const { meta, z3, plan, win, width, floorZ, block } = o, { w, res } = meta, k = width / (win.n * res);
  const yOf = (z: number) => Math.max(0, z - floorZ) * k + block;            // true height: no vertical exaggeration
  const xOf = (cx: number) => ((cx - win.x0 + .5) / win.n - .5) * width, zOf = (cy: number) => ((cy - win.y0 + .5) / win.n - .5) * width;

  // ---- texture: HiRISE colour, rings, route -----------------------------------------------------------------------
  const T = o.tex, cv = document.createElement('canvas'); cv.width = cv.height = T;
  const g = cv.getContext('2d')!, ow = o.ortho.naturalWidth, oh = o.ortho.naturalHeight;
  g.drawImage(o.ortho, win.x0 / w * ow, win.y0 / meta.h * oh, win.n / w * ow, win.n / meta.h * oh, 0, 0, T, T);
  const s = T / win.n, px = (cx: number) => (cx - win.x0 + .5) * s, py = (cy: number) => (cy - win.y0 + .5) * s, mpx = win.n * res / T;
  g.lineCap = g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = o.lines[1] / mpx;
  for (const min of [10, 20, 30]) {
    const seg = contour((i) => plan.home.time[i], w, meta.h, min * 60); g.beginPath();
    for (let j = 0; j < seg.length; j += 4) { g.moveTo(px(seg[j]), py(seg[j + 1])); g.lineTo(px(seg[j + 2]), py(seg[j + 3])); }
    g.stroke();
  }
  // the route, smoothed like the ribbon in world.ts, with a faint dark edge so it reads on bright ground
  let pts = plan.path.map((c) => [c % w, Math.floor(c / w)]);
  for (let pass = 0; pass < 3; pass++) pts = pts.map((p, i) => i && i < pts.length - 1 ? [(pts[i - 1][0] + p[0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + p[1] * 2 + pts[i + 1][1]) / 4] : p);
  const route = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, px(x), py(y))); g.stroke(); };
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = o.lines[0] / mpx * 2; route();
  g.strokeStyle = '#fff'; g.lineWidth = o.lines[0] / mpx; route();
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;

  // ---- terrain surface ----------------------------------------------------------------------------------------------
  const idx: number[] = []; for (let i = 0; i < win.n - 1; i += o.step) idx.push(i); idx.push(win.n - 1);
  const m = idx.length, pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2), tri: number[] = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const v = j * m + i, cx = win.x0 + idx[i], cy = win.y0 + idx[j];
    pos[v * 3] = xOf(cx); pos[v * 3 + 1] = yOf(z3[cy * w + cx]); pos[v * 3 + 2] = zOf(cy);
    uv[v * 2] = (idx[i] + .5) / win.n; uv[v * 2 + 1] = 1 - (idx[j] + .5) / win.n;
    if (i && j) { const a = v - m - 1; tri.push(a, a + m, a + 1, a + 1, a + m, a + m + 1); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(tri); geo.computeVertexNormals();
  const group = new THREE.Group(), surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: .95, metalness: 0 }));
  surface.castShadow = surface.receiveShadow = true; group.add(surface);

  // ---- clean vertical sides and a dark plinth, like an architectural model ----------------------------------------
  if (block > 0) {
    const wall: number[] = [], edge = (cells: [number, number][]) => cells.forEach(([ax, ay], t) => {
      if (!t) return; const [bx, by] = cells[t - 1], x1 = xOf(ax), z1 = zOf(ay), x0 = xOf(bx), z0 = zOf(by);
      const y1 = yOf(z3[ay * w + ax]), y0 = yOf(z3[by * w + bx]);
      wall.push(x0, 0, z0, x1, 0, z1, x1, y1, z1, x0, 0, z0, x1, y1, z1, x0, y0, z0);
    });
    const a = win.x0, b = win.x0 + win.n - 1, c = win.y0, d = win.y0 + win.n - 1;
    edge(idx.map((i) => [a + i, c])); edge(idx.map((i) => [b, c + i])); edge(idx.map((i) => [b - i, d])); edge(idx.map((i) => [a, d - i]));
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); wg.computeVertexNormals();
    const sides = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x47302a, roughness: .9, side: THREE.DoubleSide }));
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(width + .012, .006, width + .012), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: .6 }));
    plinth.position.y = -.003; sides.castShadow = plinth.castShadow = true; plinth.receiveShadow = true; group.add(sides, plinth);
  }

  /** Model-space position of a planning cell, `lift` metres above the drawn ground. */
  const at = (cell: number, lift = 0) => { const cx = cell % w, cy = Math.floor(cell / w); return new THREE.Vector3(xOf(cx), yOf(z3[cell]) + lift, zOf(cy)); };
  return { group, at, scale: 1 / k };
}
