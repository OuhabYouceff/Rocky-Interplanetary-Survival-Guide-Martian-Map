// Scene 4's slow planning, off the main thread so it runs while the terrain loads: Rocky's autopilot for the current
// habitat (11 targets, exact subset search, cell-by-cell check) and the walkable routes from each site to its targets.
import { dijkstra, type Grid } from '../planner/fields';
import { runAutopilot, targetMatrix, type APBudget, type APTarget } from '../planner/autopilot';
import type { ExplorerParams } from '../planner/physics';
import { loadSites } from './plan';
import type { Meta } from './world';

export interface S4Job { root: string; targets: APTarget[]; P: ExplorerParams; budget: APBudget; sites: { cell: number; stops: number[] }[] }

self.onmessage = async (e: MessageEvent<S4Job>) => {
  const { root, targets, P, budget, sites } = e.data;
  // In a worker a relative address is resolved against the worker's own file, not the page. The data files live beside
  // the page, so resolve every relative fetch (here and in the shared loaders) against the page's address instead.
  const plainFetch = self.fetch.bind(self);
  self.fetch = (u: RequestInfo | URL, o?: RequestInit) => plainFetch(typeof u === 'string' && !/^([a-z]+:|\/)/i.test(u) ? new URL(u, root).href : u, o);
  const meta: Meta = await (await fetch('data/terrain.json')).json(), q = new Uint16Array(await (await fetch('data/elev.bin')).arrayBuffer());
  const { w: W, h: H, res } = meta, z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  // the grid the siting run used: planning heights plus slope, so steep faces are not walked across
  const slope = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; slope[i] = Math.atan(Math.hypot((z[i + 1] - z[i - 1]) / (2 * res), (z[i + W] - z[i - W]) / (2 * res))) * 180 / Math.PI; }
  const g: Grid = { w: W, h: H, res, z, slope };
  const { base } = await loadSites(meta, z);                    // the story's habitat, same code as every scene
  const ap = runAutopilot(g, base, targets, P, budget, targetMatrix(g, targets.map((t) => t.cell), P));
  // one least-effort field per site (outbound load), traced back to each of its targets
  const fan = (cell: number, stops: number[]) => {
    const prev = new Int32Array(W * H).fill(-1); dijkstra(g, cell, P.bodyMass + P.suitMass + P.loadOut, P, false, -1, prev);
    return stops.map((j) => { const out: number[] = []; for (let c = targets[j].cell; c !== -1; c = prev[c]) out.push(c); return out; });
  };
  const now = ap.best;
  postMessage({ base, now, routes: [...sites.map((s) => fan(s.cell, s.stops)), now ? fan(base, now.stops) : []] });
};
