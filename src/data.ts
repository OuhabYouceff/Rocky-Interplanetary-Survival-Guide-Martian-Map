// Loads the static data products produced by pipeline/export_app.py and the science agent.
import { buildGround, type Ground, type Thermal } from './ground';
const BASE = import.meta.env.BASE_URL + 'data/';

export interface TerrainMeta {
  w: number; h: number; res: number; ground_res_x: number; ground_res_y: number;
  x_left: number; y_top: number; zmin: number; zscale: number;
  lat_top: number; lat_bottom: number; lon_left: number; lon_right: number;
  ortho: { w: number; h: number; file: string; source: string };
  trek?: { file: string; layer: string; zoom: number; source: string };
  shelter: { w: number; h: number; res: number; n_az: number; radius_m: number; method: string };
  source: string;
}

export interface Waypoint { rmc: string; site: number; drive: number; sol: number; lat: number; lon: number; elev: number }
export interface RoverImage { url: string; instrument: string; mast_az?: number; mast_el?: number; lmst?: string; credit?: string; local?: string | null; depth?: string | null }
export interface ScienceTarget { id?: string; name: string; type?: string; description: string; why_visit?: string; sol?: number; lat: number; lon: number; sources?: string[]; rmc?: string }

export interface Dataset {
  meta: TerrainMeta;
  z: Float32Array;          // planning-grid elevation, NaN = no data
  shelter: Uint8Array;      // blocked-sky %, *2.55
  dose: Uint8Array;         // GCR dose vs open ground %, *2.55
  ortho: HTMLImageElement;
  trek: HTMLImageElement | null;
  waypoints: Waypoint[];
  images: Record<string, RoverImage[]>;
  photo3d: Record<string, number>;
  terrainFactor?: Float32Array | null;     // AI sand map (TETHER pipeline/vision): ENERGY multiplier per cell
  terrainTimeFactor?: Float32Array | null; // AI sand map: TIME multiplier, only where a speed reduction is sourced
  terrainClass?: Uint8Array | null;
  terrainMeta?: TerrainClassMeta | null;
  ground: Ground | null;    // THEMIS sand/rock estimate (null if thermal.json missing)
  targets: ScienceTarget[];
  weather: WeatherCache | null;
  spaceWeather: SpaceWeatherCache | null;
  validation: Record<string, ValidationRow> | null;
}

/** Cached REMS summary (public/data/weather.json); rows hold numbers here, strings in the live feed. */
export interface WeatherCache { latest_60_sols: Record<string, string | number>[]; [k: string]: unknown }
export interface SepEvent { sepID: string; eventTime: string; instruments?: string[] }
export interface SpaceWeatherCache { events: SepEvent[]; [k: string]: unknown }
export interface ValidationRow { period: string; site?: string; ros_ours: number; ros_paper: number; measured: number | null; dsky_ours?: number }
export interface TerrainClass { id: number; name: string; color: string; terrain_factor?: number; speed_factor?: number; factor_source?: string }
export interface TerrainClassMeta { classes?: TerrainClass[]; metrics?: Record<string, unknown>; caveats?: unknown; [k: string]: unknown }
interface ImageRow { rmc: string; images?: RoverImage[]; photo3d?: number }

async function json<T>(f: string, fallback: T): Promise<T> {
  try { const r = await fetch(BASE + f); if (!r.ok) throw new Error(f); return await r.json(); } catch { return fallback; }
}
async function bin(f: string): Promise<ArrayBuffer> {
  const r = await fetch(BASE + f); if (!r.ok) throw new Error('missing ' + f); return r.arrayBuffer();
}
function img(f: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = BASE + f; });
}

