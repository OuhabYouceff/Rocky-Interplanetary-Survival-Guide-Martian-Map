// Independent verification of the TETHER planner maths.
// Runs the app's real planner modules in Node and checks them against brute-force / hand-computed references.
// Build + run:  npx esbuild verify/verify.ts --bundle --platform=node --outfile=/tmp/verify.cjs && node /tmp/verify.cjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { speed, edgeCost, metabolicWatts, DEFAULT_PARAMS, G_EARTH, G_MARS, type ExplorerParams } from '../src/planner/physics';
import { dijkstra, homeField, outField, homeFastField, route, type Grid } from '../src/planner/fields';
import { planFromModel, targetMatrix, buildModel, verifyPlan, runAutopilot, scienceValue, DP_SLACK_S, type CostModel, type APBudget, type APTarget } from '../src/planner/autopilot';
import { runSiting } from '../src/planner/siting';
import { buildGround, type Thermal } from '../src/ground';
import { msd, marsNow } from '../src/marsclock';
import { buildK, syncLive, type Live } from '../src/game/adapter';
import { terrainClassFactors, terrainFactors, type Dataset, type TerrainClassMeta } from '../src/data';
import { useStore } from '../src/store';
import { riskForRoute, riskInputsFromSummary, probTetherMapModel, RISK_DETERMINISTIC } from '../src/planner/risk';
import { parseRlPolicy, policyAction, advise, locationForCell } from '../src/planner/rlAdvisor';
import { calibratedDose, type RouteSummary } from '../src/planner/summary';

let pass = 0, fail = 0;
const section = (s: string) => console.log(`\n=== ${s}`);
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const close = (a: number, b: number, rel = 1e-4, abs = 1e-6) => Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
// deterministic RNG
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const P = DEFAULT_PARAMS;
const M_OUT = P.bodyMass + P.suitMass + P.loadOut; // 155 kg

// ---------------------------------------------------------------- 1. physics
section('1. Walking physics (Marquez speed, Santee energy)');
{
  // continuity of the piecewise speed curve at every breakpoint
  let worst = 0;
  for (const b of [-20, -10, 0, 6, 15]) worst = Math.max(worst, Math.abs(speed(b - 1e-9) - speed(b + 1e-9)));
  check('speed curve is continuous at all breakpoints', worst < 1e-3, `max jump ${worst.toExponential(2)} m/s`);
  check('speed on flat ground = 1.6 m/s (Marquez peak)', close(speed(0), 1.6));
  let pos = true; for (let s = -20; s <= 20; s += 0.1) if (!(speed(s) > 0)) pos = false;
  check('speed > 0 for every allowed slope', pos);
  // NOTE: at 15° the curve gives 0.049 m/s, then a flat 0.050 m/s above it: a 1 mm/s bump at crawl speed (tolerated)
  let monoUp = true; for (let s = 0; s < 20; s += 0.1) if (speed(s + 0.1) > speed(s) + 2e-3) monoUp = false;
  check('uphill: steeper is never faster (1 mm/s tolerance at 15°)', monoUp);

  // hand-computed flat 3 m step, 155 kg
  const [e, t] = edgeCost(3, 0, M_OUT, P)!;
  const v = Math.min(1.6, P.maxSpeed);
  const eHand = (3.28 * M_OUT + 71.1) * (0.661 * 1 + 0.115 / v) * 3;
  check('flat 3 m step: time = 3 / 0.92 s', close(t, 3 / 0.92), `${t.toFixed(3)} s`);
  check('flat 3 m step: energy matches Santee formula by hand', close(e, eHand), `${e.toFixed(1)} J vs ${eHand.toFixed(1)} J`);
  const watts = e / t;
  check('metabolic power on the flat is physiologically plausible (200–600 W)', watts > 200 && watts < 600, `${watts.toFixed(0)} W`);

  // uphill: slope term is 3.5 * m * g * dz (work against gravity)
  const [eU] = edgeCost(3, 0.5, M_OUT, P)!;
  const sl = Math.atan2(0.5, 3), L = 3 / Math.cos(sl), deg = sl * 180 / Math.PI, vU = Math.min(speed(deg), P.maxSpeed);
  const levelU = (3.28 * M_OUT + 71.1) * (0.661 * Math.cos(sl) + 0.115 / vU) * L;
  check('uphill step: energy = level term + 3.5·m·g·Δz', close(eU, levelU + 3.5 * M_OUT * G_MARS * 0.5), `${eU.toFixed(1)} J`);

  // Pythagoras: path length along slope
  const [, tU] = edgeCost(3, 0.5, M_OUT, P)!;
  check('uphill step: time uses true slope length √(3²+0.5²)', close(tU, Math.hypot(3, 0.5) / vU));

  // slope limit
  check('20° is allowed, 20.1° is refused', edgeCost(3, 3 * Math.tan(20 * Math.PI / 180) - 1e-6, M_OUT, P) !== null && edgeCost(3, 3 * Math.tan(20.1 * Math.PI / 180), M_OUT, P) === null);

  // gravity: climbing is cheaper on Mars than on Earth; flat is identical (no gravity in level term by default)
  const earth = { ...P, g: G_EARTH };
  check('climbing 1 m costs less on Mars than on Earth', edgeCost(3, 1, M_OUT, P)![0] < edgeCost(3, 1, M_OUT, earth)![0]);
  check('flat walking cost does not depend on g (documented assumption)', close(edgeCost(3, 0, M_OUT, P)![0], edgeCost(3, 0, M_OUT, earth)![0]));
  check('optional level-gravity toggle scales flat cost by √(3.71/9.81)', close(edgeCost(3, 0, M_OUT, { ...P, levelGravityScaling: true })![0], eHand * Math.sqrt(G_MARS / G_EARTH)));

  // mass: heavier costs more energy but walking speed is unchanged
  const [eL, tL] = edgeCost(3, 0.3, 140 + P.loadOut, P)!, [eH, tH] = edgeCost(3, 0.3, 140 + P.loadBack, P)!;
  check('heavier load (25 kg vs 15 kg) costs more energy', eH > eL);
  check('heavier load does not change walking time (speed depends on slope only)', close(tL, tH));

  // non-negative edges (Dijkstra requirement), downhill floor
  let minE = Infinity; for (let dz = -1.09; dz <= 1.09; dz += 0.01) { const c = edgeCost(3, dz, M_OUT, P); if (c) minE = Math.min(minE, c[0]); }
  check('every edge cost is strictly positive (required for Dijkstra)', minE > 0, `min ${minE.toFixed(1)} J`);
}

