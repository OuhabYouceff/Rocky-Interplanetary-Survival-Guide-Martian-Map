// Scene 7, Mars in the room: the walk the judges have just watched, as a scale model on the meeting-room table, seen
// through a phone. Rocky really exports the terrain and the plan for phone AR (rocky/ar.html, src/ar/arScene.ts,
// src/room/main.ts); a screenshot cannot show a camera feed, so the room here is drawn in 3D and the screen says so.
// The model is built from the same data as every other scene: the 3 m planning grid (elev.bin), the HiRISE colour
// image (ortho.jpg), and the shared four-stop walk and walk-home rings from Rocky's planner.
// URL: #7 table model (default) · ?mode=room room scale, standing in it · ?still=1 freezes the hand-held motion.
// Keys: T table, R room.
import * as THREE from 'three';
import './s7.css';
import { chrome } from './chrome';
import { WALK, loadSites, makePlanCached } from './plan';
import type { Meta } from './world';
import { buildRoom, ROOM, TABLE } from './s7-room';
import { buildModel } from './s7-model';
// Rocky's own AR code: the square it crops around the plan, and the width of its room-scale model
import { planWindow, ROOM_WIDTH_M, ROOM_VERT_EXAG } from '../ar/arScene';

const TABLE_W = .6;                                         // the table model: the whole walk area, 60 cm wide
const sig2 = (n: number) => Number(n.toPrecision(2)).toLocaleString('en-US');
const image = (u: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(u)); im.src = u; });

