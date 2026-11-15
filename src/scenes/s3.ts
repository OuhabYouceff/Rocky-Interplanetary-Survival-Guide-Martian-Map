// Screen 3, Crew down. The crew are on the shared walk; one astronaut collapses and the other must haul them home.
// Rocky's own planner answers "can you still make it?": the walk-home field is recomputed with the partner's mass added and
// the pace capped at an assumed hauling pace (src/s3-drill.ts). Every figure on screen comes from those fields at run time.
// URL: #3?step=1..4 (keys 1 to 4 or the step buttons), &pace=0.2..0.9 (hauling pace, m/s), &zone=<hours into the walk> (step 4),
//      &at=<minutes of hauling already done> (step 3).
import * as THREE from 'three';
import './s3.css';
import { chrome } from './chrome';
import { gridKey, memo } from './cache';
import { makeStory } from './story';
import { BUDGET, fmtTime } from './plan';
import { DEFAULT_PARAMS } from '../planner/physics';
import { PACE, breakingPace, drill, routeClock, type Drill } from './s3-drill';

const SPEED = 30;                                                        // hauling animation runs 30 times faster than real time
const STEPS = ['Walking', 'Collapse', 'Hauling home', 'Verdict'];

/** Marching squares on the planning grid (as in scene 2): segments [x0, y0, x1, y1, ...] in cells where f crosses level. */
function contour(f: (i: number) => number, w: number, h: number, level: number) {
  const out: number[] = [];
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = f(i), b = f(i + 1), c = f(i + w + 1), d = f(i + w);
    if (!(isFinite(a) && isFinite(b) && isFinite(c) && isFinite(d))) continue;
    const k = (a <= level ? 1 : 0) | (b <= level ? 2 : 0) | (c <= level ? 4 : 0) | (d <= level ? 8 : 0); if (k === 0 || k === 15) continue;
    const t = (p: number, q: number) => (level - p) / (q - p), pts: number[] = [];
    if ((k & 1) !== ((k >> 1) & 1)) pts.push(x + t(a, b), y);
    if (((k >> 1) & 1) !== ((k >> 2) & 1)) pts.push(x + 1, y + t(b, c));
    if (((k >> 3) & 1) !== ((k >> 2) & 1)) pts.push(x + t(d, c), y + 1);
    if ((k & 1) !== ((k >> 3) & 1)) pts.push(x, y + t(a, d));
    for (let j = 0; j + 3 < pts.length; j += 4) out.push(pts[j], pts[j + 1], pts[j + 2], pts[j + 3]);
  }
  return out;
}

