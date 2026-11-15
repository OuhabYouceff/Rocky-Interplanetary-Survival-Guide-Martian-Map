// Base siting: where should the habitat go so that one EVA, under the walk-back rule, reaches the most science?
//
// Trick: run Dijkstra FROM each target once in each direction (2 x n full fields, 22 for today's 11 targets):
//   reverse field of target j at loadOut  -> time to walk from ANY cell to j (first leg out of a candidate base)
//   forward field of target j at loadBack -> time to walk from j back to ANY cell (walk-home rule + final leg)
// so base<->target costs for every candidate cell come for free, and target<->target costs are fixed
// (they fall out of the same fields: ttOut[i][j] = reverse_j at cell_i, ttBack[i][j] = forward_i at cell_j).
// Each candidate on a coarse lattice (walkable ground, slope <= 10 deg) is then scored with a lean exact
// subset DP (value only; target-to-target legs at the mean of the loadOut/loadBack times), and the top
// sites get the full autopilot DP (per-plan-size sample mass, runner-ups, reasons).
import { dijkstra, homeField, type Grid } from './fields';
import type { ExplorerParams } from './physics';
import { DP_SLACK_S, paramsKey, planFromModel, verifyPlan, type APBudget, type APTarget, type CostModel, type Plan, type TTMatrix } from './autopilot';

export interface SiteCandidate { cell: number; value: number; slack: number; plan: Plan | null; stopsCells: number[] }

export interface SitingResult {
  cw: number; ch: number;        // lattice size
  step: number;                  // lattice spacing in planning cells
  x0: number; y0: number;        // planning-grid cell of lattice (0, 0)
  res: number;                   // metres per planning cell
  value: Uint8Array;             // best science value reachable in one EVA from this lattice site; 255 = not a candidate
  slack: Float32Array;           // (limit - total time of that plan) / T, fraction of the EVA left over (NaN if none)
  maxValue: number;              // sum of all target values (for colour scaling)
  top: SiteCandidate[];          // best sites, at least minSepM apart, each with its exact optimal plan
  key: string;                   // params + budget + targets fingerprint
  ms: number; fieldsMs: number; dpMs: number;
  candidates: number;
}

export interface SitingOptions { step?: number; maxSlopeDeg?: number; minSepM?: number; topK?: number }

export function sitingKey(p: ExplorerParams, budget: APBudget, targets: APTarget[], step: number): string {
  return paramsKey(p, targets.map((t) => t.cell)) + JSON.stringify([budget.evaHours, budget.reservePct, budget.workMinPerStop, targets.map((t) => t.value), step]);
}

/**
 * Generator so the worker can yield between Dijkstra runs (progress + cancellation). Yields progress in [0, 1].
 * Returns the result and, as a by-product, the target-to-target matrix (to warm the autopilot cache).
 */
