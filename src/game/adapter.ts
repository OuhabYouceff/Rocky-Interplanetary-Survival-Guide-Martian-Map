// Bridge between the console's verified planner and the prototype's 3D game (game3d.js).
// The game expects a "K" object (its old site-core API). Everything here comes from the same sources as the
// Plan screen: the 3 m grid of the USGS 1 m DEM, the Santee / Marquez walking model (physics.ts), the THEMIS
// ground model, and the walk-home map computed by the planner worker. Arrays the game keeps references to
// (slope, sand, rock, pass, stops, P) are updated in place by syncLive().
import type { Dataset } from '../data';
import { lonLatToCell, cellToLonLat } from '../data';
import { edgeCost, speed as marquezSpeed, type ExplorerParams } from '../planner/physics';
import { dijkstra, type Grid } from '../planner/fields';
import type { Fields } from '../store';
import type { RouteSummary } from '../planner/summary';
import { roverPhotos } from '../feeds';

const R_MARS = 3396190;
const SURFACE_MSV_PER_HOUR = 0.64 / 24; // Curiosity RAD, Hassler et al. 2014 (same rate as the route summary)

export interface GameStop { id: string; name: string; goal?: string; sol?: number; home?: boolean; x: number; y: number; cell: number }

/** Mutable inputs from the React side; K's getters read them on every call. */
export interface Live {
  params: ExplorerParams;
  groundModel: boolean;
  sandModel?: boolean;      // TETHER AI sand map for the guide line (energy/time factors as in the planner)
  fields: Fields | null;
  summary: RouteSummary | null;
  rems: { min: number; max: number; pressure: number } | null;
}

/** Higher-fidelity 3D data written by pipeline/fetch_3d.py (1 m DEM tiles, 50 cm colour tiles, 32 km far field). */
export interface HiData {
  dem: { n: number; tile: number; tiles: number; offset: number; scale: number };
  img: { px: number; tile: number; tiles: number; res_m: number };
  loadDem: (r: number, c: number) => Promise<Float32Array | null>;
  imgUrl: (r: number, c: number) => string;
  far: { n: number; res: number; data: Float32Array } | null;
}

export async function loadHi(): Promise<HiData | null> {
  const base = import.meta.env.BASE_URL + 'data/hi/';
  let meta: { dem?: HiData['dem']; img?: HiData['img']; far?: { n: number; res_m: number; offset: number; scale: number } } | null = null;
  try { const r = await fetch(base + 'meta.json'); meta = r.ok ? await r.json() : null; } catch { meta = null; }
  if (!meta?.dem || !meta.img) return null;
  const dem = meta.dem;
  let far: HiData['far'] = null;
  if (meta.far) {
    try {
      const q = new Uint16Array(await (await fetch(base + 'far.bin')).arrayBuffer());
      const d = new Float32Array(q.length); for (let i = 0; i < q.length; i++) d[i] = meta.far.offset + q[i] * meta.far.scale;
      if (q.length === meta.far.n * meta.far.n) far = { n: meta.far.n, res: meta.far.res_m, data: d };
    } catch { far = null; }
  }
  const cache = new Map<number, Promise<Float32Array | null>>();
  const loadDem = (r: number, c: number) => {
    const key = r * 1000 + c;
    if (!cache.has(key)) cache.set(key, fetch(`${base}dem/${r}_${c}.bin`).then((x) => (x.ok ? x.arrayBuffer() : null)).then((b) => {
      if (!b) return null; const q = new Uint16Array(b); const f = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) f[i] = dem.offset + q[i] * dem.scale; return f;
    }).catch(() => null));
    return cache.get(key)!;
  };
  return { dem, img: meta.img, loadDem, imgUrl: (r, c) => `${base}img/${r}_${c}.jpg`, far };
}

