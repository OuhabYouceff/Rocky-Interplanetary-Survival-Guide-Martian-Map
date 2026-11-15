// Rocky note: copied unchanged from TETHER (upstream app/src/planner/risk.ts).
// Probabilistic tether: "what are my real chances of getting home?"
// Monte Carlo over the planned route + a closed-form per-cell probability map. Pure TS, no deps.
//
// Uncertainty model (shared with the RL advisor, pipeline/rl/README_rl.md has the full derivation):
//   actual elapsed = R * ( sum_legs nu_leg * walk_leg  +  sum_stops min(O_stop, cap) * work )
//   R      per-person rate multiplier, lognormal(median 1, sigma 0.154). Folds two DERIVED spreads into one
//          "suit-minutes" factor: metabolic rate CV 11.7% across 28 Apollo crewman-EVAs (Waligora & Horrigan 1975,
//          NASA SP-368 Table 2) and comfortable walking-speed CV ~10% in young adults (Bohannon 1997, Age Ageing 26:15).
//          Waligora & Horrigan report "a very poor correlation between traverse rate and metabolic rate", so the two
//          are combined as independent: sqrt(0.117^2 + 0.10^2) = 0.154.
//   nu     per-leg terrain/navigation factor, lognormal(median 1.07, sigma 0.15). ASSUMPTION informed by the Haughton-
//          Mars walkback study (Norcross et al. 2008, NASA NTRS 20080014286: terrain and navigation increased distance
//          by 7% on average, up to 21%; unsuited, 1 g, straight-line route). Applying that mean as a median on our
//          terrain-optimal path is our choice. sigma 0.15 is bracketed by that study's 22.7% traverse-time CV.
//   O      per-stop task-duration multiplier, lognormal(median 1, sigma 0.61), capped at 3x (timebox). Median 0 and
//          mean +20.5% deviation of Apollo 14-17 geology-station durations vs plan (Miller et al. 2017,
//          NASA/TP-2017-219457, Table 31) give sigma = sqrt(2 ln 1.205) = 0.61. A PROXY: Apollo station changes
//          include deliberate re-planning. The 3x cap is an ASSUMPTION (crew stops when told to).
//   SPE    solar-particle warnings arrive as a Poisson process, 0.087/day: 4 event clusters in the 46-day DONKI
//          window 2024-05-01..06-15 (app/public/data/space_weather.json). This is a near-Earth, solar-maximum STRESS
//          CASE, not a Mars climatology. After a warning the crew walks the fastest path home and is "flare-safe" if
//          they arrive within flareLeadMin (NASA 2024: particles reached Mars "in just tens of minutes").

export interface RiskModel {
  sigmaPerson: number; // lognormal sigma of R
  navMedian: number;   // median of nu (1 = walk exactly the planned path)
  sigmaLeg: number;    // lognormal sigma of nu
  sigmaTask: number;   // lognormal sigma of O
  taskCap: number;     // O is capped at this multiple of planned work time
  spePerDay: number;   // solar-particle warning rate
}

export const RISK_DEFAULTS: RiskModel = {
  sigmaPerson: 0.154, navMedian: 1.07, sigmaLeg: 0.15, sigmaTask: 0.61, taskCap: 3, spePerDay: 0.087,
};

/** No uncertainty at all: reproduces the deterministic summary.pass of the app (useful as a sanity check). */
export const RISK_DETERMINISTIC: RiskModel = { sigmaPerson: 0, navMedian: 1, sigmaLeg: 0, sigmaTask: 0, taskCap: 3, spePerDay: 0 };

export interface RiskBudget { evaHours: number; reservePct: number; workMinPerStop: number; flareLeadMin: number }
/** t = planned cumulative time (s, includes work at earlier stops), homeT = planned walk home from here (s).
 *  fastT = fastest (least-time) walk home (s); if missing, homeT is used (conservative for the storm check). */
export interface RiskPoint { t: number; homeT: number; fastT?: number }

