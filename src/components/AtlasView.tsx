// Atlas: all of Mars as a flat map, ported from the Marswalk prototype's Mars Maps (maps.js).
// Imagery: NASA Mars Trek (Viking colour, MOLA, THEMIS, HiRISE) + Caltech global CTX mosaic.
// Names: USGS/IAU Gazetteer of Planetary Nomenclature. Rovers: live NASA MMGIS traverses and waypoints
// (with the stored copies in public/data/rovers when the feed does not answer).
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Dataset } from '../data';
import { cellToLonLat } from '../data';
import { useStore } from '../store';
import { roverPhotos, type RawImage } from '../feeds';

const R_MARS = 3389500, MPD = (2 * Math.PI * R_MARS) / 360;
const rad = (d: number) => (d * Math.PI) / 180;
function marsDist(a: [number, number], b: [number, number]) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MARS * Math.asin(Math.min(1, Math.sqrt(h)));
}
const fmtD = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 100000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m / 1000).toLocaleString()} km`);
const fmtLL = (lat: number, lon: number) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

type Name = [string, number, number, string, number, string, string];
interface Rover { key: 'MSL' | 'M20'; name: string; color: string; wp: { sol: number; lat: number; lon: number }[] }
type Pick =
  | { kind: 'place'; n: Name }
  | { kind: 'rover'; r: Rover; p: { sol: number; lat: number; lon: number } }
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'site' };

const RETINA = (window.devicePixelRatio || 1) >= 1.5;
const TILE = { updateWhenZooming: false, keepBuffer: 3, detectRetina: RETINA, noWrap: true } as const;
const HIRISE_BOUNDS: L.LatLngBoundsExpression = [[-4.9254743, 137.1224669], [-4.2489588, 137.7298129]];
const trek = (id: string, ext: string, maxN: number, o: L.TileLayerOptions = {}) =>
  L.tileLayer(`https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`,
    { tileSize: 256, maxNativeZoom: maxN - (RETINA ? 1 : 0), maxZoom: 17, bounds: [[-90, -180], [90, 180]], ...TILE, ...o });
const BASES = {
  satellite: { label: 'Satellite', make: () => L.layerGroup([
    trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7, { maxZoom: 8, attribution: 'Viking colour: NASA/USGS via Mars Trek' }),
    L.tileLayer('https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}', { tileSize: 512, zoomOffset: -1, minZoom: 7, maxNativeZoom: 13 - (RETINA ? 1 : 0), maxZoom: 17, ...TILE, attribution: 'CTX: NASA/JPL/MSSS, Caltech Murray Lab' }),
    trek('curiosity_hirise_mosaic', 'png', 16, { minZoom: 11, bounds: HIRISE_BOUNDS, attribution: 'HiRISE: NASA/JPL/UArizona' }),
  ]) },
  colour: { label: 'Colour', make: () => trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7, { attribution: 'Viking colour mosaic: NASA/USGS via Mars Trek' }) },
  terrain: { label: 'Elevation', make: () => trek('Mars_MGS_MOLA_ClrShade_merge_global_463m', 'jpg', 7, { attribution: 'MOLA colour shaded relief: NASA/JPL/GSFC' }) },
  thermal: { label: 'Thermal', make: () => L.layerGroup([trek('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 7, { maxZoom: 9 }), trek('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'png', 9, { attribution: 'THEMIS day IR: NASA/JPL/ASU' })]) },
};
type BaseKey = keyof typeof BASES;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export default function AtlasView({ data }: { data: Dataset }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const baseLayer = useRef<L.Layer | null>(null);
  const nameLayer = useRef(L.layerGroup());
  const measureLayer = useRef(L.layerGroup());
  const [base, setBase] = useState<BaseKey>('satellite');
  const [mapGen, setMapGen] = useState(0);
  const [names, setNames] = useState<Name[]>([]);
  const [rovers, setRovers] = useState<Rover[]>([]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [q, setQ] = useState(''); const [sel, setSel] = useState(0);
  const [measure, setMeasure] = useState(false); const [mPts, setMPts] = useState<[number, number][]>([]);
  const measureRef = useRef(measure); measureRef.current = measure;
  const [photos, setPhotos] = useState<RawImage[] | 'loading' | 'error' | null>(null);
  const setView = useStore((s) => s.setView);

  const siteBounds = useMemo(() => {
    const [w, n] = cellToLonLat(data.meta, 0, 0), [e, s] = cellToLonLat(data.meta, data.meta.w, data.meta.h);
    return L.latLngBounds([s, w], [n, e]);
  }, [data]);

  // map setup
  useEffect(() => {
    const m = L.map(host.current!, { crs: L.CRS.EPSG4326, center: [-4.75, 137.4], zoom: 9, minZoom: 1, maxZoom: 17, zoomSnap: 1, zoomControl: false,
      wheelPxPerZoomLevel: 140, preferCanvas: true, maxBounds: [[-95, -200], [95, 200]] });
    m.attributionControl.setPrefix('Leaflet');
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    nameLayer.current.addTo(m); measureLayer.current.addTo(m);
    L.rectangle(siteBounds, { color: '#ffffff', weight: 2, fill: false, dashArray: '6 5' })
      .bindTooltip('Rocky EVA site: 1 m terrain, walk-home map', { className: 't', sticky: true })
      .on('click', (e) => { L.DomEvent.stop(e); setPick({ kind: 'site' }); }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (measureRef.current) { setMPts((p) => [...p, [e.latlng.lat, e.latlng.lng]]); return; }
      setPick({ kind: 'point', lat: e.latlng.lat, lon: e.latlng.lng });
    });
    map.current = m; setMapGen((g) => g + 1);
    return () => { m.remove(); map.current = null; baseLayer.current = null; };
  }, [siteBounds]);

  useEffect(() => {
    const m = map.current; if (!m) return;
    if (baseLayer.current) m.removeLayer(baseLayer.current);
    baseLayer.current = BASES[base].make().addTo(m);
  }, [base, mapGen]);

  // gazetteer
  useEffect(() => {
    fetch(import.meta.env.BASE_URL + 'data/mars_names.json').then((r) => r.json()).then((j) => setNames(j.items as Name[])).catch(() => setNames([]));
  }, []);
  useEffect(() => {
    const m = map.current; if (!m) return;
    const refresh = () => {
      const layer = nameLayer.current; layer.clearLayers(); if (!names.length) return;
      const b = m.getBounds().pad(0.1), z = m.getZoom(), mPerPx = (MPD * 180) / (256 * 2 ** z);
      const vis = names.filter((n) => b.contains([n[1], n[2]]) && (n[4] * 1000 / mPerPx > 70 || (n[4] === 0 && z >= 12))).sort((a, c) => c[4] - a[4]);
      const placed: { x: number; y: number; w: number; h: number }[] = []; let k = 0;
      for (const n of vis) {
        const pt = m.latLngToContainerPoint([n[1], n[2]]), w = n[0].length * 7 + 10, h = 16;
        if (placed.some((p) => Math.abs(p.x - pt.x) < (p.w + w) / 2 && Math.abs(p.y - pt.y) < (p.h + h) / 2)) continue;
        placed.push({ x: pt.x, y: pt.y, w, h });
        L.marker([n[1], n[2]], { icon: L.divIcon({ className: '', html: `<div class="place-label">${esc(n[0])}</div>`, iconSize: [0, 0] }), keyboard: false, interactive: false }).addTo(layer);
        if (++k >= 70) break;
      }
    };
    refresh(); m.on('moveend', refresh); return () => { m.off('moveend', refresh); };
  }, [names, mapGen]);

  // rovers (live NASA MMGIS, stored copy as fallback)
  useEffect(() => {
    if (!mapGen) return;
    const defs: Rover[] = [{ key: 'MSL', name: 'Curiosity', color: '#ffffff', wp: [] }, { key: 'M20', name: 'Perseverance', color: '#73b3e7', wp: [] }];
    const group = L.layerGroup(); const stops = L.layerGroup();
    let alive = true;
    const get = (key: string, f: string) => fetch(`https://mars.nasa.gov/mmgis-maps/${key}/Layers/json/${key}_${f}.json`)
      .then((x) => { if (!x.ok) throw new Error(String(x.status)); return x.json(); })
      .catch(() => fetch(`${import.meta.env.BASE_URL}data/rovers/${key}_${f}.json`).then((x) => x.json()));
    Promise.all(defs.map(async (r) => {
      try {
        const [tr, wp] = await Promise.all([get(r.key, 'traverse'), get(r.key, 'waypoints')]);
        const lines: L.LatLngExpression[][] = [];
        for (const f of tr.features) { const g = f.geometry; (g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]).forEach((seg: number[][]) => lines.push(seg.map((p) => [p[1], p[0]] as [number, number]))); }
        L.polyline(lines, { color: '#000000', weight: 6, opacity: 0.5, interactive: false }).addTo(group);
        L.polyline(lines, { color: r.color, weight: 2.5 }).bindTooltip(`${r.name} traverse, live from NASA`, { sticky: true, className: 't' }).addTo(group);
        r.wp = wp.features.map((f: { properties: { sol: number; lat: number; lon: number } }) => f.properties).filter((p: { lat: number }) => p.lat != null).sort((a: { sol: number }, b: { sol: number }) => a.sol - b.sol);
        r.wp.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 4, color: '#000000', weight: 1, fillColor: r.color, fillOpacity: 1 })
          .bindTooltip(`${r.name}, sol ${p.sol}`, { className: 't' }).on('click', (e) => { L.DomEvent.stop(e); setPick({ kind: 'rover', r, p }); }).addTo(stops));
        const last = r.wp[r.wp.length - 1];
        L.marker([last.lat, last.lon], { icon: L.divIcon({ className: '', html: `<div class="rover-pin"><i style="background:${r.color}"></i>${r.name}</div>`, iconSize: [0, 0] }), zIndexOffset: 1000 })
          .on('click', () => setPick({ kind: 'rover', r, p: last })).addTo(group);
      } catch { /* feed unreachable: the atlas still works without it */ }
    })).then(() => { if (alive) setRovers(defs.filter((r) => r.wp.length)); });
    const m = map.current; if (m) group.addTo(m);
    const zoom = () => { if (!m) return; if (m.getZoom() >= 13) stops.addTo(m); else m.removeLayer(stops); };
    m?.on('zoomend', zoom);
    return () => { alive = false; m?.off('zoomend', zoom); group.remove(); stops.remove(); };
  }, [mapGen]);

  // measure line
  useEffect(() => {
    const layer = measureLayer.current; layer.clearLayers();
    if (mPts.length) {
      L.polyline(mPts, { color: '#ffffff', weight: 2.5, dashArray: '6 5' }).addTo(layer);
      mPts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#000000', weight: 2, fillColor: '#D83933', fillOpacity: 1 }).addTo(layer));
    }
  }, [mPts]);
  const mTotal = mPts.reduce((s, p, i) => (i ? s + marsDist(mPts[i - 1], p) : 0), 0);

  // photos for a rover stop
  useEffect(() => {
    if (pick?.kind !== 'rover') { setPhotos(null); return; }
    let alive = true; setPhotos('loading');
    roverPhotos(pick.r.key, pick.p.sol).then((ps) => { if (alive) setPhotos(ps.filter((_, k) => k % Math.max(1, Math.floor(ps.length / 6)) === 0).slice(0, 6)); }).catch(() => alive && setPhotos('error'));
    return () => { alive = false; };
  }, [pick]);

  // search
  const sugg = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [];
    const out: { t: string; sub: string; go: () => void }[] = [];
    const ll = s.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([ew])?$/i);
    if (ll) { const la = +ll[1] * (ll[2] === 's' ? -1 : 1); let lo = +ll[3] * (ll[4] === 'w' ? -1 : 1); if (lo > 180) lo -= 360; out.push({ t: fmtLL(la, lo), sub: 'Coordinates', go: () => { map.current?.flyTo([la, lo], 12); setPick({ kind: 'point', lat: la, lon: lo }); } }); }
    const sm = s.match(/^(?:(curiosity|msl|perseverance|percy|m20)\s*)?sol\s*(\d+)$/);
    if (sm) for (const r of rovers.filter((r) => !sm[1] || (/^(p|m20)/.test(sm[1]) ? r.key === 'M20' : r.key === 'MSL'))) {
      const sol = +sm[2]; const p = r.wp.reduce<Rover['wp'][number] | null>((b, w) => (w.sol <= sol && (!b || w.sol >= b.sol) ? w : b), null);
      if (p) out.push({ t: `${r.name}, sol ${p.sol}`, sub: p.sol === sol ? 'Rover position' : `Last stop on or before sol ${sol}`, go: () => { map.current?.flyTo([p.lat, p.lon], 16); setPick({ kind: 'rover', r, p }); } });
    }
    if ('rocky eva site boxwork mount sharp'.includes(s) || s.startsWith('eva')) out.push({ t: 'Rocky EVA site, Mount Sharp boxwork', sub: 'Open the walk planner area', go: () => { map.current?.flyToBounds(siteBounds); setPick({ kind: 'site' }); } });
    for (const r of rovers) if (r.name.toLowerCase().includes(s)) { const p = r.wp[r.wp.length - 1]; out.push({ t: r.name, sub: `Rover, latest sol ${p.sol}`, go: () => { map.current?.flyTo([p.lat, p.lon], 15); setPick({ kind: 'rover', r, p }); } }); }
    const hits = names.filter((n) => n[0].toLowerCase().includes(s)).sort((a, b) => (Number(b[0].toLowerCase().startsWith(s)) - Number(a[0].toLowerCase().startsWith(s))) || b[4] - a[4]);
    for (const n of hits.slice(0, 8 - out.length)) out.push({ t: n[0], sub: `${n[3]}${n[4] ? `, ${n[4]} km` : ''}`, go: () => { setPick({ kind: 'place', n }); map.current?.flyTo([n[1], n[2]], Math.max(3, Math.min(14, Math.round(Math.log2(180 / Math.max(0.01, ((n[4] || 2) * 1000 / MPD) * 2.2)))))); } });
    return out.slice(0, 8);
  }, [q, names, rovers, siteBounds]);
  const choose = (k: number) => { const s = sugg[k]; if (!s) return; setQ(''); s.go(); };

  const near = (lat: number, lon: number, n = 3) => names.map((x) => ({ x, d: marsDist([lat, lon], [x[1], x[2]]) })).sort((a, b) => a.d - b.d).slice(0, n);
  const inSite = (lat: number, lon: number) => siteBounds.contains([lat, lon]);

  return (
    <div className="atlas">
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div className="atlas-search">
        <input value={q} placeholder="Search craters, rovers, sol 4719 or -4.8, 137.4" aria-label="Search Mars"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(sugg.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter') choose(sel);
            if (e.key === 'Escape') setQ('');
          }} />
        {q && (
          <div className="atlas-sugg" role="listbox">
            {sugg.length ? sugg.map((s, k) => (
              <button key={k} role="option" aria-selected={k === sel} onClick={() => choose(k)}><b>{s.t}</b><span>{s.sub}</span></button>
            )) : <button disabled><b>No match</b><span>Try a crater name</span></button>}
          </div>
        )}
      </div>

      <div className="atlas-bases" role="group" aria-label="Map type">
        {(Object.keys(BASES) as BaseKey[]).map((k) => <button key={k} aria-pressed={base === k} onClick={() => setBase(k)}>{BASES[k].label}</button>)}
        <button aria-pressed={measure} onClick={() => { setMeasure(!measure); setMPts([]); }}>{measure ? 'Stop measuring' : 'Measure'}</button>
      </div>

      {(pick || measure) && (
        <div className="atlas-side">
          {measure ? (<>
            <h3>Measure</h3>
            <p className="small soft">Click points on the map. Distances follow the curve of Mars (radius 3,389.5 km).</p>
            <div className="big-stat num" style={{ fontSize: 40, marginTop: 10 }}>{mPts.length > 1 ? fmtD(mTotal) : '0 m'}</div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => setMPts([])}>Clear points</button></div>
          </>) : pick?.kind === 'site' ? (<>
            <h3>Rocky EVA site</h3>
            <p className="small soft">Curiosity's boxwork on Mount Sharp. The planner has 1 m terrain, sand and rock, radiation shelter and the walk-home map for this 3.2 km square.</p>
            <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => setView('plan')}>Plan a walk here</button>
          </>) : pick?.kind === 'place' ? (<>
            <h3>{pick.n[0]}</h3>
            <p className="small soft">{pick.n[3]}{pick.n[4] ? `, ${pick.n[4]} km across` : ''}</p>
            <dl className="kv"><dt>Centre</dt><dd>{fmtLL(pick.n[1], pick.n[2])}</dd></dl>
            {pick.n[5] && <p className="small soft" style={{ marginTop: 10 }}>Named for {pick.n[5]}</p>}
            <p className="xs muted" style={{ marginTop: 10 }}>USGS/IAU Gazetteer of Planetary Nomenclature.</p>
          </>) : pick?.kind === 'rover' ? (<>
            <h3>{pick.r.name}, sol {pick.p.sol}</h3>
            <dl className="kv"><dt>Position</dt><dd>{fmtLL(pick.p.lat, pick.p.lon)}</dd><dt>Latest sol</dt><dd>{pick.r.wp[pick.r.wp.length - 1].sol}</dd></dl>
            <div className="photos" style={{ marginTop: 12 }}>
              {photos === 'loading' && <p className="small muted">Loading camera frames from NASA…</p>}
              {photos === 'error' && <p className="small muted">NASA's raw image service did not answer.</p>}
              {Array.isArray(photos) && !photos.length && <p className="small muted">No camera frames listed for this sol.</p>}
              {Array.isArray(photos) && photos.map((p, i) => <figure key={i}><a href={p.full} target="_blank" rel="noreferrer"><img src={p.small} alt={`${pick.r.name} ${p.caption}, sol ${pick.p.sol}`} loading="lazy" referrerPolicy="no-referrer" /></a><figcaption>{p.caption}</figcaption></figure>)}
            </div>
            {inSite(pick.p.lat, pick.p.lon) && <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => setView('plan')}>Plan a walk here</button>}
          </>) : pick?.kind === 'point' ? (<>
            <h3>{fmtLL(pick.lat, pick.lon)}</h3>
            <p className="small soft">Nearest named features</p>
            <dl className="kv">{near(pick.lat, pick.lon).map(({ x, d }) => <span key={x[6]} style={{ display: 'contents' }}><dt>{x[0]}</dt><dd>{fmtD(d)}</dd></span>)}</dl>
            {inSite(pick.lat, pick.lon) && <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => setView('plan')}>Plan a walk here</button>}
          </>) : null}
          {!measure && <button className="link" style={{ marginTop: 14 }} onClick={() => setPick(null)}>Close</button>}
        </div>
      )}
    </div>
  );
}
