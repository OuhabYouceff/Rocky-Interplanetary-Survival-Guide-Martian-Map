// Walk screen: "Explore on foot" (the prototype's first-person game, now on the planner's engine) and
// "Replay the plan" (TETHER's fly-through along the planned route).
import { lazy, Suspense, useEffect, useReducer, useRef, useState } from 'react';
import type { Dataset } from '../data';
import { lonLatToCell } from '../data';
import { useStore } from '../store';
import type { RouteSummary } from '../planner/summary';
import { buildK, loadHi, syncLive, type GameK, type Live } from '../game/adapter';
import type { Game } from '../game/game3d';

const Hud3D = lazy(() => import('./Hud3D'));

// One game per page: building the 1.1 M-vertex terrain and its textures takes a few seconds, so it is kept
// alive (hidden) when the user leaves the screen and re-attached when they come back.
let inst: { data: Dataset; game: Game; K: GameK; live: Live; el: HTMLDivElement; planKey: string } | null = null;

function targetInfo(data: Dataset, cell: number) {
  const { w, res } = data.meta; let best: { name: string; goal?: string; sol?: number } | null = null, bd = 60 / res;
  for (const t of data.targets) {
    const [cx, cy] = lonLatToCell(data.meta, t.lon, t.lat); const d = Math.hypot(cx - (cell % w), cy - Math.floor(cell / w));
    if (d < bd) { bd = d; best = { name: t.name.replace(/\s*\(.*\)\s*/g, ''), goal: t.why_visit, sol: t.sol }; }
  }
  return best;
}

function remsOf(data: Dataset) {
  const r = data.weather?.latest_60_sols?.[0];
  return r ? { min: +r.min_temp, max: +r.max_temp, pressure: +r.pressure } : null;
}

function FreeWalk({ data, summary }: { data: Dataset; summary: RouteSummary | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [loading, setLoading] = useState(!inst);
  const [exag, setExag] = useState(2);
  const { params, groundModel, sandModel, fields, base, stops, budget } = useStore();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!inst || inst.data !== data) {
        const [{ createGame }, hi] = await Promise.all([import('../game/game3d.js'), loadHi()]);
        if (!alive) return;
        const live: Live = { params, groundModel, sandModel, fields, summary, rems: remsOf(data) };
        const K = buildK(data, live, hi);
        const el = document.createElement('div'); el.className = 'game-root';
        syncLive(K, base, stops, budget, (c) => targetInfo(data, c));
        const game = createGame(el, K, { onChange: () => bump() });
        inst = { data, game, K, live, el, planKey: '' };
        (window as unknown as { __marswalkGame: Game }).__marswalkGame = game; // scripting hook, like __marswalk
      }
      if (!alive || !host.current) return;
      host.current.appendChild(inst.el);
      setLoading(false);
      inst.game.show(true);
      bump();
    })();
    return () => { alive = false; if (inst) { inst.game.show(false); inst.el.remove(); } };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the game in step with the plan and settings
  useEffect(() => {
    if (!inst) return;
    Object.assign(inst.live, { params, groundModel, sandModel, fields, summary });
    const key = syncLive(inst.K, base, stops, budget, (c) => targetInfo(data, c));
    if (key !== inst.planKey) { const first = inst.planKey === ''; inst.planKey = key; if (!first) inst.game.reset(); inst.game.show(true); }
  }, [params, groundModel, sandModel, fields, summary, base, stops, budget, data, loading]);

  const g = inst?.game, st = g?.state;
  return (
    <div className="freewalk">
      <div ref={host} className="game-host" />
      {loading && <div className="splash" style={{ position: 'absolute', inset: 0 }}><div><span>Loading 1 m terrain and 50 cm colour imagery</span><div className="loadbar"><i /></div></div></div>}
      {g && st && !loading && (
        <div className="game-bar" role="toolbar" aria-label="3D walk controls">
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={st.mode === 'pov'} onClick={() => g.setMode('pov')}>Helmet view</button>
            <button aria-pressed={st.mode === 'map'} onClick={() => g.setMode('map')}>3D map</button>
          </div>
          <label className="game-field">Lens
            <select value={st.lens} onChange={(e) => g.setLens(+e.target.value)}>
              {g.LENSES.map(([, label], i) => <option key={i} value={i}>{label}</option>)}
            </select>
          </label>
          <label className="game-field">Time
            <select value={st.warp} onChange={(e) => g.setWarp(+e.target.value)}>
              {[1, 5, 20].map((w) => <option key={w} value={w}>×{w}</option>)}
            </select>
          </label>
          {st.mode === 'map' && (
            <label className="game-field">Height ×{exag}
              <input type="range" min={1} max={5} step={0.5} value={exag} onChange={(e) => { setExag(+e.target.value); g.setExag(+e.target.value); }} />
            </label>
          )}
          <label className="game-check"><input type="checkbox" checked={st.guide} onChange={(e) => g.set('guide', e.target.checked)} />Guide line</label>
          <label className="game-check"><input type="checkbox" checked={st.showRoute} onChange={(e) => g.set('showRoute', e.target.checked)} />Planned route</label>
          <label className="game-check"><input type="checkbox" checked={st.showTrack} onChange={(e) => g.set('showTrack', e.target.checked)} />Curiosity's path</label>
          <span className="game-gap" />
          <button className="btn" onClick={() => g.scan()} disabled={st.mode !== 'pov'}>Scan</button>
          <button className="btn" onClick={() => g.reset()}>Restart EVA</button>
        </div>
      )}
    </div>
  );
}

export default function WalkView({ data, summary }: { data: Dataset; summary: RouteSummary | null }) {
  const [mode, setMode] = useState<'free' | 'replay'>('free');
  const base = useStore((s) => s.base);
  if (base == null) return <div className="empty-state"><div><h2>Place the habitat first</h2><p>The walk starts and ends at the habitat. Place it on the Plan screen, then add stops to walk to.</p></div></div>;
  return (
    <div className="walkview">
      <div className="walk-head">
        <div className="walk-switch seg" role="group" aria-label="Walk mode">
          <button aria-pressed={mode === 'free'} onClick={() => setMode('free')}>Explore on foot</button>
          <button aria-pressed={mode === 'replay'} onClick={() => setMode('replay')} disabled={!summary}>Replay the plan</button>
        </div>
        <p className="small soft">{mode === 'free'
          ? 'Walk the real terrain yourself. Speed, slopes and the walk-back margin use the same model as the plan.'
          : 'Fly along the planned route with the reserve the plan predicts at every step.'}</p>
      </div>
      {mode === 'free' ? <FreeWalk data={data} summary={summary} /> : (
        <Suspense fallback={<div className="splash"><div><span>Building the 3D terrain</span><div className="loadbar"><i /></div></div></div>}>
          <Hud3D data={data} summary={summary} />
        </Suspense>
      )}
    </div>
  );
}