export interface RiskResult {
  pHome: number;              // P(the plan as written ends back at the habitat before the suit budget runs out)
  pWithinReserve: number;     // P(the app's own rule holds: margin >= reserve everywhere AND total <= (1-reserve) budget)
  pFlareSafe: number;         // P(no SPE warning during the EVA, or a warning but home within the lead time)
  pFlareSafeIfWarning: number;// P(home within lead time | a warning arrives at a uniformly random moment of the EVA)
  pWarning: number;           // P(at least one SPE warning during the EVA) at model.spePerDay
  worstIndex: number;         // point index with the lowest perPoint probability
  perPoint: Float32Array;     // P(can still walk home within budget from this point) per route point
  endTime: { p10: number; p50: number; p90: number; mean: number }; // actual EVA duration (s)
  histogram: { binWidth: number; edges: number[]; counts: number[]; overflow: number }; // end time / budget
  samples: number; ms: number; model: RiskModel;
}

// ---------- RNG + normal helpers ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussFactory(rand: () => number) {
  let spare = NaN;
  return () => {
    if (spare === spare) { const s = spare; spare = NaN; return s; }
    let u = 0; while (u <= 1e-12) u = rand();
    const v = rand(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}
/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |err| < 1.5e-7). */
export function normCdf(x: number): number {
  const s = x < 0 ? -1 : 1; const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + s * y);
}

