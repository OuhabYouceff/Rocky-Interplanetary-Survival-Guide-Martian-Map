// Landing page, always shown at the site root. Opening sequence after TETHER's demo film, in the first landing's
// layout: the title animates in on the left while Mars turns on the right; then one dive from orbit to Gale crater
// while Curiosity's route draws itself, ending on the Rocky site with the Atlas tools on the planet.
// "Open the dashboard" (top right) enters the app.
import { useEffect, useRef, useState } from 'react';
import MarsAtlas from '../globe/MarsAtlas';
import type { GlobeHandle, Intro } from '../globe/marsGlobe';

const BASE = import.meta.env.BASE_URL;
const openDashboard = () => { location.hash = '#/dashboard'; };
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Landing() {
  const globe = useRef<GlobeHandle | null>(null);
  const intro = useRef<Intro | null>(null);
  const started = useRef(false);
  const [km, setKm] = useState(11500);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState<'title' | 'dive' | 'free'>(reduced ? 'free' : 'title');
  const [caption, setCaption] = useState<string | null>(null);
  const [focusSite, setFocusSite] = useState(0);

  // the sequence starts once Mars is on screen (first tiles loaded), or after 12 s at the latest
  const start = (g: GlobeHandle) => {
    if (started.current) return; started.current = true;
    if (reduced) return;
    intro.current = g.playIntro({
      holdMs: 6500,
      dive: () => setStage('dive'),
      caption: setCaption,
      done: () => { setCaption(null); setStage('free'); setFocusSite((v) => v + 1); intro.current = null; },
    });
  };
  useEffect(() => {
    if (!ready || !globe.current) return;
    if (loaded) { start(globe.current); return; }
    const t = setTimeout(() => globe.current && start(globe.current), 12000); return () => clearTimeout(t);
  }, [loaded, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => intro.current?.skip(), []);

  const flyToGale = () => {
    if (intro.current && stage === 'title') { intro.current.dive(); return; }
    globe.current?.flyToSite(); setFocusSite((v) => v + 1);
  };
  const heroOn = stage === 'title' || (stage === 'free' && km > 1200);

  return (
    <div className={`landing ${heroOn ? 'hero-on' : ''}`}>
      <MarsAtlas aimLeft showTools={stage === 'free'} onReady={(g) => { globe.current = g; setReady(true); }} onHeight={setKm}
        onLoaded={() => setLoaded(true)} onOpenSite={openDashboard} focusSite={focusSite}>
        <header className="landing-top">
          <a className="landing-brand" href="#/"><img src={BASE + 'logo-64.png'} alt="" width={34} height={34} style={{ width: 34, height: 34 }} />Rocky<sup className="ai-star" title="Logo: AI-generated image">*</sup></a>
          <button className="landing-btn" onClick={openDashboard}>Open the dashboard</button>
        </header>

        <section className={`landing-copy ${heroOn ? '' : 'away'} ${stage === 'title' ? 'intro' : ''}`} aria-hidden={!heroOn}>
          <p className="landing-label">Apollo's walk-back rule, as a map of Mars</p>
          <h1>Rocky</h1>
          <p className="landing-lead">Plan a walk on Mars that always keeps a safe way home.</p>
          <p className="landing-text">Every point of the map at Curiosity's boxwork on Mount Sharp shows the suit time an astronaut would have left after walking there, working and walking back. Real NASA and USGS data, checked against Curiosity's own instruments.</p>
          <div className="landing-cta">
            <button className="landing-btn solid" onClick={flyToGale}>Fly to Gale crater</button>
            <button className="landing-link" onClick={openDashboard}>Open the dashboard</button>
          </div>
          <dl className="landing-facts">
            <div><dt>Radiation model vs Curiosity's detector</dt><dd>r 0.993</dd></div>
            <div><dt>Walk-home map, recomputed live</dt><dd>1.1 M cells</dd></div>
            <div><dt>Real Curiosity science targets</dt><dd>11</dd></div>
            <div><dt>Independent checks passing</dt><dd>52</dd></div>
          </dl>
        </section>

        <p className={`intro-caption ${caption ? 'on' : ''}`} aria-live="polite">{caption}</p>

        <footer className="landing-foot">
          {!loaded ? <span className="landing-loading">Loading Mars imagery from NASA Mars Trek</span>
            : <span>{km >= 1000 ? `${Math.round(km).toLocaleString()} km` : `${km.toFixed(1)} km`} above Mars</span>}
          {stage !== 'free'
            ? <button className="landing-skip" onClick={() => intro.current?.skip()}>Skip intro</button>
            : <span className="landing-hint">Drag to turn, scroll to zoom, click a place</span>}
        </footer>
      </MarsAtlas>
    </div>
  );
}
