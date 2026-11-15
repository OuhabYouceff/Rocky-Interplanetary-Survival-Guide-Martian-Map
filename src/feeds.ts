// Live NASA feeds (all CORS-open, checked in the prototype's site research). Each call falls back to the
// copy cached in public/data when the network is unavailable, and reports which one it used.
export type FeedState = 'live' | 'cached' | 'off';

export interface RemsSol {
  sol: string; terrestrial_date: string; ls: string; season: string; min_temp: string; max_temp: string;
  pressure: string; atmo_opacity: string; sunrise: string; sunset: string; local_uv_irradiance_index: string;
}

const REMS = 'https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json';
const ROVER_NOW = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints_current.json';
const RAW = 'https://mars.nasa.gov/api/v1/raw_image_items/';

async function getJSON<T>(url: string, ms = 12000): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`${r.status}`); return (await r.json()) as T; }
  finally { clearTimeout(t); }
}

/** Latest REMS sols (newest first). */
export async function remsLatest(cached: RemsSol[] | undefined): Promise<{ state: FeedState; sols: RemsSol[] }> {
  try {
    const j = await getJSON<{ soles: RemsSol[] }>(REMS, 20000);
    if (j.soles?.length) return { state: 'live', sols: j.soles.slice(0, 120) };
  } catch { /* fall back */ }
  return cached?.length ? { state: 'cached', sols: cached } : { state: 'off', sols: [] };
}

export interface RoverNow { sol: number; lat: number; lon: number; elev?: number; odometerKm?: number }

export async function curiosityNow(fallback: RoverNow | null): Promise<{ state: FeedState; pos: RoverNow | null }> {
  try {
    const j = await getJSON<{ features: { properties: Record<string, number> }[] }>(ROVER_NOW);
    const p = j.features?.[0]?.properties;
    if (p && p.lat != null) return { state: 'live', pos: { sol: p.sol, lat: p.lat, lon: p.lon, elev: p.elev_geoid, odometerKm: p.dist_km } };
  } catch { /* fall back */ }
  return { state: fallback ? 'cached' : 'off', pos: fallback };
}

export interface RawImage { small: string; full: string; caption: string }

/** Rover camera frames for one sol: Curiosity Navcam (raw image API) or Perseverance Navcam / Mastcam-Z (RSS feed). */
export async function roverPhotos(rover: 'MSL' | 'M20', sol: number): Promise<RawImage[]> {
  if (rover === 'MSL') {
    const j = await getJSON<{ items: { url: string; https_url?: string; instrument: string; extended?: { sample_type?: string } }[] }>(
      `${RAW}?order=sol%20desc&per_page=100&page=0&condition_1=msl:mission&condition_2=${sol}:sol:in&condition_3=NAV_RIGHT_B,NAV_LEFT_B:instrument:in`);
    return (j.items ?? []).filter((i) => /EDR_[FS]/.test(i.url) && i.extended?.sample_type !== 'thumbnail')
      .map((i) => ({ small: i.https_url || i.url, full: i.https_url || i.url, caption: i.instrument.replace(/_/g, ' ') }));
  }
  const j = await getJSON<{ images: { camera: { instrument: string }; sample_type: string; image_files: Record<string, string> }[] }>(
    `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=${sol}`);
  return (j.images ?? []).filter((i) => /NAVCAM_LEFT|MCZ_LEFT/.test(i.camera.instrument) && i.sample_type === 'Full')
    .map((i) => ({ small: i.image_files.small, full: i.image_files.large || i.image_files.full_res, caption: i.camera.instrument.replace(/_/g, ' ') }));
}