// ---------------------------------------------------------------- 2. Dijkstra vs Bellman-Ford
section('2. Dijkstra least-cost fields vs brute-force Bellman-Ford');
function randomGrid(w: number, h: number, rough: number): Grid {
  const z = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) z[y * w + x] = 4 * Math.sin(x / 5) + 3 * Math.cos(y / 4) + rough * rnd();
  // a few holes (no data)
  for (let k = 0; k < (w * h) / 40; k++) z[(rnd() * w * h) | 0] = NaN;
  return { w, h, res: 3, z };
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
/** Plain Bellman-Ford over the same graph rules (independent of the heap / early-exit code). */
function bellmanFord(g: Grid, src: number, mass: number, p: ExplorerParams, reverse: boolean, byTime: boolean) {
  const N = g.w * g.h, E = new Float64Array(N).fill(Infinity), T = new Float64Array(N).fill(Infinity);
  E[src] = 0; T[src] = 0;
  for (let it = 0; it < N; it++) {
    let changed = false;
    for (let v = 0; v < N; v++) {
      if (!isFinite(E[v])) continue;
      const vx = v % g.w, vy = (v / g.w) | 0;
      for (let k = 0; k < 8; k++) {
        const ux = vx + DX[k], uy = vy + DY[k]; if (ux < 0 || uy < 0 || ux >= g.w || uy >= g.h) continue;
        const u = uy * g.w + ux; if (Number.isNaN(g.z[u])) continue;
        if (g.slope && g.slope[u] > p.maxSlopeDeg) continue;
        const c = edgeCost(k < 4 ? g.res : g.res * Math.SQRT2, reverse ? g.z[v] - g.z[u] : g.z[u] - g.z[v], mass, p); if (!c) continue;
        const ne = E[v] + c[0], nt = T[v] + c[1];
        if (byTime ? nt < T[u] - 1e-9 : ne < E[u] - 1e-9) { E[u] = ne; T[u] = nt; changed = true; }
      }
    }
    if (!changed) break;
  }
  return { E, T };
}
{
  let maxRelE = 0, maxRelT = 0, reach = 0, unreachMismatch = 0;
  for (let trial = 0; trial < 12; trial++) {
    const g = randomGrid(22, 18, 2.5 + trial * 0.4);
    const src = (() => { for (;;) { const c = (rnd() * g.w * g.h) | 0; if (!Number.isNaN(g.z[c])) return c; } })();
    const reverse = trial % 2 === 1, byTime = trial % 3 === 2;
    const d = dijkstra(g, src, M_OUT, P, reverse, -1, undefined, byTime ? 'time' : 'energy');
    const b = bellmanFord(g, src, M_OUT, P, reverse, byTime);
    for (let i = 0; i < g.w * g.h; i++) {
      if (isFinite(b.E[i]) !== isFinite(d.energy[i])) { unreachMismatch++; continue; }
      if (!isFinite(b.E[i])) continue; reach++;
      if (byTime) maxRelT = Math.max(maxRelT, Math.abs(d.time[i] - b.T[i]) / Math.max(1, b.T[i]));
      else maxRelE = Math.max(maxRelE, Math.abs(d.energy[i] - b.E[i]) / Math.max(1, b.E[i]));
    }
  }
  check('same reachable cells as brute force (12 random terrains)', unreachMismatch === 0, `${reach} reachable cells compared`);
  check('least-energy values match brute force', maxRelE < 1e-5, `max rel. error ${maxRelE.toExponential(2)}`);
  check('least-time values match brute force (storm mode)', maxRelT < 1e-5, `max rel. error ${maxRelT.toExponential(2)}`);

  // reverse field == forward cost from each cell to the base
  const g = randomGrid(25, 25, 3.5); const base = 12 * 25 + 12;
  const hf = dijkstra(g, base, M_OUT, P, true);
  let worst = 0, n = 0;
  for (let i = 0; i < g.w * g.h; i += 7) {
    if (!isFinite(hf.energy[i])) continue;
    const r = route(g, i, base, M_OUT, P); if (!r) { worst = Infinity; continue; }
    worst = Math.max(worst, Math.abs(r.energy[r.energy.length - 1] - hf.energy[i]) / hf.energy[i] || 0); n++;
  }
  check('walk-home field (reversed edges) = actually routing each cell → base', worst < 1e-5, `${n} cells, max rel. error ${worst.toExponential(2)}`);

  // route cost = sum of its edges
  const r = route(g, 0 + 2 * 25 + 2, 22 * 25 + 21, M_OUT, P)!;
  let s = 0; for (let k = 1; k < r.cells.length; k++) { const a = r.cells[k - 1], c = r.cells[k]; const diag = (a % 25) !== (c % 25) && ((a / 25) | 0) !== ((c / 25) | 0); s += edgeCost(diag ? 3 * Math.SQRT2 : 3, g.z[c] - g.z[a], M_OUT, P)![0]; }
  check('a route\'s reported energy equals the sum of its steps', close(s, r.energy[r.energy.length - 1], 1e-5), `${r.cells.length} cells`);
}

