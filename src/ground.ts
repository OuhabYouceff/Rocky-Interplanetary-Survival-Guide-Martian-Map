// Ground type (sand vs rock) on the planning grid, ported from the Marswalk prototype (site-core.js).
//
// Measured part: THEMIS night-time infrared (Mars Odyssey, ~80 m pixels, Mars Trek layer
// THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018). Rock keeps its heat at night, sand and dust cool fast,
// so a pixel colder than the regional median reads as sandier, warmer as rockier.
// Derived part: the 1 m terrain decides where inside each 80 m pixel the sand sits (low, gentle hollows)
// and the rock sits (steep, rough ground).
// Walking cost: the prototype slowed walking by (1 - 0.45 sand)(1 - 0.5 rock). Here that becomes a
// multiplier on the energy and time of entering a cell (TETHER's terrainFactor hook). ASSUMED, off by default.
import type { TerrainMeta } from './data';
import { cellToLonLat } from './data';

export interface Thermal {
  lat0: number; lon0: number; size: number; n: number;
  regional: { p5: number; p50: number; p95: number };
  night: number[];
}

export interface Ground {
  sand: Float32Array; rock: Float32Array;   // estimates combining THEMIS with terrain shape, 0..1
  factor: Float32Array;                     // walking-cost multiplier (>= 1)
  irNight: Float32Array; sandT: Float32Array; rockT: Float32Array; // THEMIS night IR (8-bit, NaN outside) and its sand/rock reading alone
  coverage: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const M_PER_DEG = 59157; // prototype grid definition: 2·π·3389.5 km / 360

export function buildGround(meta: TerrainMeta, z: Float32Array, slope: Float32Array, th: Thermal): Ground {
  const { w, h } = meta;
  const N = th.n, CELL = th.size / N;
  const dLat = th.size / M_PER_DEG, dLon = th.size / (M_PER_DEG * Math.cos((th.lat0 * Math.PI) / 180));
  const latS = th.lat0 - dLat / 2, lonW = th.lon0 - dLon / 2;
  const { p5, p50, p95 } = th.regional;

  // bilinear sample of the night-IR grid (row 0 = north)
  const sampleIR = (lat: number, lon: number): number => {
    const x = ((lon - lonW) / dLon) * th.size, y = th.size - ((lat - latS) / dLat) * th.size;
    const fc = x / CELL - 0.5, fr = y / CELL - 0.5;
    if (fc < -0.5 || fr < -0.5 || fc > N - 0.5 || fr > N - 0.5) return NaN;
    const c0 = Math.max(0, Math.min(N - 2, Math.floor(fc))), r0 = Math.max(0, Math.min(N - 2, Math.floor(fr)));
    const u = clamp01(fc - c0), v = clamp01(fr - r0);
    const a = th.night[r0 * N + c0], b = th.night[r0 * N + c0 + 1], c = th.night[(r0 + 1) * N + c0], d = th.night[(r0 + 1) * N + c0 + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };

  // local relief: elevation minus a ~100 m box mean (integral image), ridges > 0, hollows < 0
  const R = Math.round(50 / meta.res);
  const S = new Float64Array((w + 1) * (h + 1)), C = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = z[y * w + x], ok = v === v ? 1 : 0, k = (y + 1) * (w + 1) + x + 1;
    S[k] = (ok ? v : 0) + S[k - 1] + S[k - (w + 1)] - S[k - (w + 1) - 1];
    C[k] = ok + C[k - 1] + C[k - (w + 1)] - C[k - (w + 1) - 1];
  }
  const box = (x: number, y: number) => {
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    const q = (A: Float64Array) => A[y1 * (w + 1) + x1] - A[y0 * (w + 1) + x1] - A[y1 * (w + 1) + x0] + A[y0 * (w + 1) + x0];
    return q(S) / Math.max(1, q(C));
  };

  const sand = new Float32Array(w * h), rock = new Float32Array(w * h), factor = new Float32Array(w * h).fill(1);
  const irNight = new Float32Array(w * h).fill(NaN), sandTa = new Float32Array(w * h), rockTa = new Float32Array(w * h);
  let covered = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (z[i] !== z[i]) continue;
    const [lon, lat] = cellToLonLat(meta, x + 0.5, y + 0.5);
    const ir = sampleIR(lat, lon); if (ir !== ir) continue;
    covered++;
    const sandT = clamp01((p50 - ir) / (p50 - p5)), rockT = clamp01((ir - p50) / (p95 - p50));
    irNight[i] = ir; sandTa[i] = sandT; rockTa[i] = rockT;
    const resid = z[i] - box(x, y), s = slope[i] || 0;
    const hollow = clamp01(-resid / 4) * (s < 10 ? 1 : 0.3);
    const rough = clamp01((s - 12) / 15);
    const sd = clamp01((0.7 * sandT + 0.3 * hollow) * (s < 15 ? 1 : 0.4));
    const rk = clamp01(0.6 * rockT + 0.4 * rough);
    sand[i] = sd; rock[i] = rk;
    factor[i] = 1 / ((1 - 0.45 * sd) * (1 - 0.5 * rk));
  }
  return { sand, rock, factor, irNight, sandT: sandTa, rockT: rockTa, coverage: covered / (w * h) };
}
