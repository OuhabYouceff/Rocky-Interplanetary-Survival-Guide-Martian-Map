// Scene 4, where to put the habitat. Rocky has scored every candidate habitat site on a 36 m grid by the most science
// one walk from there can reach while keeping the walk-back rule (precomputed by Rocky's own siting planner,
// base_siting.json/.bin). Teal discs on the ground: one per scored site, bigger and stronger = more science. Pins: the
// best site (A), the best site at least 300 m from A (B) and the current habitat (Now). White lines: walkable routes
// (Rocky's least-effort Dijkstra) from the selected site to every target in its plan; red rings: targets it cannot include.
// The current habitat's own plan is computed live with Rocky's autopilot (same code as the app's Autopilot screen).
// URL: #4 (crew view at the current habitat), #4?view=map (high overview); &sel=a|b|now picks the site; &moved=1 starts
// with the habitat already moved to A. Keys: A, B, N select; V switches view.
import * as THREE from 'three';
import { chrome } from './chrome';
import { memo } from './cache';
import { makeStory } from './story';
import { fmtTime } from './plan';
import { DEFAULT_PARAMS, type ExplorerParams } from '../planner/physics';
import { shortName, type APTarget, type AutopilotResult } from '../planner/autopilot';
import { decodeSiting, type SitingFileMeta } from '../planner/siting';
import type { S4Job } from './s4-worker';
import './s4.css';

type Key = 'A' | 'B' | 'Now';
interface Site { key: Key; cell: number; value: number; stops: number[]; totalTime: number; minReserve: number; routes: number[][]; chip?: HTMLElement }
const frame = () => new Promise((r) => setTimeout(r, 30));     // let the loading text paint between long computations