// ---------------------------------------------------------------- 3. Autopilot DP vs brute force
section('3. AI autopilot (subset DP) vs brute force over every ordered subset');
/** Independent brute force: try every ordered subset (pruned per final size n, since a prefix that already breaks the
 *  rule can never become feasible); same rules as the README / code comments. */
function bruteBest(m: CostModel, vals: number[], b: APBudget, L: number) {
  const N = m.n, W = b.workMinPerStop * 60;
  let best = -1, bestT = Infinity, bestOrder: number[] = [], count = 0;
  const used = new Array(N).fill(false), order: number[] = [];
  for (let n = 1; n <= N; n++) {
    const rec = (t: number) => {
      const k = order.length;
      if (k === n) {
        const total = t + m.home[order[n - 1]]; count++;
        const v = order.reduce((s, j) => s + vals[j], 0);
        if (v > best || (v === best && total < bestT - 1e-9)) { best = v; bestT = total; bestOrder = [...order]; }
        return;
      }
      for (let j = 0; j < N; j++) {
        if (used[j]) continue;
        const leg = k === 0 ? m.baseOut[j] : (1 - k / n) * m.ttOut[order[k - 1] * N + j] + (k / n) * m.ttBack[order[k - 1] * N + j];
        const t2 = t + leg + W;
        if (t2 + m.home[j] > L) continue; // walk-back rule at this stop
        used[j] = true; order.push(j); rec(t2); order.pop(); used[j] = false;
      }
    };
    rec(0);
  }
  return { value: best, total: bestT, order: bestOrder, feasibleSequences: count };
}
{
  const trials = 40; let agree = 0, totalOK = 0;
  for (let tr = 0; tr < trials; tr++) {
    const n = 4 + (tr % 5); // 4..8 targets
    const pts = Array.from({ length: n + 1 }, () => [rnd() * 3000, rnd() * 3000]);
    const d = (a: number, c: number) => Math.hypot(pts[a][0] - pts[c][0], pts[a][1] - pts[c][1]) / 0.8 * (1 + 0.3 * rnd());
    const m: CostModel = { n, baseOut: new Float64Array(n), home: new Float64Array(n), ttOut: new Float64Array(n * n), ttBack: new Float64Array(n * n) };
    for (let j = 0; j < n; j++) { m.baseOut[j] = d(0, j + 1); m.home[j] = d(j + 1, 0) * 1.05; for (let i = 0; i < n; i++) { const x = i === j ? 0 : d(i + 1, j + 1); m.ttOut[i * n + j] = x; m.ttBack[i * n + j] = x * 1.04; } }
    const vals = Array.from({ length: n }, () => 1 + ((rnd() * 10) | 0));
    const targets: APTarget[] = vals.map((v, i) => ({ id: 't' + i, name: 'T' + i, cell: i, value: v }));
    const budget: APBudget = { evaHours: 2 + (tr % 4), reservePct: 20, workMinPerStop: 20 + (tr % 3) * 10 };
    const L = budget.evaHours * 3600 * 0.8 - DP_SLACK_S;
    const dp = planFromModel(m, targets, budget);
    const bf = bruteBest(m, vals, budget, L);
    const dpVal = dp.best?.value ?? -1;
    if (dpVal === bf.value) agree++;
    if (dp.best && close(dp.best.totalTime, bf.total, 1e-6)) totalOK++;
    else if (!dp.best && bf.value < 0) totalOK++;
  }
  check(`DP finds the same best science value as brute force`, agree === trials, `${agree}/${trials} random problems (4–8 targets)`);
  check(`DP finds the same (fastest) total time for that value`, totalOK === trials, `${totalOK}/${trials}`);
}

