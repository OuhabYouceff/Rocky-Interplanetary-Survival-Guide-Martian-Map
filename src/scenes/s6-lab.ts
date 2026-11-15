// Scene 6 test laboratory, on Earth: a schematic of the reduced-gravity treadmill rig, not a picture of a real room.
// A treadmill whose deck tilts about its rear axle and whose belt runs at the test speed, an overhead gantry whose cable and
// spreader bar hold the suit by the shoulders, a floor, a back wall and a name plate. Metres; X is the walking direction.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildAstronaut } from './astro';

const BELT = 2.5, PIVOT = new THREE.Vector3(-1.25, .24, 0), ON = 1.25;   // belt length, rear axle, where the walker stands along the belt
const PLATE = new THREE.Vector2(.6, 2.95), EYE = new THREE.Vector3(4.9, 1.65, 5.7), LOOK = new THREE.Vector3(.75, 1.75, -1.0);
const STEP = .7;                                                         // ponytail: fixed 0.7 m step, so cadence follows speed

export function makeLab(stage: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe6e5e1);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 100);

  // soft, even light from above, a little stronger from the front left
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b6ae, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 9, 6); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 }); key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, .9); fill.position.set(6, 3, 10); scene.add(fill);   // from the camera side, so the wall reads off-white

  const mat = (color: number, roughness = .8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const floorM = mat(0xcfcdc8), wallM = mat(0xefeee9, .95), metal = mat(0x9b9ea4, .45, .3), dark = mat(0x45484e, .6);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const box = (w: number, h: number, d: number, r = .02) => new RoundedBoxGeometry(w, h, d, 3, r);

  // ---- room -----------------------------------------------------------------------------------------------------------
  const floor = add(new THREE.PlaneGeometry(40, 40), floorM, scene, 0, 0, 0); floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const tiles = new THREE.GridHelper(40, 40, 0xbdbbb5, 0xbdbbb5); tiles.position.y = .002; scene.add(tiles);         // 1 m floor tiles
  add(new THREE.PlaneGeometry(40, 9), wallM, scene, 0, 4.5, -3.4).castShadow = false;
  add(new THREE.BoxGeometry(40, .12, .03), mat(0xbdbbb5), scene, 0, .06, -3.38);                                  // skirting
  add(new THREE.BoxGeometry(4.2, .08, 3.4), mat(0x9fa1a3, .9), scene, 0, .04, 0);                                  // rubber mat under the rig

  // ---- treadmill: deck, belt and handrails tilt together about the rear axle ----------------------------------------
  const deck = new THREE.Group(); deck.position.copy(PIVOT); scene.add(deck);
  add(box(BELT + .2, .18, 1.05, .03), dark, deck, BELT / 2, -.1, 0);
  for (const z of [-.5, .5]) add(box(BELT + .2, .06, .08, .015), metal, deck, BELT / 2, .005, z);               // side rails
  for (const x of [0, BELT]) add(new THREE.CylinderGeometry(.07, .07, .92, 20), metal, deck, x, -.05, 0).rotation.x = Math.PI / 2;   // rollers
  const tex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 8; const g = c.getContext('2d')!; g.fillStyle = '#2a2c30'; g.fillRect(0, 0, 64, 8); g.fillStyle = '#6b6e74'; g.fillRect(0, 0, 5, 8); return new THREE.CanvasTexture(c); })();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(BELT / .25, 1); tex.colorSpace = THREE.SRGBColorSpace;
  const belt = add(new THREE.PlaneGeometry(BELT, .86), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }), deck, BELT / 2, .012, 0); belt.rotation.x = -Math.PI / 2;
  for (const z of [-.56, .56]) {                                                                                    // handrails
    for (const x of [.55, BELT - .05]) add(new THREE.CylinderGeometry(.022, .022, 1, 12), metal, deck, x, .5, z);
    add(new THREE.CylinderGeometry(.024, .024, BELT - .6, 12), metal, deck, (BELT + .5) / 2, 1, z).rotation.z = Math.PI / 2;
  }
  add(box(.16, .34, 1.2, .03), dark, deck, BELT - .05, 1.12, 0).rotation.z = .35;                                 // console
  add(box(.2, .14, 1.15), dark, scene, PIVOT.x, .07, 0);                                                            // rear axle block
  const jack = add(new THREE.CylinderGeometry(.05, .06, 1, 14), metal, scene, PIVOT.x + BELT - .15, .5, 0);       // front lift column

  // ---- gantry, cable, spreader bar --------------------------------------------------------------------------------------
  const TOP = 3.75;
  for (const z of [-1.6, 1.6]) { add(box(.14, TOP, .14), metal, scene, 0, TOP / 2, z); add(box(.5, .04, .5), metal, scene, 0, .02, z); }
  add(box(.18, .2, 3.6), metal, scene, 0, TOP + .02, 0);                                                            // cross beam
  add(box(.42, .3, .34, .04), dark, scene, 0, TOP - .2, 0);                                                         // lift unit
  const cableM = mat(0x2f3135, .5), strapM = mat(0x5c5f66, .8);
  const rod = (r: number, m: THREE.Material) => add(new THREE.CylinderGeometry(r, r, 1, 10), m, scene, 0, 0, 0);
  const cable = rod(.011, cableM), straps = [rod(.016, strapM), rod(.016, strapM)];
  const cell = add(box(.1, .14, .1), dark, scene, 0, 0, 0);                                                         // load cell on the cable
  const spreader = add(box(.06, .06, .96, .02), metal, scene, 0, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const span = (o: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) => { const d = b.clone().sub(a); o.position.copy(a).addScaledVector(d, .5); o.scale.set(1, d.length(), 1); o.quaternion.setFromUnitVectors(UP, d.normalize()); };

  // ---- wall plate -------------------------------------------------------------------------------------------------------
  const pc = document.createElement('canvas'); pc.width = 1000; pc.height = 250;
  const plateTex = new THREE.CanvasTexture(pc); plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 8;
  const plate = add(new THREE.PlaneGeometry(1, .5), new THREE.MeshBasicMaterial({ map: plateTex, toneMapped: false }), scene, PLATE.x, PLATE.y, -3.38); plate.castShadow = false;
  let plateText = '';
  // two lines ("Moon gravity 0.17 g" / "0.75 m/s · 10% uphill"); the plate's width follows the longer line
  const drawPlate = () => {
    const g = pc.getContext('2d')!, font = '600 76px Inter, system-ui, sans-serif', lines = plateText.split('\n');
    g.font = font; pc.width = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 96; plate.scale.x = pc.width / pc.height * .5; plateTex.dispose();
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, pc.width, pc.height); g.fillStyle = '#fff'; g.font = font; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, 48, pc.height / 2 + (i - (lines.length - 1) / 2) * 92 + 4)); plateTex.needsUpdate = true;
  };
  document.fonts?.ready.then(drawPlate);

  // ---- the walker -------------------------------------------------------------------------------------------------------
  const a = buildAstronaut(0xe07a1f); a.root.rotation.y = Math.PI / 2; scene.add(a.root);
  a.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });

  // ---- camera: eye level, three-quarter front view of the walker -------------------------------------------------------
  camera.position.copy(EYE);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(LOOK);
  controls.enableDamping = true; controls.minDistance = 2.5; controls.maxDistance = 14; controls.maxPolarAngle = Math.PI * .49; controls.update();

  const chips: { el: HTMLElement; at: () => THREE.Vector3 }[] = [];
  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', size); size();

  let v = 0, vGoal = 0, tilt = 0, tiltGoal = 0, phase = 0, last = performance.now();
  const shoulder = new THREE.Vector3(), p = new THREE.Vector3();
  const rigAt = new THREE.Vector3();
  const loop = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    const k = Math.min(1, dt * 2.5); v += (vGoal - v) * k; tilt += (tiltGoal - tilt) * k;
    deck.rotation.z = tilt;
    const front = PIVOT.y + Math.sin(tilt) * (BELT - .15) - .19; jack.scale.y = Math.max(.05, front); jack.position.y = jack.scale.y / 2;
    tex.offset.x = (tex.offset.x + v * dt / .25) % 1;
    phase += dt * v / (2 * STEP) * Math.PI * 2;
    a.root.position.set(PIVOT.x + ON, PIVOT.y + .012 + Math.tan(tilt) * ON, 0);
    v > .05 ? a.walk(phase) : a.stand();
    a.root.updateMatrixWorld(true);
    // straps run from the spreader bar's ends to the tops of the shoulders; the cable carries the bar from the lift unit
    a.torso.getWorldPosition(p); const barY = p.y + 1.55;
    spreader.position.set(p.x, barY, 0); cell.position.set(p.x, barY + .2, 0);
    span(cable, new THREE.Vector3(p.x, barY + .27, 0), new THREE.Vector3(0, TOP - .35, 0));
    [a.armL, a.armR].forEach((arm, i) => { arm.getWorldPosition(shoulder); shoulder.y += .09; span(straps[i], new THREE.Vector3(p.x, barY, shoulder.z > 0 ? .46 : -.46), shoulder); });
    rigAt.set(p.x, (barY + TOP) / 2 + .2, 0);
    controls.update(); renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const c of chips) { p.copy(c.at()).project(camera); c.el.style.left = `${(p.x * .5 + .5) * w}px`; c.el.style.top = `${(-p.y * .5 + .5) * h}px`; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    /** Belt speed (m/s), treadmill grade (%), and the words on the wall plate. */
    set(speed: number, grade: number, text: string) { vGoal = speed; tiltGoal = Math.atan(grade / 100); plateText = text; drawPlate(); },
    /** Pin an HTML label to a moving 3D point. */
    chip(el: HTMLElement, at: () => THREE.Vector3) { stage.append(el); chips.push({ el, at }); },
    rigAt: () => rigAt,
  };
}
