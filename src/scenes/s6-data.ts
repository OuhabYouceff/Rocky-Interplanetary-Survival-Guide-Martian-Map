// Scene 6 data: NASA's suited treadmill measurements (rocky/public/data/validation_walking.json) against Rocky's own
// energy function, computed at run time exactly as Rocky's Evidence page does (EvidenceView.tsx, WalkingCheck).
import { metabolicWatts, G_EARTH, DEFAULT_PARAMS } from '../planner/physics';

export interface Point { id: string; g: number; v: number; grade: number; body: number; suit: number; vo2: number; sd: number; n: number; weak: boolean; report: string }
export interface Report { id: string; title: string; year: number; url: string }
export interface Check { points: Point[]; j_per_ml: number; reports: Report[]; note: string }
export type Group = 'moonFlat' | 'moonUp' | 'mars';

export const GROUPS: { key: Group; name: string; colour: string }[] = [
  { key: 'moonFlat', name: 'Moon, flat', colour: '#1b1b1b' },
  { key: 'moonUp', name: 'Moon, uphill', colour: '#d18b00' },
  { key: 'mars', name: 'Mars, flat', colour: '#c1440e' },
];

export function analyse(d: Check) {
  const group = (q: Point): Group => (q.g > .3 ? 'mars' : q.grade > 0 ? 'moonUp' : 'moonFlat');
  const rows = d.points.map((q) => {
    const k = (q.body * d.j_per_ml) / 60, gm = q.g * G_EARTH;
    return { ...q, group: group(q), measured: q.vo2 * k, sdW: q.sd * k,
      model: metabolicWatts(q.body + q.suit, gm, q.v, q.grade), scaled: metabolicWatts(q.body + q.suit, gm, q.v, q.grade, true) };
  });
  // keys 1 to 9 follow the selector: Moon flat by speed, Moon uphill by grade, Mars flat by speed
  const order = GROUPS.map((g) => g.key);
  rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.grade - b.grade || a.v - b.v);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const err = rows.map((r) => r.model / r.measured - 1);
  return {
    rows,
    gap: mean(err.map(Math.abs)),                                                    // average gap, model vs measured
    bias: mean(err),                                                                 // signed mean
    inSpread: rows.filter((r) => Math.abs(r.model - r.measured) <= r.sdW).length,    // inside +/- 1 SD between subjects
    marsErr: mean(rows.filter((r) => r.group === 'mars').map((r) => r.model / r.measured - 1)),
    scaledBias: mean(rows.map((r) => r.scaled / r.measured - 1)),                    // the optional gravity-scaling setting
    defaultSuit: DEFAULT_PARAMS.suitMass,
  };
}
export type Analysis = ReturnType<typeof analyse>;
export type Row = Analysis['rows'][number];
