import { useMemo, useState } from 'react';
import type { Dataset } from '../data';
import { cellToLonLat } from '../data';
import { useStore, type LayerKey } from '../store';
import { fmtKcal, fmtTime, type RouteSummary } from '../planner/summary';
import { shelterAt } from '../terrain';
import { Icon } from './ui';

const GROUPS: { title: string; items: [LayerKey, string, string][] }[] = [
  { title: 'Imagery', items: [['ortho', 'HiRISE colour, 25 cm', '#b07a55'], ['trek', 'CTX context (Mars Trek)', '#8a7462'], ['hillshade', 'Relief shading', '#9a9a9d']] },
  { title: 'Analysis', items: [['reserve', 'Walk-home reserve', '#ffffff'], ['slope', 'Slopes over 8°', '#D83933'], ['shelter', 'Sky shelter (radiation)', '#005EA2'], ['ground', 'Ground type (THEMIS)', '#C18A3B'], ['sand', 'Sand (AI)', '#3C8CFF']] },
  { title: 'Context', items: [['traverse', "Curiosity's path", '#ffffff'], ['photos', 'Rover photo spots', '#ffffff'], ['targets', 'Science targets', '#1B1B1B']] },
];

export function LayerControl() {
  const [open, setOpen] = useState(false);
  const { layers, toggleLayer } = useStore();
  return (
    <div className="maptools">
      <button className="btn layers-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{Icon.layers} Layers</button>
      {open && (
        <div className="layers-pop" role="group" aria-label="Map layers">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4>{g.title}</h4>
              {g.items.map(([k, label, sw]) => (
                <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} /><span className="swatch" style={{ background: sw }} />{label}</label>
              ))}
              {g.title === 'Analysis' && layers.sand && <p className="xs muted" style={{ margin: '4px 0 0' }}>Sand (AI): TETHER's classifier on HiRISE colour and the 1 m DEM. On 330 held-out cells: 95% accuracy, 92% of cells it calls sand are sand, but it finds only 59% of the sand. Unmarked does not mean firm.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ siting }: { siting: boolean }) {
  const { layers, flare, budget } = useStore();
  let items: [string, string, boolean?][] = [];
  if (flare) items = [['#00A91C', `Reaches the habitat within ${budget.flareLeadMin} min`], ['#D83933', 'Too far: needs a closer shelter']];
  else if (siting) items = [['#D9E8F6', 'Most science in one walk'], ['#005EA2', 'Some'], ['#28282D', 'Little'], ['transparent', 'Unshaded: slope over 10°, not a candidate']];
  else if (layers.reserve) items = [['#ffffff', 'Tether line: edge of the walk-back rule', true], ['#bdbdbd', 'Walk home, every 10 min', true], ['#D83933', 'Beyond the tether']];
  if (layers.ground) items.push(['#C18A3B', 'Sandier (cold at night)'], ['#6F8FB8', 'Rockier (warm at night)']);
  if (layers.sand) items.push(['#3C8CFF', 'Loose sand (AI, finds ~6 in 10)'], ['#FFD65A', 'Rough ground (1 m DEM)']);
  if (layers.slope) items.push(['#D83933', 'Steeper than 20°']);
  if (!items.length) return null;
  return (
    <div className="legend" aria-label="Legend">
      {items.map(([c, t, line]) => <span key={t}><i className={line ? 'line' : ''} style={{ background: c }} />{t}</span>)}
    </div>
  );
}

export function Readout({ data, slope }: { data: Dataset; slope: Float32Array }) {
  const { hover, fields, budget, flare } = useStore();
  if (hover == null) return null;
  const [lon, lat] = cellToLonLat(data.meta, hover % data.meta.w, Math.floor(hover / data.meta.w));
  const home = fields?.homeT[hover], out = fields?.outT[hover], homeE = fields?.homeE[hover], fast = fields?.fastT[hover];
  const T = budget.evaHours * 3600;
  const rt = out != null && home != null ? out + home + budget.workMinPerStop * 60 : NaN;
  const margin = (T * (1 - budget.reservePct / 100) - rt) / T;
  const g = data.ground;
  return (
    <div className="readout" aria-live="polite">
      <div className="coord">{Math.abs(lat).toFixed(5)}° S, {lon.toFixed(5)}° E</div>
      <dl>
        <dt>Elevation</dt><dd>{Math.round(data.z[hover])} m</dd>
        <dt>Slope</dt><dd>{slope[hover]?.toFixed(1)}°</dd>
        {fields && isFinite(home ?? NaN) ? (<>
          <dt>Walk home</dt><dd>{fmtTime(home!)}, {fmtKcal(homeE!)}</dd>
          <dt>{flare ? 'Fastest walk home' : 'Out, work, back'}</dt><dd>{fmtTime(flare ? fast! : rt)}</dd>
          {!flare && <><dt>Left after</dt><dd className={margin < 0 ? 'tone-bad' : margin < 0.1 ? 'tone-warn' : 'tone-ok'}>{margin < 0 ? 'Beyond the tether' : `${Math.round(margin * 100)}% spare`}</dd></>}
        </>) : fields ? (<><dt>Walk home</dt><dd className="tone-bad">No safe path</dd></>) : null}
        <dt>Sky blocked</dt><dd>{shelterAt(data, hover).toFixed(0)}%</dd>
        <dt>Cosmic-ray dose</dt><dd>{shelterAt(data, hover, 'dose').toFixed(0)}% of open ground</dd>
        {data.terrainClass && (data.terrainClass[hover] === 2 || data.terrainClass[hover] === 3) && <><dt>AI ground</dt><dd>{data.terrainClass[hover] === 2 ? 'Loose sand, effort ×2.1' : 'Rough, effort ×1.3, slower'}</dd></>}
        {g && (g.sand[hover] > 0 || g.rock[hover] > 0) && <><dt>Ground</dt><dd>{g.sand[hover] >= g.rock[hover] ? `Sandy (${Math.round(g.sand[hover] * 100)}%)` : `Rocky (${Math.round(g.rock[hover] * 100)}%)`}</dd></>}
      </dl>
    </div>
  );
}

export function Profile({ s }: { s: RouteSummary | null }) {
  const { budget, setHover, stops } = useStore();
  const W = 1000, H = 100, P = 6;
  const geom = useMemo(() => {
    if (!s || s.points.length < 2) return null;
    const pts = s.points; const D = pts[pts.length - 1].dist || 1;
    const zs = pts.map((p) => p.z); const zmin = Math.min(...zs), zmax = Math.max(...zs);
    const X = (d: number) => P + (d / D) * (W - 2 * P);
    const Yz = (z: number) => H - P - ((z - zmin) / Math.max(1, zmax - zmin)) * (H - 2 * P) * 0.8;
    const Ym = (m: number) => H - P - Math.max(0, Math.min(1, m)) * (H - 2 * P);
    const zLine = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.dist).toFixed(1)},${Yz(p.z).toFixed(1)}`).join('');
    const zArea = `${zLine}L${X(D)},${H}L${X(0)},${H}Z`;
    const mPath = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.dist).toFixed(1)},${Ym(p.margin).toFixed(1)}`).join('');
    const stopsX: number[] = []; for (let i = 1; i < pts.length; i++) if (pts[i].leg !== pts[i - 1].leg) stopsX.push(X(pts[i].dist));
    return { zArea, zLine, mPath, X, Ym, zmin, zmax, D, stopsX };
  }, [s]);
  if (!s || !geom) return <div className="profile empty">{stops.length ? 'Computing the route and the walk-home map…' : 'Add science stops to see the climb and the walk-home reserve along the route.'}</div>;
  const worst = s.points[s.minMarginAt];
  const yRule = geom.Ym(budget.reservePct / 100);
  return (
    <div className="profile">
      <div className="profile-head">
        <b>Route profile, {(geom.D / 1000).toFixed(2)} km</b>
        <span><i style={{ background: '#005EA2' }} />Walk-home reserve</span>
        <span><i style={{ background: '#D83933' }} />{budget.reservePct}% rule</span>
        <span><i style={{ background: '#a3a3a6' }} />Elevation {Math.round(geom.zmin)} to {Math.round(geom.zmax)} m</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Lowest reserve ${Math.round(s.minMargin * 100)} percent`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const d = ((e.clientX - r.left) / r.width * W - P) / (W - 2 * P) * geom.D;
          let best = s.points[0]; for (const p of s.points) if (Math.abs(p.dist - d) < Math.abs(best.dist - d)) best = p;
          setHover(best.cell);
        }}
        onPointerLeave={() => setHover(null)}>
        <path d={geom.zArea} fill="rgba(27,27,27,.06)" />
        <path d={geom.zLine} fill="none" stroke="#a3a3a6" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <rect x={P} y={yRule} width={W - 2 * P} height={H - P - yRule} fill="rgba(216,57,51,.06)" />
        <line x1={P} x2={W - P} y1={yRule} y2={yRule} stroke="#D83933" strokeWidth={1.2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        {geom.stopsX.map((x, i) => <line key={i} x1={x} x2={x} y1={P} y2={H - P} stroke="rgba(27,27,27,.15)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <path d={geom.mPath} fill="none" stroke="#005EA2" strokeWidth={2.2} vectorEffect="non-scaling-stroke" />
        <circle cx={geom.X(worst.dist)} cy={geom.Ym(worst.margin)} r={4.5} fill={s.pass ? '#00A91C' : '#D83933'} stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
