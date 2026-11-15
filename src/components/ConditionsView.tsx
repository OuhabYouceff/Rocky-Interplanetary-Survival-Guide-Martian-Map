import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data';
import { useStore } from '../store';
import { marsNow } from '../marsclock';
import type { RemsSol } from '../feeds';
import { Prov, Slider } from './ui';

interface Sol { sol: number; date: string; ls: number; min: number; max: number; p: number; uv: string; rise: string; set: string; opacity: string }
const num = (v: unknown) => (v === '--' || v == null || v === '' ? NaN : +v);
const hm = (t: string) => { const [a, b] = (t || '0:0').split(':').map(Number); return a + b / 60; };
const fmtH = (h: number) => { h = ((h % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

function normalize(rows: (RemsSol | Record<string, unknown>)[]): Sol[] {
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return { sol: num(x.sol), date: String(x.terrestrial_date ?? ''), ls: num(x.ls), min: num(x.min_temp), max: num(x.max_temp), p: num(x.pressure),
      uv: String(x.local_uv_irradiance_index ?? ''), rise: String(x.sunrise ?? ''), set: String(x.sunset ?? ''), opacity: String(x.atmo_opacity ?? '') };
  }).filter((s) => isFinite(s.sol) && isFinite(s.min) && isFinite(s.max));
}

/** Southern-hemisphere season at Gale (4.6° S) from solar longitude. */
function season(ls: number) {
  if (ls < 90) return 'Southern autumn';
  if (ls < 180) return 'Southern winter';
  if (ls < 270) return 'Southern spring, perihelion';
  return 'Southern summer';
}
/** Global dust storms cluster in Ls 180–330 (the perihelion season). */
function dust(ls: number): [string, string] {
  if (ls >= 220 && ls <= 330) return ['High', 'tone-bad'];
  if (ls >= 180) return ['Elevated', 'tone-warn'];
  return ['Low', 'tone-ok'];
}

export default function ConditionsView({ data, live }: { data: Dataset; live: RemsSol[] | null }) {
  const [t, setT] = useState(marsNow());
  useEffect(() => { const i = setInterval(() => setT(marsNow()), 15000); return () => clearInterval(i); }, []);
  const { budget } = useStore();
  const [start, setStart] = useState(9);

  const sols = useMemo(() => normalize(live?.length ? live : data.weather?.latest_60_sols ?? []).slice(0, 60), [live, data.weather]);
  const latest = sols[0];
  const series = useMemo(() => [...sols].reverse(), [sols]);

  if (!latest) return <div className="empty-state"><div><h2>No weather yet</h2><p>The REMS feed could not be reached and no cached copy is available.</p></div></div>;

  const rise = hm(latest.rise), set = hm(latest.set);
  const tempAt = (h: number) => (latest.min + latest.max) / 2 + ((latest.max - latest.min) / 2) * Math.cos((2 * Math.PI * (h - 14.5)) / 24);
  const end = start + budget.evaHours;
  const inDaylight = start >= rise && end <= set;
  let tLo = Infinity, tHi = -Infinity; for (let h = start; h <= end; h += 0.1) { const v = tempAt(h); tLo = Math.min(tLo, v); tHi = Math.max(tHi, v); }
  const [dRisk, dTone] = dust(latest.ls);
  const isDay = t.lmstHours >= rise && t.lmstHours <= set;

  // 60-sol chart geometry
  const W = 640, H = 220, L = 38, R = 12, T = 12, B = 26;
  const s0 = series[0]?.sol ?? 0, s1 = series[series.length - 1]?.sol ?? 1;
  const tmin = Math.min(...series.map((s) => s.min)) - 4, tmax = Math.max(...series.map((s) => s.max)) + 4;
  const X = (sol: number) => L + ((sol - s0) / Math.max(1, s1 - s0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - tmin) / (tmax - tmin)) * (H - T - B);
  const band = `M${series.map((s) => `${X(s.sol)},${Y(s.max)}`).join('L')}L${[...series].reverse().map((s) => `${X(s.sol)},${Y(s.min)}`).join('L')}Z`;
  const maxL = series.map((s, i) => `${i ? 'L' : 'M'}${X(s.sol)},${Y(s.max)}`).join('');
  const minL = series.map((s, i) => `${i ? 'L' : 'M'}${X(s.sol)},${Y(s.min)}`).join('');
  const ticks = [-80, -60, -40, -20, 0, 20].filter((v) => v > tmin && v < tmax);

  // diurnal chart
  const DW = 640, DH = 200, DY = (v: number) => 14 + (1 - (v - (latest.min - 6)) / (latest.max - latest.min + 12)) * (DH - 40);
  const DX = (h: number) => 34 + (h / 24) * (DW - 46);
  const curve = Array.from({ length: 97 }, (_, k) => k / 4).map((h, i) => `${i ? 'L' : 'M'}${DX(h)},${DY(tempAt(h))}`).join('');

  return (
    <div className="page">
      <div className="page-head">
        <h1>Weather at Gale crater</h1>
        <p>Curiosity's REMS weather station has reported every sol since 2012. Use it to pick an EVA window: daylight, the warmest hours, and the season's dust risk.</p>
      </div>
      <div className="page-body">
        <div className="grid-3">
          <div className="block">
            <h2>Now at Gale</h2>
            <div className="big-stat num">{t.lmst}<small>LMST</small></div>
            <dl className="kv">
              <dt>Curiosity sol</dt><dd>{t.sol.toLocaleString()}</dd>
              <dt>Sun</dt><dd>{isDay ? 'Up' : 'Down'}, sets {latest.set}</dd>
              <dt>Earth time</dt><dd>{t.utc} UTC</dd>
            </dl>
            <p className="xs muted" style={{ marginTop: 10 }}>Mars24 algorithm (Allison and McEwen 2000) at 137.4° E.</p>
          </div>
          <div className="block">
            <h2>Latest report<Prov k="measured" /></h2>
            <div className="big-stat num">{latest.max}<small>°C high</small></div>
            <dl className="kv">
              <dt>Overnight low</dt><dd>{latest.min} °C</dd>
              <dt>Air pressure</dt><dd>{latest.p} Pa</dd>
              <dt>UV index</dt><dd>{latest.uv.replace('_', ' ')}</dd>
              <dt>Sky</dt><dd>{latest.opacity}</dd>
            </dl>
            <p className="xs muted" style={{ marginTop: 10 }}>Sol {latest.sol}, {latest.date}. {live?.length ? 'Live from the NASA feed.' : 'Cached copy of the NASA feed.'}</p>
          </div>
          <div className="block">
            <h2>Season</h2>
            <div className="big-stat num">{Math.round(latest.ls)}<small>° Ls</small></div>
            <dl className="kv">
              <dt>Season</dt><dd>{season(latest.ls)}</dd>
              <dt>Dust storm risk</dt><dd className={dTone}>{dRisk}</dd>
              <dt>Daylight</dt><dd>{latest.rise} to {latest.set}</dd>
            </dl>
            <p className="xs muted" style={{ marginTop: 10 }}>Global dust storms cluster between Ls 180° and 330°, around perihelion.</p>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 40 }}>
          <div className="block">
            <h2>Plan the EVA window</h2>
            <p className="small soft" style={{ margin: '0 0 12px' }}>A {budget.evaHours}-hour walk starting at the time below, against today's light and temperature.</p>
            <Slider label="Leave the habitat at" value={start} min={4} max={20} step={0.5} format={fmtH} unit=" LMST" onChange={setStart} prov="assumed" />
            <svg className="chart" viewBox={`0 0 ${DW} ${DH}`} role="img" aria-label="Temperature through the sol with the EVA window">
              <rect x={DX(0)} y={14} width={DX(rise) - DX(0)} height={DH - 40} fill="#ececec" />
              <rect x={DX(set)} y={14} width={DX(24) - DX(set)} height={DH - 40} fill="#ececec" />
              <rect x={DX(rise)} y={14} width={DX(set) - DX(rise)} height={DH - 40} fill="#ffffff" />
              <rect x={DX(start)} y={14} width={DX(Math.min(24, end)) - DX(start)} height={DH - 40} fill={inDaylight ? 'rgba(0,94,162,.1)' : 'rgba(216,57,51,.1)'} stroke={inDaylight ? '#005EA2' : '#D83933'} />
              <path d={curve} fill="none" stroke="#1b1b1b" strokeWidth={2} />
              <line x1={DX(t.lmstHours)} x2={DX(t.lmstHours)} y1={10} y2={DH - 26} stroke="#D83933" strokeWidth={1.5} strokeDasharray="4 3" />
              {[0, 6, 12, 18, 24].map((h) => <text key={h} x={DX(h)} y={DH - 8} textAnchor="middle">{fmtH(h)}</text>)}
              <text x={DX(t.lmstHours) + 4} y={22}>now</text>
              <text x={4} y={DY(latest.max) + 4}>{latest.max}°</text>
              <text x={4} y={DY(latest.min) + 4}>{latest.min}°</text>
            </svg>
            <p className={`small ${inDaylight ? 'soft' : 'tone-warn'}`} style={{ marginTop: 8 }}>
              {inDaylight
                ? `Back by ${fmtH(end)}, before sunset at ${latest.set}. Air from ${Math.round(tLo)} to ${Math.round(tHi)} °C during the walk.`
                : `This window runs outside daylight (${latest.rise} to ${latest.set}). Shift the start or shorten the EVA.`}
            </p>
            <p className="xs muted">The hour-by-hour curve is a cosine fitted to the reported low and high, an approximation.</p>
          </div>
          <div className="block">
            <h2>The last {series.length} sols<Prov k="measured" /></h2>
            <p className="small soft" style={{ margin: '0 0 12px' }}>Daily high and low air temperature at the rover.</p>
            <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily high and low temperature over recent sols">
              {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="#e0e0e0" /><text x={L - 6} y={Y(v) + 4} textAnchor="end">{v}°</text></g>)}
              <path d={band} fill="rgba(0,94,162,.08)" />
              <path d={maxL} fill="none" stroke="#1b1b1b" strokeWidth={1.8} />
              <path d={minL} fill="none" stroke="#005EA2" strokeWidth={1.8} />
              <text x={L} y={H - 6}>sol {s0}</text>
              <text x={W - R} y={H - 6} textAnchor="end">sol {s1}</text>
            </svg>
            <div className="row xs soft" style={{ gap: 18, marginTop: 6 }}>
              <span><i style={{ display: 'inline-block', width: 14, height: 2, background: '#1b1b1b', marginRight: 6, verticalAlign: 3 }} />Daily high</span>
              <span><i style={{ display: 'inline-block', width: 14, height: 2, background: '#005EA2', marginRight: 6, verticalAlign: 3 }} />Overnight low</span>
            </div>
            <p className="xs muted" style={{ marginTop: 10 }}>REMS data: NASA/JPL-Caltech and Centro de Astrobiología (CSIC-INTA). Outreach-grade values, influenced by the rover itself.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
