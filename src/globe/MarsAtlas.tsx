// The Atlas on the planet: a Mars globe plus the prototype's Mars Maps tools (search, map types, measure,
// what's-here card, rover photos). Used by the landing page and by the dashboard's Atlas screen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { roverPhotos, type RawImage } from '../feeds';
import type { BaseKey, GlobeHandle, Pick, Suggestion } from './marsGlobe';

const BASE = import.meta.env.BASE_URL;
const fmtLL = (lat: number, lon: number) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
const fmtD = (m: number) => (m < 1000 ? `${Math.round(m)} m` : m < 100000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m / 1000).toLocaleString()} km`);

export interface AtlasProps {
  aimLeft?: boolean;
  showTools: boolean;
  onReady?: (g: GlobeHandle) => void;
  onHeight?: (km: number) => void;
  onLoaded?: () => void;
  onOpenSite: () => void;
  focusSite?: number;          // bump to open the site card
  inApp?: boolean;             // inside the dashboard (no landing top bar)
  children?: ReactNode;
}

export default function MarsAtlas({ aimLeft, showTools, onReady, onHeight, onLoaded, onOpenSite, focusSite, inApp, children }: AtlasProps) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeHandle | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [q, setQ] = useState(''); const [sugg, setSugg] = useState<Suggestion[]>([]); const [sel, setSel] = useState(0);
  const [base, setBase] = useState<BaseKey>('colour');
  const [measure, setMeasure] = useState(false); const [mLen, setMLen] = useState({ m: 0, n: 0 });
  const [photos, setPhotos] = useState<RawImage[] | 'loading' | 'error' | null>(null);
  const [siteRect, setSiteRect] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ createMarsGlobe }, meta] = await Promise.all([import('./marsGlobe'), fetch(BASE + 'data/terrain.json').then((r) => r.json()).catch(() => null)]);
      if (!alive || !host.current) return;
      const rect: [number, number, number, number] = meta ? [meta.lon_left, meta.lat_bottom, meta.lon_right, meta.lat_top] : [137.3585, -4.8355, 137.4125, -4.7815];
      setSiteRect(rect);
      const g = createMarsGlobe(host.current, {
        siteRect: rect, aimLeft, onSite: onOpenSite, onHeight: (km) => onHeight?.(km), onReady: () => onLoaded?.(),
        onPick: (p) => setPick(p), onMeasure: (m, n) => setMLen({ m, n }),
      });
      globe.current = g; onReady?.(g);
    })();
    return () => { alive = false; globe.current?.destroy(); globe.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSugg(globe.current ? globe.current.search(q) : []); setSel(0); }, [q]);
  useEffect(() => { if (focusSite) setPick({ kind: 'site' }); }, [focusSite]);
  useEffect(() => {
    if (pick?.kind !== 'rover') { setPhotos(null); return; }
    let alive = true; setPhotos('loading');
    roverPhotos(pick.rover.key, pick.stop.sol).then((ps) => { if (alive) setPhotos(ps.filter((_, k) => k % Math.max(1, Math.floor(ps.length / 6)) === 0).slice(0, 6)); }).catch(() => alive && setPhotos('error'));
    return () => { alive = false; };
  }, [pick]);

  const nearby = useMemo(() => (pick?.kind === 'point' ? globe.current?.nearest(pick.lat, pick.lon) ?? [] : []), [pick]);
  const inSite = (lat: number, lon: number) => !!siteRect && lon >= siteRect[0] && lon <= siteRect[2] && lat >= siteRect[1] && lat <= siteRect[3];
  const choose = (k: number) => { const x = sugg[k]; if (!x) return; setQ(''); x.go(); };
  const card = measure || pick;

  return (
    <div className={`globe-atlas ${inApp ? 'in-app' : ''}`}>
      <div ref={host} className="globe-host" aria-label="Mars globe. Drag to turn, scroll to zoom, click a place for details." />
      {children}
      {showTools && (
        <>
          <div className="ga-search">
            <input value={q} placeholder="Search craters, rovers, sol 4719 or -4.8, 137.4" aria-label="Search Mars"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(sugg.length - 1, v + 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
                if (e.key === 'Enter') choose(sel);
                if (e.key === 'Escape') setQ('');
              }} />
            {q && (
              <div className="ga-sugg" role="listbox">
                {sugg.length ? sugg.map((x, k) => <button key={k} role="option" aria-selected={k === sel} onClick={() => choose(k)}><b>{x.t}</b><span>{x.sub}</span></button>)
                  : <button disabled><b>No match</b><span>Try a crater name</span></button>}
              </div>
            )}
          </div>
          <div className="ga-bar" role="group" aria-label="Map type and tools">
            {(['colour', 'elevation', 'thermal'] as BaseKey[]).map((k) => (
              <button key={k} aria-pressed={base === k} onClick={() => { setBase(k); globe.current?.setBase(k); }}>{{ colour: 'Colour', elevation: 'Elevation', thermal: 'Thermal' }[k]}</button>
            ))}
            <button aria-pressed={measure} onClick={() => { const on = !measure; setMeasure(on); globe.current?.setMeasure(on); setMLen({ m: 0, n: 0 }); }}>{measure ? 'Stop measuring' : 'Measure'}</button>
            <button onClick={() => globe.current?.flyToSite()}>EVA site</button>
            <button onClick={() => globe.current?.home()}>Orbit</button>
          </div>
          {card && (
            <aside className="ga-card">
              {measure ? (<>
                <p className="landing-label">Measure</p>
                <h3>{mLen.n > 1 ? fmtD(mLen.m) : 'Click points'}</h3>
                <p className="small soft">Distance along the surface of Mars (Cesium's Mars ellipsoid). {mLen.n > 1 ? `${mLen.n} points.` : ''}</p>
                <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={() => globe.current?.clearMeasure()}>Clear points</button></div>
              </>) : pick?.kind === 'site' ? (<>
                <p className="landing-label">Gale crater, Mount Sharp</p>
                <h3>Rocky EVA site</h3>
                <p className="small soft">Curiosity's boxwork: 3.2 km of 1 m terrain with the walk-home map, radiation shelter and 11 science targets.</p>
                <button className="btn primary block" style={{ marginTop: 14 }} onClick={onOpenSite}>Plan a walk here</button>
              </>) : pick?.kind === 'place' ? (<>
                <p className="landing-label">{pick.type}</p>
                <h3>{pick.name}</h3>
                <dl className="kv">{pick.dia ? <><dt>Diameter</dt><dd>{pick.dia} km</dd></> : null}<dt>Centre</dt><dd>{fmtLL(pick.lat, pick.lon)}</dd></dl>
                {pick.origin && <p className="small soft" style={{ marginTop: 10 }}>Named for {pick.origin}</p>}
                <p className="xs muted" style={{ marginTop: 10 }}>USGS/IAU Gazetteer of Planetary Nomenclature.</p>
              </>) : pick?.kind === 'rover' ? (<>
                <p className="landing-label">{pick.rover.name}, live from NASA</p>
                <h3>Sol {pick.stop.sol.toLocaleString()}</h3>
                <dl className="kv"><dt>Position</dt><dd>{fmtLL(pick.stop.lat, pick.stop.lon)}</dd>{pick.stop.km != null && <><dt>Driven so far</dt><dd>{pick.stop.km.toFixed(2)} km</dd></>}<dt>Landed</dt><dd>{pick.rover.land}</dd></dl>
                <div className="photos" style={{ marginTop: 12 }}>
                  {photos === 'loading' && <p className="small muted">Loading camera frames from NASA…</p>}
                  {photos === 'error' && <p className="small muted">NASA's raw image service did not answer.</p>}
                  {Array.isArray(photos) && !photos.length && <p className="small muted">No camera frames listed for this sol.</p>}
                  {Array.isArray(photos) && photos.map((p, i) => <figure key={i}><a href={p.full} target="_blank" rel="noreferrer"><img src={p.small} alt={`${pick.rover.name} ${p.caption}, sol ${pick.stop.sol}`} loading="lazy" referrerPolicy="no-referrer" /></a><figcaption>{p.caption}</figcaption></figure>)}
                </div>
                {inSite(pick.stop.lat, pick.stop.lon) && <button className="btn primary block" style={{ marginTop: 14 }} onClick={onOpenSite}>Plan a walk here</button>}
              </>) : pick?.kind === 'point' ? (<>
                <p className="landing-label">What's here</p>
                <h3>{fmtLL(pick.lat, pick.lon)}</h3>
                <dl className="kv">{nearby.map((x) => <span key={x.name} style={{ display: 'contents' }}><dt>{x.name}</dt><dd>{fmtD(x.km * 1000)}</dd></span>)}</dl>
                {inSite(pick.lat, pick.lon) && <button className="btn primary block" style={{ marginTop: 14 }} onClick={onOpenSite}>Plan a walk here</button>}
              </>) : null}
              {!measure && <button className="link" style={{ marginTop: 14 }} onClick={() => setPick(null)}>Close</button>}
            </aside>
          )}
        </>
      )}
    </div>
  );
}
