// Least-energy fields on a regular elevation grid (8-connected).
// homeField: energy/time to walk FROM every cell TO the base (Dijkstra from the base over reversed edges).
// outField:  energy/time to walk FROM the base TO every cell.
// route:     least-energy path between two cells.
import { edgeCost, homeLoad, type ExplorerParams } from './physics';

export interface Grid {
  w: number;
  h: number;
  res: number;           // metres per cell
  z: Float32Array;       // elevation, NaN = no data
  slope?: Float32Array;  // terrain slope (deg) per cell, used to forbid side-hill traverses of steep faces
  // Optional per-cell multiplier (>= 1 typical, default 1) on BOTH energy and time of entering a cell,
  // e.g. loose sand from terrain_class.bin. Applied to the cell being stepped into.
  terrainFactor?: Float32Array;      // multiplies ENERGY of entering a cell (Pandolf terrain coefficient)
  terrainTimeFactor?: Float32Array;  // multiplies TIME of entering a cell (only where a speed reduction is sourced)
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class Heap {
  keys: Float64Array; ids: Int32Array; n = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.ids = new Int32Array(cap); }
  push(k: number, id: number) {
    if (this.n >= this.keys.length) {
      const k2 = new Float64Array(this.keys.length * 2); k2.set(this.keys); this.keys = k2;
      const i2 = new Int32Array(this.ids.length * 2); i2.set(this.ids); this.ids = i2;
    }
    let i = this.n++;
    const K = this.keys, I = this.ids;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; I[i] = I[p]; i = p;
    }
    K[i] = k; I[i] = id;
  }
  pop(): number { // returns id; key in this.lastKey
    const K = this.keys, I = this.ids;
    const top = I[0]; this.lastKey = K[0];
    const k = K[--this.n], id = I[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; I[i] = I[c]; i = c;
    }
    K[i] = k; I[i] = id;
    return top;
  }
  lastKey = 0;
}

export interface Field { energy: Float32Array; time: Float32Array; }

export function dijkstra(g: Grid, source: number | number[], mass: number, p: ExplorerParams, reverse: boolean,
                  target = -1, prev?: Int32Array, objective: 'energy' | 'time' = 'energy', settle?: number[]): Field {
  const byTime = objective === 'time';
  const N = g.w * g.h;
  const energy = new Float32Array(N).fill(Infinity);
  const time = new Float32Array(N).fill(Infinity);
  const done = new Uint8Array(N);
  const heap = new Heap(1 << 16);
  for (const s of Array.isArray(source) ? source : [source]) {
    energy[s] = 0; time[s] = 0;
    heap.push(0, s);
  }
  // settle: stop early once every listed cell is final (used for node-to-node cost matrices)
  let pending = 0; let want: Uint8Array | null = null;
  if (settle && settle.length) { want = new Uint8Array(N); for (const c of settle) if (!want[c]) { want[c] = 1; pending++; } }
  const diag = g.res * Math.SQRT2;
  const tf = g.terrainFactor; const tt = g.terrainTimeFactor;
  while (heap.n > 0) {
    const v = heap.pop();
    if (done[v]) continue;
    done[v] = 1;
    if (v === target) break;
    if (want && want[v] && --pending === 0) break;
    const vx = v % g.w, vy = (v / g.w) | 0;
    const zv = g.z[v];
    for (let k = 0; k < 8; k++) {
      const ux = vx + DX[k], uy = vy + DY[k];
      if (ux < 0 || uy < 0 || ux >= g.w || uy >= g.h) continue;
      const u = uy * g.w + ux;
      if (done[u]) continue;
      const zu = g.z[u];
      if (zu !== zu) continue; // NaN
      if (g.slope && u !== target && g.slope[u] > p.maxSlopeDeg) continue; // too steep to stand on, whatever the heading
      const dl = k < 4 ? g.res : diag;
      // reverse: we are computing cost of u -> v (towards the source); forward: v -> u
      const c = edgeCost(dl, reverse ? zv - zu : zu - zv, mass, p);
      if (!c) continue;
      // terrain factor of the cell being entered: forward v -> u enters u; reverse u -> v enters v
      let f = tf ? (reverse ? tf[v] : tf[u]) : 1;
      if (!(f > 0)) f = 1; // NaN / 0 / missing class -> neutral
      let ft = tt ? (reverse ? tt[v] : tt[u]) : 1;
      if (!(ft > 0)) ft = 1;
      const ne = energy[v] + c[0] * f, nt = time[v] + c[1] * ft;
      if (byTime ? nt < time[u] : ne < energy[u]) {
        energy[u] = ne; time[u] = nt;
        if (prev) prev[u] = v;
        heap.push(byTime ? nt : ne, u);
      }
    }
  }
  return { energy, time };
}

export function homeField(g: Grid, base: number, p: ExplorerParams): Field {
  const [mass, hp] = homeLoad(p);
  return dijkstra(g, base, mass, hp, true);
}

/** Fastest walk home (least time, not least effort): used for the solar-storm drill. */
export function homeFastField(g: Grid, base: number, p: ExplorerParams): Field {
  const [mass, hp] = homeLoad(p);
  return dijkstra(g, base, mass, hp, true, -1, undefined, 'time');
}

export function outField(g: Grid, base: number, p: ExplorerParams): Field {
  return dijkstra(g, base, p.bodyMass + p.suitMass + p.loadOut, p, false);
}

/** Least-energy path from a to b with the given total mass. Returns cell indices plus cumulative energy/time. */
export function route(g: Grid, a: number, b: number, mass: number, p: ExplorerParams) {
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const f = dijkstra(g, a, mass, p, false, b, prev);
  if (!isFinite(f.energy[b])) return null;
  const cells: number[] = [];
  for (let c = b; c !== -1; c = prev[c]) cells.push(c);
  cells.reverse();
  return { cells, energy: cells.map((c) => f.energy[c]), time: cells.map((c) => f.time[c]) };
}
