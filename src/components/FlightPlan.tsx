import type { Dataset } from '../data';
import { lonLatToCell } from '../data';
import { useStore } from '../store';
import { useEffect, useState } from 'react';
import { calibratedDose, fmtDist, fmtKcal, fmtTime, type RouteSummary } from '../planner/summary';
import { ChanceOfHome, TurnBackAdvisor } from './RiskAdvisor';
import type { Tool } from './MapView';
import { AltSwitch, Fact, Icon, Prov, Slider } from './ui';

export function nearestTargetName(data: Dataset, cell: number): string | null {
  const { w, res } = data.meta; let best: string | null = null, bd = 60 / res; // within 60 m
  for (const t of data.targets) {
    const [cx, cy] = lonLatToCell(data.meta, t.lon, t.lat); const d = Math.hypot(cx - (cell % w), cy - Math.floor(cell / w));
    if (d < bd) { bd = d; best = t.name.replace(/\s*\(.*\)\s*/g, ''); }
  }
  return best;
}

export function VerdictSign({ summary }: { summary: RouteSummary }) {
  const { budget, params } = useStore();
  const down = params.rescueMass != null;
  const pct = Math.round(summary.minMargin * 100);
  return (
    <div className={`sign ${summary.pass ? '' : 'broken'}`} role="status">
      <div className="sign-head">
        <div className="sign-word">{down ? (summary.pass ? 'Rescue possible' : 'Rescue fails') : summary.pass ? 'Tether holds' : 'Tether broken'}</div>
        <div className="sign-num">{pct}<small>%</small></div>
      </div>
      <p>
        {down
          ? (summary.pass
            ? `Crew down: if one astronaut collapses at the worst point of this route, the other can still haul them home with ${pct}% of suit time left.`
            : `Crew down: from the worst point of this route, hauling a collapsed partner home leaves ${pct}% of suit time, under the ${budget.reservePct}% rule. This walk only works if nobody gets hurt.`)
          : summary.pass
          ? `The lowest walk-home reserve anywhere on this route. At every point the crew can turn around and walk back with at least ${budget.reservePct}% of suit time left.`
          : `At its worst point the crew would get home with ${pct}% of suit time left, under the ${budget.reservePct}% rule. Drop a far stop, lighten the load or move the habitat.`}
      </p>
    </div>
  );
}

/** measured_over_model_slope from the Curiosity RAD stop validation (public/data/validation_rad_stops.json). */
let radSlopeCache: Promise<{ slope: number; n: number } | null> | null = null;
function useRadCalibration() {
  const [cal, setCal] = useState<{ slope: number; n: number } | null>(null);
  useEffect(() => {
    radSlopeCache ??= fetch(import.meta.env.BASE_URL + 'data/validation_rad_stops.json').then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j.measured_over_model_slope === 'number' ? { slope: j.measured_over_model_slope as number, n: (j.stops as number) ?? 0 } : null))
      .catch(() => null);
    let live = true; radSlopeCache.then((c) => { if (live) setCal(c); }); return () => { live = false; };
  }, []);
  return cal;
}

export function RouteFacts({ summary }: { summary: RouteSummary }) {
  const cal = useRadCalibration();
  const c = cal ? calibratedDose(summary, cal.slope) : null;
  return (
    <dl className="facts">
      <Fact label="Distance">{fmtDist(summary.distance)}</Fact>
      <Fact label="Suit time">{fmtTime(summary.totalTime)}</Fact>
      <Fact label="Walking">{fmtTime(summary.walkTime)}</Fact>
      <Fact label="Energy" prov="computed">{fmtKcal(summary.energy)}</Fact>
      <Fact label="Climb">{Math.round(summary.climb)} m</Fact>
      <Fact label="Steepest step">{summary.maxSlope.toFixed(1)}°</Fact>
      <Fact label="Cosmic-ray dose" prov="computed">{(summary.doseMsv * 1000).toFixed(0)} µSv</Fact>
      <Fact label="Terrain shielding" prov="computed">{Math.max(0, (1 - summary.doseMsv / summary.doseOpenMsv) * 100).toFixed(1)}%</Fact>
      {c && cal && (
        <>
          <Fact label="Dose, detector-calibrated" prov="computed">{(c.doseMsv * 1000).toFixed(0)} µSv</Fact>
          <Fact label="Shielding, detector-calibrated" prov="computed">{c.shieldingPct.toFixed(1)}%</Fact>
          <p className="xs muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
            Calibrated values: at {cal.n.toLocaleString()} Curiosity stops the dose its RAD detector measured changed {cal.slope.toFixed(2)}× as much
            as the model predicted, so the model's shielding is scaled by {cal.slope.toFixed(2)}. The raw model values above are unchanged.
          </p>
        </>
      )}
    </dl>
  );
}