export function* sitingJob(g: Grid, targets: APTarget[], p: ExplorerParams, budget: APBudget, opt: SitingOptions = {}):
  Generator<number, { result: SitingResult; tt: TTMatrix }, void> {
  const t0 = performance.now();
  const step = opt.step ?? 12, maxSlope = opt.maxSlopeDeg ?? 10, minSep = (opt.minSepM ?? 150) / g.res, topK = opt.topK ?? 5;
  const n = targets.length, cells = targets.map((t) => t.cell);
  const x0 = Math.floor(step / 2), y0 = Math.floor(step / 2);
  const cw = Math.floor((g.w - 1 - x0) / step) + 1, ch = Math.floor((g.h - 1 - y0) / step) + 1;
  const M = cw * ch;
  const cand = new Int32Array(M).fill(-1);
  let nc = 0;
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const c = (y0 + cy * step) * g.w + (x0 + cx * step);
    const z = g.z[c];
    if (z !== z) continue;
    if (g.slope && !(g.slope[c] <= maxSlope)) continue;
    cand[cy * cw + cx] = c; nc++;
  }
  // sample the 18 fields at lattice cells only (never keep full fields around)
  const outT = new Float32Array(n * M).fill(Infinity);   // lattice -> target j (loadOut)
  const homeT = new Float32Array(n * M).fill(Infinity);  // target j -> lattice (loadBack)
  const ttOut = new Float64Array(n * n), ttBack = new Float64Array(n * n);
  const mOut = p.bodyMass + p.suitMass + p.loadOut, mBack = p.bodyMass + p.suitMass + p.loadBack;
  for (let j = 0; j < n; j++) {
    const r = dijkstra(g, cells[j], mOut, p, true);           // cost of walking cell -> j
    for (let k = 0; k < M; k++) if (cand[k] >= 0) outT[j * M + k] = r.time[cand[k]];
    for (let i = 0; i < n; i++) ttOut[i * n + j] = r.time[cells[i]];
    yield (2 * j + 1) / (2 * n + 1);
    const f = dijkstra(g, cells[j], mBack, p, false);         // cost of walking j -> cell
    for (let k = 0; k < M; k++) if (cand[k] >= 0) homeT[j * M + k] = f.time[cand[k]];
    for (let i = 0; i < n; i++) ttBack[j * n + i] = f.time[cells[i]];
    yield (2 * j + 2) / (2 * n + 1);
  }
  const fieldsMs = performance.now() - t0;
  const tt: TTMatrix = { key: paramsKey(p, cells), ttOut, ttBack, ms: fieldsMs };

  // lean exact DP per candidate
  const t1 = performance.now();
  const T = budget.evaHours * 3600, L = T * (1 - budget.reservePct / 100) - DP_SLACK_S, W = budget.workMinPerStop * 60;
  const value = new Uint8Array(M).fill(255), slack = new Float32Array(M).fill(NaN);
  const ttMid = new Float64Array(n * n); for (let i = 0; i < n * n; i++) ttMid[i] = 0.5 * (ttOut[i] + ttBack[i]);
  const vals = targets.map((t) => t.value);
  const idx = new Int32Array(n), bo = new Float64Array(n), hm = new Float64Array(n);
  const dep = new Float64Array((1 << n) * n);
  for (let k = 0; k < M; k++) {
    if (cand[k] < 0) continue;
    // keep only targets whose solo out-and-back fits
    let m = 0;
    for (let j = 0; j < n; j++) {
      const o = outT[j * M + k], h = homeT[j * M + k];
      if (o + W + h <= L) { idx[m] = j; bo[m] = o; hm[m] = h; m++; }
    }
    if (!m) { value[k] = 0; continue; }
    const S2 = 1 << m;
    dep.fill(Infinity, 0, S2 * m);
    for (let a = 0; a < m; a++) dep[(1 << a) * m + a] = bo[a] + W;
    let bestV = 0, bestT = Infinity;
    for (let S = 1; S < S2; S++) {
      let v = 0; for (let a = 0; a < m; a++) if (S & (1 << a)) v += vals[idx[a]];
      for (let a = 0; a < m; a++) {
        const d = dep[S * m + a]; if (d === Infinity) continue;
        const tot = d + hm[a];
        if (v > bestV || (v === bestV && tot < bestT)) { bestV = v; bestT = tot; }
        const ia = idx[a] * n;
        for (let b = 0; b < m; b++) {
          if (S & (1 << b)) continue;
          const nd = d + ttMid[ia + idx[b]] + W;
          if (nd + hm[b] > L) continue;
          const q = (S | (1 << b)) * m + b;
          if (nd < dep[q]) dep[q] = nd;
        }
      }
    }
    value[k] = bestV; slack[k] = isFinite(bestT) ? (L + DP_SLACK_S - bestT) / T : NaN;
  }
  const dpMs = performance.now() - t1;

  // top sites: best value, then most slack, at least minSep apart; then the exact autopilot DP for each
  const order: number[] = [];
  for (let k = 0; k < M; k++) if (cand[k] >= 0 && value[k] > 0) order.push(k);
  order.sort((a, b) => value[b] - value[a] || slack[b] - slack[a]);
  const top: SiteCandidate[] = [];
  let checked = 0;
  for (const k of order) {
    if (top.length >= topK || checked >= topK * 4) break;
    const c = cand[k], x = c % g.w, y = (c / g.w) | 0;
    if (top.some((s) => Math.hypot((s.cell % g.w) - x, ((s.cell / g.w) | 0) - y) < minSep)) continue;
    checked++;
    const model: CostModel = { n, baseOut: new Float64Array(n), home: new Float64Array(n), ttOut, ttBack };
    for (let j = 0; j < n; j++) { model.baseOut[j] = outT[j * M + k]; model.home[j] = homeT[j * M + k]; }
    const r = planFromModel(model, targets, budget, 0);
    // re-route cell by cell exactly like the app will after "use"; take the best plan that passes (max 3 tries)
    const hT = homeField(g, c, p).time;
    let plan: Plan | null = null;
    for (const b of r.ranked.slice(0, 3)) {
      const v = verifyPlan(g, c, b.order.map((j) => cells[j]), p, budget, hT);
      if (v.pass) {
        let val = 0; for (const j of b.order) val += vals[j];
        plan = { stops: b.order, value: val, totalTime: b.total, walkTime: b.walk, minReserve: b.minRes, tightestStop: b.tight, verified: v };
        break;
      }
    }
    yield (2 * n + checked / (topK * 4)) / (2 * n + 1);
    if (!plan) continue; // skip sites whose plan does not survive the exact check
    top.push({ cell: c, value: plan.value, slack: slack[k], plan, stopsCells: plan.stops.map((j) => cells[j]) });
  }
  const maxValue = vals.reduce((s, v) => s + v, 0);
  return {
    result: { cw, ch, step, x0, y0, res: g.res, value, slack, maxValue, top, key: sitingKey(p, budget, targets, step),
              ms: performance.now() - t0, fieldsMs, dpMs, candidates: nc },
    tt,
  };
}

