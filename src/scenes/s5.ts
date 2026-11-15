// Scene 5, radiation test: can you beat the map? Cosmic rays come from the sky; next to a cliff the rock hides part of it,
// so the dose falls. Rocky predicts by how much from the terrain alone; Curiosity's detector (RAD) measured it.
// The place is Maria Gordon Notch, where Curiosity parked on sol 3324: real 1 m ground, real HiRISE colour, and the real
// skyline from Rocky's horizon scan drawn as a sky dome. The judge guesses the dose drop, then sees Rocky and Curiosity.
// URL: #5                      crew-level view, guess not yet revealed
//      #5?reveal=1&guess=12    opens revealed with that guess (for screenshots)
//      #5?view=sky             looking straight up from the stop ("what the detector sees"); V toggles the two views
//      #5?dome=0               hide the dome (to compare the skyline with the rock behind it)
//      #5?cam=dx,dy,dz,tx,ty,tz,fov   camera override (position and target in metres from the stop), for framing shots
import * as THREE from 'three';
import { chrome } from './chrome';
import { buildAstronaut } from './astro';
import { CREW } from './plan';
import { makeNotch } from './s5-notch';
import { dir, dome, fisheye } from './s5-sky';
import './s5.css';

interface Quiz { sol: number; lat: number; lon: number; sky: number; model: number; measured: number; n: number }
interface Stops { stops: number; quiz: Quiz[]; window_sols: number; measured_over_model_slope: number; corrected: { terrain_matters: { n: number; same_direction: number } } }
const NOTCH_SOL = 3324, DOME_R = 30;

