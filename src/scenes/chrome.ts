// The frame every Rocky screen shares: black status bar, icon rail, and a stage for the 3D view.
// Only readouts the real app has are shown (Curiosity sol, Gale local time, Earth UTC).
const P = (d: string) => `<svg viewBox="0 0 24 24">${d}</svg>`;
const ICON: Record<string, string> = {
  Plan: P('<path d="M4 18 9 6l5 9 2-4 4 7"/><circle cx="9" cy="6" r="1.6"/>'),
  Autopilot: P('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
  Storm: P('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  Walk: P('<circle cx="13" cy="4.5" r="2"/><path d="m9 21 2.5-6.5L14 17v4M8 11l3-3.5 3 1.5 2 3M11.5 14.5 11 8"/>'),
  Atlas: P('<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3c-3 3.2-3 14.8 0 18M12 3c3 3.2 3 14.8 0 18"/>'),
  Weather: P('<path d="M7 17h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 10.1 3.5 3.5 0 0 0 7 17z"/>'),
  Evidence: P('<path d="M4 20V4M4 20h16"/><circle cx="9" cy="14" r="1.3"/><circle cx="12" cy="11" r="1.3"/><circle cx="16" cy="8" r="1.3"/>'),
  Rescue: P('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="m6 6 3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18"/>'),
  Base: P('<path d="M3 19h18M5 19a7 7 0 0 1 14 0M10 19v-4h4v4"/><path d="M12 5V3"/>'),
};

// Rocky's own Mars clock (checked by its test suite), so the readouts match the real app.
import { marsNow } from '../marsclock';
import { current, goto, next, prev, sceneName } from './main';
import { NAV, activeNav, isCurrent } from '../nav';

export function chrome(active: string, pill: { text: string; tone?: 'ok' | 'bad' | 'warn' | '' }, opts: { rail?: boolean } = {}) {
  const app = document.getElementById('app')!;
  const m = marsNow(), on = activeNav(), alt = NAV.find((n) => n.id === on)?.alt;
  void active;   // the highlighted section now follows the address, not the scene's own argument
  app.innerHTML = `
    <header class="top">
      <img class="logo" id="homeLogo" src="${import.meta.env.BASE_URL}logo-64.png" alt="Rocky home" width="34" height="34" style="cursor:pointer" title="Back to the Mars globe">
      <div class="brand" id="home" style="cursor:pointer" title="Back to the Mars globe"><b>Rocky<sup class="ai-star" title="Logo: AI-generated image">*</sup></b><span>Curiosity's boxwork, Mount Sharp, Gale crater</span></div>
      <div class="grow"></div>
      <div class="read"><span>Curiosity sol</span><b>${m.sol.toLocaleString('en-US')}</b></div>
      <div class="read"><span>Gale local time</span><b>${m.lmst}</b></div>
      <div class="read utc"><span>Earth UTC</span><b>${m.utc}</b></div>
      <div class="pager"><button id="pgPrev" aria-label="Previous scene">‹</button><span>${current()} / 7<span class="pname"> · ${sceneName()}</span></span><button id="pgNext" aria-label="Next scene">›</button></div>
      <div class="pill ${pill.tone ?? ''}" id="pill"><i></i><span>${pill.text}</span></div>
      ${alt ? `<div class="switch">${alt.map((a) => `<a class="${isCurrent(a.hash) ? 'on' : ''}" href="${a.hash}">${a.label}</a>`).join('')}</div>` : ''}
      <button class="tbtn" id="tbAr" title="The plan as a model on your table">View in AR</button>
    </header>
    <nav class="rail">
      ${NAV.map((n) => `${n.gapBefore ? '<div class="gap"></div>' : ''}<a class="${n.id === on ? 'on' : ''}" href="${n.hash}" title="${n.title}">${ICON[n.label]}${n.label}</a>`).join('')}
      <div style="height:14px"></div>
    </nav>
    <main class="stage" id="stage"></main>`;
  if (opts.rail === false) { app.querySelector('.rail')!.remove(); (app.querySelector('.stage') as HTMLElement).style.left = '0'; }
  document.getElementById('home')!.onclick = document.getElementById('homeLogo')!.onclick = () => { location.hash = '1'; };
  document.getElementById('tbAr')!.onclick = () => goto(7);
  document.getElementById('pgPrev')!.onclick = prev; document.getElementById('pgNext')!.onclick = next;
  return {
    stage: document.getElementById('stage')!,
    setPill(text: string, tone = '') { const p = document.getElementById('pill')!; p.className = `pill ${tone}`; p.querySelector('span')!.textContent = text; },
  };
}