export function buildK(data: Dataset, live: Live, hi: HiData | null = null) {
  const { meta } = data;
  const N = meta.w, CELL = meta.res, SIZE = N * CELL;
  const z = data.z;
  const g = data.ground;
  const NN = N * N;

  // static terrain arrays
  const slope = new Float32Array(NN);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x; const a = (z[i + 1] - z[i - 1]) / (2 * CELL), b = (z[i + N] - z[i - N]) / (2 * CELL);
    slope[i] = Math.atan(Math.hypot(a, b)) * 180 / Math.PI;
  }
  const sand = g ? g.sand : new Float32Array(NN), rock = g ? g.rock : new Float32Array(NN);
  const pass = new Uint8Array(NN);
  let elevMin = Infinity, elevMax = -Infinity; for (const v of z) if (v === v) { elevMin = Math.min(elevMin, v); elevMax = Math.max(elevMax, v); }

  // geometry: grid row 0 = north; game x = metres east, y = metres north from the south-west corner
  const cellX = (i: number) => ((i % N) + 0.5) * CELL;
  const cellY = (i: number) => SIZE - (Math.floor(i / N) + 0.5) * CELL;
  const cellOfXY = (x: number, y: number) => {
    const c = Math.max(0, Math.min(N - 1, Math.floor(x / CELL))), r = Math.max(0, Math.min(N - 1, Math.floor((SIZE - y) / CELL)));
    return r * N + c;
  };
  const latLngToXY = (lat: number, lon: number): [number, number] => { const [cx, cy] = lonLatToCell(meta, lon, lat); return [cx * CELL, SIZE - cy * CELL]; };
  const xyToLatLng = (x: number, y: number): [number, number] => { const [lon, lat] = cellToLonLat(meta, x / CELL, (SIZE - y) / CELL); return [lat, lon]; };

  const groundFactor = (s: number, r: number) => (live.groundModel ? 1 / ((1 - 0.45 * s) * (1 - 0.5 * r)) : 1);
  const massOut = () => live.params.bodyMass + live.params.suitMass + live.params.loadOut;

  /** Hours to walk u -> v (dl in grid units: 1 or √2), Infinity where the planner would not step. */
  const edgeTime = (u: number, v: number, dl: number) => {
    if (!pass[v]) return Infinity;
    const c = edgeCost(dl * CELL, z[v] - z[u], massOut(), live.params);
    return c ? (c[1] * groundFactor(sand[v], rock[v])) / 3600 : Infinity;
  };
  /** Walking pace in km/h on a grade (rise/run), Marquez 2008 speed capped by the pace setting. */
  const speed = (grade: number, s: number, r: number) => {
    const deg = Math.atan(grade) * 180 / Math.PI;
    return Math.min(marquezSpeed(deg), live.params.maxSpeed) / groundFactor(s, r) * 3.6;
  };

  // Guide line to the next stop. Instead of a search per step, the planner's own Dijkstra runs once per stop,
  // backwards from it, in least-time mode (dijkstra(..., reverse=true, prev, 'time')). Every cell then knows its
  // next step toward the stop, so the live path from wherever the astronaut stands is just a pointer walk.
  // Same graph, same physics, same slope rule as the planner by construction.
  let guide: { t: number; key: string; prev: Int32Array; time: Float32Array } | null = null;
  const grid = { w: N, h: N, res: CELL, z, slope } as Grid;
  const astar = (s: number, t: number): number[] | null => {
    const key = JSON.stringify([live.params, live.groundModel, !!live.sandModel]);
    if (!guide || guide.t !== t || guide.key !== key) {
      const prev = new Int32Array(NN).fill(-1);
      const tfs = live.sandModel && data.terrainFactor ? { terrainFactor: data.terrainFactor, terrainTimeFactor: data.terrainTimeFactor ?? undefined }
        : { terrainFactor: live.groundModel && g ? g.factor : undefined, terrainTimeFactor: live.groundModel && g ? g.factor : undefined };
      const f = dijkstra({ ...grid, ...tfs }, t, massOut(), live.params, true, -1, prev, 'time');
      guide = { t, key, prev, time: f.time };
    }
    if (!isFinite(guide.time[s])) return null;
    const path = [s]; for (let c = s, k = 0; c !== t && k < NN; k++) { c = guide.prev[c]; if (c < 0) return null; path.push(c); }
    return path;
  };
  /** Least-time hours from a cell to the current guide target (NaN if no field yet). */
  const guideHours = (c: number) => (guide ? guide.time[c] / 3600 : NaN);
  const nearestPassable = (i: number) => {
    if (pass[i]) return i;
    const r0 = Math.floor(i / N), c0 = i % N;
    for (let rad = 1; rad < 40; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const r = r0 + dr, c = c0 + dc; if (r >= 0 && c >= 0 && r < N && c < N && pass[r * N + c]) return r * N + c;
    }
    return i;
  };

  // walk-home hours per cell from the planner's own field (least-effort walk with the sample load)
  let homeSrc: Fields | null = null, homeH = new Float32Array(NN).fill(Infinity);
  const homeHours = () => {
    if (live.fields !== homeSrc) { homeSrc = live.fields; homeH = new Float32Array(NN).fill(Infinity); if (homeSrc) for (let i = 0; i < NN; i++) homeH[i] = homeSrc.homeT[i] / 3600; }
    return homeH;
  };

  const fmtH = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const clock = (h: number) => { h = ((h % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
  const tempAt = (h: number) => { const w = live.rems; if (!w) return -40; return (w.min + w.max) / 2 + ((w.max - w.min) / 2) * Math.cos((2 * Math.PI * (h - 14.5)) / 24); };

  const stops: GameStop[] = [];
  const P = { suit: 6, reserve: 1.2, work: 30, start: 9, ls: 0, sep: false };

  return {
    N, SIZE, CELL, EYE: 1.7, elev: z, slope, sand, rock, pass, stops, P,
    hiElev: { n: N, data: z }, elevMin, elevMax, ortho: data.ortho, hi, far: hi?.far ?? null,
    THERM: g ? { night: g.irNight } : null, sandT: g ? g.sandT : new Float32Array(NN), rockT: g ? g.rockT : new Float32Array(NN),
    lonW: meta.lon_left, lonE: meta.lon_right, latN: meta.lat_top, latS: meta.lat_bottom,
    dLon: meta.lon_right - meta.lon_left, dLat: meta.lat_top - meta.lat_bottom,
    LAT0: (meta.lat_top + meta.lat_bottom) / 2, LON0: (meta.lon_left + meta.lon_right) / 2, M_PER_DEG: R_MARS * Math.PI / 180,
    cellOfXY, cellX, cellY, latLngToXY, xyToLatLng, astar, guideHours, edgeTime, speed, nearestPassable,
    doseRate: () => SURFACE_MSV_PER_HOUR, tempAt, fmtH, clock,
    navcam: (s: GameStop) => roverPhotos('MSL', s.sol ?? 0).then((p) => p.slice(0, 4).map((x) => ({ url: x.full }))),
    get maxSlope() { return live.params.maxSlopeDeg; },
    get home() { return homeHours(); },
    get REMS() { return live.rems ? { pressure: live.rems.pressure } : null; },
    get track() { return data.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })); },
    get route() {
      const s = live.summary; if (!s) return null;
      return { pts: s.points.map((p) => ({ x: cellX(p.cell), y: cellY(p.cell) })), dist: s.distance, total: s.totalTime / 3600 };
    },
  };
}
export type GameK = ReturnType<typeof buildK>;

/** Push the current plan and settings into the arrays the game holds. Returns a key that changes with the plan. */
export function syncLive(K: GameK, base: number | null, stopCells: number[], budget: { evaHours: number; reservePct: number; workMinPerStop: number }, names: (cell: number) => { name: string; goal?: string; sol?: number } | null) {
  const max = K.maxSlope;
  for (let i = 0; i < K.pass.length; i++) K.pass[i] = K.slope[i] <= max && K.elev[i] === K.elev[i] ? 1 : 0;
  K.P.suit = budget.evaHours; K.P.reserve = budget.evaHours * budget.reservePct / 100; K.P.work = budget.workMinPerStop;
  K.stops.length = 0;
  if (base == null) return '';
  K.stops.push({ id: 'H', home: true, name: 'Habitat', x: K.cellX(base), y: K.cellY(base), cell: base });
  stopCells.forEach((c, k) => {
    const t = names(c);
    K.stops.push({ id: String(k + 1), name: t?.name ?? `Stop ${k + 1}`, goal: t?.goal, sol: t?.sol, x: K.cellX(c), y: K.cellY(c), cell: c });
  });
  return JSON.stringify([base, stopCells, max]);
}