// ---------------------------------------------------------------- 4. Real Mars terrain
section('4. Real Gale crater terrain (app/public/data)');
{
  const D = join(__dirname, '..', 'app', 'public', 'data');
  const Dalt = join(process.cwd(), 'public', 'data');
  const dir = (() => { try { readFileSync(join(Dalt, 'terrain.json')); return Dalt; } catch { return D; } })();
  const meta = JSON.parse(readFileSync(join(dir, 'terrain.json'), 'utf8'));
  const q = new Uint16Array(readFileSync(join(dir, 'elev.bin')).buffer.slice(0));
  const z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  const w = meta.w, h = meta.h, res = meta.res;
  check('elevation grid size matches metadata', z.length === w * h, `${w}×${h} = ${(w * h / 1e6).toFixed(2)} M cells`);
  let zmin = Infinity, zmax = -Infinity, nan = 0; for (const v of z) { if (Number.isNaN(v)) nan++; else { zmin = Math.min(zmin, v); zmax = Math.max(zmax, v); } }
  check('elevations are in Gale/Mount Sharp range (≈ −4000…−3300 m)', zmin > -4100 && zmax < -3200, `${zmin.toFixed(0)} … ${zmax.toFixed(0)} m, ${nan} no-data cells`);
  check('grid covers 3.2 km × 3.2 km as claimed', Math.abs(w * res - 3200) < 50, `${(w * res).toFixed(0)} m`);
  const slope = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const a = (z[i + 1] - z[i - 1]) / (2 * res), b = (z[i + w] - z[i - w]) / (2 * res); slope[i] = Math.atan(Math.hypot(a, b)) * 180 / Math.PI; }
  const g: Grid = { w, h, res, z, slope };

  // demo base + targets exactly like App.loadDemo / AutopilotPanel
  const R = 3396190;
  const toCell = (lon: number, lat: number) => { const cx = ((lon * Math.PI / 180) * R - meta.x_left) / res, cy = (meta.y_top - (lat * Math.PI / 180) * R) / res; return Math.round(cy) * w + Math.round(cx); };
  const snap = (cell: number) => { const cx = cell % w, cy = (cell / w) | 0; if (slope[cell] <= 12) return cell; let best = cell, bd = Infinity; for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; const i = y * w + x, dd = dx * dx + dy * dy; if (slope[i] <= 12 && dd < bd) { bd = dd; best = i; } } return best; };
  const wps = JSON.parse(readFileSync(join(dir, 'waypoints.json'), 'utf8'));
  const wp = wps.find((x: { sol: number }) => x.sol >= 4600) ?? wps[0];
  const base = snap(toCell(wp.lon, wp.lat));
  const tj = JSON.parse(readFileSync(join(dir, 'science_targets.json'), 'utf8'));
  const tl: { id: string; name: string; type: string; lat: number; lon: number }[] = Array.isArray(tj) ? tj : tj.targets;
  const targets: APTarget[] = tl.map((t) => ({ id: t.id, name: t.name, cell: snap(toCell(t.lon, t.lat)), value: scienceValue(t) }));
  check(`all ${targets.length} science targets fall inside the terrain grid`, targets.every((t) => t.cell >= 0 && t.cell < w * h && !Number.isNaN(z[t.cell])));

  let t0 = performance.now();
  const hf = homeField(g, base, P), of = outField(g, base, P), ff = homeFastField(g, base, P);
  const fieldsMs = performance.now() - t0;
  check('3 full Dijkstra fields on 1.14 M cells run in a few seconds (README: ~0.7 s in browser)', fieldsMs < 5000, `${(fieldsMs / 1000).toFixed(2)} s in Node`);
  let reach = 0; for (let i = 0; i < w * h; i++) if (isFinite(hf.time[i])) reach++;
  check('most of the map is reachable on foot from the habitat', reach > 0.5 * w * h, `${(100 * reach / (w * h)).toFixed(1)}% of cells`);
  let fastOK = true; for (let i = 0; i < w * h; i += 101) if (isFinite(ff.time[i]) && ff.time[i] > hf.time[i] + 1e-2) fastOK = false;
  check('storm (least-time) walk home is never slower than the least-effort walk home', fastOK);
  // crew-down drill: hauling a partner (extra mass, slower pace) must never make any walk home faster, and must leave the outbound walk alone
  const PR: ExplorerParams = { ...P, rescueMass: P.bodyMass + P.suitMass, rescuePace: 0.5 };
  const hr = homeField(g, base, PR), or = outField(g, base, PR);
  let slower = true, sameOut = true, ratio = 0, nr = 0;
  for (let i = 0; i < w * h; i += 101) {
    if (!isFinite(hf.time[i])) continue;
    if (!(hr.time[i] >= hf.time[i] - 1e-2)) slower = false;
    if (or.time[i] !== of.time[i]) sameOut = false;
    if (hf.time[i] > 600) { ratio += hr.time[i] / hf.time[i]; nr++; }
  }
  check('crew-down drill: the walk home is never faster, and the outbound walk is unchanged', slower && sameOut && nr > 100, `walk home takes ${(ratio / nr).toFixed(2)}x as long on average`);

  // tether formula on a sample cell, checked by actually routing there and back
  const T = 6 * 3600, W = 30 * 60, lim = T * 0.8;
  const tgt = targets.find((t) => t.name.startsWith('Altadena'))!;
  const go = route(g, base, tgt.cell, M_OUT, P)!, back = route(g, tgt.cell, base, P.bodyMass + P.suitMass + P.loadBack, P)!;
  const tot = go.time[go.time.length - 1] + W + back.time[back.time.length - 1];
  check('tether map value at Altadena = real out-route + work + real back-route', close(of.time[tgt.cell] + W + hf.time[tgt.cell], tot, 1e-4), `${(tot / 60).toFixed(1)} min total, limit ${(lim / 60).toFixed(0)} min`);

  // autopilot on real terrain vs brute force on the same cost model
  t0 = performance.now();
  const tt = targetMatrix(g, targets.map((t) => t.cell), P);
  const budget: APBudget = { evaHours: 6, reservePct: 20, workMinPerStop: 30 };
  const { model, homeT } = buildModel(g, base, targets.map((t) => t.cell), P, tt);
  const ap = runAutopilot(g, base, targets, P, budget, tt);
  const apMs = performance.now() - t0;
  const bf = bruteBest(model, targets.map((t) => t.value), budget, budget.evaHours * 3600 * 0.8 - DP_SLACK_S);
  console.log(`        autopilot picked: ${ap.best?.stops.map((j) => targets[j].name.split(' (')[0]).join(' → ')}  (value ${ap.best?.value}, ${((ap.best?.totalTime ?? 0) / 60).toFixed(0)} min)`);
  console.log(`        brute force best: ${bf.order.map((j) => targets[j].name.split(' (')[0]).join(' → ')}  (value ${bf.value}, ${(bf.total / 60).toFixed(0)} min; ${bf.feasibleSequences.toLocaleString()} feasible orders tried)`);
  check(`real-terrain autopilot (${targets.length} targets) = brute force over every ordered subset`, ap.best?.value === bf.value, `${(apMs / 1000).toFixed(1)} s incl. 18 Dijkstra runs`);
  check('the chosen plan passes the cell-by-cell walk-back check', !!ap.best?.verified?.pass, `min reserve ${((ap.best?.verified?.minMargin ?? 0) * 100).toFixed(1)}% (need ≥ 20%)`);
  // independent re-check of verifyPlan: re-route the plan, measure margins ourselves
  if (ap.best) {
    const cells = ap.best.stops.map((j) => targets[j].cell), seq = [base, ...cells, base];
    let mass = M_OUT, tOff = 0, minM = Infinity; const per = (P.loadBack - P.loadOut) / cells.length;
    for (let i = 0; i < seq.length - 1; i++) { const r = route(g, seq[i], seq[i + 1], mass, P)!; for (let k = 0; k < r.cells.length; k++) minM = Math.min(minM, (T - (tOff + r.time[k]) - homeT[r.cells[k]]) / T); tOff += r.time[r.time.length - 1] + (i < seq.length - 2 ? W : 0); if (i < cells.length) mass += per; }
    const v = verifyPlan(g, base, cells, P, budget, homeT);
    check('verifyPlan margin agrees with an independent re-computation', close(v.minMargin, minM, 1e-6), `${(minM * 100).toFixed(2)}%`);
  }
  // an over-ambitious plan must FAIL
  const all = targets.map((t) => t.cell);
  const vAll = verifyPlan(g, base, all, P, budget, homeT);
  check(`visiting all ${targets.length} targets in 6 h is correctly rejected`, !vAll.pass, `total ${(vAll.totalTime / 3600).toFixed(1)} h, min margin ${(vAll.minMargin * 100).toFixed(0)}%`);
  // sliders behave sensibly
  const ap8 = runAutopilot(g, base, targets, P, { ...budget, evaHours: 8 }, tt), ap3 = runAutopilot(g, base, targets, P, { ...budget, evaHours: 3 }, tt);
  check('longer EVA never gives less science (3 h ≤ 6 h ≤ 8 h)', (ap3.best?.value ?? 0) <= (ap.best?.value ?? 0) && (ap.best?.value ?? 0) <= (ap8.best?.value ?? 0), `${ap3.best?.value ?? 0} ≤ ${ap.best?.value} ≤ ${ap8.best?.value}`);

  // habitat siting: the top site's score must be achievable by the autopilot from that site
  t0 = performance.now();
  const s = runSiting(g, targets, P, budget).result;
  const sMs = performance.now() - t0;
  const top = s.top[0];
  if (top) {
    const tt2 = targetMatrix(g, targets.map((t) => t.cell), P);
    const apTop = runAutopilot(g, top.cell, targets, P, budget, tt2);
    check('best habitat site: autopilot from there reaches the score the heatmap claims', apTop.best?.value === top.value, `site score ${top.value}, autopilot ${apTop.best?.value}, siting took ${(sMs / 1000).toFixed(1)} s`);
    check('best habitat site scores at least as well as the demo base', top.value >= (ap.best?.value ?? 0), `${top.value} vs demo ${ap.best?.value}`);
  } else check('siting returned a top site', false);
}

