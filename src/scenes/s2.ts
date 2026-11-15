// Screen 2, the walk-home map, seen from the ground. The ground keeps its real HiRISE colour; on it, thin white lines
// mark 10, 20 and 30 minutes' walk from the habitat, and a small card beside the crew reads, live, how long the walk home
// is from where they stand and what would be left of the suit if they turned back there. All of it is Rocky's planner.
// URL: #2 (crew view, default) or #2?view=map (high overview). Key V (or the buttons on the view) switches between the
// two with a camera move.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { chrome } from './chrome';
import { makeStory } from './story';
import { BUDGET, fmtTime } from './plan';
import './s2.css';

/** Line segments where a field crosses a level (marching squares on the planning grid). Returns [x0, y0, x1, y1, ...] in cells. */
function contour(f: (i: number) => number, w: number, h: number, level: number) {
  const out: number[] = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = f(i), b = f(i + 1), c = f(i + w + 1), d = f(i + w);
    if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
    const k = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0); if (k === 0 || k === 15) continue;
    const t = (p: number, q: number) => (level - p) / (q - p), pts: number[] = [];
    if ((k & 1) !== ((k >> 1) & 1)) pts.push(x + t(a, b), y);
    if (((k >> 1) & 1) !== ((k >> 2) & 1)) pts.push(x + 1, y + t(b, c));
    if (((k >> 3) & 1) !== ((k >> 2) & 1)) pts.push(x + t(d, c), y + 1);
    if ((k & 1) !== ((k >> 3) & 1)) pts.push(x, y + t(a, d));
    for (let j = 0; j + 3 < pts.length; j += 4) out.push(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
  }
  return out;
}
const ease = (k: number) => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