export default async function scene4() {
  const { stage, setPill } = chrome('Plan', { text: 'Scoring habitat sites' });
  stage.classList.add('withpanel');
  stage.insertAdjacentHTML('beforeend', `<div class="loading" id="loading">Loading 1 m terrain of Mount Sharp</div>
    <div class="s4-view"><button data-v="crew">Crew view</button><button data-v="map">Overview</button><kbd>V</kbd></div>`);
  document.getElementById('app')!.insertAdjacentHTML('beforeend', '<aside class="panel s4" id="panel"></aside>');
  const loading = (t: string) => { document.getElementById('loading')!.textContent = t; return frame(); };
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');

  // the scores and the targets first (small files), so the slow planning can start in a worker while the terrain loads
  const [meta, buf, tj, terrain] = await Promise.all([
    fetch('data/base_siting.json').then((r) => r.json()) as Promise<SitingFileMeta & { targets: { id: string; cell: number; value: number }[] }>,
    fetch('data/base_siting.bin').then((r) => r.arrayBuffer()),
    fetch('data/science_targets.json').then((r) => r.json()),
    fetch('data/terrain.json').then((r) => r.json()) as Promise<{ w: number }>,
  ]);
  const S = decodeSiting(meta, buf), M = S.cw * S.ch;
  const names: Record<string, string> = Object.fromEntries((tj.targets as { id: string; name: string }[]).map((t) => [t.id, shortName(t.name)]));
  const targets: APTarget[] = meta.targets.map((t) => ({ id: t.id, name: names[t.id] ?? t.id, cell: t.cell, value: t.value }));
  const nT = targets.length, P: ExplorerParams = { ...DEFAULT_PARAMS, ...meta.params }, W = terrain.w;
  const cxy = (c: number) => [c % W, Math.floor(c / W)], dist = (p: number, q2: number) => Math.hypot(cxy(p)[0] - cxy(q2)[0], cxy(p)[1] - cxy(q2)[1]) * S.res;
  const top = S.top.filter((t) => t.plan);
  const a = top[0], b = top.find((t) => dist(t.cell, a.cell) >= 300) ?? top[1];       // B: the best site at least 300 m from A
  // The planning run takes several seconds, so its result is remembered between page loads (keyed by the siting file's date and inputs).
  const planned = memo(`s4:${meta.generated}:${a.cell}:${b.cell}:${JSON.stringify(P)}`, () => new Promise<{ base: number; now: AutopilotResult['best']; routes: number[][][] }>((ok) => {
    const worker = new Worker(new URL('./s4-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { ok(e.data); worker.terminate(); };
    worker.postMessage({ root: document.baseURI, targets, P, budget: meta.budget, sites: [a, b].map((t) => ({ cell: t.cell, stops: t.plan!.stops })) } satisfies S4Job);
  }));

  const { world, plan, habitat, crew: makeCrew } = await makeStory(stage, { route: false, stopChips: false });
  await loading('Planning the best walk from the current habitat');
  const job = await planned, nowPlan = job.now!;
  if (job.base !== plan.base) throw new Error('the worker planned from another habitat cell');
  const latCell = (k: number) => (S.y0 + Math.floor(k / S.cw) * S.step) * W + S.x0 + (k % S.cw) * S.step;

  // ---- the three sites -------------------------------------------------------------------------------------------
  const fromTop = (key: Key, t: typeof a, routes: number[][]): Site => ({ key, cell: t.cell, value: t.value, stops: t.plan!.stops, totalTime: t.plan!.verified?.totalTime ?? t.plan!.totalTime, minReserve: t.plan!.verified?.minMargin ?? t.plan!.minReserve, routes });
  // the current habitat: its score is the value of the nearest scored site; its walk is planned live by Rocky's autopilot
  let nk = -1; for (let k = 0; k < M; k++) if (S.value[k] !== 255 && (nk < 0 || dist(latCell(k), plan.base) < dist(latCell(nk), plan.base))) nk = k;
  const sites: Record<Key, Site> = {
    A: fromTop('A', a, job.routes[0]), B: fromTop('B', b, job.routes[1]),
    Now: { key: 'Now', cell: plan.base, value: S.value[nk], stops: nowPlan.stops, totalTime: nowPlan.verified?.totalTime ?? nowPlan.totalTime, minReserve: nowPlan.verified?.minMargin ?? nowPlan.minReserve, routes: job.routes[2] },
  };
  let tied = 0, scored = 0; for (let k = 0; k < M; k++) if (S.value[k] !== 255) { scored++; if (S.value[k] === a.value) tied++; }

  // ---- the ground: score markers and route lines (drawn into the ground overlay, so they lie exactly on the terrain) ----
  const o = world.overlay, kpx = o.size / W, mpp = world.SIZE / o.size;
  const draw = (s: Site) => {
    const c = o.ctx; c.clearRect(0, 0, o.size, o.size);
    for (let k = 0; k < M; k++) {
      const v = S.value[k]; if (v === 255) continue;
      const [x, y] = cxy(latCell(k)), f = v / S.maxValue;
      c.fillStyle = `rgba(0, 200, 185, ${.45 + .5 * f})`; c.beginPath(); c.arc((x + .5) * kpx, (y + .5) * kpx, (3 + 12 * f) / mpp, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 3.2; c.lineJoin = c.lineCap = 'round';
    for (const r of s.routes) { c.beginPath(); r.forEach((cell, i) => { const [x, y] = cxy(cell); c[i ? 'lineTo' : 'moveTo']((x + .5) * kpx, (y + .5) * kpx); }); c.stroke(); }
    o.update();
  };

  // ---- pins, target markers, crew ----------------------------------------------------------------------------------
  const PIN = 18, ink = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: .6 });
  const xz = (c: number) => world.cellXZ(c);
  const pinAt = (s: Site, x: number, z: number, h = PIN) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, h, 10), ink); pole.position.copy(world.at(x, z, h / 2)); pole.castShadow = true; world.scene.add(pole);
    const n = s.stops.length;
    s.chip = world.chip(`<b>${s.key}</b><span>${n} of ${nT} targets · value ${s.value} of ${S.maxValue}</span>`, world.at(x, z, h), 's4-pin');
    s.chip.onclick = () => select(s.key);
  };
  const [hx0, hz0] = [habitat.x, habitat.z];
  pinAt(sites.A, ...xz(a.cell)); pinAt(sites.B, ...xz(b.cell));
  const [bx, bz] = xz(plan.base); pinAt(sites.Now, bx, bz, 6);              // short: it stands right by the crew
  document.querySelector('.chip.hab')?.remove();                // the Now pin labels the habitat here
  // one marker per target (targets closer than 100 m share a label, e.g. the ridge and hollow drills)
  const marks: HTMLElement[] = [], groups: { cell: number; idx: number[] }[] = [];
  targets.forEach((t, j) => { const gr = groups.find((gg) => dist(gg.cell, t.cell) < 100); if (gr) gr.idx.push(j); else groups.push({ cell: t.cell, idx: [j] }); });
  for (const gr of groups) world.chip(gr.idx.map((j) => `<span><i></i>${targets[j].name}</span>`).join(''), world.cellPos(gr.cell, 1), 's4-t')
    .querySelectorAll('span').forEach((sp, n) => { marks[gr.idx[n]] = sp; });

  const { A: crewA, B: crewB } = makeCrew();
  const [ax, az] = xz(a.cell);
  /** Crew standing at a spot, looking towards a point. */
  const standAt = (x: number, z: number, tx: number, tz: number) => {
    const d = new THREE.Vector2(tx - x, tz - z).normalize(), r = new THREE.Vector2(-d.y, d.x), yaw = Math.atan2(d.x, d.y);
    for (const [m, s] of [[crewA, -1.1], [crewB, 1.1]] as const) { m.root.position.copy(world.at(x + r.x * s + d.x * (s > 0 ? .8 : 0), z + r.y * s + d.y * (s > 0 ? .8 : 0))); m.root.rotation.y = yaw + s * .08; m.stand(); }
    world.lightOn(world.at(x, z), 45);
    return d;
  };

  // ---- cameras ---------------------------------------------------------------------------------------------------
  type View = { pos: THREE.Vector3; target: THREE.Vector3 };
  const crewView = (x: number, z: number, d: THREE.Vector2): View => {
    const r = new THREE.Vector2(-d.y, d.x), c = world.at(x, z);
    const p = world.at(x - d.x * 26 - r.x * 6, z - d.y * 26 - r.y * 6); p.y = Math.max(p.y, c.y) + 9;   // a few metres up behind the crew, so the ground ahead reads
    return { pos: p, target: new THREE.Vector3(c.x + d.x * 200, c.y - 12, c.z + d.y * 200) };
  };
  const mapView = (): View => { const c = world.at(-150, -60); return { pos: new THREE.Vector3(c.x + 250, c.y + 2700, c.z + 2400), target: c }; };
  let crewSpot = { x: bx, z: bz }, crewDir = standAt(bx, bz, ax, az), view: 'crew' | 'map' = q.get('view') === 'map' ? 'map' : 'crew';
  const cur = (): View => (view === 'map' ? mapView() : crewView(crewSpot.x, crewSpot.z, crewDir));
  let tween: { from: View; to: View; t0: number; dur: number; arc: number } | null = null;
  const fly = (to: View, dur = 2.2, arc = 0) => { tween = { from: { pos: world.camera.position.clone(), target: world.controls.target.clone() }, to, t0: performance.now() / 1000, dur, arc }; };
  world.tick.push((t) => {
    if (!tween) return;
    const u = Math.min(1, (t - tween.t0) / tween.dur), e = u * u * (3 - 2 * u);
    world.camera.position.lerpVectors(tween.from.pos, tween.to.pos, e).y += Math.sin(Math.PI * e) * tween.arc;
    world.controls.target.lerpVectors(tween.from.target, tween.to.target, e);
    if (u >= 1) tween = null;
  });
  { const v = cur(); world.camera.position.copy(v.pos); world.controls.target.copy(v.target); world.controls.update(); }

  // ---- moving the habitat ------------------------------------------------------------------------------------------
  let moved = false;
  const moveToA = (instant = false) => {
    if (moved) return; moved = true;
    const d = new THREE.Vector2(ax - bx, az - bz).normalize();
    habitat.object.position.copy(world.at(ax + (hx0 - bx), az + (hz0 - bz), -.15));   // same place relative to the site as before
    crewSpot = { x: ax + d.x * 4, z: az + d.y * 4 }; crewDir = standAt(crewSpot.x, crewSpot.z, crewSpot.x + d.x, crewSpot.z + d.y);
    sites.Now.chip!.querySelector('b')!.textContent = 'Old site';
    sites.A.chip!.querySelector('b')!.textContent = 'A · habitat';
    setPill('Habitat moved to site A', 'ok');
    if (view === 'crew') { if (instant) { const v = cur(); world.camera.position.copy(v.pos); world.controls.target.copy(v.target); } else fly(cur(), 4, 60); }
    select('A');
  };

  // ---- panel -------------------------------------------------------------------------------------------------------
  const panel = document.getElementById('panel')!;
  const label = (k: Key) => (k === 'Now' ? (moved ? 'the old site' : 'the current habitat') : `site ${k}`);
  const secs = (s: number) => (Math.abs(s) < 90 ? `${Math.round(Math.abs(s))} s` : fmtTime(Math.abs(s)));
  function select(k: Key) {
    const s = sites[k], A = sites.A, N = sites.Now, inPlan = new Set(s.stops);
    draw(s);
    for (const t of Object.values(sites)) t.chip!.classList.toggle('on', t.key === k);
    marks.forEach((m, j) => m.classList.toggle('out', !inPlan.has(j)));
    const dA = dist(A.cell, N.cell), dt = N.totalTime - A.totalTime;
    const verdict = A.value === N.value
      ? `The current habitat already reaches the same ${N.stops.length} targets (value ${N.value} of ${S.maxValue}). Moving it ${Math.round(dA)} m to site A adds no science; the walk is ${secs(dt)} ${dt >= 0 ? 'shorter' : 'longer'}.`
      : `Site A reaches ${A.value - N.value} more points of science than the current habitat (${A.stops.length} targets instead of ${N.stops.length}), ${Math.round(dA)} m away.`;
    const vals = targets.map((t) => t.value);
    panel.innerHTML = `
      <h2>Where to put the habitat</h2>
      <div class="bigbar"></div>
      <div class="big">${s.stops.length}<small>of ${nT}</small></div>
      <div class="cap">Science targets one walk from ${label(k)} can reach within the walk-back rule</div>
      <div class="s4-cmp">${(['A', 'B', 'Now'] as Key[]).map((key) => `<button data-k="${key}" class="${key === k ? 'on' : ''}"><b>${key === 'Now' && moved ? 'Old' : key}</b><span>${sites[key].stops.length} targets</span><span>value <b>${sites[key].value}</b> of ${S.maxValue}</span></button>`).join('')}</div>
      <div class="rows">
        <div><span>Walk from ${k === 'Now' ? (moved ? 'old site' : 'habitat') : 'site ' + k}</span><b>${fmtTime(s.totalTime)}</b></div>
        <div><span>Lowest reserve</span><b>${Math.round(s.minReserve * 100)}%</b></div>
        <div><span>Sites scored</span><b>${scored.toLocaleString('en-US')}</b></div>
        <div><span>Tied for the top value</span><b>${tied}</b></div>
        <div><span>Grid spacing</span><b>${S.step * S.res} m</b></div>
      </div>
      <button class="s4-move" ${moved ? 'disabled' : ''}>${moved ? 'The habitat is at site A' : 'Move the habitat to A'}</button>
      <p class="note">${verdict}</p>
      <p class="note">Each site is scored by the most science one walk from there can reach while keeping the ${meta.budget.reservePct}% walk-home reserve at every stop (${meta.budget.evaHours}-hour suit, ${meta.budget.workMinPerStop} min of work per stop).</p>
      <div class="s4-keys"><div><i class="s4-k disc"></i>A scored site: bigger and brighter, more science</div><div><i class="s4-k line"></i>Walking route to a target in the plan</div><div><i class="s4-k ring"></i>Target out of reach from this site</div></div>
      <p class="s4-fine">Target values (${Math.min(...vals)} to ${Math.max(...vals)} points, ${S.maxValue} in all) are Rocky's assumed weights: drill sites rank highest. Site scores from Rocky's siting planner (${meta.generated}); the current habitat's walk is planned live by Rocky's autopilot; its value is that of the nearest scored site, ${Math.round(dist(latCell(nk), plan.base))} m away. Keys: A, B, N select, V switches view.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('.s4-cmp button').forEach((el) => { el.onclick = () => select(el.dataset.k as Key); });
    panel.querySelector<HTMLButtonElement>('.s4-move')!.onclick = () => moveToA();
  }
  const k0 = (q.get('sel') ?? 'a').toLowerCase();
  select(k0 === 'b' ? 'B' : k0 === 'now' || k0 === 'n' ? 'Now' : 'A');
  setPill(sites.A.value > sites.Now.value ? `Site A: +${sites.A.value - sites.Now.value} science` : 'Ties the best site', 'ok');
  if (q.get('moved') === '1') moveToA(true);

  const buttons = [...stage.querySelectorAll<HTMLButtonElement>('.s4-view button')];
  const setView = (v: typeof view) => { view = v; buttons.forEach((el) => el.classList.toggle('on', el.dataset.v === v)); fly(cur(), 2.4); };
  buttons.forEach((el) => { el.classList.toggle('on', el.dataset.v === view); el.onclick = () => setView(el.dataset.v as typeof view); });
  addEventListener('keydown', (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === 'a') select('A'); else if (key === 'b') select('B'); else if (key === 'n') select('Now');
    else if (key === 'v') setView(view === 'map' ? 'crew' : 'map');
  });
  document.getElementById('loading')!.remove();
  (window as unknown as { __ready: boolean }).__ready = true;
}