// ---------------------------------------------------------------- 5. THEMIS ground model + Mars clock
section('5. New in Marswalk: THEMIS ground model and Mars clock');
{
  const dir = join(process.cwd(), 'public', 'data');
  const meta = JSON.parse(readFileSync(join(dir, 'terrain.json'), 'utf8'));
  const q = new Uint16Array(readFileSync(join(dir, 'elev.bin')).buffer.slice(0));
  const z = new Float32Array(q.length); for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  const { w, h, res } = meta; const slope = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const a = (z[i + 1] - z[i - 1]) / (2 * res), b = (z[i + w] - z[i - w]) / (2 * res); slope[i] = Math.atan(Math.hypot(a, b)) * 180 / Math.PI; }
  const th = JSON.parse(readFileSync(join(dir, 'thermal.json'), 'utf8')) as Thermal;
  const g = buildGround(meta, z, slope, th);
  check('THEMIS grid covers the planning grid (prototype box stops ~100 m short of the southern edge)', g.coverage > 0.96, `${(g.coverage * 100).toFixed(1)}% of cells; uncovered cells stay neutral (×1)`);
  let fmin = Infinity, fmax = 0, bad = 0; for (let i = 0; i < g.factor.length; i++) { const f = g.factor[i]; if (!(f >= 1 && f <= 1 / (0.55 * 0.5) + 1e-6)) bad++; fmin = Math.min(fmin, f); fmax = Math.max(fmax, f); }
  check('cost multiplier stays within the prototype model\'s bounds [1, 3.64]', bad === 0, `range ${fmin.toFixed(2)} to ${fmax.toFixed(2)}`);
  // sand should come from cold-at-night pixels: compare mean IR of the sandiest vs rockiest cells via the regional stats
  let sSand = 0, nSand = 0, sRock = 0, nRock = 0;
  for (let i = 0; i < g.sand.length; i++) { if (g.sand[i] > 0.5) { sSand += slope[i]; nSand++; } if (g.rock[i] > 0.5) { sRock += slope[i]; nRock++; } }
  check('sandy cells are gentler than rocky cells (sand pools in hollows)', nSand > 0 && nRock > 0 && sSand / nSand < sRock / nRock, `mean slope sand ${(sSand / Math.max(1, nSand)).toFixed(1)}° vs rock ${(sRock / Math.max(1, nRock)).toFixed(1)}°`);
  const grid: Grid = { w, h, res, z, slope };
  const base = 500 * w + 500;
  let t0 = performance.now(); const plain = homeField(grid, base, P); const tPlain = performance.now() - t0;
  t0 = performance.now(); const slow = homeField({ ...grid, terrainFactor: g.factor }, base, P); const tSlow = performance.now() - t0;
  // Invariant: multipliers >= 1 can never make the least-EFFORT walk home cheaper. (Its time can drop: a sandier
  // old path may lose to a less tiring path that happens to be quicker, so time is not a valid invariant.)
  let never = true, sumRatio = 0, n = 0;
  for (let i = 0; i < w * h; i += 37) { if (!isFinite(plain.energy[i])) continue; if (slow.energy[i] < plain.energy[i] * (1 - 1e-5)) never = false; if (plain.energy[i] > 5e4) { sumRatio += slow.energy[i] / plain.energy[i]; n++; } }
  check('with the ground model on, no walk home ever takes less effort', never, `effort is ${(sumRatio / n).toFixed(2)}× higher on average`);
  check('ground model does not slow the search much', tSlow < tPlain * 2.5 + 300, `${(tPlain / 1000).toFixed(2)} s plain vs ${(tSlow / 1000).toFixed(2)} s with ground`);

  // TETHER's AI sand map (pipeline/vision): energy x Pandolf terrain coefficient, time only where a speed cut is sourced
  const tcm = JSON.parse(readFileSync(join(dir, 'terrain_class.json'), 'utf8')) as TerrainClassMeta;
  const tcls = new Uint8Array(readFileSync(join(dir, 'terrain_class.bin')));
  check('AI sand map is on the planning grid', tcls.length === w * h, `${tcls.length} cells`);
  const { terrainFactor: sE, terrainTimeFactor: sT } = terrainClassFactors(tcls, tcm);
  const iSand = tcls.indexOf(2), iRough = tcls.indexOf(3), iFirm = tcls.indexOf(1);
  check('loose sand: energy ×2.1 (Soule & Goldman 1972), time unchanged (no sourced speed cut)', close(sE[iSand], 2.1) && sT[iSand] === 1, `E ×${sE[iSand].toFixed(2)}, t ×${sT[iSand]}`);
  check('rough ground: energy ×1.3, time ×1/0.86', close(sE[iRough], 1.3) && close(sT[iRough], 1 / 0.86), `E ×${sE[iRough].toFixed(2)}, t ×${sT[iRough].toFixed(3)}`);
  check('firm ground is neutral', sE[iFirm] === 1 && sT[iFirm] === 1);
  { // flat synthetic strip, all sand: energy scales by 2.1 exactly, time does not move
    const W2 = 40, H2 = 3, n2 = W2 * H2; const flat: Grid = { w: W2, h: H2, res: 3, z: new Float32Array(n2) };
    const a = homeField(flat, W2 + 0, P), b = homeField({ ...flat, terrainFactor: new Float32Array(n2).fill(2.1), terrainTimeFactor: new Float32Array(n2).fill(1) }, W2 + 0, P);
    const far = W2 + W2 - 1;
    check('all-sand walk: effort ×2.1, walking time unchanged (separate energy/time factors, as TETHER)', close(b.energy[far], 2.1 * a.energy[far], 1e-4) && close(b.time[far], a.time[far], 1e-6), `${(b.energy[far] / a.energy[far]).toFixed(3)}× effort, ${(b.time[far] / a.time[far]).toFixed(3)}× time`);
  }
  const ds = { ground: { factor: g.factor }, terrainFactor: sE, terrainTimeFactor: sT } as unknown as Dataset;
  check('walking-model switch: AI sand passes its own time factor, THEMIS keeps energy+time', terrainFactors(ds, false, true).terrainTimeFactor === sT && terrainFactors(ds, true, false).terrainTimeFactor === g.factor && terrainFactors(ds, false, false).terrainFactor === null);
  useStore.getState().setGroundModel(true); useStore.getState().setSandModel(true);
  const ex1 = !useStore.getState().groundModel && useStore.getState().sandModel;
  useStore.getState().setGroundModel(true);
  check('"Ground type" and "AI sand" walking options are mutually exclusive', ex1 && useStore.getState().groundModel && !useStore.getState().sandModel);
  useStore.getState().setGroundModel(false);

  check('Mars Sol Date matches Allison & McEwen at 2000-01-06 00:00 UTC (MSD 44795.9998)', Math.abs(msd(Date.UTC(2000, 0, 6)) - 44795.9998) < 0.001, msd(Date.UTC(2000, 0, 6)).toFixed(4));
  const remsSol = marsNow(Date.UTC(2026, 7, 25, 12)).sol;
  check('mission sol on 2026-08-25 matches the REMS feed (sol 4995)', Math.abs(remsSol - 4995) <= 1, `clock says ${remsSol}`);
  const landing = marsNow(Date.UTC(2012, 7, 6, 6)).sol;
  check('landing day is sol 0', landing === 0, `clock says ${landing}`);
}