export default async function screen2() {
  const { stage, setPill } = chrome('Plan', { text: 'Computing the walk-home map' });
  stage.classList.add('withpanel');
  stage.insertAdjacentHTML('beforeend', `<div class="loading" id="loading">Loading 1 m terrain of Mount Sharp</div>
    <div class="s2-view" id="s2view"><button data-v="crew">Crew view</button><button data-v="map">Overview</button><kbd>V</kbd></div>`);
  document.getElementById('app')!.insertAdjacentHTML('beforeend', '<aside class="panel" id="panel"></aside>');
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');

  const { world, stops, plan, crew: makeCrew } = await makeStory(stage);
  const { W, H, res } = world, HALF = world.SIZE / 2, home = plan.home.time;

  // ---- walk-home rings: thin white lines draped on the ground, a constant 2 px wide from any distance -------------
  // (painted into the ground texture they vanish at eye level, where a 3 m line is seen almost edge-on)
  const ringMat = new LineMaterial({ color: 0xffffff, linewidth: 1.6, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  // contoured on a lightly smoothed copy of the field (two 3 x 3 passes, about 6 m) so rough ground gives clean lines
  let sm = Float32Array.from(home);
  for (let pass = 0; pass < 2; pass++) { const o = new Float32Array(sm.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const v = sm[yy * W + xx]; if (isFinite(v)) { a += v; n++; } } o[y * W + x] = isFinite(sm[y * W + x]) && n ? a / n : Infinity; } sm = o; }
  // lifted a little more with distance from stop 1 (where the crew view looks), so far stretches are not lost in the ground
  const [s1x, s1z] = world.cellXZ(stops[0].cell), lift = (x: number, z: number) => .3 + Math.min(2.5, Math.hypot(x - s1x, z - s1z) / 250);
  const rings: [number, Float32Array][] = [];
  for (const min of [10, 20, 30]) {
    const s = contour((i) => sm[i], W, H, min * 60), pos = new Float32Array(s.length / 2 * 3);
    for (let j = 0; j < s.length / 2; j++) { const x = (s[j * 2] + .5) * res - HALF, z = (s[j * 2 + 1] + .5) * res - HALF; pos[j * 3] = x; pos[j * 3 + 1] = world.ground(x, z) + lift(x, z); pos[j * 3 + 2] = z; }
    const g = new LineSegmentsGeometry(); g.setPositions(pos); world.scene.add(new LineSegments2(g, ringMat)); rings.push([min, pos]);
  }

  // the shared route ribbon is under a pixel wide from the overview; there a 3 px line traces it
  const routeLine = (() => { const P = plan.path.map(world.cellXZ), pos: number[] = []; for (let i = 1; i < P.length; i++) pos.push(P[i - 1][0], world.ground(P[i - 1][0], P[i - 1][1]) + 1, P[i - 1][1], P[i][0], world.ground(P[i][0], P[i][1]) + 1, P[i][1]);
    const g = new LineSegmentsGeometry(); g.setPositions(pos); const l = new LineSegments2(g, new LineMaterial({ color: 0xffffff, linewidth: 4.5 })); world.scene.add(l); return l; })();

  // ---- the crew on leg 1, moved by the planner's own clock --------------------------------------------------------
  const leg = plan.legs[0], pts = leg.cells.map(world.cellXZ), END = leg.time[leg.time.length - 1];
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < pts.length - 1; i++) pts[i] = [(pts[i - 1][0] + pts[i][0] * 2 + pts[i + 1][0]) / 4, (pts[i - 1][1] + pts[i][1] * 2 + pts[i + 1][1]) / 4];
  /** Where the crew are t seconds after leaving the habitat, and the planner's walk-home time from that spot. */
  const onLeg = (t: number) => {
    t = Math.max(0, Math.min(END, t)); let k = 1; while (k < leg.time.length - 1 && leg.time[k] < t) k++;
    const f = Math.min(1, (t - leg.time[k - 1]) / (leg.time[k] - leg.time[k - 1] || 1)), lerp = (a: number, b: number) => a + (b - a) * f;
    return { x: lerp(pts[k - 1][0], pts[k][0]), z: lerp(pts[k - 1][1], pts[k][1]), home: lerp(home[leg.cells[k - 1]], home[leg.cells[k]]) };
  };
  const yawAt = (t: number) => { const a = onLeg(t - 10), b = onLeg(t + 10); return Math.atan2(b.x - a.x, b.z - a.z); };
  const T0 = END * .55, STOPPED = END - 4;                                   // the scene opens 55% of the way to stop 1
  const { A, B } = makeCrew();
  const crewPos = new THREE.Vector3(), cardAt = new THREE.Vector3();
  const card = world.chip('', cardAt, 's2-here');
  let shown = '';
  /** Pose both crew members at walk time t; update the "if they turned back here" card. */
  const place = (t: number) => {
    t = Math.min(t, STOPPED); const c = onLeg(t), yaw = yawAt(t), fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx, moving = t < STOPPED;
    // A (orange) walks just left of the line, B (blue) just right of it and a step behind
    for (const [a, side, lag] of [[A, -.7, 0], [B, .5, .8]] as const) {
      const x = c.x + rx * side - fx * lag, z = c.z + rz * side - fz * lag;
      a.root.position.copy(world.at(x, z)); a.root.rotation.y = yaw; if (moving) a.walk(t * 1.1 * Math.PI * 2 / 1.5 + lag * 2); else a.stand();
    }
    crewPos.copy(world.at(c.x, c.z));
    cardAt.copy(crewPos).add(new THREE.Vector3(0, 2.5, 0));
    const left = (plan.T - t - c.home) / plan.T, html = `<div><span>Walk home</span><b>${Math.round(c.home / 60)}<small> min</small></b></div><div><span>Reserve</span><b>${Math.round(left * 100)}<small>%</small></b></div><p>if they turned back here</p>`;
    if (html !== shown) { card.innerHTML = html; shown = html; }
    return yaw;
  };

  // ---- camera: crew view and overview -----------------------------------------------------------------------------
  const cam = world.camera, ctl = world.controls;
  /** Crew view: eye level a few metres behind and to the right of the two, looking the way they walk. */
  const crewPose = (yaw: number) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
    const x = crewPos.x - fx * 8.5 + rx * 1.4, z = crewPos.z - fz * 8.5 + rz * 1.4;
    const p = new THREE.Vector3(x, Math.max(crewPos.y + 2.4, world.ground(x, z) + 1.7), z);
    const look = yaw - .07, t = p.clone().add(new THREE.Vector3(Math.sin(look) * 60, -60 * Math.tan(.11), Math.cos(look) * 60));
    return { p, t };
  };
  /** Overview: high and oblique from the north, the whole route, the habitat and the rings, Mount Sharp behind. */
  const mapPose = (() => {
    const cells = [plan.base, ...plan.path], xs = cells.map((c) => world.cellXZ(c)[0]), zs = cells.map((c) => world.cellXZ(c)[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, t = world.at(cx, cz);
    return { p: t.clone().add(new THREE.Vector3(-520, 1000, -1900)), t };
  })();

  let yaw = place(T0); const last = crewPos.clone();

  // ---- ring labels ------------------------------------------------------------------------------------------------
  // A ring the route crosses is labelled at the crossing. The route never reaches 20 or 30 min (the whole walk stays
  // within about 12 min of the hatch), so those are labelled at the nearest stretch of ring the crew view can see.
  const view0 = crewPose(yawAt(T0)), probe = cam.clone(); probe.position.copy(view0.p); probe.lookAt(view0.t); probe.updateMatrixWorld();
  const seen = (p: THREE.Vector3) => { const n = 120; for (let i = 1; i < n; i++) { const k = i / n, x = view0.p.x + (p.x - view0.p.x) * k, z = view0.p.z + (p.z - view0.p.z) * k; if (world.ground(x, z) > view0.p.y + (p.y - view0.p.y) * k + .2) return false; } return true; };
  const placed = [world.cellPos(stops[0].cell, 3).project(probe)];
  for (const [min, segs] of rings) {
    const lv = min * 60, P = plan.path;
    const at: THREE.Vector3[] = [];
    for (let k = 1; k < P.length; k++) if ((home[P[k - 1]] - lv) * (home[P[k]] - lv) <= 0 && home[P[k - 1]] !== home[P[k]]) { const p = world.cellPos(P[k], .3); if (at.every((o) => o.distanceTo(p) > 120)) { at.push(p); world.chip(`${min} min`, p, 'time s2-ring'); } }
    if (at.length) continue;
    let best: THREE.Vector3 | null = null, bd = Infinity;
    for (let j = 0; j < segs.length; j += 3 * 6) {
      const p = new THREE.Vector3(segs[j], segs[j + 1], segs[j + 2]), d = p.distanceTo(view0.p), s = p.clone().project(probe);
      if (d < 60 || d > bd || s.z > 1 || Math.abs(s.x) > .8 || s.y < -.2 || s.y > .8 || placed.some((o) => Math.hypot(o.x - s.x, (o.y - s.y) * 2) < .25) || !seen(p)) continue;
      best = p; bd = d;
    }
    if (best) { world.chip(`${min} min`, best, 'time s2-ring s2-mid'); placed.push(best.clone().project(probe)); }
  }

  let view: 'crew' | 'map' = q.get('view') === 'map' ? 'map' : 'crew', move: { p: THREE.Vector3; t: THREE.Vector3; at: number } | null = null;
  const t0 = performance.now() / 1000;
  const first = view === 'map' ? mapPose : crewPose(yaw); cam.position.copy(first.p); ctl.target.copy(first.t); ctl.update();
  world.lightOn(crewPos, 45);
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('#s2view button')];
  const mark = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  const setView = (v: typeof view) => {
    if (v === view && !move) return; view = v; mark();
    move = { p: cam.position.clone(), t: ctl.target.clone(), at: performance.now() / 1000 };
    history.replaceState(null, '', v === 'map' ? '#2?view=map' : '#2');
  };
  mark(); buttons.forEach((b) => (b.onclick = () => setView(b.dataset.v as typeof view)));
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'v' || e.key === 'V') setView(view === 'map' ? 'crew' : 'map'); });

  world.tick.push((now) => {
    yaw = place(T0 + (now - t0));
    const d = crewPos.clone().sub(last); last.copy(crewPos);
    if (move) {
      const k = ease(Math.min(1, (now - move.at) / 2.2)), to = view === 'map' ? mapPose : crewPose(yaw);
      cam.position.lerpVectors(move.p, to.p, k); ctl.target.lerpVectors(move.t, to.t, k);
      if (k >= 1) move = null;
    } else if (view === 'crew') { cam.position.add(d); ctl.target.add(d); }   // follow the crew; orbiting stays free
    world.lightOn(crewPos, 45);
    routeLine.visible = cam.position.y - world.ground(cam.position.x, cam.position.z) > 120; card.classList.toggle('s2-high', routeLine.visible);
  });

  // ---- panel -------------------------------------------------------------------------------------------------------
  // The tether line: where walking out, the science and walking home fill the usable suit time. Checked over every cell.
  let worst = 0; for (let i = 0; i < W * H; i++) { const v = plan.out.time[i] + plan.work + home[i]; if (isFinite(v) && v > worst) worst = v; }
  const tetherIn = worst > plan.usable;
  const pct = Math.round(plan.minReserve * 100), km = (world.SIZE / 1000).toFixed(1);
  document.getElementById('panel')!.innerHTML = `
    <h2>EVA plan</h2>
    <div class="bigbar ${plan.pass ? '' : 'bad'}"></div>
    <div class="status ${plan.pass ? '' : 'bad'}"><i></i>${plan.pass ? 'Tether holds' : 'Tether broken'}</div>
    <div class="big">${pct}<small>%</small></div>
    <div class="cap">Lowest walk-home reserve on this route</div>
    <div class="rows">
      <div><span>Distance</span><b>${(plan.distance / 1000).toFixed(2)} km</b></div>
      <div><span>Suit time</span><b>${fmtTime(plan.totalTime)}</b></div>
      <div><span>Walking</span><b>${fmtTime(plan.walkTime)}</b></div>
      <div><span>Climb</span><b>${Math.round(plan.climb)} m</b></div>
    </div>
    <div class="s2-keys">
      <div><i class="s2-k route"></i>Planned route, four stops</div>
      <div><i class="s2-k rg"></i>Walk home from here: 10, 20, 30 min</div>
      <div><i class="s2-k card"></i>Walk home and reserve where the crew stand</div>
    </div>
    <p class="s2-tether"><b>Tether line: ${tetherIn ? 'inside this area' : 'not in this area'}.</b> ${tetherIn ? '' : `Every spot you can walk to in this ${km} km square passes the walk-back rule (out, ${BUDGET.workMinPerStop} min of science, home, all within ${fmtTime(plan.usable)}); the farthest still has ${fmtTime(plan.usable - worst)} to spare.`}</p>
    <p class="note">From anywhere on this ground Rocky knows how long the walk home is and what would be left of a ${BUDGET.evaHours}-hour suit.</p>
    <p class="s2-small">Assumes Rocky's defaults: ${BUDGET.evaHours} h suit, ${BUDGET.reservePct}% kept in reserve, ${BUDGET.workMinPerStop} min per stop. Ground: HiRISE image on USGS 1 m terrain.</p>`;
  setPill(`${plan.pass ? 'Go' : 'No-go'}, ${pct}% reserve`, plan.pass ? 'ok' : 'bad');
  document.getElementById('loading')!.remove();
  (window as unknown as { __ready: boolean }).__ready = true;
}