export function SuitControls({ data }: { data: Dataset }) {
  const { params, setParams, budget, setBudget, groundModel, setGroundModel, sandModel, setSandModel, fields } = useStore();
  return (
    <>
      <section>
        <h3>Suit budget</h3>
        <Slider label="EVA length" value={budget.evaHours} min={2} max={8} step={0.5} unit=" h" onChange={(v) => setBudget({ evaHours: v })} hint="NASA lunar EVA concept of operations: up to 8 h, nominal 6 ± 2 h" />
        <Slider label="Safety reserve" value={budget.reservePct} min={0} max={50} step={5} unit="%" onChange={(v) => setBudget({ reservePct: v })} />
        <Slider label="Science time per stop" value={budget.workMinPerStop} min={0} max={90} step={5} unit=" min" onChange={(v) => setBudget({ workMinPerStop: v })} />
        <Slider label="Walking pace cap" value={params.maxSpeed} min={0.5} max={1.6} step={0.02} unit=" m/s" onChange={(v) => setParams({ maxSpeed: v })} hint="Default 0.92 m/s (3.3 km/h), a cautious pace for a loaded suited crew." />
        <Slider label="Steepest walkable slope" value={params.maxSlopeDeg} min={10} max={30} step={1} unit="°" onChange={(v) => setParams({ maxSlopeDeg: v })} hint="Lunar EVA concept of operations cites 20°; Apollo 15 crews walked about 17°." />
      </section>
      <section>
        <h3>Crew and load</h3>
        <Slider label="Tools carried out" value={params.loadOut} min={0} max={60} step={1} unit=" kg" onChange={(v) => setParams({ loadOut: v, loadBack: Math.max(v, params.loadBack) })} />
        <Slider label="Carried home with samples" value={params.loadBack} min={params.loadOut} max={80} step={1} unit=" kg" onChange={(v) => setParams({ loadBack: v })} />
        <Slider label="Astronaut" value={params.bodyMass} min={50} max={110} step={1} unit=" kg" onChange={(v) => setParams({ bodyMass: v })} />
        <Slider label="Suit and life support" value={params.suitMass} min={30} max={140} step={5} unit=" kg" onChange={(v) => setParams({ suitMass: v })} hint="xEMU-class suits weigh about 130 kg on Earth; a Mars suit is expected to be lighter." />
      </section>
      <section>
        <h3>Walking model</h3>
        <p className="small soft" style={{ margin: '0 0 6px' }}>
          Suited-walking energy (Santee et al. 2001) and speed on slopes (Marquez 2008), from NASA Ames and MIT's Pextant, at Mars gravity, 3.71 m/s². Checked against NASA's suited treadmill measurements at Moon and Mars gravity (see Evidence); nobody has measured it on real Martian ground, so the choices below are yours.
        </p>
        <label className="check">
          <input type="checkbox" checked={groundModel} disabled={!data.ground} onChange={(e) => setGroundModel(e.target.checked)} />
          <span>Slow down on sand and rock<Prov k="assumed" /><br /><span className="xs muted">Uses THEMIS night-time infrared (measured): sandy cells cost up to 1.8× and rocky cells up to 2× the effort. Off by default.</span></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={sandModel} disabled={!data.terrainFactor} onChange={(e) => setSandModel(e.target.checked)} />
          <span>Avoid AI-detected sand<Prov k="computed" /><br /><span className="xs muted">TETHER's sand map (Sand (AI) layer). Loose sand costs 2.1× the walking energy (Soule and Goldman 1972) at the same pace; rough ground 1.3× and 14% slower. The AI finds only about 6 in 10 sand cells. Replaces the THEMIS option above; off by default.</span></span>
        </label>
        <label className="check">
          <input type="checkbox" checked={params.levelGravityScaling} onChange={(e) => setParams({ levelGravityScaling: e.target.checked })} />
          <span>Scale flat-ground effort with gravity<Prov k="assumed" /><br /><span className="xs muted">Multiplies the level-walking term by √(g / g Earth). NASA's suited treadmill data do not support this (see Evidence); off by default.</span></span>
        </label>
        {fields && <p className="xs muted" style={{ marginTop: 10 }}>Walk-home map: {(data.meta.w * data.meta.h / 1e6).toFixed(2)} million cells in {(fields.ms / 1000).toFixed(2)} s.</p>}
      </section>
    </>
  );
}