export default async function scene7() {
  const { stage, setPill } = chrome('Plan', { text: 'Building the model' });
  document.body.classList.add('s7');
  [...document.querySelectorAll<HTMLElement>('.tbtn')].find((b) => b.textContent === 'View in AR')?.classList.add('on');
  stage.innerHTML = `
    <div class="s7-phone"><div class="s7-screen" id="s7screen">
      <div class="s7-pins" id="s7pins"></div>
      <b class="s7-brand"><img src="${import.meta.env.BASE_URL}logo-64.png" alt="" width="30" height="30">Rocky<sup class="ai-star" title="Logo: AI-generated image">*</sup></b><div class="s7-scale" id="s7scale"></div>
      <div class="s7-hold" id="s7hold"></div>
      <div class="s7-switch" id="s7switch"><button data-m="table">Table</button><button data-m="room">Room</button></div>
    </div><i class="s7-island"></i><i class="s7-key a"></i><i class="s7-key b"></i></div>
    <div class="s7-band">
      <div class="s7-copy">
        <h1>Mars in the room, before you leave Earth</h1>
        <p>Rocky turns the terrain and the plan into a 3D model you can stand on a table or spread across the floor. Scan the code with a phone: iPhone opens it in AR Quick Look, Android in Chrome's WebXR or Google's Scene Viewer.</p>
        <p class="s7-model" id="s7model"></p>
      </div>
      <figure class="s7-qr"><img src="data/ar/qr.png" alt="QR code to Rocky's AR page"><figcaption>Open the real AR view on your phone</figcaption></figure>
    </div>
    <p class="s7-sim">Simulated view. On a phone, the camera shows your own room.</p>
    <p class="s7-credit">Terrain: USGS MSL Gale DEM (Rocky's 3 m planning grid), HiRISE colour (NASA/JPL/University of Arizona)</p>
    <div class="loading" id="loading">Building the model from the 3 m terrain</div>`;
  const q = new URLSearchParams(location.hash.split('?')[1] ?? ''), still = q.get('still') === '1';

  // ---- the real data and the shared walk ------------------------------------------------------------------------------
  const [meta, buf, ortho] = await Promise.all([fetch('data/terrain.json').then((r) => r.json()) as Promise<Meta>, fetch('data/elev.bin').then((r) => r.arrayBuffer()), image('data/ortho.jpg')]);
  const u16 = new Uint16Array(buf), z3 = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) z3[i] = u16[i] === 0 ? NaN : meta.zmin + (u16[i] - 1) * meta.zscale;
  const sites = await loadSites(meta, z3), stops = WALK.map((n) => sites.targets.find((t) => t.name.startsWith(n))!);
  const plan = await makePlanCached({ w: meta.w, h: meta.h, res: meta.res, z: z3 }, sites.base, stops);
  const pct = Math.round(plan.minReserve * 100);

  // ---- the room, the phone's camera ---------------------------------------------------------------------------------
  const screen = document.getElementById('s7screen')!, pins = document.getElementById('s7pins')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
  screen.prepend(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 2, .01, 40);   // about a phone's main camera in landscape
  const { furniture } = buildRoom(scene, renderer);

  // table model: the whole 3.2 km walk area, true height, on a block 1.5 cm thick under its lowest point
  let zlo = Infinity; for (const z of z3) if (z < zlo) zlo = z;
  const tableWin = { x0: 0, y0: 0, n: meta.w };
  const table = buildModel({ meta, z3, ortho, plan, win: tableWin, width: TABLE_W, floorZ: zlo, block: .015, step: 2, tex: 3200, lines: [22, 4] });
  // turned so the person at the table looks at it from the north-west: low northern plains in front, Mount Sharp rising behind
  table.group.position.y = TABLE.top + .006; table.group.rotation.y = Math.PI; scene.add(table.group); table.group.updateMatrixWorld();
  // room model: Rocky's own crop around the plan, 6 m wide, true height, the floor 15 m below the lowest step of the walk
  const roomWin = planWindow({ meta } as never, plan.legs as never, plan.base, stops.map((s) => s.cell));
  const walkLow = Math.min(...plan.path.map((c) => z3[c])) - 15;
  const room = buildModel({ meta, z3, ortho, plan, win: roomWin, width: ROOM_WIDTH_M, floorZ: walkLow, block: 0, step: 1, tex: 2048, lines: [4, 1.5] });
  room.group.position.y = .004; scene.add(room.group); room.group.updateMatrixWorld();

  // ---- pins on the phone screen: habitat and the four stops -----------------------------------------------------------
  const pin = (html: string, cls: string) => { const el = document.createElement('div'); el.className = cls; el.innerHTML = html; pins.append(el); return el; };
  const pinsOf = (m: typeof table, lift: number) => [
    { el: pin('Habitat', 's7-hab'), p: m.group.localToWorld(m.at(plan.base, lift * 2.5)) },
    ...stops.map((s, i) => ({ el: pin(String(i + 1), 's7-dot'), p: m.group.localToWorld(m.at(s.cell, lift)) })),
  ];
  const tablePins = pinsOf(table, .004), roomPins = pinsOf(room, .05);
  const hab = (m: typeof table, size: number) => {   // a small white dome where the habitat stands (marker, not to scale)
    const d = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: .5 }));
    d.position.copy(m.at(plan.base)); d.castShadow = true; m.group.add(d);
  };
  hab(table, .0045); hab(room, .035);

  // ---- viewpoints: someone walking slowly round the table, phone in hand ------------------------------------------------
  const centre = new THREE.Vector3(0, TABLE.top + .02, -.06);
  const rh = room.group.localToWorld(room.at(plan.base)), rs = stops.map((s) => room.group.localToWorld(room.at(s.cell)));
  const rc = rs.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(rs.length), dir = rc.clone().sub(rh).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
  let frames = 0, mode: 'table' | 'room' = q.get('mode') === 'room' ? 'room' : 'table';
  const look = new THREE.Vector3();
  const view = (t: number) => {
    const shake = (a: number, f: number, p: number) => a * Math.sin(t * f + p);
    if (mode === 'table') {
      const th = .62 + .38 * Math.sin(t * .05), r = .72;
      camera.position.set(Math.sin(th) * r, TABLE.top + .5, Math.cos(th) * r); look.copy(centre);
    } else {
      camera.position.copy(rc).addScaledVector(dir, 1.3).addScaledVector(side, .5 * Math.sin(t * .05)).setY(1.5);
      camera.position.x = Math.max(-ROOM.x + .4, Math.min(ROOM.x - .4, camera.position.x)); camera.position.z = Math.max(-ROOM.z + .4, Math.min(ROOM.z - .4, camera.position.z));
      look.copy(rh).addScaledVector(dir, -.9).setY(.15);
    }
    camera.position.x += shake(.004, 1.3, 0); camera.position.y += shake(.003, 1.7, 1); camera.position.z += shake(.003, 1.1, 2);
    look.x += shake(.006, .9, 3); look.y += shake(.005, 1.2, 4);
    camera.lookAt(look);
  };

  // ---- the phone's interface ----------------------------------------------------------------------------------------------
  const hold = document.getElementById('s7hold')!;
  hold.className = `s7-hold ${plan.pass ? '' : 'bad'}`; hold.innerHTML = `<i></i>${plan.pass ? 'Tether holds' : 'Tether broken'} ${pct}%`;
  const tableScale = sig2(table.scale), roomScale = sig2(room.scale), area = (meta.w * meta.res / 1000).toFixed(1), crop = (roomWin.n * meta.res / 1000).toFixed(1);
  const setMode = (m: typeof mode) => {
    mode = m; frames = 0; table.group.visible = furniture.visible = m === 'table'; room.group.visible = m === 'room';
    for (const p of tablePins) p.el.hidden = m !== 'table'; for (const p of roomPins) p.el.hidden = m !== 'room';
    document.getElementById('s7scale')!.textContent = `${m === 'table' ? 'Table' : 'Room'} scale 1:${m === 'table' ? tableScale : roomScale}`;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#s7switch button')) b.classList.toggle('on', b.dataset.m === m);
    document.getElementById('s7model')!.textContent = m === 'table'
      ? `On the table: the whole ${area} km walk area, ${TABLE_W * 100} cm wide, scale 1:${tableScale}, true height. White line: the shared four-stop walk. Thin rings: 10, 20, 30 minutes' walk home.`
      : `Room scale: Rocky's ${crop} km square around the walk, ${ROOM_WIDTH_M} m across the floor, scale 1:${roomScale}, ${ROOM_VERT_EXAG === 1 ? 'true height' : `height x${ROOM_VERT_EXAG}`}. You stand at the far end of the walk, looking back down it to the habitat.`;
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('#s7switch button')) b.onclick = () => setMode(b.dataset.m as typeof mode);
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 't' || e.key === 'T') setMode('table'); if (e.key === 'r' || e.key === 'R') setMode('room'); });
  setMode(mode);

  const size = () => { const w = screen.clientWidth, h = screen.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); frames = 0; };
  addEventListener('resize', size); size();
  const v = new THREE.Vector3(), t0 = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (still && frames > 2) return;     // ponytail: a frozen view is drawn a few times, then left alone (software rendering is slow)
    frames++;
    view(still ? 0 : (now - t0) / 1000);
    renderer.render(scene, camera);
    const w = screen.clientWidth, h = screen.clientHeight;
    for (const p of mode === 'table' ? tablePins : roomPins) {
      v.copy(p.p).project(camera); const on = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      p.el.style.display = on ? '' : 'none'; if (on) { p.el.style.left = `${(v.x * .5 + .5) * w}px`; p.el.style.top = `${(-v.y * .5 + .5) * h}px`; }
    }
  };
  requestAnimationFrame(loop);
  setPill(`${plan.pass ? 'Go' : 'No-go'}, ${pct}% reserve`, plan.pass ? 'ok' : 'bad');
  document.getElementById('loading')!.remove();
  (window as unknown as { __ready: boolean }).__ready = true;
}
