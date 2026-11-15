import { useMemo } from 'react';
import type { Dataset, SepEvent } from '../data';
import { useStore } from '../store';
import { fmtTime, type RouteSummary } from '../planner/summary';
import { Prov, Slider } from './ui';


export default function StormPanel({ data, summary }: { data: Dataset; summary: RouteSummary | null }) {
  const { budget, setBudget, fields } = useStore();
  const lead = budget.flareLeadMin * 60;

  const route = useMemo(() => {
    if (!summary || !fields) return null;
    let worst = 0, exposed = 0;
    for (const p of summary.points) { const t = fields.fastT[p.cell]; if (t > worst) worst = t; if (t > lead) exposed++; }
    return { worst, exposedPct: (100 * exposed) / summary.points.length };
  }, [summary, fields, lead]);

  const area = useMemo(() => {
    if (!fields) return null;
    let reach = 0, total = 0;
    for (let i = 0; i < fields.fastT.length; i++) { const t = fields.fastT[i]; if (!isFinite(t)) continue; total++; if (t <= lead) reach++; }
    return { km2: (reach * data.meta.res * data.meta.res) / 1e6, pct: (100 * reach) / Math.max(1, total) };
  }, [fields, lead, data.meta.res]);

  const events: SepEvent[] = data.spaceWeather?.events ?? [];
  const may = events.filter((e) => e.eventTime?.startsWith('2024-05'));

  return (
    <aside className="panel" aria-label="Solar storm drill">
      <section>
        <h2>Solar storm drill</h2>
        <p className="lede">A solar particle event can reach Mars tens of minutes after a flare is seen. The terrain shields only a little, so the habitat is the real shelter. The map shows where the crew can get back in time on the fastest walk home.</p>
        <Slider label="Warning before particles arrive" value={budget.flareLeadMin} min={10} max={90} step={5} unit=" min" onChange={(v) => setBudget({ flareLeadMin: v })} hint="In May 2024 the energetic particles reached Mars tens of minutes after the flare." />
      </section>

      {route && (
        <section>
          <div className={`sign ${route.worst <= lead ? '' : 'broken'}`} role="status">
            <div className="sign-head">
              <div className="sign-word">{route.worst <= lead ? 'Shelter in time' : 'Too far out'}</div>
              <div className="sign-num">{Math.round(route.worst / 60)}<small> min</small></div>
            </div>
            <p>{route.worst <= lead
              ? `From the farthest point of this walk, the fastest way home takes ${fmtTime(route.worst)}: inside the ${budget.flareLeadMin}-minute warning.`
              : `From the farthest point of this walk the crew needs ${fmtTime(route.worst)} to reach the habitat. ${route.exposedPct.toFixed(0)}% of the route lies beyond the ${budget.flareLeadMin}-minute warning: plan a closer safe haven or a shorter walk.`}</p>
          </div>
        </section>
      )}

      {area && (
        <section>
          <dl className="facts" style={{ marginTop: 0 }}>
            <div><dt>Ground inside the warning<Prov k="computed" /></dt><dd>{area.km2.toFixed(2)} km²</dd></div>
            <div><dt>Share of walkable site</dt><dd>{area.pct.toFixed(0)}%</dd></div>
          </dl>
          <p className="xs muted" style={{ marginTop: 12 }}>Fastest walk home means least time rather than least effort: the crew runs the risk of tiring to save minutes.</p>
        </section>
      )}

      <section>
        <h3>The May 2024 event<Prov k="measured" /></h3>
        <p className="small soft" style={{ margin: 0 }}>
          On 20 May 2024 Curiosity's radiation detector measured the largest particle dose of the mission. NASA's DONKI space-weather database lists {may.length} solar energetic particle alerts that month, used here as the drill scenario.
        </p>
        {may.length > 0 && (
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Detected (UTC)</th><th>Instrument</th></tr></thead>
            <tbody>
              {may.slice(0, 6).map((e) => (
                <tr key={e.sepID}><td className="num">{e.eventTime.replace('T', ' ').replace('Z', '')}</td><td className="xs soft">{(e.instruments?.[0] ?? '').replace(/^MODEL: /, '')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="xs muted" style={{ marginTop: 10 }}>These are 2024 near-Earth records, a drill rather than a live alert. Source: NASA CCMC DONKI.</p>
      </section>
    </aside>
  );
}
