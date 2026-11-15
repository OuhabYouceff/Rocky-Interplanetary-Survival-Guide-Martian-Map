// The set every Mars scene shares, so the seven scenes read as one continuous story:
// the same ground, the same habitat in the same spot, the same four-stop walk, the same two crew members.
import * as THREE from 'three';
import { makeWorld } from './world';
import { buildAstronaut, buildHabitat } from './astro';
import { CREW, WALK, loadSites, makePlanCached, type Plan, type Stop } from './plan';

export async function makeStory(stage: HTMLElement, opts: { route?: boolean; stopChips?: boolean; patch?: number } = {}) {
  let sites!: Awaited<ReturnType<typeof loadSites>>, stops!: Stop[];
  const world = await makeWorld(stage, async ({ meta, z3, cellXZ }) => {
    sites = await loadSites(meta, z3); stops = WALK.map((n) => sites.targets.find((t) => t.name.startsWith(n))!);
    const pts = [sites.base, ...stops.map((s) => s.cell)].map(cellXZ), cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { x: Math.round(cx), z: Math.round(cz), size: opts.patch ?? 1500 };
  });
  const plan: Plan = await makePlanCached(world.grid, sites.base, stops);
  if (opts.route !== false) world.ribbon(plan.path.map(world.cellXZ), 1.1, 0xffffff, .92);
  // the habitat stands beside the start of the route, hatch facing it
  const hab = buildHabitat(), [bx, bz] = world.cellXZ(plan.base), [s1x, s1z] = world.cellXZ(stops[0].cell);
  const off = new THREE.Vector2(s1x - bx, s1z - bz).normalize(), side = new THREE.Vector2(-off.y, off.x), hx = bx - off.x * 9 + side.x * 3, hz = bz - off.y * 9 + side.y * 3;
  hab.position.copy(world.at(hx, hz, -.15)); hab.rotation.y = Math.atan2(off.x, off.y); world.scene.add(hab);
  world.chip('Habitat', world.at(hx, hz, 7), 'hab');
  if (opts.stopChips !== false) stops.forEach((s, i) => world.chip(`<i>${i + 1}</i>${s.name}`, world.cellPos(s.cell, 3), 'stop'));
  /** The two crew members: A wears the orange arm band, B the blue one. */
  const crew = () => { const A = buildAstronaut(CREW.a), B = buildAstronaut(CREW.b); world.scene.add(A.root, B.root); return { A, B }; };
  /** A path of planner cells as world XZ points with running length, and a sampler along it (metres from its start). */
  const track = (cells: number[]) => {
    const pts = cells.map(world.cellXZ), len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1];
    const at = (d: number): [number, number] => { d = Math.max(0, Math.min(total - .01, d)); let i = 1; while (len[i] < d) i++; const t = (d - len[i - 1]) / (len[i] - len[i - 1] || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
    return { total, at };
  };
  return { world, sites, stops, plan, habitat: { x: hx, z: hz, object: hab }, base: { x: bx, z: bz }, crew, track };
}
export type Story = Awaited<ReturnType<typeof makeStory>>;
