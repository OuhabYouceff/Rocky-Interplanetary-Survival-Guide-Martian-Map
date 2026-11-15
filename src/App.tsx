import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { loadDataset, lonLatToCell, terrainFactors, type Dataset } from './data';
import { useStore } from './store';
import { usePlanner } from './planner/usePlanner';
import { summarize } from './planner/summary';
import { slopeDeg, snapWalkable } from './terrain';
import { remsLatest, curiosityNow, type FeedState, type RemsSol } from './feeds';
import MapView, { type Tool } from './components/MapView';
import { LayerControl, Legend, Profile, Readout } from './components/MapChrome';
import FlightPlan from './components/FlightPlan';
import AutopilotPanel from './components/AutopilotPanel';
import StormPanel from './components/StormPanel';
import { PhotoDrawer } from './components/Drawers';
import { Rail, StatusBar } from './components/Shell';
import type { SitingResult } from './planner/siting';
import './styles.css';

const WalkView = lazy(() => import('./components/WalkView'));
const AtlasView = lazy(() => import('./components/AtlasView'));
const ConditionsView = lazy(() => import('./components/ConditionsView'));
const EvidenceView = lazy(() => import('./components/EvidenceView'));
// CAPCOM (TETHER's on-device assistant): its code loads on first open, the language model only on Wake
const Capcom = lazy(() => import('./components/Capcom'));

const Loading = ({ what }: { what: string }) => <div className="splash"><div><span>{what}</span><div className="loadbar"><i /></div></div></div>;

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stage, setStage] = useState('terrain');
  const [tool, setTool] = useState<Tool>('base');
  const [photo, setPhoto] = useState<string | null>(null);
  const [siting, setSiting] = useState<SitingResult | null>(null);
  const [rems, setRems] = useState<RemsSol[] | null>(null);
  const [feeds, setFeeds] = useState<FeedState>('off');
  const [capcomOn, setCapcomOn] = useState(false);
  const { legs, fields, budget, view, base, stops, glove, groundModel, sandModel } = useStore();
  const tf = terrainFactors(data, groundModel, sandModel);

  useEffect(() => { loadDataset(setStage).then(setData).catch((e) => setErr(String(e))); }, []);
  usePlanner(data);

  // live NASA feeds, with the cached copies as fallback
  useEffect(() => {
    if (!data) return;
    const last = data.waypoints[data.waypoints.length - 1];
    Promise.all([remsLatest(undefined), curiosityNow(last ? { sol: last.sol, lat: last.lat, lon: last.lon } : null)]).then(([w, r]) => {
      if (w.state === 'live') setRems(w.sols);
      setFeeds(w.state === 'live' || r.state === 'live' ? 'live' : 'cached');
    });
  }, [data]);

  // demo walk: habitat at Curiosity's sol ~4600 position, stops at real boxwork science targets
  const loadDemo = useCallback(() => {
    if (!data) return;
    const sl = slopeDeg(data);
    const cellOf = (lon: number, lat: number) => { const [cx, cy] = lonLatToCell(data.meta, lon, lat); return snapWalkable(data, sl, Math.round(cy) * data.meta.w + Math.round(cx)); };
    const wp = data.waypoints.find((w) => w.sol >= 4600) ?? data.waypoints[0];
    if (!wp) return;
    const pick = ['Altadena', 'Ayopaya', 'Nevado Sajama', 'Campo Marte'];
    const s = pick.map((n) => data.targets.find((t) => t.name.startsWith(n))).filter(Boolean).map((t) => cellOf(t!.lon, t!.lat));
    useStore.setState({ base: cellOf(wp.lon, wp.lat), stops: s, legs: [] });
    setTool('stop');
  }, [data]);
  useEffect(() => { if (data && base == null) loadDemo(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const slope = useMemo(() => (data ? slopeDeg(data) : new Float32Array()), [data]);
  const routeError = useStore((s) => s.routeError);
  const summary = useMemo(() => (data && !routeError ? summarize(data, legs, fields, budget) : null), [data, legs, fields, budget, routeError]);

  if (err) return <div className="splash"><div><b>Could not load the terrain</b><span>{err}</span></div></div>;
  if (!data) return (
    <div className="splash"><div>
      <b>Rocky</b>
      <span>{{ terrain: 'Loading 1 m terrain of Mount Sharp', science: 'Loading Curiosity data', ground: 'Reading THEMIS sand and rock' }[stage] ?? 'Loading'}</span>
      <div className="loadbar"><i /></div>
    </div></div>
  );

  const mapView = view === 'plan' || view === 'autopilot' || view === 'storm';
  const hint = view === 'plan' ? (base == null ? 'Click the map to place the habitat' : tool === 'stop' ? `Click the map to add stop ${stops.length + 1}` : 'Click the map to move the habitat') : null;

  return (
    <div className={`app ${mapView ? '' : 'wide'} ${glove ? 'glove' : ''}`}>
      <StatusBar summary={summary} feeds={feeds} data={data} />
      <Rail hasRoute={base != null} />
      <main className={`stage ${mapView ? '' : 'full'}`}>
        {mapView ? (
          <>
            <div style={{ position: 'relative', minHeight: 0, display: 'grid' }}>
              <MapView data={data} tool={tool} readOnly={view !== 'plan'} onPickWaypoint={setPhoto} siting={view === 'autopilot' ? siting : null} />
              <LayerControl />
              <Legend siting={view === 'autopilot' && !!siting} />
              <Readout data={data} slope={slope} />
              {hint && <div className="map-hint">{hint}</div>}
              {photo && <PhotoDrawer data={data} rmc={photo} onClose={() => setPhoto(null)} />}
            </div>
            <Profile s={summary} />
          </>
        ) : view === 'walk' ? (
          <Suspense fallback={<Loading what="Building the 3D terrain" />}><WalkView data={data} summary={summary} /></Suspense>
        ) : view === 'atlas' ? (
          <Suspense fallback={<Loading what="Loading the atlas" />}><AtlasView data={data} /></Suspense>
        ) : view === 'conditions' ? (
          <Suspense fallback={<Loading what="Loading weather" />}><ConditionsView data={data} live={rems} /></Suspense>
        ) : (
          <Suspense fallback={<Loading what="Loading evidence" />}><EvidenceView data={data} /></Suspense>
        )}
      </main>
      {view === 'plan' && <FlightPlan data={data} summary={summary} tool={tool} setTool={setTool} onDemo={loadDemo} />}
      <AutopilotPanel data={data} hidden={view !== 'autopilot'} terrainFactor={tf.terrainFactor ?? undefined} terrainTimeFactor={tf.terrainTimeFactor ?? undefined}
        onApply={({ base, stops }) => useStore.setState({ base, stops, legs: [] })}
        onShowSiting={(on, s) => setSiting(on && s ? s : null)} />
      {view === 'storm' && <StormPanel data={data} summary={summary} />}
      {capcomOn
        ? <Suspense fallback={<button className="capcom-fab" disabled><span className="capcom-dot busy" /> CAPCOM</button>}><Capcom data={data} initialOpen /></Suspense>
        : <button className="capcom-fab" onClick={() => setCapcomOn(true)} title="CAPCOM: ask the planner in plain words"><span className="capcom-dot" /> CAPCOM</button>}
    </div>
  );
}