// ---------------------------------------------------------------- 6. 3D game on the planner's engine
section('6. 3D walk: the game runs on the same physics as the planner');
{
  const dir = join(process.cwd(), 'public', 'data');
  const meta = JSON.parse(readFileSync(join(dir, 'terrain.json'), 'utf8'));
  const q = new Uint16Array(readFileSync(join(dir, 'elev.bin')).buffer.slice(0));
  const z = new Float32Array(q.length); for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  const data = { meta, z, ground: null, waypoints: [], targets: [], weather: null } as unknown as Dataset;
  const live: Live = { params: P, groundModel: false, fields: null, summary: null, rems: null };
  const K = buildK(data, live);
  const w = meta.w, base = 520 * w + 470;
  syncLive(K, base, [400 * w + 560], { evaHours: 6, reservePct: 20, workMinPerStop: 30 }, () => null);
  check('game grid is the planner grid (3 m cells, same size)', K.N === w && K.CELL === meta.res && K.SIZE === w * meta.res, `${K.N}×${K.N}, ${K.CELL} m`);
  let same = true; for (const [u, v, dl] of [[base, base + 1, 1], [base, base + w + 1, Math.SQRT2], [base + 7, base + 8, 1]] as [number, number, number][]) {
    const c = edgeCost(dl * meta.res, z[v] - z[u], M_OUT, P); const want = c ? c[1] / 3600 : Infinity;
    if (Math.abs(K.edgeTime(u, v, dl) - want) > 1e-12) same = false;
  }
  check('game step time = planner edgeCost (Santee / Marquez), in hours', same);
  check('game walking pace on flat ground = pace cap', Math.abs(K.speed(0, 0, 0) - P.maxSpeed * 3.6) < 1e-9, `${K.speed(0, 0, 0).toFixed(2)} km/h`);
  const xy = K.latLngToXY(-4.79984723, 137.3835414), c = K.cellOfXY(xy[0], xy[1]);
  const [cx, cy] = [(137.3835414 * Math.PI / 180 * 3396190 - meta.x_left) / meta.res, (meta.y_top - (-4.79984723) * Math.PI / 180 * 3396190) / meta.res];
  check('game coordinates match the planner grid (Altadena)', c === Math.floor(cy) * w + Math.floor(cx), `cell ${c}`);
  // Guide line vs the planner's Dijkstra run forward from the astronaut: same fastest time, and the path's own
  // step times add up to it. Endpoints are snapped to walkable ground, as the game does.
  const grid: Grid = { w, h: meta.h, res: meta.res, z, slope: K.slope };
  const walk = (c: number) => { for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const i = c + dy * w + dx; if (K.slope[i] < 12) return i; } return c; };
  const t = walk(400 * w + 560);
  let worst = 0, n = 0, unreach = 0; const t0 = performance.now(); K.astar(walk(520 * w + 470), t); const tField = performance.now() - t0;
  let tWalk = 0;
  for (let k = 0; k < 8; k++) {
    const s0 = walk((250 + 70 * k) * w + 250 + 80 * k);
    const ta = performance.now(); const path = K.astar(s0, t); tWalk += performance.now() - ta;
    const dj = dijkstra(grid, s0, M_OUT, P, false, t, undefined, 'time');
    if (!path || !isFinite(dj.time[t])) { if (!!path !== isFinite(dj.time[t])) worst = Infinity; unreach++; continue; }
    let sum = 0; for (let i = 1; i < path.length; i++) { const u = path[i - 1], v = path[i]; sum += K.edgeTime(u, v, (u % w !== v % w && ((u / w) | 0) !== ((v / w) | 0)) ? Math.SQRT2 : 1); }
    worst = Math.max(worst, Math.abs(sum * 3600 - dj.time[t]) / dj.time[t], Math.abs(K.guideHours(s0) * 3600 - dj.time[t]) / dj.time[t]); n++;
  }
  check("guide line finds the same fastest time as the planner's Dijkstra", worst < 1e-5 && n >= 6, `${n} routes (${unreach} unreachable on both), max rel. diff ${worst.toExponential(1)}`);
  check('guide line is instant once the stop is set', tWalk / 8 < 20, `one-off field ${(tField / 1000).toFixed(2)} s, then ${(tWalk / 8).toFixed(2)} ms per update`);
}