// ---------- Monte Carlo over a route ----------
export function riskForRoute(points: RiskPoint[], legsEnd: number[], budget: RiskBudget,
  opts: { samples?: number; seed?: number; model?: Partial<RiskModel>; maxPoints?: number } = {}): RiskResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const M: RiskModel = { ...RISK_DEFAULTS, ...opts.model };
  const S = opts.samples ?? 10000;
  const T = budget.evaHours * 3600, work = budget.workMinPerStop * 60, lead = budget.flareLeadMin * 60;
  const reserve = budget.reservePct / 100;
  const N = points.length;
  const empty = (): RiskResult => ({ pHome: NaN, pWithinReserve: NaN, pFlareSafe: NaN, pFlareSafeIfWarning: NaN, pWarning: NaN,
    worstIndex: -1, perPoint: new Float32Array(N), endTime: { p10: NaN, p50: NaN, p90: NaN, mean: NaN },
    histogram: { binWidth: 0.05, edges: [], counts: [], overflow: 0 }, samples: 0, ms: 0, model: M });
  if (N < 2 || !legsEnd.length) return empty();
  const ends = [...legsEnd].sort((a, b) => a - b);
  const nLegs = ends.length;

  // decimate (always keep leg starts/ends) so cost stays ~O(samples * maxPoints)
  const maxP = opts.maxPoints ?? 1200;
  const keep: number[] = [];
  const isKey = new Uint8Array(N); isKey[0] = 1; isKey[N - 1] = 1;
  for (const e of ends) { isKey[e] = 1; if (e + 1 < N) isKey[e + 1] = 1; }
  const stride = Math.max(1, Math.ceil(N / maxP));
  for (let i = 0; i < N; i++) if (isKey[i] || i % stride === 0) keep.push(i);
  const K = keep.length;

  // split planned time into walking (per leg) and work (per stop)
  const legOf = new Int32Array(K), walkInLeg = new Float64Array(K), home = new Float64Array(K), fast = new Float64Array(K);
  const legStartT = new Float64Array(nLegs), legWalk = new Float64Array(nLegs);
  { let L = 0, start = 0;
    for (let l = 0; l < nLegs; l++) {
      const s0 = l === 0 ? 0 : ends[l - 1] + 1;
      legStartT[l] = points[Math.min(s0, N - 1)].t; legWalk[l] = points[ends[l]].t - legStartT[l];
    }
    for (let k = 0; k < K; k++) {
      const i = keep[k];
      while (L < nLegs - 1 && i > ends[L]) L++;
      start = legStartT[L];
      legOf[k] = L; walkInLeg[k] = Math.max(0, points[i].t - start);
      home[k] = isFinite(points[i].homeT) ? points[i].homeT : 1e12;
      const f = points[i].fastT; fast[k] = f !== undefined && isFinite(f) ? f : home[k];
    }
  }

  const rand = mulberry32(opts.seed ?? 12345), gauss = gaussFactory(rand);
  const okCount = new Uint32Array(K);
  const nu = new Float64Array(nLegs), cum = new Float64Array(nLegs + 1);
  const actual = new Float64Array(K);
  const endT = new Float64Array(S);
  const binW = 0.05, nBins = 30; const counts = new Array(nBins).fill(0); let overflow = 0;
  let nHome = 0, nRes = 0, nFlareSafeIfW = 0, sumPWarn = 0, sumFlareSafe = 0;
  const lnNav = Math.log(M.navMedian), lam = M.spePerDay / 86400;

  for (let s = 0; s < S; s++) {
    const R = Math.exp(M.sigmaPerson * gauss());
    cum[0] = 0;
    for (let l = 0; l < nLegs; l++) {
      nu[l] = Math.exp(lnNav + M.sigmaLeg * gauss());
      const O = l < nLegs - 1 ? Math.min(Math.exp(M.sigmaTask * gauss()), M.taskCap) : 0;
      cum[l + 1] = cum[l] + nu[l] * legWalk[l] + O * work; // elapsed (before R) at the start of leg l+1
    }
    let minMargin = Infinity;
    for (let k = 0; k < K; k++) {
      const L = legOf[k];
      const a = R * (cum[L] + nu[L] * walkInLeg[k]);
      actual[k] = a;
      const need = a + R * nu[L] * home[k];
      if (need <= T) okCount[k]++;
      const m = (T - need) / T; if (m < minMargin) minMargin = m;
    }
    const end = actual[K - 1]; endT[s] = end;
    if (end <= T) nHome++;
    if (end <= T * (1 - reserve) && minMargin >= reserve) nRes++;
    const b = Math.floor(end / T / binW); if (b < nBins) counts[b]++; else overflow++;
    // storm: warning at a uniform moment of this EVA; walk the fastest path home
    const tw = rand() * end;
    let lo = 0, hi = K - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (actual[mid] < tw) lo = mid + 1; else hi = mid; }
    const safe = R * nu[legOf[lo]] * fast[lo] <= lead ? 1 : 0;
    nFlareSafeIfW += safe;
    const pW = 1 - Math.exp(-lam * end); sumPWarn += pW; sumFlareSafe += 1 - pW * (1 - safe);
  }

  // perPoint back on the full index
  const perPoint = new Float32Array(N);
  let worst = 0, worstP = Infinity;
  for (let k = 0; k < K; k++) {
    const p = okCount[k] / S;
    const i0 = keep[k], i1 = k + 1 < K ? keep[k + 1] : N;
    for (let i = i0; i < i1; i++) perPoint[i] = p;
    if (p < worstP) { worstP = p; worst = i0; }
  }
  const sorted = Array.from(endT).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(S - 1, Math.floor(f * S))];
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    pHome: nHome / S, pWithinReserve: nRes / S, pFlareSafe: sumFlareSafe / S, pFlareSafeIfWarning: nFlareSafeIfW / S,
    pWarning: sumPWarn / S, worstIndex: worst, perPoint,
    endTime: { p10: q(0.1), p50: q(0.5), p90: q(0.9), mean: sorted.reduce((a, b) => a + b, 0) / S },
    histogram: { binWidth: binW, edges: Array.from({ length: nBins + 1 }, (_, i) => +(i * binW).toFixed(2)), counts, overflow },
    samples: S, ms: t1 - t0, model: M,
  };
}

// ---------- closed form, per map cell ----------
/** If the round-trip time scales by a lognormal multiplier m ~ LN(mu, sigma):
 *  P(m * (outT + work + homeT) <= usable) = Phi((ln(usable / rt) - mu) / sigma). Returns 0 where unreachable. */
export function probTetherMap(outT: Float32Array, homeT: Float32Array, work: number, usable: number, sigma: number, mu = 0): Float32Array {
  const n = outT.length, out = new Float32Array(n);
  const sg = Math.max(sigma, 1e-9);
  for (let i = 0; i < n; i++) {
    const rt = outT[i] + work + homeT[i];
    out[i] = rt > 0 && isFinite(rt) ? normCdf((Math.log(usable / rt) - mu) / sg) : (rt === 0 ? 1 : 0);
  }
  return out;
}

