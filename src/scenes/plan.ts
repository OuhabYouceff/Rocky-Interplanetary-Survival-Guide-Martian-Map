// The walk itself, computed with Rocky's own planner (imported, not copied): the same Dijkstra fields, walking model and
// reserve rule that the real app uses. Nothing here is typed in by hand except the list of stops.
import { DEFAULT_PARAMS, type ExplorerParams } from '../planner/physics';
import { homeField, outField, route, type Field, type Grid } from '../planner/fields';
import type { Meta } from './world';
import { gridKey, memo } from './cache';

export const BUDGET = { evaHours: 6, reservePct: 20, workMinPerStop: 30 };      // Rocky's defaults
export const WALK = ['Altadena', 'Ayopaya', 'Nevado Sajama', 'Campo Marte'];    // Rocky's demo walk: the story every scene shares
export const CREW = { a: 0xe4572e, b: 0x2f6fd0 };                             // arm-band colours: orange and blue, the same two people in every scene
export interface Stop { name: string; cell: number }
export interface Plan {
  base: number; stops: Stop[]; home: Field; out: Field; legs: { cells: number[]; time: number[] }[];
  path: number[]; distance: number; totalTime: number; walkTime: number; climb: number; minReserve: number; pass: boolean; T: number; usable: number; work: number;
}

export async function loadSites(meta: Meta, z: Float32Array) {
  const { w, h, res } = meta;
  const cellOf = (lon: number, lat: number) => Math.round((meta.lat_top - lat) / (meta.lat_top - meta.lat_bottom) * h - .5) * w + Math.round((lon - meta.lon_left) / (meta.lon_right - meta.lon_left) * w - .5);
  const slope = (c: number) => { const x = c % w, y = Math.floor(c / w); if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 99; return Math.atan(Math.hypot((z[c + 1] - z[c - 1]) / (2 * res), (z[c + w] - z[c - w]) / (2 * res))) * 180 / Math.PI; };
  /** Nearest cell gentle enough to stand on (same rule as Rocky's snapWalkable: under 12 degrees, within 12 cells). */
  const snap = (c: number) => { let best = c, bd = 1e9; const x0 = c % w, y0 = Math.floor(c / w); for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const x = x0 + dx, y = y0 + dy; if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; const i = y * w + x; if (!(slope(i) < 12)) continue; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; };
  const [tj, wps] = await Promise.all([fetch('data/science_targets.json').then((r) => r.json()), fetch('data/waypoints.json').then((r) => r.json())]);
  const targets: Stop[] = (Array.isArray(tj) ? tj : tj.targets).map((t: { name: string; lon: number; lat: number }) => ({ name: t.name.replace(/\s*\(.*\)\s*/g, ''), cell: snap(cellOf(t.lon, t.lat)) }));
  const wp = wps.find((p: { sol: number }) => p.sol >= 4600) ?? wps[0];          // the habitat of Rocky's demo walk
  return { targets, base: snap(cellOf(wp.lon, wp.lat)), slope };
}

export function makePlan(g: Grid, base: number, stops: Stop[], p: ExplorerParams = DEFAULT_PARAMS): Plan {
  const T = BUDGET.evaHours * 3600, work = BUDGET.workMinPerStop * 60, usable = T * (1 - BUDGET.reservePct / 100);
  const home = homeField(g, base, p), out = outField(g, base, p);
  const per = stops.length ? Math.max(0, p.loadBack - p.loadOut) / stops.length : 0;     // samples picked up at each stop
  let mass = p.bodyMass + p.suitMass + p.loadOut, t = 0, distance = 0, climb = 0, minReserve = 1, walkTime = 0;
  const seq = [base, ...stops.map((s) => s.cell), base], legs: Plan['legs'] = [], path: number[] = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const r = route(g, seq[i], seq[i + 1], mass, p); if (!r) throw new Error('no walkable route to ' + (stops[i]?.name ?? 'the habitat'));
    for (let k = 0; k < r.cells.length; k++) {
      const c = r.cells[k]; minReserve = Math.min(minReserve, (T - (t + r.time[k]) - home.time[c]) / T);
      if (k) { const a = r.cells[k - 1]; distance += Math.hypot((c % g.w) - (a % g.w), Math.floor(c / g.w) - Math.floor(a / g.w)) * g.res; const dz = g.z[c] - g.z[a]; if (dz > 0) climb += dz; }
    }
    legs.push({ cells: r.cells, time: r.time }); path.push(...(i ? r.cells.slice(1) : r.cells));
    const lt = r.time[r.time.length - 1]; t += lt; walkTime += lt;
    if (i < stops.length) { t += work; mass += per; }
  }
  return { base, stops, home, out, legs, path, distance, totalTime: t, walkTime, climb, minReserve, pass: minReserve >= BUDGET.reservePct / 100 && t <= usable, T, usable, work };
}
/** makePlan, remembered between page loads: the two Dijkstra fields and the routes take a few seconds to compute. */
export const makePlanCached = (g: Grid, base: number, stops: Stop[], p: ExplorerParams = DEFAULT_PARAMS) =>
  memo(`plan:${gridKey(g.z)}:${base}:${stops.map((s) => s.cell).join(',')}:${JSON.stringify(p)}:${JSON.stringify(BUDGET)}`, () => makePlan(g, base, stops, p));
export const fmtTime = (s: number) => { const m = Math.round(s / 60), h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
