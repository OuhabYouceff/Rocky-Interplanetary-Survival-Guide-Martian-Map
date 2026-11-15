// EVA autopilot: which science targets to visit, in what order, so that science is maximised while the
// Apollo walk-back rule holds at every point of the walk.
//
// This is an orienteering problem. With n targets (11 in science_targets.json today) it is solved EXACTLY by
// dynamic programming over subsets (Held-Karp style, 2^n * n states; 2^11 * 11 ~ 22.5 k for 11 targets):
//   dep[S][j] = earliest time the crew can LEAVE target j (science work done) having visited exactly the set S.
// The earliest departure dominates every later one (all constraints are "elapsed + something <= limit"),
// so keeping only the minimum per (S, j) loses no feasible plan.
// Rule enforced at every stop:
//   departure_j + walkHome_j <= T * (1 - reserve)      (T = EVA duration; the final return is the last case)
// and the winning plan is then re-routed cell by cell with the exact app physics (verifyPlan), which checks the
// same margin at EVERY cell of the path, exactly like summarize() does after onApply.
// Costs: least-ENERGY routes (same objective as the app's route planner), constrained on the TIME they take.
// In the Santee/Marquez model speed depends on slope only, so load changes which path is least-effort (and the
// kcal) but not walking speed. Sample mass accumulates exactly as in usePlanner: after k of n stops the crew
// carries loadOut + k * (loadBack - loadOut) / n; target-to-target leg times are interpolated between fields
// computed at loadOut and loadBack. The first leg uses outField(base) (loadOut) and the walk home uses
// homeField(base) (loadBack): the very fields the app uses for its reserve map and verdict.
import { dijkstra, homeField, outField, route, type Grid } from './fields';
import type { ExplorerParams } from './physics';

// ---------------------------------------------------------------- science value (editable)
/** Science value per target, 1-10. Drill sites (fresh powder for CheMin/SAM) outrank imaging-only stops.
 *  Rationale strings come from the target descriptions in science_targets.json (NASA Curiosity blog). */
export const SCIENCE_TABLE: Record<string, { value: number; why: string }> = {
  'nevado-sajama': { value: 10, why: 'Ridge-top drill, re-drilled for organics (TMAH): the cemented-ridge half of the boxwork experiment' },
  'monte-grande-valle-de-la-luna': { value: 9, why: 'Hollow-floor drill 10 m from the ridge: the other half of the ridge-vs-hollow comparison' },
  'altadena': { value: 8, why: 'First drill sample of the boxwork unit: the "before" reference' },
  'nazca': { value: 8, why: 'Drill in a block of crystal pseudomorphs grown from salty water' },
  'campo-marte': { value: 7, why: 'Drill in the layered-sulfate bedrock above the boxwork' },
  'basque-lakes': { value: 6, why: 'Recent drill (CheMin + SAM) with ripples and gray pebbles in the workspace' },
  'mammoth-lakes': { value: 6, why: 'Gediz Vallis channel drill: rubble carried down from far up the mountain' },
  'antofagasta-crater': { value: 5, why: 'Young crater, possible organics, but sand-filled: imaging and grab samples, no drill' },
  'kings-canyon': { value: 4, why: 'Well-studied drill site already analysed by Curiosity: a reference stop' },
  'ayopaya': { value: 7, why: 'Three ridges meet: cross-cutting order dates the groundwater events (no drill, mapping and contact science)' },
  'sulfate-contact': { value: 5, why: 'Where the boxwork ends against the sulfate layers: upper boundary of the event, imaging and grab samples' },
};
const TYPE_DEFAULT: Record<string, number> = { drill_site: 7, crater: 5 };