/** Crew-down drill: redraw the walk-home map for one astronaut hauling the other. */
function CrewDown() {
  const { params, setParams, setCrewDown, base } = useStore();
  const on = params.rescueMass != null;
  if (base == null) return null;
  return (
    <section>
      <h3>Crew-down drill<Prov k="assumed" /></h3>
      <p className="small soft" style={{ margin: '0 0 8px' }}>
        What if your partner collapses out there? The map is redrawn for one astronaut hauling the other home: {Math.round(params.bodyMass + params.suitMass)} kg more to move, at a slower pace.
      </p>
      <div className="seg" role="group" aria-label="Crew-down drill">
        <button aria-pressed={!on} onClick={() => setCrewDown(false)}>Both walking</button>
        <button aria-pressed={on} onClick={() => setCrewDown(true)}>Crew down</button>
      </div>
      {on && (
        <>
          <Slider label="Hauling pace" value={params.rescuePace ?? 0.5} min={0.2} max={0.9} step={0.05} unit=" m/s" onChange={(v) => setParams({ rescuePace: v })} hint="No measured value exists for hauling a suited crew member on Mars; 0.5 m/s is a placeholder." />
          <p className="xs muted" style={{ marginTop: 6 }}>NASA's 2024 South Pole Safety challenge asked for exactly this on the Moon: move a 343 kg suited crew member 2 km over slopes up to 20° without a rover. The same walking model is used with the extra mass; the pace is an assumption.</p>
        </>
      )}
    </section>
  );
}

export default function FlightPlan({ data, summary, tool, setTool, onDemo }: {
  data: Dataset; summary: RouteSummary | null; tool: Tool; setTool: (t: Tool) => void; onDemo: () => void;
}) {
  const { base, stops, removeStop, moveStop, clearStops, routeError, legs } = useStore();
  const legT = (i: number) => legs[i] ? legs[i].time[legs[i].time.length - 1] : NaN;
  return (
    <aside className="panel" aria-label="EVA plan">
      <section>
        <AltSwitch id="plan" view="plan" />
        <h2>EVA plan</h2>
        <p className="lede">Place the habitat, then add science stops in the order you will walk them. Every metre of the map shows what is left after the walk home.</p>
        <div className="seg" role="group" aria-label="Map tool">
          <button aria-pressed={tool === 'base'} onClick={() => setTool('base')}>Place habitat</button>
          <button aria-pressed={tool === 'stop'} onClick={() => setTool('stop')} disabled={base == null}>Add a stop</button>
        </div>
        {base != null && (
          <ol className="timeline">
            <li>
              <span className="node hab">H</span>
              <span className="tl-name"><b>Habitat</b><span>{Math.round(data.z[base])} m, start</span></span>
              <span />
            </li>
            {stops.map((s, i) => (
              <li key={i}>
                <span className="node">{i + 1}</span>
                <span className="tl-name"><b>{nearestTargetName(data, s) ?? 'Custom stop'}</b><span>{Math.round(data.z[s])} m{isFinite(legT(i)) ? `, ${fmtTime(legT(i))} walk` : ''}</span></span>
                <span className="tl-actions">
                  <button className="icon-btn" onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label={`Move stop ${i + 1} earlier`}>{Icon.up}</button>
                  <button className="icon-btn" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} aria-label={`Move stop ${i + 1} later`}>{Icon.down}</button>
                  <button className="icon-btn" onClick={() => removeStop(i)} aria-label={`Remove stop ${i + 1}`}>{Icon.x}</button>
                </span>
              </li>
            ))}
            {stops.length > 0 && (
              <li>
                <span className="node hab">H</span>
                <span className="tl-name"><b>Back at the habitat</b><span>{isFinite(legT(stops.length)) ? `${fmtTime(legT(stops.length))} walk home` : 'walk home'}</span></span>
                <span />
              </li>
            )}
          </ol>
        )}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="link" onClick={onDemo}>Load the demo walk</button>
          {stops.length > 0 && <button className="link" onClick={clearStops}>Clear stops</button>}
        </div>
        {routeError && <p className="small tone-bad">{routeError}: the terrain is too steep for a suited walk.</p>}
      </section>

      {summary && (
        <section>
          <VerdictSign summary={summary} />
          <RouteFacts summary={summary} />
        </section>
      )}
      {summary && <ChanceOfHome summary={summary} />}
      {summary && <TurnBackAdvisor data={data} summary={summary} />}

      <CrewDown />

      <SuitControls data={data} />
    </aside>
  );
}