export async function loadDataset(onProgress?: (s: string) => void): Promise<Dataset> {
  onProgress?.('terrain');
  const meta = await json<TerrainMeta>('terrain.json', null as unknown as TerrainMeta);
  const [eb, sb, db, ortho, trek] = await Promise.all([bin('elev.bin'), bin('shelter.bin'), bin('dose.bin'), img(meta.ortho.file),
    meta.trek ? img(meta.trek.file).catch(() => null) : Promise.resolve(null)]);
  const q = new Uint16Array(eb);
  const z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  onProgress?.('science');
  const [wps, imgs, targets, weather, spaceWeather, validation] = await Promise.all([
    json<Waypoint[]>('waypoints.json', []),
    json<ImageRow[]>('rover_images_local.json', []).then((r) => (r.length ? r : json<ImageRow[]>('rover_images.json', []))),
    json<ScienceTarget[] | { targets: ScienceTarget[] }>('science_targets.json', []),
    json<WeatherCache | null>('weather.json', null),
    json<SpaceWeatherCache | null>('space_weather.json', null),
    json<Record<string, ValidationRow> | null>('validation_rad.json', null),
  ]);
  onProgress?.('ground');
  const thermal = await json<Thermal | null>('thermal.json', null);
  const images: Record<string, RoverImage[]> = {};
  const photo3d: Record<string, number> = {};
  for (const r of imgs) { images[r.rmc] = r.images ?? []; if (typeof r.photo3d === 'number') photo3d[r.rmc] = r.photo3d; }
  const tlist: ScienceTarget[] = Array.isArray(targets) ? targets : (targets?.targets ?? []);
  // AI terrain classes (pipeline/vision): energy factor per class (Pandolf terrain coefficient), time factor only where sourced
  let terrainClass: Uint8Array | null = null, terrainFactor: Float32Array | null = null, terrainTimeFactor: Float32Array | null = null;
  const terrainMeta = await json<TerrainClassMeta | null>('terrain_class.json', null);
  if (terrainMeta) {
    try {
      terrainClass = new Uint8Array(await bin('terrain_class.bin'));
      ({ terrainFactor, terrainTimeFactor } = terrainClassFactors(terrainClass, terrainMeta));
    } catch { terrainClass = null; }
  }
  let ground: Ground | null = null;
  if (thermal) {
    const { w, h, res } = meta; const sl = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; const a = (z[i + 1] - z[i - 1]) / (2 * res), b = (z[i + w] - z[i - w]) / (2 * res);
      sl[i] = Math.atan(Math.hypot(a, b)) * 180 / Math.PI;
    }
    ground = buildGround(meta, z, sl, thermal);
  }
  return { meta, z, shelter: new Uint8Array(sb), dose: new Uint8Array(db), ortho, trek, waypoints: wps, images, photo3d,
           terrainClass, terrainFactor, terrainTimeFactor, terrainMeta,
           targets: tlist, weather, spaceWeather, validation, ground };
}

/** TETHER's per-class lookup (upstream data.ts): energy = class terrain_factor, time = 1 / speed_factor where sourced, else 1. */
export function terrainClassFactors(terrainClass: Uint8Array, terrainMeta: TerrainClassMeta) {
  const ef = new Float32Array(256).fill(1), sf = new Float32Array(256).fill(1);
  for (const c of terrainMeta.classes ?? []) { ef[c.id] = c.terrain_factor ?? 1; sf[c.id] = c.speed_factor ? 1 / c.speed_factor : 1; }
  const terrainFactor = new Float32Array(terrainClass.length), terrainTimeFactor = new Float32Array(terrainClass.length);
  for (let i = 0; i < terrainClass.length; i++) { terrainFactor[i] = ef[terrainClass[i]]; terrainTimeFactor[i] = sf[terrainClass[i]]; }
  return { terrainFactor, terrainTimeFactor };
}

/** Which per-cell walking-cost multipliers apply: THEMIS ground model (energy and time, Rocky) or the AI sand map
 *  (TETHER: energy = Pandolf terrain coefficient, time only where a speed reduction is sourced). Mutually exclusive. */
export function terrainFactors(data: Dataset | null, groundModel: boolean, sandModel: boolean): { terrainFactor: Float32Array | null; terrainTimeFactor: Float32Array | null } {
  if (sandModel && data?.terrainFactor) return { terrainFactor: data.terrainFactor, terrainTimeFactor: data.terrainTimeFactor ?? null };
  if (groundModel && data?.ground) return { terrainFactor: data.ground.factor, terrainTimeFactor: data.ground.factor };
  return { terrainFactor: null, terrainTimeFactor: null };
}

// ---- coordinate helpers (planning grid <-> lat/lon) ----
const R = 3396190;
export function lonLatToCell(m: TerrainMeta, lon: number, lat: number): [number, number] {
  const x = (lon * Math.PI / 180) * R, y = (lat * Math.PI / 180) * R;
  return [(x - m.x_left) / m.res, (m.y_top - y) / m.res];
}
export function cellToLonLat(m: TerrainMeta, cx: number, cy: number): [number, number] {
  const x = m.x_left + cx * m.res, y = m.y_top - cy * m.res;
  return [(x / R) * 180 / Math.PI, (y / R) * 180 / Math.PI];
}
