import { useEffect, useState } from 'react';
import type { Dataset } from '../data';
import { AltSwitch, Prov, Slider, type Provenance } from './ui';
import { metabolicWatts, G_EARTH } from '../planner/physics';


const SOURCES: [string, string, Provenance][] = [
  ['Terrain heights, 1 m', 'USGS MSL Gale DEM Mosaic 1 m v3 (USGS Astrogeology), resampled to a 3 m planning grid', 'measured'],
  ['Colour imagery, 25 cm', 'USGS MSL Gale HiRISE LRGB mosaic (HiRISE: NASA/JPL/University of Arizona)', 'measured'],
  ['Context imagery', 'NASA JPL Mars Trek, CTX block-adjusted mosaic of Gale', 'measured'],
  ['Sand and rock', 'THEMIS night-time infrared (Mars Odyssey, NASA/JPL/ASU), 80 m pixels, placed by terrain shape', 'measured'],
  ["Curiosity's path", 'NASA MMGIS waypoint record, matched exactly to the live feed', 'measured'],
  ['Rover photos', 'Curiosity raw images, Navcam and Mastcam (NASA/JPL-Caltech, MSSS)', 'measured'],
  ['Science targets', 'NASA Curiosity mission blog, sols 4219 to 5052; positions are the rover on that sol', 'measured'],
  ['Weather', 'REMS (NASA/JPL-Caltech, Centro de Astrobiología), live with cached fallback', 'measured'],
  ['Space weather', 'NASA CCMC DONKI solar energetic particle log, May 2024', 'measured'],
  ['Surface dose rate', '0.64 mSv per sol, Curiosity RAD (Hassler et al. 2014, Science 343)', 'measured'],
  ['Walk-home reserve', 'Dijkstra least-effort search over 1.14 million cells, outbound and reversed', 'computed'],
  ['Autopilot plan', 'Exact search over every subset and order of targets, re-walked cell by cell', 'computed'],
  ['Sky shelter', 'Horizon scan, 360° out to 20 km with Mars curvature, after Guo et al. 2026', 'computed'],
  ['Walking speed and energy', 'Marquez 2008 and Santee et al. 2001 via NASA/MIT Pextant, Earth-measured', 'assumed'],
  ['Suit, crew and loads', 'Every mass, duration, pace and slope limit is a slider', 'assumed'],
  ['Science values', 'Drill sites score higher than imaging stops; editable', 'assumed'],
];

type StopStats = { n: number; r: number; r_ci: [number, number] };
type StopsSummary = { stops: number; observations: number; model: StopStats; terrain_matters: { n: number; r: number; same_direction: number }; measured_over_model_slope: number; open_ground: { n: number; scatter: number } };
type StopsCheck = StopsSummary & {
  rad_days: number; sols: [number, number]; window_sols: number; corrected: StopsSummary;
  space_weather: { beta: number; r_dose_vs_telescope: number }; points: [number, number][];
  quiz?: { sol: number; sky: number; model: number; measured: number; n: number }[];
};

// Named places on Curiosity's route, by the sols it was parked there (NASA mission updates; Guo et al. 2026 Table 1).
const PLACES: [number, number, string][] = [[1430, 1460, 'Murray Buttes'], [2730, 2740, 'Tower Buttes'], [3315, 3330, 'Maria Gordon Notch'], [3560, 3570, 'Paraitepuy Pass']];