export default async function screen3() {
  const { stage, setPill } = chrome('Plan', { text: 'Computing the walk home' });
  stage.classList.add('withpanel');
  stage.insertAdjacentHTML('beforeend', `<div class="loading" id="loading">Loading 1 m terrain of Mount Sharp</div>
    <div class="s3-strip" id="strip">Crew down · partner cannot walk</div>
    <div class="s3-speed" id="speed">Hauling shown at x${SPEED} real time</div>
    <nav class="s3-steps" id="steps">${STEPS.map((s, i) => `<button data-s="${i + 1}"><i>${i + 1}</i>${s}</button>`).join('')}</nav>
    <div class="credit">Terrain: USGS MSL Gale 1 m DEM, HiRISE colour (NASA/JPL/University of Arizona). Walking model: Pextant (Marquez 2008, Santee 2001).</div>`);
  document.getElementById('app')!.insertAdjacentHTML('beforeend', '<aside class="panel s3-panel" id="panel"></aside>');
  const panel = document.getElementById('panel')!, $ = (id: string) => panel.querySelector<HTMLElement>('#' + id) ?? stage.querySelector<HTMLElement>('#' + id);
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');

  const { world, sites, plan, base, crew: makeCrew, track } = await makeStory(stage);
  world.controls.minDistance = 1.5;                                    // close-ups of the crew
  const { W, H } = world, T = plan.T, RULE = BUDGET.reservePct / 100, clock = routeClock(plan);
  const pct = (x: number) => `${Math.round(x * 100)}%`, min = (s: number) => `${Math.round(s / 60)} min`;
  const clampPace = (v: number) => Math.min(PACE.max, Math.max(PACE.min, Math.round(v * 20) / 20));

  // ---- the two walk-home fields ------------------------------------------------------------------------------------
  // remembered between page loads: the hauling field and the breaking-pace search are several seconds of Dijkstra
  const key = (pace: number) => `drill:${gridKey(world.grid.z)}:${plan.base}:${plan.stops.map((x) => x.cell).join(',')}:${pace}`;
  const pace0 = clampPace(+(q.get('pace') ?? PACE.def));
  let d: Drill = await memo(key(pace0), () => drill(world.grid, plan, pace0));
  const breaks = await memo(key(-1), () => breakingPace(world.grid, plan));   // independent of the slider: computed once, then remembered

  // ---- crew, hauling path, harness --------------------------------------------------------------------------------
  const { A, B } = makeCrew();
  // the harness: two straps from the hauler's gloves to the partner's shoulders
  const harness = new THREE.Group(), straps = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1, 6).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: .7 })); harness.add(m); return m; });
  const strap = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => { const v = b.clone().sub(a); m.position.copy(a); m.scale.set(1, v.length(), 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); };
  world.scene.add(harness);
  let haulRibbon: THREE.Mesh | null = null, haul = makeHaul();
  function makeHaul() {
    const cells = d.path.cells, pts = cells.map(world.cellXZ), dist = [0];
    for (let k = 1; k < pts.length; k++) dist.push(dist[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    haulRibbon?.removeFromParent(); haulRibbon = world.ribbon(pts, .7, 0xf2c200, .95, .5);
    return { cells, dist, time: d.path.time, tr: track(cells), total: d.path.time[cells.length - 1], length: dist[dist.length - 1] };
  }
  /** Where the hauler is after tau seconds of hauling: metres along the path and the cell. */
  const haulAt = (tau: number) => {
    const { time, dist, cells } = haul; let k = 1; while (k < time.length - 1 && time[k] < tau) k++;
    const f = Math.max(0, Math.min(1, (tau - time[k - 1]) / (time[k] - time[k - 1] || 1)));
    return { m: dist[k - 1] + (dist[k] - dist[k - 1]) * f, cell: cells[f < .5 ? k - 1 : k] };
  };
  const smoothAt = (tr: { at: (m: number) => [number, number] }, m: number): [number, number] => { const a = tr.at(m - 3), b = tr.at(m), c = tr.at(m + 3); return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; };
  const heading = (tr: { at: (m: number) => [number, number] }, m: number) => { const [ax, az] = tr.at(m - 6), [bx, bz] = tr.at(m + 6); return Math.atan2(bx - ax, bz - az); };

  // a label on the steepest ground next to the hauling path
  const steepChip = { el: null as HTMLElement | null };

  // ---- ground overlay: steep ground next to the hauling path, and the safe-zone outlines -----------------------------
  let zoneT = d.zoneLeaves;                                             // step 4 opens at the moment the zone edge reaches the worst stop
  const o = world.overlay, k = o.size / W;
  function paint(step: number) {
    o.ctx.clearRect(0, 0, o.size, o.size);
    if (step >= 3) {                                                    // ground the planner will not cross (over its slope limit), within 45 m of the path
      o.ctx.fillStyle = 'rgba(216,57,51,.55)'; const seen = new Set<number>(); let top = -1, topS = 0;
      for (const c of haul.cells) { const cx = c % W, cy = Math.floor(c / W);
        for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) { const i = (cy + dy) * W + cx + dx; if (seen.has(i)) continue; seen.add(i); const s = sites.slope(i); if (s > DEFAULT_PARAMS.maxSlopeDeg && s < 90) { o.ctx.fillRect((i % W) * k, Math.floor(i / W) * k, k, k); if (s > topS) { topS = s; top = i; } } } }
      if (top >= 0 && !steepChip.el) steepChip.el = world.chip(`Too steep to haul, ${Math.round(topS)}°`, world.cellPos(top, 2), 's3-steep');
    }
    if (step === 4) {
      const lim = plan.usable - zoneT, seg = (s: number[], colour: string, dashed: boolean) => {
        o.ctx.strokeStyle = colour; o.ctx.lineWidth = 3.5; o.ctx.lineCap = 'round'; o.ctx.beginPath();
        for (let j = 0; j < s.length; j += 4) { if (dashed && (Math.floor(s[j] / 7) + Math.floor(s[j + 1] / 7)) % 2) continue; o.ctx.moveTo((s[j] + .5) * k, (s[j + 1] + .5) * k); o.ctx.lineTo((s[j + 2] + .5) * k, (s[j + 3] + .5) * k); }
        o.ctx.stroke(); };
      const line = (cells: number[], colour: string) => { o.ctx.strokeStyle = colour; o.ctx.lineWidth = 2.5; o.ctx.beginPath(); cells.forEach((c, j) => o.ctx[j ? 'lineTo' : 'moveTo'](((c % W) + .5) * k, (Math.floor(c / W) + .5) * k)); o.ctx.stroke(); };
      line(plan.path, '#ffffff'); line(haul.cells, '#f2c200');            // from this height the route ribbons are too thin to read
      if (lim > 0) { seg(contour((i) => plan.home.time[i], W, H, lim), 'rgba(255,255,255,.95)', true); seg(contour((i) => d.haul.time[i], W, H, lim), '#2ee05a', false); }
    }
    o.update();
  }
  /** Share of the mapped ground from which the walk home, starting zoneT into the walk, still arrives with 20% left. */
  const zoneShare = (f: Float32Array) => { const lim = plan.usable - zoneT; let a = 0, n = 0; for (let i = 0; i < W * H; i++) { if (!(world.z3[i] === world.z3[i])) continue; n++; if (f[i] <= lim) a++; } return a / n; };

  // ---- the four steps --------------------------------------------------------------------------------------------
  const leg = plan.legs[plan.stops.indexOf(plan.stops.find((s) => s.cell === d.worst.cell)!)], walkTr = track(leg.cells), wi = d.stops.indexOf(d.worst);
  const W0 = walkTr.total * .7;                                         // step 1: the crew are most of the way to the stop where it happens
  const legStart = wi ? clock.done[wi - 1] : 0;
  let step = 0, simT = 0, haulFrom = 0, curM = 0, ahead = new THREE.Vector3();                                  // haulFrom: seconds of hauling already done when step 3 opens (URL at=<min>)
  const cam = (p: THREE.Vector3, t: THREE.Vector3) => { world.camera.position.copy(p); world.controls.target.copy(t); world.controls.update(); };
  const up = (y: number) => new THREE.Vector3(0, y, 0);

  function place(now: number) {
    if (step === 1) {                                                   // walking side by side towards the stop
      const m = Math.min(walkTr.total - 4, W0 + now * DEFAULT_PARAMS.maxSpeed), yaw = heading(walkTr, m), moving = m < walkTr.total - 4.05, [x, z] = smoothAt(walkTr, m);
      const sx = Math.cos(yaw), sz = -Math.sin(yaw);
      for (const [a, off, lag] of [[A, -.9, 0], [B, .9, 1.1]] as const) { const px = x + sx * off - Math.sin(yaw) * lag, pz = z + sz * off - Math.cos(yaw) * lag; a.root.position.copy(world.at(px, pz)); a.root.rotation.y = yaw; if (moving) a.walk(m / 1.5 * Math.PI * 2 + lag * 2); else a.stand(); }
      return world.at(x, z, 1.2);
    }
    if (step === 3) {                                                   // B walks backwards towards the habitat, A dragged behind
      const tau = Math.min(haul.total, (haulFrom + now * SPEED) % (haul.total + SPEED * 4)), { m } = haulAt(tau), yaw = heading(haul.tr, m); curM = m;
      const [bx, bz] = smoothAt(haul.tr, m), [ax, az] = smoothAt(haul.tr, m - 2.6);
      B.root.position.copy(world.at(bx, bz)); B.root.rotation.y = yaw + Math.PI; if (tau < haul.total) B.haul(m * 3.2); else B.stand();
      A.root.position.copy(world.at(ax, az)); A.root.rotation.y = heading(haul.tr, m - 2.6) + Math.PI; A.lie();
      A.root.updateMatrixWorld(true); B.root.updateMatrixWorld(true);
      strap(straps[0], B.elbowL.localToWorld(new THREE.Vector3(0, -.31, 0)), A.armL.getWorldPosition(new THREE.Vector3()));
      strap(straps[1], B.elbowR.localToWorld(new THREE.Vector3(0, -.31, 0)), A.armR.getWorldPosition(new THREE.Vector3()));
      readout(tau, m);
      return world.at(bx, bz, 1);
    }
    return null;
  }

  function go(n: number) {
    step = n; simT = 0; history.replaceState(null, '', `#3?step=${n}`);
    document.querySelectorAll<HTMLButtonElement>('#steps button').forEach((b) => b.classList.toggle('on', +b.dataset.s! === n));
    $('strip')!.style.display = n === 2 || n === 3 ? '' : 'none'; $('speed')!.style.display = n === 3 ? '' : 'none';
    harness.visible = n === 3; haulRibbon!.visible = n >= 2;
    paint(n);
    if (steepChip.el) steepChip.el.style.visibility = n === 3 ? '' : 'hidden';
    const [cx, cz] = world.cellXZ(d.worst.cell), [hx, hz] = world.cellXZ(plan.base), toBase = new THREE.Vector3(hx - cx, 0, hz - cz).normalize(), side = new THREE.Vector3(-toBase.z, 0, toBase.x);
    if (n === 1) {
      const yaw = heading(walkTr, W0); ahead = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); follow(place(0)!);
    } else if (n === 2) {
      const yaw = Math.atan2(toBase.x, toBase.z), a = world.at(cx, cz), torso = a.clone().addScaledVector(toBase, .45);
      A.root.position.copy(a); A.root.rotation.y = yaw + Math.PI; A.lie();
      const bp = torso.clone().addScaledVector(side, 1.2); B.root.position.copy(world.at(bp.x, bp.z)); B.root.rotation.y = Math.atan2(-side.x, -side.z); B.kneel();
      cam(torso.clone().addScaledVector(side, -5.2).addScaledVector(toBase, -1.6).add(up(2.1)), torso.clone().addScaledVector(side, .6).addScaledVector(toBase, .6).add(up(.1)));
      world.lightOn(torso, 30);
    } else if (n === 3) {
      chase(place(0)!);
    } else {
      // verdict: the crew are home; a higher oblique view over the habitat, the route and the four stops
      const [bx, bz] = [base.x, base.z], yaw = Math.atan2(cx - bx, cz - bz);
      B.root.position.copy(world.at(bx + 2, bz + 1)); B.root.rotation.y = yaw; B.stand(); A.root.position.copy(world.at(bx - 1, bz)); A.root.rotation.y = yaw; A.lie();
      const pts = [plan.base, ...plan.stops.map((s) => s.cell)].map(world.cellXZ), mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, mz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      const r = Math.max(...pts.map(([x, z]) => Math.hypot(x - mx, z - mz))), c = world.at(mx, mz);
      cam(c.clone().add(new THREE.Vector3(.35, .62, 1).normalize().multiplyScalar(r * 2.6)), c);
      world.lightOn(c, 700);
    }
    render();
  }
  // step 3: the camera rides behind the dragged partner, looking along the path towards the habitat
  function chase(p: THREE.Vector3) {
    const m = curM, [ax, az] = haul.tr.at(m - 14), [bx, bz] = haul.tr.at(m + 14);
    const dir = new THREE.Vector3(bx - ax, 0, bz - az).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    cam(p.clone().addScaledVector(dir, -8.5).addScaledVector(side, 2.6).add(up(1.5)), p.clone().addScaledVector(dir, 12).add(up(-.5)));
    world.lightOn(p, 40);
  }
  // step 1: a few metres behind the two walkers, looking the way they walk
  function follow(p: THREE.Vector3) {
    const right = new THREE.Vector3(-ahead.z, 0, ahead.x);
    cam(p.clone().addScaledVector(ahead, -7.5).addScaledVector(right, -1.4).add(up(1.5)), p.clone().addScaledVector(ahead, 30).addScaledVector(right, 2).add(up(-.4)));
    world.lightOn(p, 45);
  }
  world.tick.push((_, dt) => {                                          // the scene's own clock: slow frames slow the story, never skip it
    simT += dt; const p = place(simT); if (!p) return;
    if (step === 3) chase(p); else if (step === 1) follow(p);
  });

  // ---- panel ---------------------------------------------------------------------------------------------------------
  const paceCtl = () => `
    <div class="s3-pace"><label for="pace">Hauling pace</label><b id="paceV">${d.pace.toFixed(2)} m/s</b><span class="s3-tag">Assumed</span></div>
    <input type="range" id="pace" min="${PACE.min}" max="${PACE.max}" step="0.05" value="${d.pace}">
    <p class="s3-hint">No measured value exists for hauling a suited crew member on Mars. Rocky's drill uses 0.5 m/s as a placeholder.</p>`;
  const bar = (used: number, arrive: number) => `
    <div class="s3-bar"><i style="width:${used / T * 100}%"></i><u style="left:${used / T * 100}%;width:${Math.max(0, arrive - used) / T * 100}%"></u><em style="left:${(1 - RULE) * 100}%"></em><s style="left:${arrive / T * 100}%"></s></div>
    <div class="s3-barlab"><span class="rule" style="left:${(1 - RULE) * 100}%">${BUDGET.reservePct}% rule</span></div>`;
  let prof = { zs: [] as number[], lo: 0, sy: 1 };
  function render() {
    const w = d.worst, holds = d.stops.every((s) => s.down >= RULE);
    if (step === 1) {
      const kk = Math.min(leg.cells.length - 1, Math.round(leg.cells.length * .7)), here = leg.cells[kk], used = legStart + leg.time[kk];
      panel.innerHTML = `
        <h2>EVA plan</h2>
        <div class="bigbar ${plan.pass ? '' : 'bad'}"></div>
        <div class="status ${plan.pass ? '' : 'bad'}"><i></i>${plan.pass ? 'Tether holds' : 'Tether broken'}</div>
        <div class="big">${Math.round(plan.minReserve * 100)}<small>%</small></div>
        <div class="cap">Lowest walk-home reserve on this route</div>
        <h3 class="s3-h3">Here, on the way to stop ${wi + 1}, ${w.name}</h3>
        <div class="rows">
          <div><span>Walk home from here</span><b>${min(plan.home.time[here])}</b></div>
          <div><span>Suit time used</span><b>${fmtTime(used)}</b></div>
          <div><span>Suit time left</span><b>${fmtTime(T - used)}</b></div>
          <div><span>Shared walk</span><b>${(plan.distance / 1000).toFixed(2)} km, ${fmtTime(plan.totalTime)}</b></div>
        </div>
        <button class="s3-cta" id="drillBtn">Crew-down drill</button>
        <p class="note">The drill asks one question: if one of you collapses, can the other haul them home in time?</p>`;
      $('drillBtn')!.onclick = () => go(2);
      setPill(`Go, ${Math.round(plan.minReserve * 100)}% reserve`, plan.pass ? 'ok' : 'bad');
    } else if (step === 2) {
      panel.innerHTML = `
        <h2>Crew-down drill</h2>
        <div class="status bad"><i></i>Collapse at stop ${wi + 1}, ${w.name}</div>
        <p class="s3-sub">${fmtTime(w.elapsed)} into the walk, science there finished. The walk home is recomputed on the same terrain with the same walking model, one astronaut hauling the other.</p>
        <div class="s3-change"><span>Mass to move</span><b>${d.massBefore} kg → ${d.massAfter} kg</b></div>
        <div class="s3-change"><span>Pace</span><b>${DEFAULT_PARAMS.maxSpeed.toFixed(2)} → ${d.pace.toFixed(2)} m/s</b></div>
        <div class="s3-change"><span>Walk home from here</span><b>${min(w.home)} → ${min(w.haul)}</b></div>
        <div class="s3-change"><span>Arrive home with</span><b>${pct(w.both)} → <em class="${w.down >= RULE ? 'ok' : 'bad'}">${pct(w.down)}</em></b></div>
        <p class="s3-hint">Mass: ${DEFAULT_PARAMS.bodyMass + DEFAULT_PARAMS.suitMass + DEFAULT_PARAMS.loadBack} kg (hauler, suit, tools and samples) plus the partner in the same suit, ${DEFAULT_PARAMS.bodyMass + DEFAULT_PARAMS.suitMass} kg. Rule: arrive with at least ${BUDGET.reservePct}% of the ${BUDGET.evaHours}-hour suit.</p>
        ${paceCtl()}`;
      setPill('Drill running', 'warn');
    } else if (step === 3) {
      panel.innerHTML = `
        <h2>Crew-down drill</h2>
        <div class="status warn"><i></i>Hauling home</div>
        <div class="big" id="r-left">–</div>
        <div class="cap">Time to habitat</div>
        <div class="s3-suit"><span>Suit time</span><b id="r-arrive"></b></div>
        <div id="r-bar"></div>
        <div class="rows">
          <div><span>Distance left</span><b id="r-dist">–</b></div>
          <div><span>Pace cap</span><b>${d.pace.toFixed(2)} m/s</b></div>
          <div><span>Slope here</span><b id="r-slope">–</b></div>
        </div>
        <svg class="s3-prof" id="r-prof" viewBox="0 0 340 70" preserveAspectRatio="none"></svg>
        <div class="s3-proflab"><span>Path home, ${Math.round(haul.length)} m</span><span id="r-climb"></span></div>
        ${paceCtl()}`;
      // the ground profile of the hauling path, from the 3 m grid
      const zs = haul.cells.map((c) => world.z3[c]), lo = Math.min(...zs), hi = Math.max(...zs), sx = 340 / haul.length, sy = 60 / Math.max(1, hi - lo);
      prof = { zs, lo, sy };
      let climb = 0; for (let i = 1; i < zs.length; i++) climb += Math.max(0, zs[i] - zs[i - 1]);
      $('r-prof')!.innerHTML = `<polyline points="${zs.map((z, i) => `${(haul.dist[i] * sx).toFixed(1)},${(65 - (z - lo) * sy).toFixed(1)}`).join(' ')}"/><circle id="r-dot" r="4" cx="0" cy="${65 - (zs[0] - lo) * sy}"/>`;
      $('r-climb')!.textContent = `climb ${Math.round(climb)} m`;
      setPill('Drill running', 'warn');
    } else {
      const share = { down: zoneShare(d.haul.time), both: zoneShare(plan.home.time) };
      panel.innerHTML = `
        <h2>Crew-down drill</h2>
        <div class="status ${holds ? '' : 'bad'}"><i></i>${holds ? 'Rescue holds at every stop' : 'Rescue fails'}</div>
        <table class="s3-table"><thead><tr><th>Partner collapses after the science at</th><th>Both walking, arrive with</th><th>Crew down</th><th>Cost</th></tr></thead><tbody>
          ${d.stops.map((s, i) => `<tr class="${s.down >= RULE ? '' : 'bad'}"><td><i class="${s.down >= RULE ? 'ok' : 'bad'}"></i>${i + 1} ${s.name}<small>${fmtTime(s.elapsed)} in</small></td><td>${pct(s.both)}</td><td><b>${pct(s.down)}</b></td><td>${min(s.haul - s.home)}<small>${((s.both - s.down) * 100).toFixed(1)} pts</small></td></tr>`).join('')}
        </tbody></table>
        <p class="s3-verdict">${holds
          ? `This walk survives its worst day. The worst place to collapse is ${w.name}: hauling home takes ${min(w.haul)} instead of ${min(w.home)}, and the crew still arrive with ${pct(w.down)} of suit time, ${Math.round((w.down - RULE) * 100)} points above the rule.`
          : `A collapse at ${d.stops.filter((s) => s.down < RULE).map((s) => s.name).join(', ')} cannot be hauled home with ${BUDGET.reservePct}% left.`}</p>
        <p class="s3-break"><b>What would break it.</b> ${breaks === null ? 'No hauling pace above 0.05 m/s' : `A hauling pace under ${breaks.toFixed(2)} m/s`}, or running ${fmtTime(d.lateBy)} behind schedule at ${d.pace.toFixed(2)} m/s.</p>
        <div class="s3-zone">
          <div class="s3-zhead"><span>Safe zone, collapse at</span><b id="zoneV">${fmtTime(zoneT)}</b></div>
          <div class="s3-zbtn">${d.stops.map((_s, i) => `<button data-t="${clock.done[i]}" class="${Math.abs(zoneT - clock.done[i]) < 30 ? 'on' : ''}">Stop ${i + 1}</button>`).join('')}<button data-t="${d.zoneLeaves}" class="${Math.abs(zoneT - d.zoneLeaves) < 30 ? 'on' : ''}">${fmtTime(d.zoneLeaves)}</button></div>
          <input type="range" id="zone" min="0" max="${Math.floor(plan.usable / 60)}" step="1" value="${Math.round(zoneT / 60)}">
          <div class="keys"><div><i class="k s3-kroute"></i>Shared walk</div><div><i class="k s3-khaul"></i>Hauling path home from ${w.name}</div><div><i class="k s3-kdash"></i>Both walking: ${pct(share.both)} of the map</div><div><i class="k s3-ksolid"></i>Crew down: ${pct(share.down)} of the map</div></div>
          <p class="s3-hint">From inside a line the crew still get home with ${BUDGET.reservePct}% left. After ${fmtTime(d.zoneLeaves)} outside, a collapse at ${w.name} could no longer be hauled home in time (walking together: ${fmtTime(d.zoneLeavesBoth)}). The plan leaves it at ${fmtTime(w.elapsed)}.</p>
        </div>
        ${paceCtl()}`;
      const setZone = (t: number) => { zoneT = t; paint(4); render(); };
      panel.querySelectorAll<HTMLButtonElement>('.s3-zbtn button').forEach((b) => (b.onclick = () => setZone(+b.dataset.t!)));
      let raf = 0; const z = $('zone') as HTMLInputElement;
      z.oninput = () => { $('zoneV')!.textContent = fmtTime(+z.value * 60); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { zoneT = +z.value * 60; paint(4); }); };
      z.onchange = () => setZone(+z.value * 60);
      setPill(holds ? `Rescue holds, ${pct(d.lowestDown)} at worst` : 'Rescue fails', holds ? 'ok' : 'bad');
    }
    const p = $('pace') as HTMLInputElement | null;
    if (p) {
      p.oninput = () => { $('paceV')!.textContent = `${(+p.value).toFixed(2)} m/s`; };
      p.onchange = () => {
        panel.querySelector('.status')!.outerHTML = '<div class="status warn"><i></i>Recalculating the walk home</div>';
        const atLimit = Math.abs(zoneT - d.zoneLeaves) < 30;
        setTimeout(() => { d = drill(world.grid, plan, clampPace(+p.value)); if (atLimit) zoneT = d.zoneLeaves; haul = makeHaul(); steepChip.el?.remove(); steepChip.el = null; go(step); }, 40);   // about 1 s of Dijkstra
      };
    }
  }
  function readout(tau: number, m: number) {
    const left = haul.total - tau, used = d.worst.elapsed + tau, arrive = d.worst.elapsed + haul.total, el = $('r-left');
    if (!el) return;
    el.innerHTML = `${Math.max(0, Math.ceil(left / 60))}<small> min</small>`;
    $('r-arrive')!.textContent = `arrive with ${fmtTime(T - arrive)}, ${pct((T - arrive) / T)}`;
    $('r-bar')!.innerHTML = bar(used, arrive);
    $('r-dist')!.textContent = `${Math.max(0, Math.round(haul.length - m))} m`;
    $('r-slope')!.textContent = `${Math.round(sites.slope(haulAt(tau).cell))}°`;
    const dot = $('r-dot'), i = haul.dist.findIndex((x) => x >= m); if (dot) { dot.setAttribute('cx', String(m / haul.length * 340)); dot.setAttribute('cy', String(65 - (prof.zs[i < 0 ? prof.zs.length - 1 : i] - prof.lo) * prof.sy)); }
  }

  document.querySelectorAll<HTMLButtonElement>('#steps button').forEach((b) => (b.onclick = () => go(+b.dataset.s!)));
  (window as unknown as { __keys?: (e: KeyboardEvent) => boolean }).__keys = (e) => { if (/^[1-4]$/.test(e.key) && !(e.target instanceof HTMLInputElement)) { go(+e.key); return true; } return false; };
  haulFrom = Math.max(0, +(q.get('at') ?? 0) * 60);
  if (q.get('zone')) zoneT = Math.max(0, Math.min(plan.usable, +q.get('zone')! * 3600));
  go(Math.min(4, Math.max(1, +(q.get('step') ?? 1) || 1)));
  $('loading')!.remove();
  (window as unknown as { __ready: boolean }).__ready = true;
}