export default async function scene5() {
  const { stage, setPill } = chrome('Evidence', { text: 'Radiation test' });
  stage.classList.add('withpanel');
  stage.insertAdjacentHTML('beforeend', '<div class="loading" id="loading">Loading 1 m terrain of Maria Gordon Notch</div>');
  document.getElementById('app')!.insertAdjacentHTML('beforeend', '<aside class="panel s5" id="panel"></aside>');
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');

  const [rad, stops, world] = await Promise.all([
    fetch('data/validation_rad.json').then((r) => r.json()) as Promise<Record<string, { site?: string; sol: number; horizon: number[] }>>,
    fetch('data/validation_rad_stops.json').then((r) => r.json()) as Promise<Stops>,
    makeNotch(stage)]);
  const site = Object.values(rad).find((p) => p.sol === NOTCH_SOL)!, horizon = site.horizon, name = site.site ?? 'Maria Gordon Notch';
  const notch = stops.quiz.find((s) => s.sol === NOTCH_SOL)!;
  const { scene, camera, controls, at } = world;

  // ---- astronaut where the rover was parked, the sky dome around her ---------------------------------------------
  const astro = buildAstronaut(CREW.a), FACE = 330;                    // facing north-north-west, up the notch
  astro.stand(); astro.root.position.copy(at(0, 0)); astro.root.rotation.y = Math.atan2(Math.sin(FACE * Math.PI / 180), -Math.cos(FACE * Math.PI / 180));
  astro.root.traverse((o) => { o.renderOrder = 20; }); scene.add(astro.root);
  const eye = at(0, 0, 1);                                             // Rocky's horizon scan looks from 1 m above the ground
  const domeG = dome(scene, eye, DOME_R, horizon); domeG.visible = q.get('dome') !== '0';
  world.chip(`${Math.round(notch.sky)}% of the sky blocked`, eye.clone().addScaledVector(dir(312, 40), DOME_R), 's5-dome');

  // ---- cameras -----------------------------------------------------------------------------------------------------
  // crew level: a few metres behind and to the right of the astronaut, eye height, looking up the notch past her
  const cam = q.get('cam')?.split(',').map(Number);
  if (cam && cam.length >= 6) { camera.position.copy(at(0, 0)).add(new THREE.Vector3(cam[0], cam[1], cam[2])); controls.target.copy(at(0, 0)).add(new THREE.Vector3(cam[3], cam[4], cam[5])); if (cam[6]) camera.fov = cam[6]; }
  else {
    camera.position.copy(at(0, 0)).add(new THREE.Vector3(2.5, 1.9, 6.5)); controls.target.copy(at(0, 0)).add(new THREE.Vector3(-3, 5, -25)); camera.fov = 68;
  }
  camera.updateProjectionMatrix(); controls.update();
  const fish = fisheye(world.renderer, scene, eye, horizon), draw3d = world.view.draw;
  stage.insertAdjacentHTML('beforeend', `
    <canvas class="s5-fishlay" id="fishlay"></canvas>
    <div class="s5-fishcap" id="fishcap"><b>What the detector sees</b>Looking straight up from the stop, 1 m above the ground (the height of Rocky's horizon scan). North at the top, east on the left, as the sky is seen from below. Dark: sky hidden by rock. Pale: open sky.</div>
    <div class="chip s5-fishpct" id="fishpct">${Math.round(notch.sky)}% of the sky blocked</div>
    <div class="s5-place">${name} · Sol ${NOTCH_SOL}</div>
    <button class="s5-view" id="s5view"></button>
    <div class="credit">Ground: USGS MSL Gale DEM Mosaic 1 m v3 and HiRISE colour mosaic 25 cm (NASA/JPL/UArizona, USGS), no vertical exaggeration.<br>
      Skyline and dose model: Rocky's horizon scan of that DEM (after Guo et al. 2026). Dose: Curiosity RAD (NASA PDS).</div>`);
  const lay = document.getElementById('fishlay') as HTMLCanvasElement;
  const setView = (sky: boolean) => {
    stage.classList.toggle('s5-sky', sky); world.view.chips = !sky; controls.enabled = !sky;
    document.getElementById('s5view')!.textContent = sky ? 'Back to the notch (V)' : 'What the detector sees (V)';
    world.view.draw = sky ? () => { const w = stage.clientWidth, h = stage.clientHeight, r = Math.min(w, h) / 2 - 46; fish.draw(w, h, r, [astro.root, domeG]); overlay(w, h, r); } : draw3d;
  };
  /** Compass, elevation rings and the skyline drawn crisply over the fisheye. */
  const overlay = (w: number, h: number, r: number) => {
    const dpr = Math.min(devicePixelRatio, 2); if (lay.width !== w * dpr) { lay.width = w * dpr; lay.height = h * dpr; }
    const c = lay.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, P = (az: number, el: number): [number, number] => { const k = (90 - el) / 90 * r, a = az * Math.PI / 180; return [cx - Math.sin(a) * k, cy - Math.cos(a) * k]; };
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '500 11px "DM Mono", ui-monospace, monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
    for (const el of [0, 30, 60]) { c.beginPath(); c.arc(cx, cy, (90 - el) / 90 * r, 0, Math.PI * 2); c.stroke(); if (el) c.fillText(`${el}°`, cx + 4, cy - (90 - el) / 90 * r + 8); }
    for (let az = 0; az < 360; az += 30) { const [x, y] = P(az, 0); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.globalAlpha = .35; c.stroke(); c.globalAlpha = 1; }
    c.font = '700 15px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    for (const [l, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) { const [x, y] = P(az, -6); c.fillText(l, x, y); }
    c.beginPath(); horizon.forEach((e, az) => { const [x, y] = P(az, Math.max(0, e)); if (az) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
    c.strokeStyle = '#fff'; c.lineWidth = 2.2; c.stroke();
  };
  setView(q.get('view') === 'sky');
  document.getElementById('s5view')!.onclick = () => setView(!stage.classList.contains('s5-sky'));
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'v' || e.key === 'V') setView(!stage.classList.contains('s5-sky')); });

  // ---- panel: guess, reveal, other stops ---------------------------------------------------------------------------
  const R_KM = 3396.19 * Math.PI / 180;
  const away = (s: Quiz) => Math.hypot((s.lat - notch.lat) * R_KM, (s.lon - notch.lon) * R_KM * Math.cos(notch.lat * Math.PI / 180));
  const order = [notch, ...stops.quiz.filter((s) => s !== notch)];
  let idx = 0, revealed = q.get('reveal') === '1', guess = Math.max(0, Math.min(40, Number(q.get('guess') ?? 10) || 0));
  const fig = Math.round(stops.corrected.terrain_matters.same_direction * 100);
  const panel = document.getElementById('panel')!;
  panel.innerHTML = `
    <h2>Can you beat the map?</h2>
    <p class="s5-lead">Cosmic rays come from the sky. Next to a cliff, rock hides part of the sky, so the dose falls. Rocky predicts by how much from the terrain alone. How much lower is the dose here?</p>
    <div class="s5-where" id="where"></div>
    <label class="s5-q" for="guess">Your guess: the dose drops by <b id="gv"></b></label>
    <input type="range" id="guess" min="0" max="40" step="1" value="${guess}">
    <button class="s5-btn" id="reveal">Reveal what Curiosity measured</button>
    <div id="result" hidden>
      <div class="s5-bars" id="bars"></div>
      <p class="s5-verdict" id="verdict"></p>
      <p class="s5-honest">Curiosity's readings at each stop are compared with its readings at other stops in the ${stops.window_sols} sols before and after. Across all ${stops.stops.toLocaleString('en-US')} stops the detector saw on average ${stops.measured_over_model_slope.toFixed(2)} times the change Rocky predicts: the model overestimates.</p>
    </div>
    <div class="s5-rule"></div>
    <div class="s5-figs">
      <div><b>${stops.stops.toLocaleString('en-US')}</b><span>Rover stops tested</span></div>
      <div><b>${fig}%</b><span>Right direction where shelter is large</span></div>
    </div>
    <p class="s5-foot">Right direction: the ${stops.corrected.terrain_matters.n} stops where Rocky predicts a change of more than 3%, with day-to-day space weather removed.</p>
    <button class="s5-btn ghost" id="next">Next stop</button>
    <p class="s5-foot" id="note3d"></p>`;
  const pct = (v: number) => `${v.toFixed(1).replace(/\.0$/, '')}%`;
  const say = (drop: number) => (drop >= 0 ? pct(drop) : `rises ${pct(-drop)}`);
  const render = () => {
    const s = order[idx], d = away(s), model = -s.model, meas = -s.measured;     // drops, positive = lower dose
    document.getElementById('gv')!.textContent = `${guess}%`;
    document.getElementById('where')!.innerHTML = `<b>${d < .05 ? name : `Curiosity's stop of sol ${s.sol}`} · Sol ${s.sol}</b><span>${pct(s.sky)} of the sky blocked · ${s.n} detector readings</span>`;
    document.getElementById('note3d')!.textContent = s === notch ? '' : `3D view shown for ${name} (sol ${NOTCH_SOL}), ${d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`} from this stop.`;
    document.getElementById('reveal')!.hidden = revealed; document.getElementById('result')!.hidden = !revealed;
    if (!revealed) { setPill('Guess first'); return; }
    const top = Math.max(25, Math.abs(guess), Math.abs(model), Math.abs(meas)) * 1.1;
    const bar = (label: string, v: number, cls: string) => `<div class="s5-bar ${cls}"><span>${label}</span><b>${say(v)}</b><i><em style="width:${Math.abs(v) / top * 100}%"></em></i></div>`;
    document.getElementById('bars')!.innerHTML = bar('Your guess', guess, 'you') + bar('Rocky predicted', model, 'rocky') + bar(`Curiosity measured`, meas, 'rad');
    const offR = Math.abs(model - meas), offY = Math.abs(guess - meas), f = (v: number) => v.toFixed(1);
    document.getElementById('verdict')!.innerHTML = offR < offY ? `Rocky was <b>${f(offR)} points</b> off, you were ${f(offY)}. <b>Rocky was closer.</b>`
      : offY < offR ? `You were <b>${f(offY)} points</b> off, Rocky ${f(offR)}. <b>You beat the map.</b>` : `You and Rocky were both ${f(offR)} points off.`;
    setPill(`Rocky ${f(offR)} pts off`, offR < 5 ? 'ok' : 'warn');
  };
  (document.getElementById('guess') as HTMLInputElement).oninput = (e) => { guess = Number((e.target as HTMLInputElement).value); render(); };
  document.getElementById('reveal')!.onclick = () => { revealed = true; render(); };
  document.getElementById('next')!.onclick = () => { idx = (idx + 1) % order.length; render(); };
  render();

  document.getElementById('loading')!.remove();
  (window as unknown as { __ready: boolean }).__ready = true;
}
