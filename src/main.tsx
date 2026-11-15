// Rocky has two halves that share one site and one design:
//   the 3D story (src/scenes): the landing page at the site root and scenes #2 to #7, plain three.js
//   the planner (React):       #/dashboard, with ?view=plan|autopilot|storm|walk|atlas|conditions|evidence
// Each half owns the whole page while it is shown, so moving from one to the other reloads the page.
const isPlanner = () => location.hash.startsWith('#/dashboard')
const started = isPlanner()
addEventListener('hashchange', () => { if (isPlanner() !== started) location.reload() })
if (started) import('./app-entry.tsx')
else { document.getElementById('root')?.remove(); import('./scenes/main.ts') }
// After the first visit the data files come from the browser's own store (public/sw.js). Production only: in
// development the files change under us.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => undefined)
