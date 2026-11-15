import type { Dataset } from '../data';
import type { Budget, Fields } from '../store';
import type { Leg } from './worker';
import { shelterAt } from '../terrain';

export const RAD_SURFACE_MSV_PER_DAY = 0.64; // Hassler et al. 2014, Science 343 (RAD, dose equivalent, open ground)

export interface RoutePoint { cell: number; dist: number; t: number; e: number; z: number; margin: number; leg: number; dose: number }
export interface RouteSummary {
  points: RoutePoint[];
  distance: number; walkTime: number; workTime: number; totalTime: number; energy: number;
  minMargin: number; minMarginAt: number; pass: boolean; doseMsv: number; doseOpenMsv: number;
  maxSlope: number; climb: number;
}

export function summarize(d: Dataset, legs: Leg[], fields: Fields | null, budget: Budget): RouteSummary | null {
  if (!legs.length) return null;
  const { w, res } = d.meta;
  const T = budget.evaHours * 3600;
  const work = budget.workMinPerStop * 60;
  const pts: RoutePoint[] = [];
  let tOff = 0, eOff = 0, dist = 0, doseAcc = 0, doseOpen = 0, maxSlope = 0, climb = 0;
  legs.forEach((leg, li) => {
    for (let k = 0; k < leg.cells.length; k++) {
      const c = leg.cells[k];
      if (k > 0) {
        const p = leg.cells[k - 1];
        const dx = (c % w) - (p % w), dy = Math.floor(c / w) - Math.floor(p / w);
        const dl = Math.hypot(dx, dy) * res; dist += dl;
        const dz = d.z[c] - d.z[p]; if (dz > 0) climb += dz;
        maxSlope = Math.max(maxSlope, Math.abs(Math.atan2(dz, dl)) * 180 / Math.PI);
        const dt = leg.time[k] - leg.time[k - 1];
        const frac = shelterAt(d, c, 'dose') / 100;
        doseAcc += dt * frac; doseOpen += dt;
      }
      const t = tOff + leg.time[k];
      const home = fields ? fields.homeT[c] : 0;
      pts.push({ cell: c, dist, t, e: eOff + leg.energy[k], z: d.z[c], margin: (T - t - home) / T, leg: li,
                 dose: shelterAt(d, c, 'dose') });
    }
    tOff += leg.time[leg.time.length - 1];
    eOff += leg.energy[leg.energy.length - 1];
    if (li < legs.length - 1) { tOff += work; doseAcc += work * shelterAt(d, leg.to, 'dose') / 100; doseOpen += work; }
  });
  let minMargin = Infinity, minAt = 0;
  pts.forEach((p, i) => { if (p.margin < minMargin) { minMargin = p.margin; minAt = i; } });
  const walkTime = legs.reduce((s, l) => s + l.time[l.time.length - 1], 0);
  const perSec = RAD_SURFACE_MSV_PER_DAY / 86400;
  return {
    points: pts, distance: dist, walkTime, workTime: work * (legs.length - 1), totalTime: tOff, energy: eOff,
    minMargin, minMarginAt: minAt, pass: minMargin >= budget.reservePct / 100 && tOff <= T * (1 - budget.reservePct / 100),
    doseMsv: doseAcc * perSec, doseOpenMsv: doseOpen * perSec, maxSlope, climb,
  };
}

export const fmtTime = (s: number) => {
  if (!isFinite(s)) return '—';
  const m = Math.round(s / 60); const h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
export const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtKcal = (j: number) => `${Math.round(j / 4184).toLocaleString()} kcal`;

/** Detector calibration of the terrain-shielding model. Across the Curiosity stops in validation_rad_stops.json the
 *  MEASURED stop-to-stop dose change was on average `slope` x the change the shielding model predicts
 *  (measured_over_model_slope, a fit to RAD data). The raw model is not changed: this only scales the predicted
 *  shielding (the drop below open ground) by that measured ratio. */
export function calibratedDose(s: RouteSummary, slope: number): { doseMsv: number; shieldingPct: number } {
  const raw = Math.max(0, s.doseOpenMsv - s.doseMsv);
  const dose = s.doseOpenMsv - slope * raw;
  return { doseMsv: dose, shieldingPct: s.doseOpenMsv > 0 ? Math.max(0, (1 - dose / s.doseOpenMsv) * 100) : 0 };
}
