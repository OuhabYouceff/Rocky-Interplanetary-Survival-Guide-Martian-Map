// "Chance of getting home" + "Turn-back advisor", ported from TETHER (upstream app/src/components/RiskAdvisor.tsx).
// Same computations and arguments as TETHER; only the markup follows Rocky's design system.
import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../data';
import { useStore } from '../store';
import { fmtTime, type RouteSummary } from '../planner/summary';
import { riskForRoute, riskInputsFromSummary } from '../planner/risk';
import { advise, loadRlPolicy, locationForCell, type RlPolicy } from '../planner/rlAdvisor';
import { Prov } from './ui';

const pct = (p: number) => (p >= 0.9995 ? '>99.9%' : p <= 0.0005 ? '<0.1%' : `${(p * 100).toFixed(p > 0.99 ? 2 : 1)}%`);

export function ChanceOfHome({ summary }: { summary: RouteSummary }) {
  const { fields, budget } = useStore();
  const risk = useMemo(() => {
    if (!fields) return null;
    const { points, legsEnd } = riskInputsFromSummary(summary.points, fields.homeT, fields.fastT);
    return riskForRoute(points, legsEnd, budget, { samples: 10000, seed: 7 });
  }, [summary, fields, budget]);
  if (!risk) return null;
  const bad = risk.pHome < 0.99;
  return (
    <section aria-label="Chance of getting home">
      <h3>Chance of getting home<Prov k="computed" /></h3>
      <dl className="facts" style={{ marginTop: 8, paddingTop: 0, borderTop: 0 }}>
        <div><dt>Back before the suit runs out</dt><dd className={bad ? 'tone-bad' : ''}>{pct(risk.pHome)}</dd></div>
        <div><dt>Keeps the {budget.reservePct}% reserve</dt><dd>{pct(risk.pWithinReserve)}</dd></div>
        <div><dt>Likely length (p10 to p90)</dt><dd style={{ fontSize: 'var(--t-m)' }}>{fmtTime(risk.endTime.p10)} to {fmtTime(risk.endTime.p90)}</dd></div>
        <div><dt>Planned length</dt><dd style={{ fontSize: 'var(--t-m)' }}>{fmtTime(summary.totalTime)}</dd></div>
      </dl>
      <p className="xs muted" style={{ marginTop: 10 }}>
        10,000 simulated walks of this exact route. Each one draws a different astronaut (pace and effort spread from Apollo
        crew data and walking studies<Prov k="measured" />), detours on every leg (+7% typical, Haughton-Mars walk-back
        study) and science stops that run long (Apollo 14–17 station times, capped at 3× the plan)<Prov k="assumed" />.
        Example: {pct(risk.pHome)} means about {Math.round(risk.pHome * 100)} of 100 crews walking this plan get home in time.
      </p>
    </section>
  );
}

export function TurnBackAdvisor({ data, summary }: { data: Dataset; summary: RouteSummary }) {
  const { budget, stops, params, base } = useStore();
  const [policy, setPolicy] = useState<RlPolicy | null>(null);
  const [policyErr, setPolicyErr] = useState(false);
  useEffect(() => { loadRlPolicy().then(setPolicy).catch(() => setPolicyErr(true)); }, []);

  const habitatOk = policy != null && base != null && locationForCell(policy, base, data.meta.w) === 0;
  const advice = useMemo(() => {
    if (!policy || !stops.length || !habitatOk) return [];
    const ends: number[] = [];
    summary.points.forEach((p, i) => { const n = summary.points[i + 1]; if (!n || n.leg !== p.leg) ends.push(i); });
    const rows: { where: string; when: number; headline: string; pHome: number; matches: boolean | null }[] = [];
    const visited: number[] = [];
    const live = { workMinPerStop: budget.workMinPerStop, flareLeadMin: budget.flareLeadMin, maxSpeed: params.maxSpeed, maxSlopeDeg: params.maxSlopeDeg };
    for (let i = 0; i <= stops.length - 1; i++) {
      const loc = locationForCell(policy, stops[i], data.meta.w);
      if (loc <= 0) continue;
      const tArrive = summary.points[ends[i]]?.t ?? 0;
      const elapsedMin = tArrive / 60 + budget.workMinPerStop;
      const a = advise(policy, { location: loc, visited: [...visited], elapsedMin, evaHours: budget.evaHours, live }, { samples: 1500, seed: 11 + i });
      visited.push(loc);
      const nextLoc = i + 1 < stops.length ? locationForCell(policy, stops[i + 1], data.meta.w) : 0;
      const planSays = nextLoc > 0 ? 'go' : 'return';
      const matches = a.action === 'return' ? planSays === 'return' : a.action === 'go' ? (a.target?.index === nextLoc) : null;
      rows.push({ where: policy.locations?.[loc]?.name ?? `stop ${i + 1}`, when: elapsedMin * 60, headline: a.headline, pHome: a.pHome, matches });
    }
    return rows;
  }, [policy, habitatOk, summary, stops, budget, params, data.meta.w]);

  return (
    <section aria-label="Turn-back advisor">
      <h3>Turn-back advisor<Prov k="computed" /></h3>
      <p className="small soft" style={{ margin: '0 0 8px' }}>At each stop: keep going, stay longer, or turn back now.</p>
      {policyErr && <p className="small muted">Advisor policy unavailable.</p>}
      {!policyErr && !policy && <p className="small muted">Loading policy…</p>}
      {policy && !habitatOk && <p className="small muted">The advisor was solved for the habitat at Curiosity's sol-4600 parking spot (the demo walk). Load the demo walk to get advice.</p>}
      {policy && habitatOk && advice.length === 0 && <p className="small muted">Add stops at named science targets to get advice.</p>}
      {advice.length > 0 && (
        <ol className="timeline">
          {advice.map((r, i) => (
            <li key={i}>
              <span className="node">{i + 1}</span>
              <span className="tl-name">
                <b>{r.headline}</b>
                <span>{r.where.replace(/\s*\(.*\)\s*/g, '')}, after {fmtTime(r.when)} · P(home) {pct(r.pHome)}
                  {r.matches === false && <span className="tone-bad"> · differs from your plan</span>}</span>
              </span>
              <span />
            </li>
          ))}
        </ol>
      )}
      <p className="xs muted" style={{ marginTop: 10 }}>
        The best choice was solved exactly (dynamic programming over 15.5 million situations) on the same terrain physics,
        for {policy ? policy.model.work_min : 30} min of work per stop and the 9 targets it was solved for (Ayopaya and the
        sulfate contact are newer and get no advice). P(home) comes from 1,500 simulated walks that follow the advice. In
        200,000 simulated EVAs it brings back about 8% more science than the best fixed rule, mostly by knowing when to stay
        longer at a good stop.
      </p>
    </section>
  );
}