/** Guess the dose drop at a sheltered rover stop, then see Rocky's prediction and what Curiosity's detector measured. */
function GuessReveal({ quiz }: { quiz: NonNullable<StopsCheck['quiz']> }) {
  const cards = quiz.filter((q) => q.model < 0);
  const [i, setI] = useState(0), [guess, setGuess] = useState(5), [shown, setShown] = useState(false);
  if (!cards.length) return null;
  const q = cards[i % cards.length], place = PLACES.find(([a, b]) => q.sol >= a && q.sol <= b)?.[2];
  const bars: [string, number, string][] = [['Your guess', guess, '#8c8c8f'], ['Rocky predicted', -q.model, '#005EA2'], ['Curiosity measured', -q.measured, '#1b1b1b']];
  const mine = Math.abs(guess + q.measured), ours = Math.abs(q.model - q.measured);
  return (
    <div className="block" style={{ marginTop: 40 }}>
      <h2>Try it: can you beat the map?</h2>
      <p className="small soft" style={{ margin: '0 0 12px', maxWidth: 720 }}>
        Stop {(i % cards.length) + 1} of {cards.length}. On sol {q.sol} Curiosity parked {place ? `at ${place}` : 'beside steep ground'}, where rock walls hide <b>{q.sky.toFixed(0)}% of the sky</b>. Cosmic rays come from the sky, so the dose should fall. By how much, compared with where it parked in the two weeks before and after?
      </p>
      <div style={{ maxWidth: 520 }}>
        {!shown && <Slider label="Your guess: the dose drops by" value={guess} min={0} max={35} step={1} unit="%" onChange={setGuess} />}
        {shown && bars.map(([name, v, c]) => (
          <div key={name} style={{ margin: '10px 0' }}>
            <div className="row small" style={{ justifyContent: 'space-between' }}><span>{name}</span><b className="num">{v.toFixed(v % 1 ? 1 : 0)}%</b></div>
            <div style={{ height: 14, background: '#ececec', borderRadius: 3 }}><div style={{ height: 14, width: `${Math.max(0, Math.min(100, (v / 35) * 100))}%`, background: c, borderRadius: 3 }} /></div>
          </div>
        ))}
        {shown && <p className="small" style={{ margin: '12px 0 0' }}>
          You were {mine.toFixed(1)} points off; Rocky was {ours.toFixed(1)}. {mine < ours ? 'You beat the map on this one.' : 'The map was closer.'} <span className="soft">Measured from {q.n} detector readings at this stop.</span>
        </p>}
        <div className="row" style={{ marginTop: 14 }}>
          {!shown
            ? <button className="btn primary" onClick={() => setShown(true)}>Reveal what Curiosity measured</button>
            : <button className="btn primary" onClick={() => { setI(i + 1); setShown(false); setGuess(5); }}>Next stop</button>}
        </div>
      </div>
    </div>
  );
}

