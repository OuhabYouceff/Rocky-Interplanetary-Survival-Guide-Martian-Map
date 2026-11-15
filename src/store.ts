import { create } from 'zustand';
import { DEFAULT_PARAMS, type ExplorerParams } from './planner/physics';
import type { Leg } from './planner/worker';

export type LayerKey = 'trek' | 'ortho' | 'hillshade' | 'slope' | 'reserve' | 'shelter' | 'flare' | 'traverse' | 'targets' | 'photos' | 'ground' | 'sand';
export type View = 'plan' | 'autopilot' | 'storm' | 'walk' | 'atlas' | 'conditions' | 'evidence';

export interface Budget {
  evaHours: number;        // total EVA duration the suit supports (NASA lunar ConOps: up to 8 h, nominal 6 +/- 2)
  reservePct: number;      // safety margin kept back for the walk home
  workMinPerStop: number;  // time spent doing science at each stop
  flareLeadMin: number;    // warning time before solar particles arrive (May 2024 event: tens of minutes)
}

export interface Fields { homeE: Float32Array; homeT: Float32Array; outE: Float32Array; outT: Float32Array; fastT: Float32Array; ms: number }

interface State {
  params: ExplorerParams;
  budget: Budget;
  base: number | null;         // cell index
  stops: number[];             // cell indices
  layers: Record<LayerKey, boolean>;
  fields: Fields | null;
  legs: Leg[];
  routeError: string | null;
  hover: number | null;
  mode: 'plan' | 'hud';
  view: View;
  glove: boolean;          // crew-tablet mode: bigger touch targets for gloved hands
  groundModel: boolean;    // apply the THEMIS sand/rock walking-cost multiplier (assumption)
  sandModel: boolean;      // apply TETHER's AI sand map (energy x Pandolf coefficient); exclusive with groundModel
  flare: boolean;
  setParams: (p: Partial<ExplorerParams>) => void;
  setBudget: (b: Partial<Budget>) => void;
  setBase: (c: number) => void;
  addStop: (c: number) => void;
  removeStop: (i: number) => void;
  moveStop: (i: number, dir: -1 | 1) => void;
  clearStops: () => void;
  toggleLayer: (k: LayerKey) => void;
  setFields: (f: Fields | null) => void;
  setLegs: (l: Leg[], err?: string | null) => void;
  setHover: (c: number | null) => void;
  setMode: (m: 'plan' | 'hud') => void;
  setFlare: (f: boolean) => void;
  setView: (v: View) => void;
  setGlove: (g: boolean) => void;
  setGroundModel: (g: boolean) => void;
  setSandModel: (g: boolean) => void;
  setCrewDown: (on: boolean) => void;
}

export const useStore = create<State>((set) => ({
  params: DEFAULT_PARAMS,
  budget: { evaHours: 6, reservePct: 20, workMinPerStop: 30, flareLeadMin: 30 },
  base: null,
  stops: [],
  layers: { trek: false, ortho: true, hillshade: true, slope: false, reserve: true, shelter: false, flare: false, traverse: true, targets: true, photos: true, ground: false, sand: false },
  fields: null,
  legs: [],
  routeError: null,
  hover: null,
  mode: 'plan',
  view: 'plan',
  glove: false,
  groundModel: false,
  sandModel: false,
  flare: false,
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
  setBudget: (b) => set((s) => ({ budget: { ...s.budget, ...b } })),
  setBase: (c) => set({ base: c }),
  addStop: (c) => set((s) => ({ stops: [...s.stops, c] })),
  removeStop: (i) => set((s) => ({ stops: s.stops.filter((_, j) => j !== i) })),
  moveStop: (i, dir) => set((s) => {
    const a = [...s.stops]; const j = i + dir; if (j < 0 || j >= a.length) return {};
    [a[i], a[j]] = [a[j], a[i]]; return { stops: a };
  }),
  clearStops: () => set({ stops: [], legs: [] }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setFields: (f) => set({ fields: f }),
  setLegs: (l, err = null) => set({ legs: l, routeError: err }),
  setHover: (c) => set({ hover: c }),
  setMode: (m) => set({ mode: m }),
  setFlare: (f) => set((s) => ({ flare: f, layers: { ...s.layers, flare: f } })),
  setView: (v) => set((s) => ({ view: v, mode: v === 'walk' ? 'hud' : 'plan', flare: v === 'storm', layers: { ...s.layers, flare: v === 'storm' } })),
  setGlove: (g) => set({ glove: g }),
  setGroundModel: (g) => set((s) => ({ groundModel: g, sandModel: g ? false : s.sandModel })),
  setSandModel: (g) => set((s) => ({ sandModel: g, groundModel: g ? false : s.groundModel })),
  // Crew-down drill: one crew member hauls the other home. Partner mass = a second astronaut in the same suit.
  setCrewDown: (on) => set((s) => ({ params: { ...s.params, rescueMass: on ? s.params.bodyMass + s.params.suitMass : undefined, rescuePace: on ? (s.params.rescuePace ?? 0.5) : undefined } })),
}));

// #/dashboard?view=<name> opens that view (the 3D scenes link here)
if (typeof location !== 'undefined') {
  const v = new URLSearchParams(location.hash.split('?')[1] ?? '').get('view') as View | null;
  if (v && ['plan', 'autopilot', 'storm', 'walk', 'atlas', 'conditions', 'evidence'].includes(v)) useStore.getState().setView(v);
}

// scripting hook (used by the demo recorder and for debugging)
if (typeof window !== 'undefined') (window as unknown as { __marswalk: typeof useStore }).__marswalk = useStore;