section("7. Walking model against NASA's measurements of people in the Mark III suit (treadmill, partial offload)");
{
  const W = JSON.parse(readFileSync(join(process.cwd(), 'public/data/validation_walking.json'), 'utf8')) as { j_per_ml: number; points: { g: number; v: number; grade: number; body: number; suit: number; vo2: number; sd: number }[] };
  const err = (scaled: boolean) => W.points.map((q) => metabolicWatts(q.body + q.suit, q.g * G_EARTH, q.v, q.grade, scaled) / (q.vo2 * q.body * W.j_per_ml / 60) - 1);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length, abs = (a: number[]) => mean(a.map(Math.abs));
  const e = err(false), es = err(true);
  check('model as shipped is within 20% of NASA\'s suited measurements on average, with no overall bias beyond 10%', abs(e) < 0.2 && Math.abs(mean(e)) < 0.1, `${W.points.length} conditions, mean error ${(100 * mean(e)).toFixed(0)}%, mean |error| ${(100 * abs(e)).toFixed(0)}%`);
  check('the optional gravity scaling of flat-ground effort fits the measurements worse (kept off by default)', abs(es) > abs(e), `mean error ${(100 * mean(es)).toFixed(0)}% with it on`);
}

section('8. Chance of getting home, turn-back advisor, RAD calibration (ported from TETHER pipeline/rl/*_check.ts)');
{
  const dir = join(process.cwd(), 'public', 'data');
  const meta = JSON.parse(readFileSync(join(dir, 'terrain.json'), 'utf8'));
  const q = new Uint16Array(readFileSync(join(dir, 'elev.bin')).buffer.slice(0));
  const z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  const { w, h, res } = meta;
  const slope = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const a = (z[i + 1] - z[i - 1]) / (2 * res), b = (z[i + w] - z[i - w]) / (2 * res); slope[i] = Math.atan(Math.hypot(a, b)) * 180 / Math.PI; }
  const g: Grid = { w, h, res, z, slope };
  const R = 3396190;
  const toCell = (lon: number, lat: number) => { const cx = ((lon * Math.PI / 180) * R - meta.x_left) / res, cy = (meta.y_top - (lat * Math.PI / 180) * R) / res; return Math.round(cy) * w + Math.round(cx); };
  const snap = (cell: number) => { const cx = cell % w, cy = (cell / w) | 0; if (slope[cell] <= 12) return cell; let best = cell, bd = Infinity; for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue; const i = y * w + x, dd = dx * dx + dy * dy; if (slope[i] <= 12 && dd < bd) { bd = dd; best = i; } } return best; };
  const wps = JSON.parse(readFileSync(join(dir, 'waypoints.json'), 'utf8'));
  const wp = wps.find((x: { sol: number }) => x.sol >= 4600) ?? wps[0];
  const base = snap(toCell(wp.lon, wp.lat));
  const tl: { name: string; lon: number; lat: number }[] = JSON.parse(readFileSync(join(dir, 'science_targets.json'), 'utf8')).targets;
  const stops = ['Altadena', 'Nevado Sajama', 'Campo Marte'].map((n) => tl.find((t) => t.name.startsWith(n))!).map((t) => snap(toCell(t.lon, t.lat)));
  const home = homeField(g, base, P), fast = homeFastField(g, base, P), out = outField(g, base, P);
  const budget = { evaHours: 6, reservePct: 20, workMinPerStop: 30, flareLeadMin: 30 };
  const work = budget.workMinPerStop * 60, T = budget.evaHours * 3600;
  const seq = [base, ...stops, base];
  let mass = P.bodyMass + P.suitMass + P.loadOut; const dm = (P.loadBack - P.loadOut) / stops.length;
  const pts: { cell: number; t: number; leg: number; margin: number }[] = [];
  let tOff = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const r = route(g, seq[i], seq[i + 1], mass, P)!;
    r.cells.forEach((c, k) => { const t = tOff + r.time[k]; pts.push({ cell: c, t, leg: i, margin: (T - t - home.time[c]) / T }); });
    tOff += r.time[r.time.length - 1]; if (i < seq.length - 2) tOff += work;
    if (i < stops.length) mass += dm;
  }
  const minMargin = Math.min(...pts.map((x) => x.margin));
  const pass = minMargin >= budget.reservePct / 100 && tOff <= T * (1 - budget.reservePct / 100);
  const { points, legsEnd } = riskInputsFromSummary(pts, home.time, fast.time);
  const det = riskForRoute(points, legsEnd, budget, { samples: 200, model: RISK_DETERMINISTIC });
  check('risk with no uncertainty reproduces the plan verdict exactly (TETHER risk_check)', det.pWithinReserve === (pass ? 1 : 0) && det.pHome === (tOff <= T ? 1 : 0), `pass=${pass}, pHome=${det.pHome}, pWithinReserve=${det.pWithinReserve}`);
  const rk = riskForRoute(points, legsEnd, budget, { samples: 10000, seed: 7 });
  const rk2 = riskForRoute(points, legsEnd, budget, { samples: 10000, seed: 7 });
  check('10,000-walk Monte Carlo is deterministic for a seed and gives probabilities in [0,1]', rk.pHome === rk2.pHome && rk.pHome >= 0 && rk.pHome <= 1 && rk.pWithinReserve <= rk.pHome, `pHome ${rk.pHome.toFixed(4)}, reserve ${rk.pWithinReserve.toFixed(4)}, ${rk.ms.toFixed(0)} ms`);
  check('Monte Carlo duration median sits above the plan (detours median +7%)', rk.endTime.p50 > tOff && rk.endTime.p10 <= rk.endTime.p50 && rk.endTime.p50 <= rk.endTime.p90, `plan ${(tOff / 60).toFixed(0)} min, p10/p50/p90 ${[rk.endTime.p10, rk.endTime.p50, rk.endTime.p90].map((x) => (x / 60).toFixed(0)).join('/')} min`);
  // closed form vs Monte Carlo on one out-and-back
  const c = stops[stops.length - 1];
  const cf = probTetherMapModel(out.time, home.time, work, T)[c];
  const ob = riskForRoute([{ t: 0, homeT: home.time[base] }, { t: out.time[c], homeT: home.time[c] }, { t: out.time[c] + work, homeT: home.time[c] }, { t: out.time[c] + work + home.time[c], homeT: 0 }], [1, 3], { ...budget, evaHours: (out.time[c] + work + home.time[c]) * 1.1 / 3600 }, { samples: 20000, model: { spePerDay: 0 } });
  const cf2 = probTetherMapModel(out.time, home.time, work, (out.time[c] + work + home.time[c]) * 1.1)[c];
  check('closed-form map probability agrees with the Monte Carlo on an out-and-back', Math.abs(cf2 - ob.pHome) < 0.03 && cf >= 0 && cf <= 1, `closed form ${cf2.toFixed(3)} vs MC ${ob.pHome.toFixed(3)}`);

  const pol = parseRlPolicy(JSON.parse(readFileSync(join(dir, 'rl_policy.json'), 'utf8')));
  const samp: { loc: number; mask: number; ext: number; cls: number; r: number; a: number }[] = JSON.parse(readFileSync(join(process.cwd(), 'verify', 'rl_policy_samples.json'), 'utf8'));
  let bad = 0; for (const s of samp) if (policyAction(pol, s.loc, s.mask, s.ext, s.cls, s.r) !== s.a) bad++;
  check('advisor policy table decodes to the same action as the Python solver (TETHER advisor_check)', bad === 0 && samp.length > 0, `${samp.length - bad}/${samp.length} states`);
  check('advisor habitat is the demo habitat (sol-4600 parking spot)', locationForCell(pol, base, w) === 0);
  const names = pol.locations.slice(1).map((l) => l.id);
  check('every policy location is a Rocky science target', names.every((id) => tl.some((t) => (t as unknown as { id: string }).id === id)), `${names.length} of ${tl.length} targets in the policy`);
  const a0 = advise(pol, { location: 'habitat', elapsedMin: 0, rateMultiplier: 1 });
  const aLate = advise(pol, { location: 'nazca', visited: ['altadena', 'campo-marte'], elapsedMin: 340, rateMultiplier: 1 });
  const aStorm = advise(pol, { location: 'basque-lakes', visited: ['altadena'], elapsedMin: 150, storm: true, rateMultiplier: 1 });
  check('advisor: at the start with a full suit it says go', a0.action === 'go', a0.headline);
  check('advisor: at Nazca after 5 h 40 it says turn back', aLate.action === 'return', aLate.headline);
  check('advisor: a solar storm warning means go home now', aStorm.action === 'return' && aStorm.pFlareSafe >= 0 && aStorm.pFlareSafe <= 1, aStorm.headline);

  const rad = JSON.parse(readFileSync(join(dir, 'validation_rad_stops.json'), 'utf8'));
  const k = rad.measured_over_model_slope as number;
  const fake = { doseMsv: 0.08, doseOpenMsv: 0.1 } as RouteSummary;
  const cd = calibratedDose(fake, k);
  check('RAD calibration factor read from validation_rad_stops.json (~0.59 over 1,298 stops)', k > 0.5 && k < 0.7 && rad.stops === 1298, `factor ${k.toFixed(3)}`);
  check('calibrated shielding = raw shielding × factor, raw dose untouched', close(cd.shieldingPct, 20 * k) && fake.doseMsv === 0.08, `${cd.shieldingPct.toFixed(2)}% vs raw 20%`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
