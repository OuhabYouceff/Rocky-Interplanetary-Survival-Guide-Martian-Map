// "AI advisor": continue / extend / turn back now, from the exact MDP policy solved offline (pipeline/rl/, README_rl.md).
// The ACTION comes from the policy table (backward induction over the EVA MDP). The NUMBERS shown with it (expected
// science, P(home), P(flare-safe)) are NOT read from the DP: they come from a small Monte Carlo rollout of that policy
// from the current state, using the same uncertainty model as risk.ts with the person's rate drawn inside their telemetry
// band. We measured the DP's own P(home) to be over-confident in the band tails, so we do not show it.
// Rocky note: copied unchanged from TETHER (upstream app/src/planner/rlAdvisor.ts). The policy table in
// public/data/rl_policy.json was solved for TETHER's habitat and its 9 targets; Rocky's 2 newer targets (Ayopaya,
// Sulfate unit contact) are not in it, so the UI gives no advice at those stops.
import { gaussFactory, mulberry32, normCdf } from './risk';

export const RL_POLICY_URL = 'data/rl_policy.json';

interface RawPolicy {
  model: {
    sigma_person: number; nav_median: number; sigma_leg: number; sigma_task: number; task_cap: number; spe_per_day: number;
    lead_min: number; work_min: number; ext_min: number; ext_frac: number; pen_fail: number; pen_storm: number; r_max: number;
    class_quantiles: number[]; blind_class: number; class_rate_multipliers: number[]; class_bounds: number[];
    physics: Record<string, number | boolean>;
  };
  locations: { id: string; name: string; cell: number; lon: number; lat: number; value?: number; value_rationale?: string; type?: string }[];
  travel_min: (number | null)[][][];
  fast_home_min: number[];
  table: { n_lm: number; n_cls: number; r_max_min: number; offsets_b64: string; runs_b64: string };
  comparison: unknown;
  [k: string]: unknown;
}

export interface RlPolicy {
  raw: RawPolicy;
  model: RawPolicy['model'];
  locations: RawPolicy['locations'];
  values: number[];         // science value per location (0 for the habitat)
  travel: number[][][];     // [massLevel 0..3][from][to] minutes, least-energy path (Infinity = unreachable)
  fastHome: number[];       // fastest walk home, minutes
  offsets: Uint32Array; runs: Uint16Array; nLm: number; nCls: number; rMax: number;
}

/** Advice is given at the habitat or at one of the 9 targets (not mid-leg). A target passed as `location` counts as
 *  already worked (its base 30 min of science is done); `extendedHere` says whether the +15 min extension was used. */
export interface AdvisorState {
  location: string | number;          // 'habitat' | target id | location index (0 = habitat, 1..9 = targets)
  visited?: (string | number)[];      // targets already worked (ids or indices)
  extendedHere?: boolean;             // already used "extend science here" at this stop
  elapsedMin?: number;                // EVA clock
  consumedMin?: number;               // suit minutes used (if telemetry gives it; default = elapsedMin)
  evaHours?: number;                  // suit budget (default 6; the table covers up to 8 h)
  rateMultiplier?: number;            // measured pace/metabolic rate vs plan (1 = nominal), picks the telemetry band
  rateClass?: number;                 // or give the band index directly (0 = fastest ... nCls-1 = slowest)
  storm?: boolean;                    // SPE warning received
  live?: { workMinPerStop?: number; flareLeadMin?: number; maxSpeed?: number; maxSlopeDeg?: number };
}

export interface Advice {
  action: 'go' | 'extend' | 'return' | 'stay' | 'over-budget';
  target?: { index: number; id: string; name: string };
  headline: string;                   // e.g. "Continue to Nevado Sajama" / "Turn back now"
  expectedScience: number;            // expected science RETURNED HOME (already collected + new), following the advisor
  expectedNewScience: number;         // expected additional science from here on (counted only if you get home)
  scienceSoFar: number;
  pHome: number;                      // P(back inside the habitat before the suit budget runs out), following the advisor
  pFlareSafe: number;                 // P(no SPE caught outside), following the advisor (at the modelled warning rate)
  pHomeIfReturnNow: number;
  alternative?: { label: string; expectedScience: number; pHome: number };
  explanation: string;
  warnings: string[];
  rateClass: number; remainingMin: number; samples: number;
}