/** E[min(X,c)] and E[min(X,c)^2] for X ~ LN(mu, s). */
function cappedLognormalMoments(mu: number, s: number, c: number): [number, number] {
  if (s < 1e-9) { const x = Math.min(Math.exp(mu), c); return [x, x * x]; }
  const lc = Math.log(c);
  const tail = 1 - normCdf((lc - mu) / s);
  const m1 = Math.exp(mu + s * s / 2) * normCdf((lc - mu - s * s) / s) + c * tail;
  const m2 = Math.exp(2 * mu + 2 * s * s) * normCdf((lc - mu - 2 * s * s) / s) + c * c * tail;
  return [m1, m2];
}

/** Fenton-Wilkinson lognormal for the actual time R * (nu * walk + O * work) under the model.
 *  Returns mu/sigma of ln(actual seconds), plus muRel = mu - ln(walk + work): the (mu, sigma) of the MULTIPLIER on the
 *  planned time, which is what probTetherMap expects: probTetherMap(outT, homeT, work, usable, r.sigma, r.muRel). */
export function roundTripLognormal(walk: number, work: number, model: Partial<RiskModel> = {}): { mu: number; muRel: number; sigma: number; mean: number } {
  const M = { ...RISK_DEFAULTS, ...model };
  const mn = Math.log(M.navMedian);
  const w1 = Math.exp(mn + M.sigmaLeg ** 2 / 2) * walk, w2 = Math.exp(2 * mn + 2 * M.sigmaLeg ** 2) * walk * walk;
  const [o1, o2] = work > 0 ? cappedLognormalMoments(0, M.sigmaTask, M.taskCap) : [0, 0];
  const m1 = w1 + o1 * work, v = (w2 - w1 * w1) + (o2 - o1 * o1) * work * work;
  if (m1 <= 0) return { mu: 0, muRel: 0, sigma: 0, mean: 0 };
  const s2 = Math.log(1 + v / (m1 * m1));
  const muS = Math.log(m1) - s2 / 2;
  const sigma = Math.sqrt(s2 + M.sigmaPerson ** 2);
  return { mu: muS, muRel: muS - Math.log(walk + work), sigma, mean: m1 * Math.exp(M.sigmaPerson ** 2 / 2) };
}

/** Per-cell P(walk out, work, walk home within `usable` seconds), with the full model applied cell by cell. */
export function probTetherMapModel(outT: Float32Array, homeT: Float32Array, work: number, usable: number,
  model: Partial<RiskModel> = {}): Float32Array {
  const M = { ...RISK_DEFAULTS, ...model };
  const n = outT.length, out = new Float32Array(n);
  const mn = Math.log(M.navMedian);
  const e1 = Math.exp(mn + M.sigmaLeg ** 2 / 2), e2 = Math.exp(2 * mn + 2 * M.sigmaLeg ** 2);
  const [o1, o2] = work > 0 ? cappedLognormalMoments(0, M.sigmaTask, M.taskCap) : [0, 0];
  const wm = o1 * work, wv = (o2 - o1 * o1) * work * work, sp2 = M.sigmaPerson ** 2;
  for (let i = 0; i < n; i++) {
    const walk = outT[i] + homeT[i];
    if (!isFinite(walk)) { out[i] = 0; continue; }
    const m1 = e1 * walk + wm;
    if (m1 <= 0) { out[i] = 1; continue; }
    const v = (e2 - e1 * e1) * walk * walk + wv;
    const s2 = Math.log(1 + v / (m1 * m1));
    const sg = Math.sqrt(s2 + sp2);
    out[i] = sg < 1e-9 ? (m1 <= usable ? 1 : 0) : normCdf((Math.log(usable) - (Math.log(m1) - s2 / 2)) / sg);
  }
  return out;
}

/** Convenience: build RiskPoints/legsEnd from the app's RouteSummary points + Fields. */
export function riskInputsFromSummary(points: { cell: number; t: number; leg: number }[], homeT: Float32Array, fastT?: Float32Array) {
  const pts: RiskPoint[] = points.map((p) => ({ t: p.t, homeT: homeT[p.cell], fastT: fastT ? fastT[p.cell] : undefined }));
  const legsEnd: number[] = [];
  for (let i = 0; i < points.length; i++) if (i === points.length - 1 || points[i + 1].leg !== points[i].leg) legsEnd.push(i);
  return { points: pts, legsEnd };
}
