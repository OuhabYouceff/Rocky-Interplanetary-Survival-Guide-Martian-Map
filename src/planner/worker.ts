/// <reference lib="webworker" />
import { homeField, homeFastField, outField, route, type Grid } from './fields';
import type { ExplorerParams } from './physics';
import { paramsKey, runAutopilot, targetMatrix, type APBudget, type APTarget, type AutopilotResult, type TTMatrix } from './autopilot';
import { sitingJob, type SitingOptions, type SitingResult } from './siting';

let grid: Grid | null = null;
let ttCache: TTMatrix | null = null;     // target-to-target legs; depend on params + target cells + terrain only
let sitingLatest = 0;

export type WorkerRequest =
  | { type: 'init'; grid: Grid }                                   // grid.terrainFactor optional (multiplies energy+time of entering a cell)
  | { type: 'terrain'; terrainFactor: Float32Array | null; terrainTimeFactor?: Float32Array | null }        // swap the terrain factor later (clears caches)
  | { type: 'fields'; id: number; base: number; params: ExplorerParams }
  | { type: 'route'; id: number; base: number; stops: number[]; params: ExplorerParams; sampleMassPerStop: number }
  | { type: 'warm'; params: ExplorerParams; targets: APTarget[] }  // precompute the target matrix in the background
  | { type: 'autopilot'; id: number; base: number; params: ExplorerParams; budget: APBudget; targets: APTarget[] }
  | { type: 'siting'; id: number; params: ExplorerParams; budget: APBudget; targets: APTarget[]; options?: SitingOptions };

export type AutopilotReply = { type: 'autopilot'; id: number; result?: AutopilotResult & { matrixMs: number; fieldsMs: number; verifyMs: number; matrixCached: boolean }; error?: string };
export type SitingReply =
  | { type: 'siting-progress'; id: number; progress: number }
  | { type: 'siting'; id: number; result?: SitingResult; error?: string };

export interface Leg { from: number; to: number; cells: number[]; energy: number[]; time: number[]; mass: number }

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

function getTT(params: ExplorerParams, targets: APTarget[]): { tt: TTMatrix; cached: boolean } {
  const cells = targets.map((t) => t.cell);
  const key = paramsKey(params, cells);
  if (ttCache && ttCache.key === key) return { tt: ttCache, cached: true };
  ttCache = targetMatrix(grid!, cells, params);
  return { tt: ttCache, cached: false };
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    const g = msg.grid; const s = new Float32Array(g.w * g.h);
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      const dzdx = (g.z[i + 1] - g.z[i - 1]) / (2 * g.res), dzdy = (g.z[i + g.w] - g.z[i - g.w]) / (2 * g.res);
      s[i] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    }
    grid = { ...g, slope: s, terrainFactor: g.terrainFactor ?? undefined, terrainTimeFactor: g.terrainTimeFactor ?? undefined }; ttCache = null; return;
  }
  if (!grid) return;
  if (msg.type === 'terrain') {
    grid = { ...grid, terrainFactor: msg.terrainFactor ?? undefined, terrainTimeFactor: msg.terrainTimeFactor ?? undefined }; ttCache = null; return;
  }
  if (msg.type === 'fields') {
    const t0 = performance.now();
    const home = homeField(grid, msg.base, msg.params);
    const out = outField(grid, msg.base, msg.params);
    const fast = homeFastField(grid, msg.base, msg.params);
    const ms = performance.now() - t0;
    post(
      { type: 'fields', id: msg.id, homeE: home.energy, homeT: home.time, outE: out.energy, outT: out.time, fastT: fast.time, ms },
      [home.energy.buffer, home.time.buffer, out.energy.buffer, out.time.buffer, fast.time.buffer],
    );
    return;
  }
  if (msg.type === 'route') {
    // Visit stops in order, then return to base. Mass grows by sampleMassPerStop after each stop.
    const p = msg.params;
    const seq = [msg.base, ...msg.stops, msg.base];
    const legs: Leg[] = [];
    let mass = p.bodyMass + p.suitMass + p.loadOut;
    for (let i = 0; i < seq.length - 1; i++) {
      const r = route(grid, seq[i], seq[i + 1], mass, p);
      if (!r) { post({ type: 'route', id: msg.id, legs, error: `No safe path to stop ${i + 1}` }); return; }
      legs.push({ from: seq[i], to: seq[i + 1], ...r, mass });
      if (i < msg.stops.length) mass += msg.sampleMassPerStop;
    }
    post({ type: 'route', id: msg.id, legs });
    return;
  }
  if (msg.type === 'warm') { if (msg.targets.length) getTT(msg.params, msg.targets); return; }
  if (msg.type === 'autopilot') {
    try {
      const { tt, cached } = getTT(msg.params, msg.targets);
      const r = runAutopilot(grid, msg.base, msg.targets, msg.params, msg.budget, tt) as AutopilotResult & { ranked?: unknown; matrixMs: number; fieldsMs: number; verifyMs: number };
      delete r.ranked;
      const reply: AutopilotReply = { type: 'autopilot', id: msg.id, result: { ...r, matrixCached: cached } };
      post(reply);
    } catch (e) { post({ type: 'autopilot', id: msg.id, error: String(e) } satisfies AutopilotReply); }
    return;
  }
  if (msg.type === 'siting') {
    // one Dijkstra per macrotask: progress flushes, and a newer siting request supersedes this one
    const id = msg.id; sitingLatest = id;
    const g = grid;
    const job = sitingJob(g, msg.targets, msg.params, msg.budget, msg.options);
    const stepJob = () => {
      if (id !== sitingLatest || g !== grid) return; // superseded or terrain changed
      try {
        const s = job.next();
        if (s.done) {
          const { result, tt } = s.value;
          if (!ttCache || ttCache.key !== tt.key) ttCache = tt; // warm the autopilot cache for free
          post({ type: 'siting', id, result } satisfies SitingReply, [result.value.buffer, result.slack.buffer]);
          return;
        }
        post({ type: 'siting-progress', id, progress: s.value } satisfies SitingReply);
        setTimeout(stepJob, 0);
      } catch (e) { post({ type: 'siting', id, error: String(e) } satisfies SitingReply); }
    };
    setTimeout(stepJob, 0);
  }
};
