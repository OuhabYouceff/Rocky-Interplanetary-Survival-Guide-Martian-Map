// CAPCOM tools (ported from TETHER): the only way the assistant (LLM or offline analyst) touches Rocky.
// Every tool mutates Rocky's zustand store (window.__marswalk); get_status() reads the planner's own
// summarize() output, so every number CAPCOM speaks comes from the route engine, never from a model.
import { lonLatToCell, type Dataset } from '../data';
import { useStore } from '../store';
import { slopeDeg, snapWalkable } from '../terrain';
import { fmtDist, fmtTime, summarize } from '../planner/summary';

// ---------------------------------------------------------------- targets / name matching
export interface TargetRef { name: string; short: string; aliases: string[]; lon: number; lat: number }

const EXTRA_ALIASES: Record<string, string[]> = {
  'Mammoth Lakes': ['mammoth'],
  'Kings Canyon': ['kings'],
  Altadena: ['alta dena', 'altadina'],
  'Monte Grande hollow': ['monte grande', 'valle de la luna', 'monte grand'],
  'Nevado Sajama': ['sajama', 'nevado', 'ridge top', 'sahama'],
  'Antofagasta crater': ['antofagasta'],
  'Campo Marte': ['campo', 'marte', 'atacama', 'campo marty'],
  'Basque Lakes': ['basque'],
  Nazca: ['nasca'],
};

export const compact = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

