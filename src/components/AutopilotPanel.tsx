// EVA autopilot + habitat siting panel. Runs its own planner worker instance so multi-second jobs never block the
// map's live 'fields'/'route' requests.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from '../data';
import { lonLatToCell } from '../data';
import { useStore } from '../store';
import { slopeDeg, snapWalkable } from '../terrain';
import { fmtMin, scienceValue, scienceWhy, shortName, type APTarget, type Plan } from '../planner/autopilot';
import { decodeSiting, sitingKey, type SitingFileMeta, type SitingResult } from '../planner/siting';
import type { AutopilotReply, SitingReply } from '../planner/worker';
import { AltSwitch, Prov } from './ui';

type APRes = NonNullable<AutopilotReply['result']>;
const SITING_STEP = 12; // lattice spacing in planning cells (36 m)

export default function AutopilotPanel({ data, onApply, onShowSiting, terrainFactor, terrainTimeFactor, hidden }: {
  data: Dataset;
  onApply: (plan: { base: number; stops: number[] }) => void;
  onShowSiting?: (show: boolean, siting: SitingResult | null) => void;
  terrainFactor?: Float32Array;
  terrainTimeFactor?: Float32Array;
  hidden?: boolean;
}) {
  const params = useStore((s) => s.params);
  const budget = useStore((s) => s.budget);
  const base = useStore((s) => s.base);
  const worker = useRef<Worker | null>(null);
  const apId = useRef(0), siteId = useRef(0);
  const [res, setRes] = useState<APRes | null>(null);
  const [resBase, setResBase] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);       // after the first click, re-plan whenever inputs change
  const [siting, setSiting] = useState<SitingResult | null>(null);
  const [sitingProg, setSitingProg] = useState<number | null>(null);
  const [showHeat, setShowHeat] = useState(false);
  const [editValues, setEditValues] = useState(false);
  const [showWhyNot, setShowWhyNot] = useState(false);

  // science targets -> planning cells (same snapping as App.loadDemo)
  const slope = useMemo(() => slopeDeg(data), [data]);
  const baseTargets = useMemo(() => data.targets.map((t) => {
    const raw = t as typeof t & { id?: string; type?: string };
    const [cx, cy] = lonLatToCell(data.meta, t.lon, t.lat);
    return { id: raw.id ?? t.name, name: t.name, type: raw.type, cell: snapWalkable(data, slope, Math.round(cy) * data.meta.w + Math.round(cx)) };
  }), [data, slope]);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(baseTargets.map((t) => [t.id, scienceValue(t)])));
  const targets: APTarget[] = useMemo(() => baseTargets.map((t) => ({ id: t.id, name: t.name, cell: t.cell, value: values[t.id] ?? scienceValue(t) })), [baseTargets, values]);
  const budgetAP = useMemo(() => ({ evaHours: budget.evaHours, reservePct: budget.reservePct, workMinPerStop: budget.workMinPerStop }), [budget.evaHours, budget.reservePct, budget.workMinPerStop]);

  // own worker
  useEffect(() => {
    const w = new Worker(new URL('../planner/worker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ type: 'init', grid: { w: data.meta.w, h: data.meta.h, res: data.meta.res, z: data.z, terrainFactor, terrainTimeFactor } });
    w.onmessage = (ev: MessageEvent<AutopilotReply | SitingReply>) => {
      const m = ev.data;
      if (m.type === 'autopilot' && m.id === apId.current) { setBusy(false); setErr(m.error ?? null); if (m.result) setRes(m.result); }
      if (m.type === 'siting-progress' && m.id === siteId.current) setSitingProg(m.progress);
      if (m.type === 'siting' && m.id === siteId.current) { setSitingProg(null); if (m.result) setSiting(m.result); else setErr(m.error ?? 'siting failed'); }
    };
    worker.current = w;
    return () => { w.terminate(); worker.current = null; };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { worker.current?.postMessage({ type: 'terrain', terrainFactor: terrainFactor ?? null, terrainTimeFactor: terrainTimeFactor ?? null }); }, [terrainFactor, terrainTimeFactor]);
  // warm the target-to-target matrix (~2 s) as soon as params are known, so the first click is fast
  // (debounced: dragging a load slider must not queue one 2 s matrix build per slider step)
  useEffect(() => { if (hidden) return; const t = setTimeout(() => worker.current?.postMessage({ type: 'warm', params, targets }), 600); return () => clearTimeout(t); }, [params, targets, hidden]);

  const run = useCallback(() => {
    if (!worker.current || base == null) return;
    apId.current++; setBusy(true); setErr(null); setResBase(base);
    worker.current.postMessage({ type: 'autopilot', id: apId.current, base, params, budget: budgetAP, targets });
  }, [base, params, budgetAP, targets]);
  useEffect(() => { if (!auto) return; const t = setTimeout(run, 650); return () => clearTimeout(t); }, [auto, run]);

  // siting: use the precomputed file when it matches the current inputs, else compute live in the worker
  const runSiting = useCallback(async () => {
    const key = sitingKey(params, budgetAP, targets, SITING_STEP);
    try {
      const b = import.meta.env.BASE_URL + 'data/';
      const meta: SitingFileMeta = await (await fetch(b + 'base_siting.json')).json();
      if (meta.key === key && !!meta.terrainFactor === !!terrainFactor) {
        const buf = await (await fetch(b + meta.file)).arrayBuffer();
        setSiting(decodeSiting(meta, buf)); return;
      }
    } catch { /* no precomputed file: fall through */ }
    if (!worker.current) return;
    siteId.current++; setSitingProg(0);
    worker.current.postMessage({ type: 'siting', id: siteId.current, params, budget: budgetAP, targets, options: { step: SITING_STEP } });
  }, [params, budgetAP, targets, terrainFactor]);
  const sitingStale = siting && siting.key !== sitingKey(params, budgetAP, targets, SITING_STEP);
  useEffect(() => { if (showHeat) onShowSiting?.(true, siting); }, [siting]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (j: number) => shortName(targets[j]?.name ?? '?');
  const apply = (p: Plan, b = resBase ?? base) => { if (b != null) onApply({ base: b, stops: p.stops.map((j) => targets[j].cell) }); };
  const maxV = targets.reduce((s, t) => s + t.value, 0);
  const stale = res && (resBase !== base) && !auto;

  const verified = res?.best?.verified;
  return (
    <aside className="panel" aria-label="Autopilot" hidden={hidden}>
      <section>
        <AltSwitch id="base" view="autopilot" />
        <h2>Autopilot</h2>
        <p className="lede">Chooses which targets to visit, and in what order, to collect the most science while the walk-back rule holds at every step. It checks all {(1 << targets.length).toLocaleString()} combinations of the {targets.length} targets, then re-walks the winner cell by cell.</p>
        <button className="btn primary block" onClick={() => { setAuto(true); run(); }} disabled={base == null || busy}>
          {busy ? 'Planning…' : res ? 'Plan again' : 'Find the best walk'}
        </button>
        <p className="xs muted" style={{ marginTop: 8 }}>{budget.evaHours} h suit time, {budget.reservePct}% reserve, {budget.workMinPerStop} min at each stop. Change these on the Plan screen.</p>
        {base == null && <p className="small tone-warn">Place the habitat on the Plan screen first.</p>}
        {err && <p className="small tone-bad">{err}</p>}
        {stale && <p className="small tone-warn">The habitat moved since this plan. Plan again.</p>}

        {res && !res.feasible && <div className="sign broken" style={{ marginTop: 14 }}><div className="sign-word">No safe walk</div><p>From this habitat, every target breaks the walk-back rule with this suit budget. Move the habitat or allow a longer EVA.</p></div>}
        {res?.best && (
          <div className={`optimal ${verified && !verified.pass ? 'fail' : ''}`}>
            <header>
              <h3>Best walk</h3>
              <div className="plan-score"><b>{res.best.value}</b><span>of {maxV} points</span></div>
            </header>
            <ol className="timeline" style={{ marginTop: 6 }}>
              {res.best.stops.map((j, k) => (
                <li key={k}><span className="node">{k + 1}</span><span className="tl-name"><b>{nameOf(j)}</b><span>{targets[j].value} points</span></span><span /></li>
              ))}
            </ol>
            <dl className="facts">
              <div><dt>Suit time</dt><dd>{fmtMin(verified?.totalTime ?? res.best.totalTime)}</dd></div>
              <div><dt>Lowest reserve<Prov k="computed" /></dt><dd className={verified && !verified.pass ? 'tone-bad' : ''}>{Math.round((verified?.minMargin ?? res.best.minReserve) * 100)}%</dd></div>
              <div><dt>Walking</dt><dd>{fmtMin(res.best.walkTime)}</dd></div>
              <div><dt>Time to spare</dt><dd>{fmtMin(res.T - (verified?.totalTime ?? res.best.totalTime))}</dd></div>
            </dl>
            <button className="btn block" style={{ marginTop: 16 }} onClick={() => apply(res.best!)}>Use this walk on the map</button>
            <p className="xs muted" style={{ marginTop: 10 }}>
              {res.statesExplored.toLocaleString()} search states in {Math.round(res.ms)} ms{res.matrixCached ? '' : `, plus ${Math.round(res.matrixMs)} ms to measure every leg`}. {verified?.pass ? 'Re-walked cell by cell: the rule holds everywhere.' : 'Fails the cell-by-cell re-walk.'}
            </p>
          </div>
        )}
      </section>

      {res && res.runnersUp.length > 0 && (
        <section>
          <h3>Other good walks</h3>
          <ol className="alts">
            {res.runnersUp.map((p, i) => (
              <li key={i}>
                <span className="score">{p.value}</span>
                <div>
                  <ol className="chain" aria-label="Stops in order">{p.stops.map((j, k) => <li key={k}>{nameOf(j)}</li>)}</ol>
                  <div className="xs muted" style={{ marginTop: 4 }}>{p.why}</div>
                  <div className="row xs" style={{ marginTop: 6, gap: 12 }}>
                    <span className="soft">{fmtMin(p.verified?.totalTime ?? p.totalTime)}</span>
                    <span className="soft">lowest reserve {Math.round((p.verified?.minMargin ?? p.minReserve) * 100)}%</span>
                    {p.verified && <span className={`pass ${p.verified.pass ? '' : 'fail'}`}>{p.verified.pass ? 'Holds' : 'Breaks'}</span>}
                  </div>
                </div>
                <button className="link" onClick={() => apply(p)}>Use</button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {res && res.excluded.length > 0 && (
        <section>
          <button className="link" onClick={() => setShowWhyNot((v) => !v)} aria-expanded={showWhyNot}>{showWhyNot ? 'Hide' : 'Show'} why {res.excluded.length} targets were left out</button>
          {showWhyNot && (
            <ul className="why">
              {res.excluded.map((e) => <li key={e.target}><b>{nameOf(e.target)}</b>, {targets[e.target].value} points. {e.reason}.</li>)}
            </ul>
          )}
        </section>
      )}

      <section>
        <h3>Science value of each target<Prov k="assumed" /></h3>
        <p className="small soft" style={{ margin: 0 }}>Drill sites score higher than stops for imaging only. Hover a name for the reason.</p>
        <button className="link" style={{ marginTop: 8 }} onClick={() => setEditValues((v) => !v)} aria-expanded={editValues}>{editValues ? 'Hide' : 'Edit'} the values</button>
        {editValues && (
          <ul className="values">
            {baseTargets.map((t) => (
              <li key={t.id} title={scienceWhy(t)}>
                <span>{shortName(t.name)}</span>
                <input type="number" min={0} max={20} step={1} value={values[t.id] ?? 0} aria-label={`Points for ${shortName(t.name)}`}
                  onChange={(e) => setValues((v) => ({ ...v, [t.id]: Math.max(0, Math.min(20, Math.round(+e.target.value || 0))) }))} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Where to put the habitat</h2>
        <p className="lede">Scores every walkable spot on a 36 m grid (slope under 10°) by the most science one walk from there can reach under the same rule.</p>
        <div className="row">
          <button className="btn" onClick={runSiting} disabled={sitingProg != null}>{siting && !sitingStale ? 'Score again' : 'Score every site'}</button>
          <label className="check" style={{ paddingTop: 0, alignItems: 'center' }}>
            <input type="checkbox" checked={showHeat} disabled={!siting} onChange={(e) => { setShowHeat(e.target.checked); onShowSiting?.(e.target.checked, siting); }} />Show heat map
          </label>
        </div>
        {sitingProg != null && <><div className="progress"><i style={{ width: `${Math.round(sitingProg * 100)}%` }} /></div><p className="xs muted">Computing {2 * targets.length} walk maps, {Math.round(sitingProg * 100)}%</p></>}
        {sitingStale && <p className="small tone-warn">Inputs changed since these scores. Score again.</p>}
        {siting && res?.best && resBase === base && (
          <p className="small soft">This habitat reaches <b className="num">{res.best.value}</b> points in one walk{siting.top[0] && siting.top[0].value > res.best.value ? `; the best site reaches ${siting.top[0].value}.` : ', as good as the best site.'}</p>
        )}
        {siting && (
          <ol className="sites">
            {siting.top.map((s, i) => {
              const dx = base != null ? Math.hypot((s.cell % data.meta.w) - (base % data.meta.w), Math.floor(s.cell / data.meta.w) - Math.floor(base / data.meta.w)) * data.meta.res : null;
              return (
                <li key={i}>
                  <span className="rank">{i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <div><b className="num">{s.value}</b><span className="muted"> of {siting.maxValue} points</span>{dx != null && <span className="xs muted">, {dx >= 1000 ? `${(dx / 1000).toFixed(1)} km` : `${Math.round(dx)} m`} from the habitat</span>}</div>
                    {s.plan && <div className="xs muted">{s.plan.stops.length} stops, {fmtMin(s.plan.totalTime)}</div>}
                  </div>
                  <button className="link" onClick={() => onApply({ base: s.cell, stops: s.stopsCells })}>Use</button>
                </li>
              );
            })}
          </ol>
        )}
        {siting && <p className="xs muted" style={{ marginTop: 8 }}>{siting.candidates.toLocaleString()} sites scored in {(siting.ms / 1000).toFixed(1)} s.</p>}
      </section>
    </aside>
  );
}
