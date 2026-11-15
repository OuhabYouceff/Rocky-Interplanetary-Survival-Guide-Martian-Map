// One list of sections for the whole site, used by the sidebar of the 3D scenes (src/scenes/chrome.ts) and of the
// planner (src/components/Shell.tsx). A section that has both a 3D scene and a working tool lists them under `alt`.
// Addresses: "#2" to "#7" are 3D scenes; "#/dashboard?view=<name>" is a planner view.
export type NavId = 'plan' | 'rescue' | 'base' | 'storm' | 'walk' | 'atlas' | 'weather' | 'evidence';
export interface NavItem { id: NavId; label: string; hash: string; title: string; gapBefore?: boolean; alt?: { label: string; hash: string }[] }

const tool = (view: string) => `#/dashboard?view=${view}`;
export const NAV: NavItem[] = [
  { id: 'plan', label: 'Plan', hash: '#2', title: 'The walk and how much is left after walking home',
    alt: [{ label: '3D view', hash: '#2' }, { label: 'Map editor', hash: tool('plan') }] },
  { id: 'rescue', label: 'Rescue', hash: '#3', title: 'Crew-down drill: one astronaut hauls the other home' },
  { id: 'base', label: 'Base', hash: '#4', title: 'Where to put the habitat, and the best walk from it',
    alt: [{ label: '3D view', hash: '#4' }, { label: 'Autopilot', hash: tool('autopilot') }] },
  { id: 'storm', label: 'Storm', hash: tool('storm'), title: 'Solar storm drill' },
  { id: 'walk', label: 'Walk', hash: tool('walk'), title: 'Walk the terrain yourself' },
  { id: 'atlas', label: 'Atlas', hash: tool('atlas'), title: 'All of Mars', gapBefore: true },
  { id: 'weather', label: 'Weather', hash: tool('conditions'), title: 'Weather and Mars time' },
  { id: 'evidence', label: 'Evidence', hash: tool('evidence'), title: 'How each number was checked',
    alt: [{ label: 'All evidence', hash: tool('evidence') }, { label: 'Radiation test', hash: '#5' }, { label: 'Suit test', hash: '#6' }] },
];

const VIEW_TO_NAV: Record<string, NavId> = { plan: 'plan', autopilot: 'base', storm: 'storm', walk: 'walk', atlas: 'atlas', conditions: 'weather', evidence: 'evidence' };
const SCENE_TO_NAV: Record<string, NavId | null> = { '1': null, '2': 'plan', '3': 'rescue', '4': 'base', '5': 'evidence', '6': 'evidence', '7': null };

/** Which planner view an address points at, or null for a 3D scene. */
export const viewOf = (hash: string) => (hash.startsWith('#/dashboard') ? new URLSearchParams(hash.split('?')[1] ?? '').get('view') ?? 'plan' : null);
/** The section the current address (or a planner view) belongs to. */
export function activeNav(view?: string): NavId | null {
  if (view) return VIEW_TO_NAV[view] ?? null;
  const v = viewOf(location.hash); if (v) return VIEW_TO_NAV[v] ?? 'plan';
  return SCENE_TO_NAV[location.hash.replace('#', '').split('?')[0]] ?? null;
}
/** Is this entry the page being shown? Compares scene numbers, or planner views. */
export function isCurrent(hash: string, view?: string) {
  const v = viewOf(hash); if (v) return view ? v === view : viewOf(location.hash) === v;
  return !view && !viewOf(location.hash) && location.hash.replace('#', '').split('?')[0] === hash.replace('#', '');
}