/** The model against Curiosity's detector at every stop of the mission (pipeline/validate_rad_stops.py). Hidden if the file is absent. */
function AllStops() {
  const [d, setD] = useState<StopsCheck | null>(null);
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/validation_rad_stops.json`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const lo = -26, hi = 12, S = 300, L = 44;
  const X = (v: number) => L + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * S, Y = (v: number) => 12 + S - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * S;
  const fmt = (v: number) => v.toLocaleString('en-US');
  return (
    <>
    {d.quiz && <GuessReveal quiz={d.quiz} />}
    <div className="grid-2" style={{ marginTop: 40 }}>
      <div className="block">
        <h2>Every stop of the mission</h2>
        <p className="small soft" style={{ margin: '0 0 14px' }}>
          The same model, tested directly on the detector's own readings: {fmt(d.observations)} RAD dose measurements at {fmt(d.stops)} places Curiosity parked, sols {d.sols[0]} to {d.sols[1]}. Each stop is compared with the readings at other stops within {d.window_sols} sols, which removes the Sun's cycle. Day-to-day space weather is removed with the detector's own upward telescope, which terrain barely blocks. Nothing is fitted to the terrain model.
        </p>
        <svg className="chart" viewBox={`0 0 ${L + S + 16} ${S + 52}`} role="img" aria-label={`Measured dose change against modelled dose change at ${d.stops} stops, r ${d.model.r.toFixed(2)}`} style={{ maxWidth: 440 }}>
          {[-20, -10, 0, 10].map((v) => (
            <g key={v}>
              <line x1={X(lo)} x2={X(hi)} y1={Y(v)} y2={Y(v)} stroke="#e0e0e0" />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end">{v}%</text>
              <text x={X(v)} y={S + 30} textAnchor="middle">{v}%</text>
            </g>
          ))}
          <line x1={X(lo)} y1={Y(lo)} x2={X(hi)} y2={Y(hi)} stroke="#8c8c8f" strokeDasharray="5 4" />
          {d.points.map(([m, y], i) => <circle key={i} cx={X(m)} cy={Y(y)} r={Math.abs(m) > 3 ? 3.5 : 1.6} fill={Math.abs(m) > 3 ? '#1b1b1b' : '#005EA2'} fillOpacity={Math.abs(m) > 3 ? 0.85 : 0.35} />)}
          <text x={L + S / 2} y={S + 50} textAnchor="middle">Dose change Rocky predicts from terrain</text>
          <text x={12} y={12 + S / 2} textAnchor="middle" transform={`rotate(-90 12 ${12 + S / 2})`}>RAD measured</text>
        </svg>
        <div className="row xs soft" style={{ gap: 18, marginTop: 4 }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#1b1b1b', marginRight: 6, verticalAlign: -1 }} />Terrain should change the dose by more than 3%</span>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#005EA2', opacity: 0.5, marginRight: 6, verticalAlign: -1 }} />Open ground</span>
        </div>
      </div>
      <div className="block">
        <h2>Result<Prov k="computed" /></h2>
        <div className="grid-2" style={{ gap: 18, marginTop: 12 }}>
          <div><div className="big-stat num">{fmt(d.stops)}</div><p className="small soft">Rover stops tested, from {fmt(d.rad_days)} days of NASA RAD Level 2 data</p></div>
          <div><div className="big-stat num">{d.corrected.model.r.toFixed(2)}</div><p className="small soft">Correlation with the detector across all stops (95% interval {d.corrected.model.r_ci[0].toFixed(2)} to {d.corrected.model.r_ci[1].toFixed(2)}). Without the space-weather step: {d.model.r.toFixed(2)}</p></div>
          <div><div className="big-stat num">{Math.round(100 * d.corrected.terrain_matters.same_direction)}<small>%</small></div><p className="small soft">Of the {d.corrected.terrain_matters.n} stops where terrain should matter, the detector moved the way the model said (r = {d.corrected.terrain_matters.r.toFixed(2)})</p></div>
          <div><div className="big-stat num">{(100 * d.open_ground.scatter).toFixed(1)}<small>%</small> → {(100 * d.corrected.open_ground.scatter).toFixed(1)}<small>%</small></div><p className="small soft">Noise on open ground, before and after removing space weather</p></div>
        </div>
        <p className="xs muted" style={{ marginTop: 14 }}>How big is the effect? The detector sees {d.measured_over_model_slope.toFixed(2)} of the predicted change in the raw readings: the ground itself radiates, so blocked sky is not fully dark. The upward telescope loses a little signal near cliffs too, so the space-weather version understates size ({d.corrected.measured_over_model_slope.toFixed(2)}) and is used for agreement only. Limits: parking times are inferred from the waypoint sols, air pressure is not modelled, and solar-storm readings are clipped as outliers. Source: NASA SPDF, MSL RAD Level 2, detector E dose and A1·A2 telescope counts.</p>
      </div>
    </div>
    </>
  );
}

type WalkPoint = { id: string; g: number; v: number; grade: number; body: number; suit: number; vo2: number; sd: number; n: number; weak: boolean };
type WalkCheck = { j_per_ml: number; reports: { id: string; title: string; year: number; url: string }[]; points: WalkPoint[] };

/** The walking-energy model (the planner's own function) against NASA's measurements of people walking in the Mark III suit. */
function WalkingCheck() {
  const [d, setD] = useState<WalkCheck | null>(null);
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/validation_walking.json`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)); }, []);
  if (!d) return null;
  const rows = d.points.map((q) => {
    const k = (q.body * d.j_per_ml) / 60, measured = q.vo2 * k;
    return { ...q, measured, sdW: q.sd * k, model: metabolicWatts(q.body + q.suit, q.g * G_EARTH, q.v, q.grade), scaled: metabolicWatts(q.body + q.suit, q.g * G_EARTH, q.v, q.grade, true) };
  });
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const err = rows.map((r) => r.model / r.measured - 1), errS = rows.map((r) => r.scaled / r.measured - 1);
  const inSpread = rows.filter((r) => Math.abs(r.model - r.measured) <= r.sdW).length;
  const mars = rows.filter((r) => r.g > 0.3), marsErr = mean(mars.map((r) => r.model / r.measured - 1));
  const max = 1100, S = 300, L = 52;
  const X = (v: number) => L + (Math.min(v, max) / max) * S, Y = (v: number) => 12 + S - (Math.min(v, max) / max) * S;
  return (
    <div className="grid-2" style={{ marginTop: 40 }}>
      <div className="block">
        <h2>Walking effort against people in suits</h2>
        <p className="small soft" style={{ margin: '0 0 14px' }}>
          NASA put test subjects in the 121 kg Mark III suit on a treadmill, lifted by a rig to simulate Moon and Mars gravity, and measured the oxygen they used. We ran the planner's own energy function on the same {rows.length} conditions: same mass, gravity, speed and slope.
        </p>
        <svg className="chart" viewBox={`0 0 ${L + S + 16} ${S + 52}`} role="img" aria-label={`Modelled against measured metabolic rate for ${rows.length} suited walking conditions`} style={{ maxWidth: 440 }}>
          {[0, 250, 500, 750, 1000].map((v) => (
            <g key={v}>
              <line x1={X(0)} x2={X(max)} y1={Y(v)} y2={Y(v)} stroke="#e0e0e0" />
              <text x={L - 8} y={Y(v) + 4} textAnchor="end">{v}</text>
              <text x={X(v)} y={S + 30} textAnchor="middle">{v}</text>
            </g>
          ))}
          <line x1={X(0)} y1={Y(0)} x2={X(max)} y2={Y(max)} stroke="#8c8c8f" strokeDasharray="5 4" />
          {rows.map((r) => (
            <g key={r.id}>
              <line x1={X(r.measured - r.sdW)} x2={X(r.measured + r.sdW)} y1={Y(r.model)} y2={Y(r.model)} stroke="#8c8c8f" strokeWidth={1.5} />
              <circle cx={X(r.measured)} cy={Y(r.model)} r={5.5} fill={r.g > 0.3 ? '#C1440E' : r.grade > 0 ? '#005EA2' : '#1b1b1b'} stroke="#ffffff" strokeWidth={1.5} />
            </g>
          ))}
          <text x={L + S / 2} y={S + 50} textAnchor="middle">NASA measured, watts (bar: spread between subjects)</text>
          <text x={12} y={12 + S / 2} textAnchor="middle" transform={`rotate(-90 12 ${12 + S / 2})`}>Rocky's model, watts</text>
        </svg>
        <div className="row xs soft" style={{ gap: 18, marginTop: 4 }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#1b1b1b', marginRight: 6, verticalAlign: -1 }} />Moon gravity, flat</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#005EA2', marginRight: 6, verticalAlign: -1 }} />Moon gravity, uphill 10 to 30%</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#C1440E', marginRight: 6, verticalAlign: -1 }} />Mars gravity, flat</span>
        </div>
      </div>
      <div className="block">
        <h2>Result<Prov k="computed" /></h2>
        <div className="grid-2" style={{ gap: 18, marginTop: 12 }}>
          <div><div className="big-stat num">{(100 * mean(err.map(Math.abs))).toFixed(0)}<small>%</small></div><p className="small soft">Average gap between the model and NASA's measurement, over {rows.length} conditions</p></div>
          <div><div className="big-stat num">{mean(err) >= 0 ? '+' : ''}{(100 * mean(err)).toFixed(0)}<small>%</small></div><p className="small soft">Overall bias: the model neither flatters nor punishes the walker on average</p></div>
          <div><div className="big-stat num">{inSpread}<small>of {rows.length}</small></div><p className="small soft">Conditions where the model lands inside the spread between NASA's own test subjects</p></div>
          <div><div className="big-stat num">{(100 * marsErr).toFixed(0)}<small>%</small></div><p className="small soft">At Mars gravity the model is low: plan with a reserve, as the default 20% does</p></div>
        </div>
        <p className="xs muted" style={{ marginTop: 14 }}>
          The optional "scale flat-ground effort with gravity" setting would be {Math.abs(100 * mean(errS)).toFixed(0)}% too low against these measurements, so it stays off. Limits: {rows.length} conditions only; group averages were read from the individual-subject markers in NASA's charts, not from printed tables; the Mars-gravity series has 4 subjects and faster speeds than our pace cap; a treadmill with a lifting rig is not loose Martian ground; the test suit weighs 121 kg, twice our default. Oxygen is converted at {d.j_per_ml} J per ml. Sources: {d.reports.map((r, i) => <span key={r.id}>{i ? '; ' : ''}<a href={r.url} target="_blank" rel="noreferrer">{r.title} ({r.year})</a></span>)}.
        </p>
      </div>
    </div>
  );
}

