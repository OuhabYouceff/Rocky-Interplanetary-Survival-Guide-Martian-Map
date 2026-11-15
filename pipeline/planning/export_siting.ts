// Precompute the base-siting heatmap for the default parameters with the SAME TypeScript the browser runs
// (no Python port, so it matches the live worker by construction).
// Run from the project root:
//   npx esbuild pipeline/planning/export_siting.ts --bundle --platform=node --format=esm \
//     --define:import.meta.env='{"BASE_URL":"/"}' --outfile=/tmp/export_siting.mjs && node /tmp/export_siting.mjs
// Writes public/data/base_siting.bin (+ .json). Optional terrain factor: public/data/terrain_class.bin/.json.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_PARAMS } from '../../src/planner/physics';
import { lonLatToCell } from '../../src/data';
import { snapWalkable } from '../../src/terrain';
import { scienceValue, type APTarget } from '../../src/planner/autopilot';
import { encodeSiting, runSiting } from '../../src/planner/siting';

const ROOT = process.cwd().endsWith('planning') ? resolve(process.cwd(), '../..') : process.cwd();
const D = resolve(ROOT, 'public/data') + '/';
const meta = JSON.parse(readFileSync(D + 'terrain.json', 'utf8'));
const buf = readFileSync(D + 'elev.bin'); const q = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
const z = new Float32Array(q.length); for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
const { w, h, res } = meta;
const slope = new Float32Array(w * h), slNaN = new Float32Array(w * h).fill(NaN);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x; const dzdx = (z[i + 1] - z[i - 1]) / (2 * res), dzdy = (z[i + w] - z[i - w]) / (2 * res);
  slope[i] = slNaN[i] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
}
let terrainFactor: Float32Array | undefined;
if (existsSync(D + 'terrain_class.bin') && existsSync(D + 'terrain_class.json')) {
  const tc = JSON.parse(readFileSync(D + 'terrain_class.json', 'utf8'));
  const cls = new Uint8Array(readFileSync(D + 'terrain_class.bin'));
  const lut = new Float32Array(256).fill(1);
  const classes = tc.classes ?? tc;
  for (const [k, v] of Object.entries<{ id?: number; terrain_factor?: number }>(classes)) { const id = v.id ?? +k; if (Number.isFinite(id) && v.terrain_factor) lut[id] = v.terrain_factor; }
  if (cls.length === w * h) { terrainFactor = new Float32Array(w * h); for (let i = 0; i < w * h; i++) terrainFactor[i] = lut[cls[i]]; console.log('using terrain_class factors'); }
}
const grid = { w, h, res, z, slope, terrainFactor };
const T = JSON.parse(readFileSync(D + 'science_targets.json', 'utf8')).targets;
const data = { meta, z } as unknown as Parameters<typeof snapWalkable>[0];
const targets: APTarget[] = T.map((t: { id: string; name: string; type?: string; lat: number; lon: number }) => {
  const [cx, cy] = lonLatToCell(meta, t.lon, t.lat);
  return { id: t.id, name: t.name, cell: snapWalkable(data, slNaN, Math.round(cy) * w + Math.round(cx)), value: scienceValue(t) };
});
const budget = { evaHours: 6, reservePct: 20, workMinPerStop: 30 };
const { result } = runSiting(grid, targets, DEFAULT_PARAMS, budget);
writeFileSync(D + 'base_siting.bin', encodeSiting(result));
const { value: _v, slack: _s, ...rest } = result; void _v; void _s;
writeFileSync(D + 'base_siting.json', JSON.stringify({ ...rest, file: 'base_siting.bin', params: DEFAULT_PARAMS, budget, generated: new Date().toISOString().slice(0, 10),
  terrainFactor: !!terrainFactor, targets: targets.map((t) => ({ id: t.id, cell: t.cell, value: t.value })),
  format: 'Uint8 value plane (cw*ch, row-major, 255 = not a candidate) then Uint8 slack plane (percent of EVA left, 255 = none). Lattice (cx,cy) -> planning cell (x0+cx*step, y0+cy*step).' }, null, 1));
console.log(`base_siting: ${result.candidates} candidates, ${result.ms.toFixed(0)} ms; top:`, result.top.map((s) => `${s.cell % w},${(s.cell / w) | 0} v=${s.value}`).join(' | '));
