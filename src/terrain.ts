import type { Dataset } from './data';

export function slopeDeg(d: Dataset): Float32Array {
  const { w, h, res } = d.meta; const z = d.z;
  const s = new Float32Array(w * h).fill(NaN);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const dzdx = (z[i + 1] - z[i - 1]) / (2 * res), dzdy = (z[i + w] - z[i - w]) / (2 * res);
    s[i] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
  }
  return s;
}

export function hillshadeCanvas(d: Dataset): HTMLCanvasElement {
  const { w, h, res } = d.meta; const z = d.z;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; const im = ctx.createImageData(w, h);
  const az = (315 * Math.PI) / 180, alt = (40 * Math.PI) / 180;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const dzdx = (z[i + 1] - z[i - 1]) / (2 * res) * 2, dzdy = (z[i + w] - z[i - w]) / (2 * res) * 2;
    const slope = Math.atan(Math.hypot(dzdx, dzdy)); const aspect = Math.atan2(dzdy, -dzdx);
    let v = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
    v = Math.max(0, Math.min(1, v));
    const o = i * 4; const g = 255 * v;
    im.data[o] = g; im.data[o + 1] = g; im.data[o + 2] = g; im.data[o + 3] = isNaN(z[i]) ? 0 : 255;
  }
  ctx.putImageData(im, 0, 0); return c;
}

type RGBA = [number, number, number, number];
export function fieldCanvas(w: number, h: number, f: (i: number) => RGBA | null): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!; const im = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = f(i); if (!v) continue; const o = i * 4;
    im.data[o] = v[0]; im.data[o + 1] = v[1]; im.data[o + 2] = v[2]; im.data[o + 3] = v[3];
  }
  ctx.putImageData(im, 0, 0); return c;
}

/** Interpolate a ramp of [stop, r, g, b] entries. */
export function ramp(stops: [number, number, number, number][], t: number): [number, number, number] {
  if (t <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const a = stops[k - 1], b = stops[k], u = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  const l = stops[stops.length - 1]; return [l[1], l[2], l[3]];
}

export const SLOPE_RAMP: [number, number, number, number][] = [
  [0, 255, 255, 255], [10, 255, 224, 150], [15, 229, 160, 0], [20, 216, 57, 51], [30, 140, 20, 20],
];

/** Shelter cell value (percent) sampled at a planning-grid cell. */
export function shelterAt(d: Dataset, cell: number, which: 'shelter' | 'dose' = 'shelter'): number {
  const { w, h } = d.meta; const s = d.meta.shelter;
  const cx = cell % w, cy = (cell / w) | 0;
  const sx = Math.min(s.w - 1, Math.floor((cx / w) * s.w)), sy = Math.min(s.h - 1, Math.floor((cy / h) * s.h));
  const arr = which === 'shelter' ? d.shelter : d.dose;
  return arr[sy * s.w + sx] / 2.55;
}

/** Snap a cell to the nearest gently sloping cell (so habitats and stops sit on walkable ground). */
export function snapWalkable(d: Dataset, slope: Float32Array, cell: number, maxDeg = 12, radius = 12): number {
  const { w, h } = d.meta; const cx = cell % w, cy = Math.floor(cell / w);
  if (slope[cell] <= maxDeg) return cell;
  let best = cell, bd = Infinity;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    const i = y * w + x; const dd = dx * dx + dy * dy;
    if (slope[i] <= maxDeg && dd < bd) { bd = dd; best = i; }
  }
  return best;
}