export default function EvidenceView({ data }: { data: Dataset }) {
  const rows = Object.values(data.validation ?? {});
  const max = 40, S = 300, L = 44, B = 40;
  const Xs = (v: number) => L + (v / max) * S, Ys = (v: number) => 12 + S - (v / max) * S;
  const ours = rows.map((r) => r.ros_ours), paper = rows.map((r) => r.ros_paper);
  const n = rows.length, mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const ma = mean(ours), mb = mean(paper);
  const r = rows.length ? rows.reduce((s, _, i) => s + (ours[i] - ma) * (paper[i] - mb), 0) / Math.sqrt(ours.reduce((s, v) => s + (v - ma) ** 2, 0) * paper.reduce((s, v) => s + (v - mb) ** 2, 0)) : NaN;
  const mad = mean(rows.map((x) => Math.abs(x.ros_ours - x.ros_paper)));
  const parked = rows.filter((x) => x.measured != null && x.dsky_ours != null);
  const doseGap = mean(parked.map((x) => Math.abs((x.dsky_ours ?? 0) - (x.measured ?? 0))));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Evidence</h1>
        <p>Every number on the map comes from NASA or USGS data, a calculation on that data, or an assumption you can change. This page shows which is which, and how the radiation model was checked against Curiosity's own detector.</p>
      </div>
      <div className="page-body">
        <div style={{ maxWidth: 520, marginBottom: 28 }}><AltSwitch id="evidence" view="evidence" /></div>
        <div className="grid-2">
          <div className="block">
            <h2>Sky shelter against Curiosity's detector</h2>
            <p className="small soft" style={{ margin: '0 0 14px' }}>
              Guo et al. (2026, JGR Planets) measured how much sky the terrain blocked at {n} periods when Curiosity's radiation detector was parked or driving. We recomputed those values with our own horizon scan on the same 1 m terrain model.
            </p>
            <svg className="chart" viewBox={`0 0 ${L + S + 16} ${S + 12 + B}`} role="img" aria-label={`Our blocked sky versus the published values, r ${r.toFixed(3)}`} style={{ maxWidth: 440 }}>
              {[0, 10, 20, 30, 40].map((v) => (
                <g key={v}>
                  <line x1={Xs(0)} x2={Xs(max)} y1={Ys(v)} y2={Ys(v)} stroke="#e0e0e0" />
                  <text x={L - 8} y={Ys(v) + 4} textAnchor="end">{v}%</text>
                  <text x={Xs(v)} y={S + 30} textAnchor="middle">{v}%</text>
                </g>
              ))}
              <line x1={Xs(0)} y1={Ys(0)} x2={Xs(max)} y2={Ys(max)} stroke="#8c8c8f" strokeDasharray="5 4" />
              {rows.map((x) => (
                <g key={x.period}>
                  <circle cx={Xs(x.ros_paper)} cy={Ys(x.ros_ours)} r={5.5} fill={x.period.startsWith('P') ? '#1b1b1b' : '#005EA2'} stroke="#ffffff" strokeWidth={1.5} />
                </g>
              ))}
              <text x={L + S / 2} y={S + 50} textAnchor="middle">Published (Guo et al. 2026, Table 1)</text>
              <text x={12} y={12 + S / 2} textAnchor="middle" transform={`rotate(-90 12 ${12 + S / 2})`}>Rocky</text>
            </svg>
            <div className="row xs soft" style={{ gap: 18, marginTop: 4 }}>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#1b1b1b', marginRight: 6, verticalAlign: -1 }} />Parked next to a feature</span>
              <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#005EA2', marginRight: 6, verticalAlign: -1 }} />Background period</span>
              <span><i style={{ display: 'inline-block', width: 14, height: 0, borderTop: '2px dashed #8c8c8f', marginRight: 6, verticalAlign: 3 }} />Perfect agreement</span>
            </div>
          </div>
          <div className="block">
            <h2>Result<Prov k="computed" /></h2>
            <div className="grid-2" style={{ gap: 18, marginTop: 12 }}>
              <div><div className="big-stat num">{r.toFixed(3)}</div><p className="small soft">Correlation with the published values, across {n} periods</p></div>
              <div><div className="big-stat num">{mad.toFixed(2)}<small>pts</small></div><p className="small soft">Mean difference in blocked sky</p></div>
              <div><div className="big-stat num">{doseGap.toFixed(2)}<small>pts</small></div><p className="small soft">Mean gap between our modelled dose drop and the drop RAD measured</p></div>
              <div><div className="big-stat num">~10<small>%</small></div><p className="small soft">Typical dose saved by terrain on a walk. In a storm, the habitat is the shelter</p></div>
            </div>
            <p className="xs muted" style={{ marginTop: 14 }}>Re-run end to end from the USGS terrain on 14 November 2026: identical results. Limits: sky only (no ground albedo), the zenith dose curve is digitised from the paper's Fig. 2, and one site (Mt Mercou, P5) disagrees with RAD's measured drop.</p>
          </div>
        </div>

        <AllStops />

        <WalkingCheck />

        <div className="block" style={{ marginTop: 40 }}>
          <h2>Period by period</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ marginTop: 10, minWidth: 560 }}>
              <thead><tr><th>Period</th><th>Site</th><th className="n">Sky blocked, ours</th><th className="n">Published</th><th className="n">Dose drop, ours</th><th className="n">Dose drop, RAD measured</th></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.period}>
                    <td className="num">{x.period}</td><td>{x.site ?? 'Background'}</td>
                    <td className="n">{x.ros_ours.toFixed(1)}%</td><td className="n">{x.ros_paper.toFixed(1)}%</td>
                    <td className="n">{x.dsky_ours != null ? `${x.dsky_ours.toFixed(1)}%` : ''}</td><td className="n">{x.measured != null ? `${x.measured}%` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="block" style={{ marginTop: 40 }}>
          <h2>Where each number comes from</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ marginTop: 10, minWidth: 560 }}>
              <thead><tr><th>Layer</th><th>Source</th><th>Kind</th></tr></thead>
              <tbody>{SOURCES.map(([a, b, k]) => <tr key={a}><td style={{ whiteSpace: 'nowrap' }}><b>{a}</b></td><td className="soft">{b}</td><td><Prov k={k} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 40 }}>
          <div className="block prose">
            <h2 style={{ color: 'var(--ink)' }}>The rule behind the map</h2>
            <p>Apollo crews worked under a walk-back rule: if the rover failed, they had to be able to walk back to the lunar module from any point. Life support left over capped how far they could drive (Bellcomm, Apollo 15 traverse planning, 1970).</p>
            <p>Rocky applies the same rule to a walk on Mars. From the habitat, a least-effort search runs over the terrain twice: out with the tool load, and home over reversed edges with the heavier load of samples. Each cell gets the suit time left after going there, working and walking back. A plan holds only if that reserve stays above the safety line at <b>every</b> step.</p>
            <p>The planning code was checked against brute force: the search matches an independent Bellman-Ford solver on random terrains, and the autopilot matches an exhaustive search over every possible order of stops.</p>
          </div>
          <div className="block prose">
            <h2 style={{ color: 'var(--ink)' }}>Honest limits</h2>
            <p>No one has measured suited walking at Mars gravity. The Earth-derived model is scaled through its lifting term only; the alternatives are switches on the Plan screen.</p>
            <p>The reserve is shown as time and energy, not oxygen or cooling water: public suit consumable rates were not found.</p>
            <p>The sand and rock layer comes from 80 m infrared pixels, placed inside each pixel by terrain shape. It is an estimate, off by default.</p>
            <p className="cite">Guo, J. et al. (2026) JGR Planets 131, e2026JE009704. Hassler, D. M. et al. (2014) Science 343, 1244797. Santee, W. R. et al. (2001); Marquez, J. J. (2008), via Pextant (NASA Ames / MIT, MIT licence). Not affiliated with or endorsed by NASA. Built for the NASA Space Apps Challenge 2026.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