// ---------------------------------------------------------------- loading
function b64bytes(b64: string): Uint8Array {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function parseRlPolicy(raw: RawPolicy): RlPolicy {
  const ob = b64bytes(raw.table.offsets_b64), rb = b64bytes(raw.table.runs_b64);
  const dvO = new DataView(ob.buffer), dvR = new DataView(rb.buffer);
  const offsets = new Uint32Array(ob.length / 4); for (let i = 0; i < offsets.length; i++) offsets[i] = dvO.getUint32(i * 4, true);
  const runs = new Uint16Array(rb.length / 2); for (let i = 0; i < runs.length; i++) runs[i] = dvR.getUint16(i * 2, true);
  return {
    raw, model: raw.model, locations: raw.locations,
    values: raw.locations.map((l) => l.value ?? 0),
    travel: raw.travel_min.map((m) => m.map((r) => r.map((x) => (x == null ? Infinity : x)))),
    fastHome: raw.fast_home_min, offsets, runs, nLm: raw.table.n_lm, nCls: raw.table.n_cls, rMax: raw.table.r_max_min,
  };
}

export async function loadRlPolicy(url?: string): Promise<RlPolicy> {
  const r = await fetch(url ?? import.meta.env.BASE_URL + RL_POLICY_URL);
  if (!r.ok) throw new Error('rl_policy.json: HTTP ' + r.status);
  return parseRlPolicy(await r.json());
}

// ---------------------------------------------------------------- table lookup
export function lmIndex(loc: number, mask: number): number {
  if (loc === 0) return 0;
  const k = loc - 1;
  const low = mask & ((1 << k) - 1), high = mask >> (k + 1);
  return 1 + k * 256 + (low | (high << k));
}
const popcount = (m: number) => { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; };

/** Policy action: 0 = home (stay at start), 1..9 = go to target k, 10 = extend. */
export function policyAction(P: RlPolicy, loc: number, mask: number, ext: number, cls: number, remainingMin: number): number {
  const r = Math.max(0, Math.min(P.rMax, Math.floor(remainingMin)));
  const row = (cls * 2 + (loc === 0 ? 0 : ext)) * P.nLm + lmIndex(loc, mask);
  let lo = P.offsets[row], hi = P.offsets[row + 1] - 1, ans = P.runs[lo] & 15;
  while (lo <= hi) { // last run with r_start <= r
    const mid = (lo + hi) >> 1; const rs = P.runs[mid] >> 4;
    if (rs <= r) { ans = P.runs[mid] & 15; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function classOfRate(P: RlPolicy, rate: number): number {
  let c = 0; while (c < P.model.class_bounds.length && rate >= P.model.class_bounds[c]) c++;
  return c;
}

export function locationIndex(P: RlPolicy, v: string | number): number {
  if (typeof v === 'number') return v;
  if (v === 'habitat') return 0;
  const i = P.locations.findIndex((l) => l.id === v || l.name === v || l.name.startsWith(v));
  if (i < 0) throw new Error('unknown location ' + v);
  return i;
}

/** Map an app cell (e.g. a stop snapped from science_targets.json) to a policy location index, or -1. */
export function locationForCell(P: RlPolicy, cell: number, w = 1066, maxCells = 4): number {
  let best = -1, bd = Infinity;
  P.locations.forEach((l, i) => {
    const dx = (l.cell % w) - (cell % w), dy = Math.floor(l.cell / w) - Math.floor(cell / w); const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = i; }
  });
  return bd <= maxCells ? best : -1;
}

// ---------------------------------------------------------------- rollout (mirrors pipeline/rl/mdp.py simulate)
interface Start { loc: number; mask: number; ext: number; remaining: number; cls: number; first?: number; sci0: number }

function rollout(P: RlPolicy, s: Start, samples: number, seed: number) {
  const M = P.model; const rand = mulberry32(seed), gauss = gaussFactory(rand);
  const lnNav = Math.log(M.nav_median), lam = M.spe_per_day / 1440;
  const zb = [-Infinity, ...M.class_quantiles.map(invNorm), Infinity];
  const plo = normCdf(zb[s.cls]), phi = normCdf(zb[s.cls + 1]);
  let sumSci = 0, sumNew = 0, nHome = 0, nUnsafe = 0;
  for (let n = 0; n < samples; n++) {
    // person's rate drawn inside their telemetry band
    const R = Math.exp(M.sigma_person * invNorm(plo + (phi - plo) * rand()));
    const W = lam > 0 ? -Math.log(1 - rand()) / lam : Infinity;
    let loc = s.loc, mask = s.mask, ext = s.ext, t = 0, sci = s.sci0, home = false, unsafe = false;
    const T = s.remaining; let first = s.first;
    for (let step = 0; step < 40; step++) {
      const mi = Math.min(popcount(mask), 3);
      const a = first !== undefined ? first : policyAction(P, loc, mask, ext, s.cls, T - t);
      first = undefined;
      if (a === 0) {
        if (loc === 0) { home = true; break; }
        const X = R * Math.exp(lnNav + M.sigma_leg * gauss()) * P.travel[mi][loc][0];
        if (W < t + X) {
          const F = P.fastHome[loc] * (1 - (W - t) / X);
          const f = R * Math.exp(lnNav + M.sigma_leg * gauss()) * F;
          unsafe = f > M.lead_min; t = W + f;
        } else t += X;
        home = t <= T; break;
      }
      if (a === 10) {
        const X = R * Math.min(Math.exp(M.sigma_task * gauss()), M.task_cap) * M.ext_min;
        if (W < t + X) { const f = R * Math.exp(lnNav + M.sigma_leg * gauss()) * P.fastHome[loc]; unsafe = f > M.lead_min; t = W + f; home = t <= T; break; }
        t += X; if (t > T) break;
        sci += M.ext_frac * P.values[loc]; ext = 1; continue;
      }
      const k = a, tau = P.travel[mi][loc][k];
      if (!isFinite(tau)) break;
      const trv = R * Math.exp(lnNav + M.sigma_leg * gauss()) * tau;
      const wk = R * Math.min(Math.exp(M.sigma_task * gauss()), M.task_cap) * M.work_min;
      if (W < t + trv + wk) {
        const u = Math.min(1, (W - t) / trv);
        const F = W < t + trv ? P.fastHome[loc] + u * (P.fastHome[k] - P.fastHome[loc]) : P.fastHome[k];
        const f = R * Math.exp(lnNav + M.sigma_leg * gauss()) * F;
        unsafe = f > M.lead_min; t = W + f; home = t <= T; break;
      }
      t += trv + wk; if (t > T) break;
      sci += P.values[k]; mask |= 1 << (k - 1); loc = k; ext = 0;
    }
    if (home) { nHome++; sumSci += sci; sumNew += sci - s.sci0; }
    if (unsafe) nUnsafe++;
  }
  return { expectedScience: sumSci / samples, expectedNew: sumNew / samples, pHome: nHome / samples, pFlareSafe: 1 - nUnsafe / samples };
}

/** Acklam's inverse normal CDF (|rel err| < 1.2e-9). */
function invNorm(p: number): number {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** P(R * nu * minutes <= limit), R ~ lognormal restricted to the telemetry band (32-point quadrature), nu = nav factor.
 *  Consistent with the rollout, which draws R the same way. */
function pWithin(P: RlPolicy, cls: number, minutes: number, limit: number): number {
  if (minutes <= 0) return 1; if (limit <= 0) return 0;
  const M = P.model;
  const zb = [-Infinity, ...M.class_quantiles.map(invNorm), Infinity];
  const plo = normCdf(zb[cls]), phi = normCdf(zb[cls + 1]);
  const n = 32; let acc = 0;
  for (let i = 0; i < n; i++) {
    const R = Math.exp(M.sigma_person * invNorm(plo + (phi - plo) * (i + 0.5) / n));
    acc += normCdf((Math.log(limit / (R * minutes)) - Math.log(M.nav_median)) / Math.max(M.sigma_leg, 1e-9));
  }
  return acc / n;
}

const fmtP = (p: number) => (p >= 0.9995 ? '>99.9%' : `${(p * 100).toFixed(p > 0.99 ? 2 : 1)}%`);

// ---------------------------------------------------------------- main entry
export function advise(P: RlPolicy, st: AdvisorState, opts: { samples?: number; seed?: number } = {}): Advice {
  const M = P.model; const warnings: string[] = [];
  const samples = opts.samples ?? 2000, seed = opts.seed ?? 4242;
  const loc = locationIndex(P, st.location);
  let mask = 0;
  for (const v of st.visited ?? []) { const k = locationIndex(P, v); if (k > 0) mask |= 1 << (k - 1); }
  if (loc > 0) mask |= 1 << (loc - 1);
  const ext = st.extendedHere ? 1 : 0;
  const budget = (st.evaHours ?? 6) * 60;
  const used = st.consumedMin ?? st.elapsedMin ?? 0;
  let remaining = budget - used;
  const cls = st.rateClass ?? (st.rateMultiplier !== undefined ? classOfRate(P, st.rateMultiplier) : M.blind_class);
  if (st.rateClass === undefined && st.rateMultiplier === undefined) warnings.push('No pace/metabolic telemetry given: assuming the nominal band (40-60%).');
  if (remaining > P.rMax) { warnings.push(`Policy solved up to ${P.rMax / 60} h of suit time; using the ${P.rMax / 60} h slice.`); remaining = P.rMax; }
  const L = st.live ?? {};
  if (L.workMinPerStop !== undefined && L.workMinPerStop !== M.work_min) warnings.push(`Policy assumes ${M.work_min} min of work per stop (you set ${L.workMinPerStop}).`);
  if (L.flareLeadMin !== undefined && L.flareLeadMin !== M.lead_min) warnings.push(`Policy assumes a ${M.lead_min} min SPE lead time (you set ${L.flareLeadMin}).`);
  if (L.maxSpeed !== undefined && L.maxSpeed !== M.physics.maxSpeed) warnings.push(`Travel times were computed with a ${M.physics.maxSpeed} m/s pace cap (you set ${L.maxSpeed}).`);
  if (L.maxSlopeDeg !== undefined && L.maxSlopeDeg !== M.physics.maxSlopeDeg) warnings.push(`Travel times were computed with a ${M.physics.maxSlopeDeg} deg slope limit (you set ${L.maxSlopeDeg}).`);
  let scienceSoFar = 0;
  for (let k = 1; k < P.locations.length; k++) if (mask & (1 << (k - 1))) scienceSoFar += P.values[k];
  if (ext && loc > 0) scienceSoFar += M.ext_frac * P.values[loc];
  const mi = Math.min(popcount(mask), 3);
  const homeMin = loc === 0 ? 0 : P.travel[mi][loc][0];
  const pHomeIfReturnNow = loc === 0 ? 1 : pWithin(P, cls, homeMin, remaining);
  const base = { scienceSoFar, rateClass: cls, remainingMin: remaining, samples, warnings, pHomeIfReturnNow };
  const sci0 = scienceSoFar;

  if (remaining <= 0) {
    return { ...base, action: 'over-budget', headline: 'Suit budget exceeded: walk home now on the fastest path', expectedScience: 0, expectedNewScience: 0,
      pHome: 0, pFlareSafe: NaN, explanation: 'The suit budget is already used up. Every minute counts: go straight home.' };
  }
  if (st.storm) {
    const fast = P.fastHome[loc];
    const pSafe = pWithin(P, cls, fast, M.lead_min), pHome = pWithin(P, cls, fast, remaining);
    return { ...base, action: loc === 0 ? 'stay' : 'return', headline: loc === 0 ? 'Stay in the habitat' : 'Solar storm: go home now (fastest path)',
      expectedScience: sci0 * pHome, expectedNewScience: 0, pHome, pFlareSafe: pSafe,
      explanation: loc === 0 ? 'Particles are on the way. The habitat is the shelter.'
        : `Particles expected in ~${M.lead_min} min. The fastest walk home from here is about ${Math.round(fast * M.class_rate_multipliers[cls])} min at your pace: P(inside before they arrive) ${fmtP(pSafe)}.` };
  }

  const a = policyAction(P, loc, mask, ext, cls, remaining);
  const follow = rollout(P, { loc, mask, ext, remaining, cls, sci0 }, samples, seed);
  let action: Advice['action'], headline: string, target: Advice['target'] | undefined, explanation: string;
  let alternative: Advice['alternative'] | undefined;
  if (a === 0) {
    action = loc === 0 ? 'stay' : 'return';
    headline = loc === 0 ? 'Stay home: no stop is worth the risk with this budget' : 'Turn back now';
    // alternative: the nearest unvisited reachable stop, then follow the advisor
    let alt = -1, best = Infinity;
    for (let k = 1; k < P.locations.length; k++) if (!(mask & (1 << (k - 1))) && P.travel[mi][loc][k] < best) { best = P.travel[mi][loc][k]; alt = k; }
    if (alt > 0) {
      const r = rollout(P, { loc, mask, ext, remaining, cls, first: alt, sci0 }, samples, seed + 1);
      alternative = { label: `Continue to ${P.locations[alt].name}`, expectedScience: r.expectedScience, pHome: r.pHome };
    }
    explanation = loc === 0 ? 'With this budget and pace, the expected science of any walk does not outweigh the risk of not getting home.'
      : `The walk home takes ~${Math.round(homeMin * M.class_rate_multipliers[cls])} min at your pace; you have ${Math.round(remaining)} suit-min left. ` +
        (alternative ? `Continuing to ${P.locations[alt].name.split(' (')[0]} would change the expected science brought home from ${follow.expectedScience.toFixed(1)} to ${alternative.expectedScience.toFixed(1)} points, with P(home) ${fmtP(alternative.pHome)} instead of ${fmtP(follow.pHome)}.` : 'Every target is done.');
  } else if (a === 10) {
    action = 'extend';
    headline = `Extend science here (+${M.ext_min} min)`;
    explanation = `You have time for ${M.ext_min} more minutes at ${P.locations[loc].name.split(' (')[0]}: it beats walking on to the next stop. ` +
      `If you follow the advisor: +${follow.expectedNew.toFixed(1)} expected science points (${follow.expectedScience.toFixed(1)} brought home in total), P(home) ${fmtP(follow.pHome)}.`;
  } else {
    action = 'go';
    target = { index: a, id: P.locations[a].id, name: P.locations[a].name };
    headline = `Continue to ${P.locations[a].name.split(' (')[0]}`;
    alternative = { label: loc === 0 ? 'Stay home' : 'Turn back now', expectedScience: sci0 * pHomeIfReturnNow, pHome: pHomeIfReturnNow };
    explanation = `${Math.round(P.travel[mi][loc][a] * M.class_rate_multipliers[cls])} min walk + ${M.work_min} min work (value ${P.values[a]}: ${P.locations[a].value_rationale ?? ''}). ` +
      `Following the advisor from here: +${follow.expectedNew.toFixed(1)} expected science points (${follow.expectedScience.toFixed(1)} brought home in total), P(home) ${fmtP(follow.pHome)}` +
      (loc === 0 ? '.' : `; turning back now: P(home) ${fmtP(pHomeIfReturnNow)}.`);
  }
  return { ...base, action, target, headline, expectedScience: follow.expectedScience, expectedNewScience: follow.expectedNew, pHome: follow.pHome, pFlareSafe: follow.pFlareSafe,
    alternative, explanation };
}