export function slugOf(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function tableHit(t: { id?: string; name: string }) {
  const key = t.id ?? slugOf(t.name);
  return SCIENCE_TABLE[key] ?? Object.entries(SCIENCE_TABLE).find(([k]) => key.startsWith(k) || k.startsWith(key))?.[1];
}
/** Value for a target from science_targets.json (uses `id`, falls back to name slug, then target type). */
export function scienceValue(t: { id?: string; name: string; type?: string }): number {
  const hit = tableHit(t);
  return hit ? hit.value : TYPE_DEFAULT[t.type ?? ''] ?? 4;
}
export function scienceWhy(t: { id?: string; name: string }): string { return tableHit(t)?.why ?? ''; }

// ---------------------------------------------------------------- types
export interface APTarget { id: string; name: string; cell: number; value: number }
export interface APBudget { evaHours: number; reservePct: number; workMinPerStop: number }

/** Leg times (s). n = number of targets. */
export interface CostModel {
  n: number;
  baseOut: Float64Array;   // base -> j at loadOut mass (first leg)
  home: Float64Array;      // j -> base at loadBack mass (walk-home rule + final leg)
  ttOut: Float64Array;     // i -> j at loadOut mass, row-major n*n
  ttBack: Float64Array;    // i -> j at loadBack mass
}

export interface Plan {
  stops: number[];          // target indices in visiting order
  value: number;
  totalTime: number;        // s, back at the habitat (DP estimate)
  walkTime: number;         // s
  minReserve: number;       // fraction of T left at the tightest stop (DP estimate)
  tightestStop: number;     // index into stops (or -1)
  why?: string;             // one-line comparison with the optimum
  verified?: { pass: boolean; totalTime: number; minMargin: number; energy: number; distance: number };
}

export interface AutopilotResult {
  feasible: boolean;
  best: Plan | null;
  runnersUp: Plan[];
  excluded: { target: number; reason: string }[];
  limit: number;            // s, T * (1 - reserve)
  T: number;
  statesExplored: number;
  ms: number;
  notes: string[];
}

const INF = Infinity;
/** Seconds of slack kept in the DP so knife-edge plans do not flip to FAIL in the cell-by-cell check. */
export const DP_SLACK_S = 20;

// ---------------------------------------------------------------- exact subset DP
export interface SubsetBest { S: number; total: number; order: number[]; minRes: number; tight: number; walk: number }

const POPC = (() => { const a = new Uint8Array(1 << 12); for (let s = 1; s < a.length; s++) a[s] = a[s >> 1] + (s & 1); return a; })();

/**
 * Exact DP. For each final plan size n the sample mass per stop is (loadBack-loadOut)/n, as in the app,
 * so we run one DP per n (cheap: n * 2^n * n^2, ~2.7 M transitions for n = 11). Returns the best order per feasible subset.
 * limit: seconds the plan must fit in (default T*(1-reserve) - DP_SLACK_S). Pass Infinity for an unconstrained solve.
 */
export function solveSubsets(m: CostModel, budget: APBudget, limit?: number): { best: Map<number, SubsetBest>; states: number } {
  const N = m.n, T = budget.evaHours * 3600, W = budget.workMinPerStop * 60;
  const L = limit ?? T * (1 - budget.reservePct / 100) - DP_SLACK_S;
  const S2 = 1 << N;
  const dep = new Float64Array(S2 * N), walk = new Float64Array(S2 * N);
  const par = new Int8Array(S2 * N);
  const best = new Map<number, SubsetBest>();
  let states = 0;
  const backtrack = (S: number, last: number) => {
    const out: number[] = []; let s = S, j = last;
    while (j >= 0) { out.push(j); const p = par[s * N + j]; s &= ~(1 << j); j = p; }
    return out.reverse();
  };
  for (let n = 1; n <= N; n++) {
    dep.fill(INF);
    for (let j = 0; j < N; j++) {
      const d = m.baseOut[j] + W, k = (1 << j) * N + j;
      if (d + m.home[j] <= L) { dep[k] = d; walk[k] = m.baseOut[j]; par[k] = -1; }
    }
    for (let S = 1; S < S2; S++) {
      const k = POPC[S]; if (k > n) continue;
      for (let i = 0; i < N; i++) {
        const di = dep[S * N + i]; if (di === INF) continue;
        states++;
        if (k === n) {
          const total = di + m.home[i];
          const cur = best.get(S);
          if (!cur || total < cur.total) best.set(S, { S, total, order: backtrack(S, i), minRes: 0, tight: -1, walk: walk[S * N + i] + m.home[i] });
          continue;
        }
        const a = k / n; // fraction of the sample load already collected
        for (let j = 0; j < N; j++) {
          if (S & (1 << j)) continue;
          const leg = (1 - a) * m.ttOut[i * N + j] + a * m.ttBack[i * N + j];
          if (leg === INF) continue;
          const d = di + leg + W;
          if (d + m.home[j] > L) continue;
          const t2 = (S | (1 << j)) * N + j;
          if (d < dep[t2]) { dep[t2] = d; walk[t2] = walk[S * N + i] + leg; par[t2] = i; }
        }
      }
    }
  }
  for (const b of best.values()) { const t = timeline(m, b.order, budget); b.minRes = t.minRes; b.tight = t.tight; }
  return { best, states };
}

/** Elapsed-time timeline of an ordered plan with the model's mass interpolation. */
export function timeline(m: CostModel, order: number[], budget: APBudget) {
  const N = m.n, T = budget.evaHours * 3600, W = budget.workMinPerStop * 60, n = order.length;
  let t = 0, walk = 0, minRes = 1, tight = -1;
  for (let k = 0; k < n; k++) {
    const j = order[k];
    const leg = k === 0 ? m.baseOut[j] : (1 - k / n) * m.ttOut[order[k - 1] * N + j] + (k / n) * m.ttBack[order[k - 1] * N + j];
    t += leg + W; walk += leg;
    const r = (T - t - m.home[j]) / T;
    if (r < minRes) { minRes = r; tight = k; }
  }
  const total = n ? t + m.home[order[n - 1]] : 0;
  return { total, walk: walk + (n ? m.home[order[n - 1]] : 0), minRes, tight };
}

export const fmtMin = (s: number) => {
  if (!isFinite(s)) return '—';
  if (Math.abs(s) < 30) return '<1 min';
  const mm = Math.round(Math.abs(s) / 60); const h = Math.floor(mm / 60);
  return h ? `${h} h ${String(mm % 60).padStart(2, '0')} min` : `${mm} min`;
};
export const shortName = (name: string) => name.replace(/\s*\(.*\)\s*/g, '').trim();

/** Rank all feasible subsets, explain the trade-offs. Pure function of the cost model. */
export function planFromModel(m: CostModel, targets: APTarget[], budget: APBudget, maxRunnerUps = 4): AutopilotResult & { ranked: SubsetBest[] } {
  const t0 = performance.now();
  const T = budget.evaHours * 3600, L = T * (1 - budget.reservePct / 100), W = budget.workMinPerStop * 60;
  const { best, states } = solveSubsets(m, budget);
  const valueOf = (S: number) => { let v = 0; for (let j = 0; j < m.n; j++) if (S & (1 << j)) v += targets[j].value; return v; };
  const ranked = [...best.values()].sort((x, y) => valueOf(y.S) - valueOf(x.S) || x.total - y.total);
  const toPlan = (b: SubsetBest): Plan => ({ stops: b.order, value: valueOf(b.S), totalTime: b.total, walkTime: b.walk, minReserve: b.minRes, tightestStop: b.tight });
  const notes: string[] = [];
  const excluded: AutopilotResult['excluded'] = [];
  const soloReason = (j: number) => {
    const solo = m.baseOut[j] + W + m.home[j];
    if (!isFinite(solo)) return 'No safe walking path from the habitat (slopes over the limit)';
    return `Out of range: even alone it needs ${fmtMin(solo)} (walk ${fmtMin(m.baseOut[j] + m.home[j])} + work), the limit is ${fmtMin(L)}`;
  };
  if (!ranked.length) {
    for (let j = 0; j < m.n; j++) excluded.push({ target: j, reason: soloReason(j) });
    return { feasible: false, best: null, runnersUp: [], excluded, limit: L, T, statesExplored: states, ms: performance.now() - t0, notes, ranked };
  }
  const top = ranked[0];
  const bestPlan = toPlan(top);
  bestPlan.why = `Highest science value that keeps the ${budget.reservePct}% walk-home reserve at every stop`;
  const runnersUp = pickRunnerUps(top, ranked, best, maxRunnerUps).map((b) => { const p = toPlan(b); p.why = diffWhy(top, b); return p; });

  // why each unvisited target was left out: exact unconstrained solve of (optimum + that target)
  const free = solveSubsets(m, budget, Infinity).best;
  for (let j = 0; j < m.n; j++) {
    if (top.S & (1 << j)) continue;
    const solo = m.baseOut[j] + W + m.home[j];
    if (!isFinite(solo) || solo > L) { excluded.push({ target: j, reason: soloReason(j) }); continue; }
    const withJ = free.get(top.S | (1 << j));
    if (!withJ) { excluded.push({ target: j, reason: 'Cannot be chained with the chosen stops' }); continue; }
    const extra = withJ.total - top.total;
    const cost = `Adding it costs ${fmtMin(extra)} (${fmtMin(W)} work + ${fmtMin(Math.max(0, extra - W))} walking)`;
    if (withJ.total > L) {
      excluded.push({ target: j, reason: `${cost}: back ${fmtMin(withJ.total - L)} after the ${budget.reservePct}% reserve line` });
    } else if (withJ.total > L - DP_SLACK_S) {
      excluded.push({ target: j, reason: `${cost}: it would end less than ${DP_SLACK_S} s before the ${budget.reservePct}% reserve line, too tight to trust` });
    } else {
      excluded.push({ target: j, reason: `Adding it fits the total (+${fmtMin(extra)}), but in every order the walk-back reserve drops below ${budget.reservePct}% at a far stop` });
    }
  }
  return { feasible: true, best: bestPlan, runnersUp, excluded, limit: L, T, statesExplored: states, ms: performance.now() - t0, notes, ranked };

  function diffWhy(a: SubsetBest, b: SubsetBest) {
    const dropped: string[] = [], added: string[] = [];
    for (let j = 0; j < m.n; j++) {
      const ia = !!(a.S & (1 << j)), ib = !!(b.S & (1 << j));
      if (ia && !ib) dropped.push(`${shortName(targets[j].name)} (−${targets[j].value})`);
      if (!ia && ib) added.push(`${shortName(targets[j].name)} (+${targets[j].value})`);
    }
    const dt = b.total - a.total, dv = valueOf(b.S) - valueOf(a.S);
    const head = dropped.length && added.length ? `Swapping ${dropped.join(', ')} for ${added.join(', ')}`
      : dropped.length ? `Dropping ${dropped.join(', ')}` : added.length ? `Adding ${added.join(', ')}` : 'Same stops, other order';
    const time = Math.abs(dt) < 30 ? 'takes the same time' : dt < 0 ? `saves ${fmtMin(-dt)}` : `costs ${fmtMin(dt)} more`;
    return `${head} ${time}, ${dv < 0 ? '−' : '+'}${Math.abs(dv)} pts`;
  }
}

/** Runner-ups worth showing: the best "optimum minus one stop" (biggest time saving per point lost), then the
 *  best MAXIMAL feasible subsets (no feasible superset), i.e. genuinely different plans, not trimmed copies. */
function pickRunnerUps(top: SubsetBest, ranked: SubsetBest[], best: Map<number, SubsetBest>, k: number): SubsetBest[] {
  const out: SubsetBest[] = [];
  let drop: SubsetBest | null = null, dropScore = -INF;
  for (let j = 0; j < 16; j++) {
    if (!(top.S & (1 << j))) continue;
    const b = best.get(top.S & ~(1 << j)); if (!b) continue;
    const s = (top.total - b.total); // seconds saved
    if (s > dropScore) { dropScore = s; drop = b; }
  }
  const N = Math.max(...ranked.map((r) => 32 - Math.clz32(r.S)));
  const maximal = (S: number) => { for (let j = 0; j < N; j++) if (!(S & (1 << j)) && best.has(S | (1 << j))) return false; return true; };
  for (const r of ranked) {
    if (out.length >= k - (drop ? 1 : 0)) break;
    if (r.S === top.S || r === drop) continue;
    if (maximal(r.S)) out.push(r);
  }
  if (drop) out.push(drop);
  return out;
}

// ---------------------------------------------------------------- cost model from the terrain
export interface TTMatrix { key: string; ttOut: Float64Array; ttBack: Float64Array; ms: number }

export function paramsKey(p: ExplorerParams, cells: number[]): string {
  return JSON.stringify([p.bodyMass, p.suitMass, p.loadOut, p.loadBack, p.g, p.maxSlopeDeg, p.maxSpeed, p.levelGravityScaling, cells]);
}

/** Target-to-target leg times at loadOut and loadBack. Independent of base and budget: cache it. */
export function targetMatrix(g: Grid, cells: number[], p: ExplorerParams): TTMatrix {
  const t0 = performance.now(), n = cells.length;
  const ttOut = new Float64Array(n * n), ttBack = new Float64Array(n * n);
  const mOut = p.bodyMass + p.suitMass + p.loadOut, mBack = p.bodyMass + p.suitMass + p.loadBack;
  for (let i = 0; i < n; i++) {
    const fo = dijkstra(g, cells[i], mOut, p, false, -1, undefined, 'energy', cells);
    const fb = mBack === mOut ? fo : dijkstra(g, cells[i], mBack, p, false, -1, undefined, 'energy', cells);
    for (let j = 0; j < n; j++) { ttOut[i * n + j] = fo.time[cells[j]]; ttBack[i * n + j] = fb.time[cells[j]]; }
  }
  return { key: paramsKey(p, cells), ttOut, ttBack, ms: performance.now() - t0 };
}

/** Base-dependent legs from the app's own fields (outField / homeField). Returns homeT for verifyPlan. */
export function buildModel(g: Grid, base: number, cells: number[], p: ExplorerParams, tt: TTMatrix) {
  const out = outField(g, base, p), hf = homeField(g, base, p);
  const n = cells.length;
  const baseOut = new Float64Array(n), home = new Float64Array(n);
  for (let j = 0; j < n; j++) { baseOut[j] = out.time[cells[j]]; home[j] = hf.time[cells[j]]; }
  const model: CostModel = { n, baseOut, home, ttOut: tt.ttOut, ttBack: tt.ttBack };
  return { model, homeT: hf.time };
}

// ---------------------------------------------------------------- exact verification (app physics, every cell)
/**
 * Re-route a plan exactly as the app will after onApply (usePlanner 'route' + summarize): least-energy legs with
 * the per-leg mass, then margin = (T - t - homeT[cell]) / T at EVERY cell of the path.
 */
export function verifyPlan(g: Grid, base: number, stopCells: number[], p: ExplorerParams, budget: APBudget, homeT: Float32Array) {
  const T = budget.evaHours * 3600, W = budget.workMinPerStop * 60, r = budget.reservePct / 100;
  const per = stopCells.length ? Math.max(0, p.loadBack - p.loadOut) / stopCells.length : 0;
  const seq = [base, ...stopCells, base];
  let mass = p.bodyMass + p.suitMass + p.loadOut, tOff = 0, eOff = 0, dist = 0, minMargin = Infinity;
  for (let i = 0; i < seq.length - 1; i++) {
    const rt = route(g, seq[i], seq[i + 1], mass, p);
    if (!rt) return { pass: false, totalTime: Infinity, minMargin: -Infinity, energy: Infinity, distance: Infinity };
    for (let k = 0; k < rt.cells.length; k++) {
      const c = rt.cells[k];
      if (k > 0) { const pc = rt.cells[k - 1]; dist += Math.hypot((c % g.w) - (pc % g.w), ((c / g.w) | 0) - ((pc / g.w) | 0)) * g.res; }
      const mg = (T - (tOff + rt.time[k]) - homeT[c]) / T;
      if (mg < minMargin) minMargin = mg;
    }
    tOff += rt.time[rt.time.length - 1]; eOff += rt.energy[rt.energy.length - 1];
    if (i < seq.length - 2) tOff += W;
    if (i < stopCells.length) mass += per;
  }
  return { pass: minMargin >= r && tOff <= T * (1 - r), totalTime: tOff, minMargin, energy: eOff, distance: dist };
}

/** Full live autopilot: DP + cell-by-cell verification, walking down the ranking until a plan verifies. */
export function runAutopilot(g: Grid, base: number, targets: APTarget[], p: ExplorerParams, budget: APBudget,
                             tt: TTMatrix, maxVerify = 6): AutopilotResult & { matrixMs: number; fieldsMs: number; verifyMs: number } {
  const t0 = performance.now();
  const cells = targets.map((t) => t.cell);
  const { model, homeT } = buildModel(g, base, cells, p, tt);
  const t1 = performance.now();
  const res = planFromModel(model, targets, budget);
  let verifyMs = 0;
  if (res.best) {
    // verify the optimum; if the exact check disagrees, walk down the ranking (cap maxVerify)
    const tv = performance.now();
    const order = [res.best, ...res.ranked.slice(1).map((b) => ({ stops: b.order } as Plan))];
    let chosen: Plan | null = null, tries = 0;
    for (const cand of order) {
      if (tries++ >= maxVerify) break;
      const v = verifyPlan(g, base, cand.stops.map((j) => cells[j]), p, budget, homeT);
      if (cand === res.best) res.best.verified = v;
      if (v.pass) {
        if (cand !== res.best) {
          const b = res.ranked.find((r) => r.order === cand.stops)!;
          let value = 0; for (const j of b.order) value += targets[j].value;
          chosen = { stops: b.order, value, totalTime: b.total, walkTime: b.walk, minReserve: b.minRes, tightestStop: b.tight, verified: v,
                     why: `The DP optimum failed the cell-by-cell check (margin ${Math.round((res.best.verified?.minMargin ?? 0) * 100)}%); this is the best plan that passes` };
          res.notes.push('Optimum demoted after exact re-routing; showing the best verified plan.');
        } else chosen = res.best;
        break;
      }
    }
    if (!chosen && res.best.verified && !res.best.verified.pass) {
      res.best.why = `Fails the exact cell-by-cell check (min margin ${Math.round(res.best.verified.minMargin * 100)}%) and none of the next ${maxVerify - 1} plans pass: add reserve or remove a far stop`;
      res.notes.push('No verified plan within the check cap.');
    }
    if (chosen && chosen !== res.best) {
      const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      res.runnersUp = [res.best, ...res.runnersUp.filter((r) => !same(r.stops, chosen!.stops))];
      res.best = chosen;
    }
    // verify runner-ups too (cheap: a few leg routes each) so the panel can show PASS/FAIL honestly
    for (const r of res.runnersUp) if (!r.verified) r.verified = verifyPlan(g, base, r.stops.map((j) => cells[j]), p, budget, homeT);
    verifyMs = performance.now() - tv;
  }
  return { ...res, ms: performance.now() - t0, matrixMs: tt.ms, fieldsMs: t1 - t0, verifyMs };
}
