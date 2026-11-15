// The crew-down drill, computed with Rocky's own planner: the walk home is redone hauling a partner who cannot walk.
// Rocky's drill adds rescueMass = bodyMass + suitMass (a second astronaut in the same suit) and caps the pace on the walk
// home at rescuePace (0.5 m/s by default: an ASSUMPTION, no measured value exists). Everything below is derived from the
// two walk-home fields (both walking, crew down) and the suit clock of the shared walk.
import { DEFAULT_PARAMS, homeLoad, type ExplorerParams } from '../planner/physics';
import { dijkstra, homeField, route, type Grid } from '../planner/fields';
import { BUDGET, type Plan } from './plan';

export const PACE = { def: .5, min: .2, max: .9 };
export const rescue = (pace: number): ExplorerParams => ({ ...DEFAULT_PARAMS, rescueMass: DEFAULT_PARAMS.bodyMass + DEFAULT_PARAMS.suitMass, rescuePace: pace });
const RULE = BUDGET.reservePct / 100;

/** The suit clock along the shared walk, counted exactly as makePlan counts it (science time added when leaving a stop). */
export function routeClock(plan: Plan) {
  const cells: number[] = [], t: number[] = [], done: number[] = []; let t0 = 0;
  plan.legs.forEach((l, i) => {
    l.cells.forEach((c, k) => { cells.push(c); t.push(t0 + l.time[k]); });
    t0 += l.time[l.time.length - 1]; if (i < plan.stops.length) { t0 += plan.work; done.push(t0); }
  });
  return { cells, t, done };   // done[i]: suit time used when science at stop i is finished
}

/** Lowest share of suit time left on arrival home, if the partner collapses anywhere on the walk; homeTime(c) is the walk home from cell c. */
const lowest = (plan: Plan, clock: ReturnType<typeof routeClock>, homeTime: (c: number) => number) =>
  clock.cells.reduce((m, c, k) => Math.min(m, (plan.T - clock.t[k] - homeTime(c)) / plan.T), 1);

export function drill(g: Grid, plan: Plan, pace: number) {
  const p = rescue(pace), haul = homeField(g, plan.base, p), T = plan.T, clock = routeClock(plan);
  const stops = plan.stops.map((s, i) => {
    const elapsed = clock.done[i], home = plan.home.time[s.cell], h = haul.time[s.cell];
    return { name: s.name, cell: s.cell, elapsed, home, haul: h, both: (T - elapsed - home) / T, down: (T - elapsed - h) / T };
  });
  const worst = stops.reduce((a, b) => (b.down < a.down ? b : a));
  const [massAfter, hp] = homeLoad(p), path = route(g, worst.cell, plan.base, massAfter, hp)!;
  const lowestDown = lowest(plan, clock, (c) => haul.time[c]);
  return {
    pace, haul, stops, worst, path, lowestDown, lowestBoth: lowest(plan, clock, (c) => plan.home.time[c]),
    massBefore: homeLoad(DEFAULT_PARAMS)[0], massAfter,
    lateBy: (lowestDown - RULE) * T,            // how far behind schedule the crew could be and still haul home with 20% left
    zoneLeaves: plan.usable - worst.haul,       // suit time after which a collapse at the worst stop can no longer be hauled home in time
    zoneLeavesBoth: plan.usable - worst.home,
  };
}
export type Drill = ReturnType<typeof drill>;

/** Slowest hauling pace (to 0.01 m/s) at which a collapse anywhere on the shared walk still arrives with 20%. Bisection, each probe
 *  a Dijkstra that stops once every cell of the route is settled. null if the walk holds even at 0.05 m/s. */
export function breakingPace(g: Grid, plan: Plan) {
  const clock = routeClock(plan), cells = [...new Set(clock.cells)];
  const ok = (pace: number) => { const [m, hp] = homeLoad(rescue(pace)), f = dijkstra(g, plan.base, m, hp, true, -1, undefined, 'energy', cells); return lowest(plan, clock, (c) => f.time[c]) >= RULE; };
  let lo = .05, hi = DEFAULT_PARAMS.maxSpeed;
  if (ok(lo)) return null; if (!ok(hi)) return hi;   // holds at any pace / fails even at full walking pace
  while (hi - lo > .002) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
  return Math.ceil(hi * 100) / 100;
}