export function targetRefs(data: Dataset): TargetRef[] {
  return data.targets.map((t) => {
    const short = t.name.replace(/\s*\(.*\)\s*/g, '').trim();
    const quoted = [...t.name.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const aliases = [short, ...quoted, ...(EXTRA_ALIASES[short] ?? [])];
    return { name: t.name, short, aliases: [...new Set(aliases.map(compact))].filter((a) => a.length >= 4), lon: t.lon, lat: t.lat };
  });
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Resolve one spoken/typed name to a target (fuzzy, speech-mangling tolerant). */
export function resolveTarget(data: Dataset, q: string): TargetRef | null {
  const c = compact(q); if (c.length < 3) return null;
  let best: TargetRef | null = null, bs = Infinity;
  for (const t of targetRefs(data)) for (const a of t.aliases) {
    let s = lev(c, a) / Math.max(a.length, 1);
    if (c.length >= 5 && (a.startsWith(c) || c.startsWith(a))) s = Math.min(s, 0.05);
    if (s < bs) { bs = s; best = t; }
  }
  return bs <= 0.25 ? best : null;
}

/** Find all target mentions in free text, in the order spoken. */
export function findTargetsInText(data: Dataset, text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const refs = targetRefs(data);
  const hits: { start: number; end: number; t: TargetRef; score: number }[] = [];
  for (let i = 0; i < words.length; i++) for (let n = 4; n >= 1; n--) {
    if (i + n > words.length) continue;
    const g = compact(words.slice(i, i + n).join(''));
    if (g.length < 4) continue;
    for (const t of refs) for (const a of t.aliases) {
      const tol = a.length >= 10 ? 2 : a.length >= 6 ? 1 : 0;
      const d = lev(g, a);
      if (d <= tol) hits.push({ start: i, end: i + n, t, score: d / a.length - n * 0.01 });
    }
  }
  hits.sort((a, b) => a.score - b.score);
  const used = new Set<number>(); const chosen: typeof hits = [];
  for (const h of hits) {
    let free = true; for (let k = h.start; k < h.end; k++) if (used.has(k)) free = false;
    if (!free || chosen.some((c) => c.t.short === h.t.short)) continue;
    for (let k = h.start; k < h.end; k++) used.add(k);
    chosen.push(h);
  }
  return chosen.sort((a, b) => a.start - b.start).map((h) => h.t.short);
}

// ---------------------------------------------------------------- cell helpers
const slopeCache = new WeakMap<Dataset, Float32Array>();
const slopeOf = (d: Dataset) => { let s = slopeCache.get(d); if (!s) { s = slopeDeg(d); slopeCache.set(d, s); } return s; };
function cellOf(d: Dataset, lon: number, lat: number) {
  const [cx, cy] = lonLatToCell(d.meta, lon, lat);
  return snapWalkable(d, slopeOf(d), Math.round(cy) * d.meta.w + Math.round(cx));
}
/** Nearest named target within 60 m (same rule as PlanPanel). */
export function nearestTargetName(d: Dataset, cell: number, maxM = 60): string {
  const { w, res } = d.meta; let best = '', bd = maxM / res;
  for (const t of d.targets) {
    const [cx, cy] = lonLatToCell(d.meta, t.lon, t.lat); const dd = Math.hypot(cx - (cell % w), cy - Math.floor(cell / w));
    if (dd < bd) { bd = dd; best = t.name.replace(/\s*\(.*\)\s*/g, ''); }
  }
  return best;
}
const cellDistM = (d: Dataset, a: number, b: number) => Math.hypot((a % d.meta.w) - (b % d.meta.w), Math.floor(a / d.meta.w) - Math.floor(b / d.meta.w)) * d.meta.res;

function ensureBase(d: Dataset) {
  if (useStore.getState().base != null) return false;
  const wp = d.waypoints.find((w) => w.sol >= 4600) ?? d.waypoints[0];
  if (!wp) return false;
  useStore.setState({ base: cellOf(d, wp.lon, wp.lat), legs: [] });
  return true;
}

// ---------------------------------------------------------------- mutation tracking + settle
interface Pending { stopsAt: number; paramsAt: number; snapLegs: unknown; snapFields: unknown }
let pending: Pending | null = null;
function begin(): Pending {
  if (!pending) { const s = useStore.getState(); pending = { stopsAt: 0, paramsAt: 0, snapLegs: s.legs, snapFields: s.fields }; }
  return pending;
}
const markStops = () => { begin().stopsAt = performance.now(); };
const markParams = () => { begin().paramsAt = performance.now(); };

/**
 * Wait until the worker has delivered fields/legs that reflect the mutations made since the last settle.
 * Budget-only changes (hours, reserve) recompute nothing in the worker, so they resolve immediately.
 * Results arriving before the planner's debounce (120/150 ms) are stale in-flight answers and are ignored.
 */
export function settle(timeoutMs = 20000): Promise<'ok' | 'timeout'> {
  const p = pending; pending = null;
  const t0 = performance.now();
  let legsAt = -1, fieldsAt = -1;
  let lastLegs = p?.snapLegs, lastFields = p?.snapFields;
  const routeMut = p ? Math.max(p.stopsAt, p.paramsAt) : 0;
  const ready = () => {
    const s = useStore.getState();
    if (s.base == null) return true;
    if (!s.fields) return false;
    if (p?.paramsAt && !(fieldsAt >= p.paramsAt + 110)) return false;
    if (s.stops.length === 0) return s.legs.length === 0;
    if (routeMut && !(legsAt >= routeMut + 140)) return false;
    if (s.routeError) return true;
    const L = s.legs, pr = s.params;
    if (L.length !== s.stops.length + 1) return false;
    if (L[0].from !== s.base || L[L.length - 1].to !== s.base) return false;
    for (let i = 0; i < s.stops.length; i++) if (L[i].to !== s.stops[i]) return false;
    if (Math.abs(L[0].mass - (pr.bodyMass + pr.suitMass + pr.loadOut)) > 1e-6) return false;
    return true;
  };
  return new Promise((resolve) => {
    let done = false; let readySince = -1;
    const finish = (r: 'ok' | 'timeout') => { if (done) return; done = true; unsub(); clearInterval(iv); resolve(r); };
    const check = () => {
      const s = useStore.getState(), now = performance.now();
      if (s.legs !== lastLegs) { lastLegs = s.legs; legsAt = now; readySince = -1; }
      if (s.fields !== lastFields) { lastFields = s.fields; fieldsAt = now; readySince = -1; }
      if (now - t0 > timeoutMs) return finish('timeout');
      if (!ready()) { readySince = -1; return; }
      if (readySince < 0) readySince = now;
      else if (now - readySince >= 250) finish('ok');
    };
    const unsub = useStore.subscribe(check);
    const iv = setInterval(check, 100);
    check();
  });
}

// ---------------------------------------------------------------- status
export interface StormStop { name: string; fast_walk_home_min: number; safe: boolean }
export interface CapcomStatus {
  state: 'ok' | 'no_base' | 'no_stops' | 'route_error' | 'computing';
  message?: string;
  verdict?: 'TETHER HOLDS' | 'TETHER BROKEN';
  pass?: boolean;
  min_reserve_pct?: number;
  required_reserve_pct: number;
  bottleneck?: string;
  eva_time?: string;
  eva_time_min?: number;
  eva_budget_h: number;
  distance?: string;
  climb_m?: number;
  steepest_deg?: number;
  dose_usv?: number;
  terrain_saves_pct?: number;
  stops: string[];
  load_out_kg: number;
  load_back_kg: number;
  science_min_per_stop: number;
  storm: { on: boolean; lead_min: number; stops?: StormStop[]; route_safe_pct?: number };
  view: 'plan' | '3d';
}

export function getStatus(d: Dataset): CapcomStatus {
  const s = useStore.getState();
  const stopNames = s.stops.map((c, i) => nearestTargetName(d, c) || `stop ${i + 1}`);
  const lead = s.budget.flareLeadMin;
  const base: CapcomStatus = {
    state: 'ok', required_reserve_pct: s.budget.reservePct, eva_budget_h: s.budget.evaHours, stops: stopNames,
    load_out_kg: s.params.loadOut, load_back_kg: s.params.loadBack, science_min_per_stop: s.budget.workMinPerStop,
    storm: { on: s.flare, lead_min: lead }, view: s.view === 'walk' ? '3d' : 'plan',
  };
  if (s.fields && s.stops.length) {
    base.storm.stops = s.stops.map((c, i) => {
      const t = s.fields!.fastT[c]; const m = isFinite(t) ? Math.round(t / 60) : -1;
      return { name: stopNames[i], fast_walk_home_min: m, safe: m >= 0 && t <= lead * 60 };
    });
  }
  if (s.base == null) return { ...base, state: 'no_base', message: 'No habitat placed yet.' };
  if (!s.stops.length) return { ...base, state: 'no_stops', message: 'No science stops planned.' };
  if (s.routeError) return { ...base, state: 'route_error', message: `${s.routeError}: terrain too steep for a suited walk.` };
  if (!s.fields || s.legs.length !== s.stops.length + 1) return { ...base, state: 'computing', message: 'Route still computing.' };
  const sum = summarize(d, s.legs, s.fields, s.budget);
  if (!sum) return { ...base, state: 'computing', message: 'Route still computing.' };
  // where is the tightest point?
  const pt = sum.points[sum.minMarginAt];
  const leg = s.legs[pt.leg];
  const nameOf = (c: number) => (c === s.base ? 'the habitat' : stopNames[s.stops.indexOf(c)] ?? nearestTargetName(d, c) ?? 'a stop');
  let bottleneck: string;
  if (cellDistM(d, pt.cell, leg.to) <= 40 && leg.to !== s.base) bottleneck = `at ${nameOf(leg.to)}`;
  else if (cellDistM(d, pt.cell, leg.from) <= 40 && leg.from !== s.base) bottleneck = `at ${nameOf(leg.from)}`;
  else if (leg.to === s.base) bottleneck = `on the walk home from ${nameOf(leg.from)}`;
  else bottleneck = `between ${nameOf(leg.from)} and ${nameOf(leg.to)}`;
  let safePts = 0;
  for (const p of sum.points) if (s.fields.fastT[p.cell] <= lead * 60) safePts++;
  base.storm.route_safe_pct = Math.round((safePts / sum.points.length) * 100);
  const usv = Math.round(sum.doseMsv * 1000);
  return {
    ...base,
    verdict: sum.pass ? 'TETHER HOLDS' : 'TETHER BROKEN', pass: sum.pass,
    min_reserve_pct: Math.round(sum.minMargin * 100), bottleneck,
    eva_time: fmtTime(sum.totalTime), eva_time_min: Math.round(sum.totalTime / 60),
    distance: fmtDist(sum.distance), climb_m: Math.round(sum.climb), steepest_deg: +sum.maxSlope.toFixed(1),
    dose_usv: usv,
    terrain_saves_pct: +Math.max(0, (1 - sum.doseMsv / sum.doseOpenMsv) * 100).toFixed(1),
  };
}

// ---------------------------------------------------------------- autopilot (optional, built by another agent)
const autopilotMods = import.meta.glob('../planner/autopilot.ts');
export const hasAutopilot = () => Object.keys(autopilotMods).length > 0;

let apWorker: Worker | null = null; let apId = 0;
interface APReply { type: string; id: number; result?: { best: { stops: number[] } | null }; error?: string }
function autopilotInWorker(d: Dataset, req: { base: number; params: unknown; budget: unknown; targets: unknown[] }, timeoutMs = 45000) {
  if (!apWorker) {
    apWorker = new Worker(new URL('../planner/worker.ts', import.meta.url), { type: 'module' });
    apWorker.postMessage({ type: 'init', grid: { w: d.meta.w, h: d.meta.h, res: d.meta.res, z: d.z } });
  }
  const id = ++apId; const w = apWorker;
  return new Promise<APReply['result'] | null>((resolve, reject) => {
    const t = setTimeout(() => { w.removeEventListener('message', on); reject(new Error('autopilot timed out')); }, timeoutMs);
    const on = (ev: MessageEvent<APReply>) => {
      if (ev.data?.type !== 'autopilot' || ev.data.id !== id) return;
      clearTimeout(t); w.removeEventListener('message', on);
      if (ev.data.error) reject(new Error(ev.data.error)); else resolve(ev.data.result ?? null);
    };
    w.addEventListener('message', on);
    w.postMessage({ type: 'autopilot', id, ...req });
  });
}

// ---------------------------------------------------------------- tool registry
export type ToolName = 'set_eva_hours' | 'set_reserve' | 'set_loads' | 'plan_stops' | 'clear_stops' | 'storm_drill'
  | 'open_3d' | 'open_map' | 'get_status' | 'run_autopilot';
export interface ToolCall { tool: ToolName; args?: Record<string, unknown> }
export interface ToolResult { tool: ToolName; ok: boolean; note: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : NaN);

export async function runTool(d: Dataset, call: ToolCall): Promise<ToolResult> {
  const a = call.args ?? {}; const st = useStore.getState();
  switch (call.tool) {
    case 'set_eva_hours': {
      const h = num(a.hours ?? a.h); if (isNaN(h)) return { tool: call.tool, ok: false, note: 'no hours given' };
      const v = clamp(Math.round(h * 2) / 2, 2, 8); st.setBudget({ evaHours: v });
      return { tool: call.tool, ok: true, note: `EVA set to ${v} h${v !== h ? ` (suit limits 2-8 h)` : ''}` };
    }
    case 'set_reserve': {
      const p = num(a.pct ?? a.percent); if (isNaN(p)) return { tool: call.tool, ok: false, note: 'no reserve given' };
      const v = clamp(Math.round(p / 5) * 5, 0, 50); st.setBudget({ reservePct: v });
      return { tool: call.tool, ok: true, note: `reserve set to ${v}%` };
    }
    case 'set_loads': {
      let out = num(a.out_kg), back = num(a.back_kg);
      if (isNaN(out) && isNaN(back)) return { tool: call.tool, ok: false, note: 'no load given' };
      out = isNaN(out) ? st.params.loadOut : clamp(Math.round(out), 0, 60);
      back = isNaN(back) ? Math.max(out, st.params.loadBack) : clamp(Math.round(back), out, 80);
      st.setParams({ loadOut: out, loadBack: back }); markParams();
      return { tool: call.tool, ok: true, note: `loads ${out} kg out, ${back} kg back` };
    }
    case 'plan_stops': {
      const raw = Array.isArray(a.names) ? a.names.map(String) : typeof a.names === 'string' ? [a.names] : [];
      const refs = raw.map((n) => resolveTarget(d, n)).filter((t): t is TargetRef => !!t);
      const uniq = refs.filter((t, i) => refs.findIndex((r) => r.short === t.short) === i);
      if (!uniq.length) return { tool: call.tool, ok: false, note: `unknown target${raw.length ? ': ' + raw.join(', ') : ''}` };
      if (ensureBase(d)) markParams();
      const cells = uniq.map((t) => cellOf(d, t.lon, t.lat));
      const cur = useStore.getState().stops;
      const next = a.append ? [...cur, ...cells.filter((c) => !cur.includes(c))] : cells;
      useStore.setState({ stops: next }); markStops();
      return { tool: call.tool, ok: true, note: `${a.append ? 'added' : 'route set to'} ${uniq.map((t) => t.short).join(' → ')}` };
    }
    case 'clear_stops': st.clearStops(); markStops(); return { tool: call.tool, ok: true, note: 'stops cleared' };
    case 'storm_drill': {
      const on = a.on === undefined ? true : !!a.on && a.on !== 'false'; st.setView(on ? 'storm' : 'plan');
      return { tool: call.tool, ok: true, note: on ? 'solar storm drill started' : 'storm drill ended' };
    }
    case 'open_3d':
      if (!st.legs.length) return { tool: call.tool, ok: false, note: 'no route yet, so no 3D walk' };
      st.setView('walk'); return { tool: call.tool, ok: true, note: 'opened 3D walk' };
    case 'open_map': st.setView('plan'); return { tool: call.tool, ok: true, note: 'back to the map' };
    case 'get_status': return { tool: call.tool, ok: true, note: 'status read' };
    case 'run_autopilot': {
      const loader = Object.values(autopilotMods)[0];
      if (!loader) return { tool: call.tool, ok: false, note: 'autopilot is not available in this build' };
      try {
        const mod = (await loader()) as { scienceValue?: (t: { id?: string; name: string; type?: string }) => number };
        if (ensureBase(d)) markParams();
        const s2 = useStore.getState();
        const targets = d.targets.map((t) => {
          const raw = t as typeof t & { id?: string; type?: string };
          return { id: raw.id ?? t.name, name: t.name, cell: cellOf(d, t.lon, t.lat), value: mod.scienceValue ? mod.scienceValue(raw) : 5 };
        });
        const res = await autopilotInWorker(d, { base: s2.base!, params: s2.params, targets,
          budget: { evaHours: s2.budget.evaHours, reservePct: s2.budget.reservePct, workMinPerStop: s2.budget.workMinPerStop } });
        if (!res?.best?.stops?.length) return { tool: call.tool, ok: false, note: 'autopilot found no plan that keeps the tether within this budget' };
        const picked = res.best.stops.map((j) => targets[j]);
        useStore.setState({ stops: picked.map((t) => t.cell) }); markStops();
        return { tool: call.tool, ok: true, note: `autopilot chose ${picked.map((t) => t.name.replace(/\s*\(.*\)\s*/g, '')).join(' → ')}` };
      } catch (e) { return { tool: call.tool, ok: false, note: 'autopilot failed: ' + String(e) }; }
    }
    default: return { tool: call.tool, ok: false, note: 'unknown tool' };
  }
}

export const TOOL_NAMES: ToolName[] = ['set_eva_hours', 'set_reserve', 'set_loads', 'plan_stops', 'clear_stops', 'storm_drill', 'open_3d', 'open_map', 'get_status', 'run_autopilot'];
