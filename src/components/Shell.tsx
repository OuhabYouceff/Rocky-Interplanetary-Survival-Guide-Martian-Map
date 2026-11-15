import { useEffect, useState } from 'react';
import { marsNow } from '../marsclock';
import { useStore, type View } from '../store';
import type { FeedState } from '../feeds';
import type { RouteSummary } from '../planner/summary';
import { Icon } from './ui';
import { NAV, activeNav, viewOf, type NavId } from '../nav';
import ArButton from './ArButton';
import type { Dataset } from '../data';

export function StatusBar({ summary, feeds, data }: { summary: RouteSummary | null; feeds: FeedState; data: Dataset }) {
  const [t, setT] = useState(marsNow());
  useEffect(() => { const i = setInterval(() => setT(marsNow()), 15000); return () => clearInterval(i); }, []);
  const { glove, setGlove, budget, setView, stops } = useStore();
  const pct = summary ? Math.round(summary.minMargin * 100) : null;
  return (
    <header className="status">
      <a className="wordmark" href="#/" title="Back to the Mars globe"><img src={import.meta.env.BASE_URL + 'logo-64.png'} alt="Rocky home" width={34} height={34} style={{ width: 34, height: 34 }} /></a>
      <div className="status-title">
        <b>Rocky<sup className="ai-star" title="Logo: AI-generated image">*</sup></b>
        <span>Curiosity's boxwork, Mount Sharp, Gale crater</span>
      </div>
      <dl className="clock" aria-label="Mars time at Gale crater">
        <div><dt>Curiosity sol</dt><dd>{t.sol.toLocaleString()}</dd></div>
        <div><dt>Gale local time</dt><dd>{t.lmst}</dd></div>
        <div className="hide-md"><dt>Earth UTC</dt><dd>{t.utc}</dd></div>
      </dl>
      <button
        className={`go-chip ${summary == null ? 'idle' : summary.pass ? '' : 'no'}`}
        onClick={() => setView('plan')}
        title={summary ? `Lowest walk-home reserve on the route; rule is ${budget.reservePct}% or more` : 'Add stops to check a plan'}
      >
        {summary == null ? (stops.length ? 'Computing route…' : 'No plan yet') : summary.pass ? `Go, ${pct}% reserve` : `No-go, ${pct}% reserve`}
      </button>
      <div className="feeds" title="Live NASA feeds: REMS weather and Curiosity's position. Cached copies are used when offline.">
        <i className={`led ${feeds}`} aria-hidden />
        <span>{feeds === 'live' ? 'NASA feeds live' : feeds === 'cached' ? 'Using cached NASA data' : 'Connecting to NASA feeds'}</span>
      </div>
      <ArButton data={data} />
      <button className="toggle-glove" aria-pressed={glove} onClick={() => setGlove(!glove)} title="Crew tablet mode: larger controls for gloved hands">
        {Icon.glove}<span>Glove mode</span>
      </button>
    </header>
  );
}

const ICONS: Record<NavId, keyof typeof Icon> = { plan: 'plan', rescue: 'rescue', base: 'base', storm: 'storm', walk: 'walk', atlas: 'atlas', weather: 'sky', evidence: 'evidence' };

export function Rail({ hasRoute }: { hasRoute: boolean }) {
  const { view, setView } = useStore();
  const on = activeNav(view);
  // A planner view opens in place; a 3D scene is another page of the site (the address changes and the page reloads).
  const open = (hash: string) => { const v = viewOf(hash) as View | null; if (v) { setView(v); history.replaceState(null, '', hash); } else location.hash = hash; };
  return (
    <nav className="rail" aria-label="Sections">
      {NAV.map((n) => {
        const blocked = n.id === 'walk' && !hasRoute;
        return (
          <span key={n.id} style={{ display: 'contents' }}>
            {n.gapBefore && <span className="rail-gap" />}
            <button aria-current={on === n.id ? 'page' : undefined} onClick={() => open(n.hash)} disabled={blocked} title={blocked ? 'Place the habitat first' : n.title}>
              {Icon[ICONS[n.id]]}{n.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