/** Run to completion (node precompute / tests). */
export function runSiting(g: Grid, targets: APTarget[], p: ExplorerParams, budget: APBudget, opt?: SitingOptions) {
  const it = sitingJob(g, targets, p, budget, opt);
  for (;;) { const s = it.next(); if (s.done) return s.value; }
}

// ---------------------------------------------------------------- rendering helpers for the map (lead integrates)
/** Rectangle (planning-grid cell units) at which to draw sitingCanvas(): ctx.drawImage(cv, r.x, r.y, r.w, r.h). */
export function sitingRect(s: Pick<SitingResult, 'cw' | 'ch' | 'step' | 'x0' | 'y0'>) {
  return { x: s.x0 - s.step / 2, y: s.y0 - s.step / 2, w: s.cw * s.step, h: s.ch * s.step };
}
/** Lattice-sized heatmap canvas (dark grey -> NASA blue -> light blue = more science). Draw it with smoothing on. */
export function sitingCanvas(s: Pick<SitingResult, 'cw' | 'ch' | 'value' | 'maxValue'>, alpha = 170): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = s.cw; c.height = s.ch;
  const ctx = c.getContext('2d')!; const im = ctx.createImageData(s.cw, s.ch);
  let vmax = 1; for (let i = 0; i < s.value.length; i++) if (s.value[i] !== 255 && s.value[i] > vmax) vmax = s.value[i];
  const stops: [number, number, number, number][] = [[0, 40, 40, 45], [0.4, 26, 68, 128], [0.75, 0, 94, 162], [0.9, 115, 179, 231], [1, 217, 232, 246]];
  for (let i = 0; i < s.value.length; i++) {
    const v = s.value[i]; if (v === 255) continue;
    const t = v / vmax; let k = 1; while (k < stops.length - 1 && t > stops[k][0]) k++;
    const a = stops[k - 1], b = stops[k], u = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    const o = i * 4;
    im.data[o] = a[1] + (b[1] - a[1]) * u; im.data[o + 1] = a[2] + (b[2] - a[2]) * u; im.data[o + 2] = a[3] + (b[3] - a[3]) * u;
    im.data[o + 3] = v === 0 ? 60 : alpha;
  }
  ctx.putImageData(im, 0, 0); return c;
}

// ---------------------------------------------------------------- precomputed file format (base_siting.bin/.json)
// bin: Uint8 value plane (cw*ch, 255 = not a candidate) followed by Uint8 slack plane (percent of T, 255 = none).
export interface SitingFileMeta extends Omit<SitingResult, 'value' | 'slack'> { file: string; params: ExplorerParams; budget: APBudget; generated: string; terrainFactor?: boolean }

export function decodeSiting(meta: SitingFileMeta, buf: ArrayBuffer): SitingResult {
  const M = meta.cw * meta.ch; const u = new Uint8Array(buf);
  const value = u.slice(0, M); const slack = new Float32Array(M);
  for (let i = 0; i < M; i++) slack[i] = u[M + i] === 255 ? NaN : u[M + i] / 100;
  return { ...meta, value, slack };
}
export function encodeSiting(r: SitingResult): Uint8Array {
  const M = r.cw * r.ch; const out = new Uint8Array(2 * M); out.set(r.value);
  for (let i = 0; i < M; i++) out[M + i] = isFinite(r.slack[i]) ? Math.max(0, Math.min(100, Math.round(r.slack[i] * 100))) : 255;
  return out;
}
