// Rocky's 3D story: seven scenes, one route each (#1 to #7; the site root is scene 1, the landing page).
// The planner itself (React) lives at #/dashboard; moving between the two reloads the page (see ../main.tsx).
// Right arrow / left arrow (or the pager in the top bar) move between scenes with a short fade.
import './style.css';
const NAMES = ['Arrival', 'Walk-home map', 'Crew down', 'Where to put the base', 'Radiation test', 'Suit test', 'Mars in the room'];
const screens: Record<string, () => Promise<{ default: () => unknown }>> = {
  '1': () => import('./s1'), '2': () => import('./s2'), '3': () => import('./s3'), '4': () => import('./s4'),
  '5': () => import('./s5'), '6': () => import('./s6'), '7': () => import('./s7'),
};
export const current = () => { const k = location.hash.replace('#', '').split('?')[0]; return screens[k] ? +k : 1; };
/** Go to another scene: fade to black, load it fresh. */
export function goto(n: number) {
  if (n < 1 || n > NAMES.length || n === current()) return;
  const veil = document.createElement('div'); veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;transition:opacity .35s;z-index:99';
  document.body.append(veil); requestAnimationFrame(() => { veil.style.opacity = '1'; });
  setTimeout(() => { location.hash = String(n); location.reload(); }, 380);
}
export const next = () => goto(current() + 1), prev = () => goto(current() - 1);
export const sceneName = (n = current()) => NAMES[n - 1];
addEventListener('keydown', (ev) => {
  const e = ev as KeyboardEvent;
  if ((window as unknown as { __keys?: (e: KeyboardEvent) => boolean }).__keys?.(e)) return;   // a scene may handle a key first (scene 1: the dive)
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next(); if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
});
addEventListener('hashchange', () => location.reload());
/** Open the planner (the React app) on one of its views. */
export const planner = (view = 'plan') => { location.hash = `/dashboard?view=${view}`; };
// the scenes draw into #app; Rocky's page only has #root
if (!document.getElementById('app')) { const el = document.createElement('div'); el.id = 'app'; document.body.append(el); }
document.body.style.opacity = '0'; document.body.style.transition = 'opacity .45s';
screens[String(current())]().then((m) => m.default()).finally(() => requestAnimationFrame(() => { document.body.style.opacity = '1'; }));
