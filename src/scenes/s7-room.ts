// Scene 7 helper: an ordinary meeting room from clean shapes. Metres, Y up, floor at y = 0.
// Room 9 x 8 m, 2.8 m high; windows along the east wall (+X) give the daylight; a 3 x 1.2 m wooden table in the middle.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const ROOM = { x: 4.5, z: 4, h: 2.8 }, TABLE = { w: 3, d: 1.2, top: .74 };

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; };
const texOf = (c: HTMLCanvasElement, repeat = 1) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (repeat > 1) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); } return t; };

/** Oak-like veneer drawn in code: long wavy grain lines over a warm base, a few darker streaks. */
function wood() {
  const [c, g] = canvas(2048, 820);
  g.fillStyle = '#94714f'; g.fillRect(0, 0, 2048, 820);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '90,55,30' : '200,160,115'},${.02 + rnd() * .05})`; g.fillRect(0, rnd() * 820, 2048, 4 + rnd() * 30); }
  for (let i = 0; i < 520; i++) {
    const y = rnd() * 820, a = 1 + rnd() * 5, f = .001 + rnd() * .003, ph = rnd() * 6;
    g.strokeStyle = `rgba(70,40,20,${.05 + rnd() * .14})`; g.lineWidth = .6 + rnd() * 1.8; g.beginPath();
    for (let x = 0; x <= 2048; x += 32) g.lineTo(x, y + Math.sin(x * f + ph) * a + Math.sin(x * f * 3.1 + ph) * a * .3);
    g.stroke();
  }
  return texOf(c);
}
/** Fine speckle for carpet tiles and painted walls. */
function speckle(base: string, amount: number) {
  const [c, g] = canvas(256, 256); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  const im = g.getImageData(0, 0, 256, 256); for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - .5) * amount; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
  g.putImageData(im, 0, 0); return c;
}
/** What the window shows: overexposed sky and a soft line of trees, out of focus as a phone camera would see it. */
function outside() {
  const [c, g] = canvas(1024, 512); g.fillStyle = '#eef2f4'; g.fillRect(0, 0, 1024, 512);
  g.filter = 'blur(18px)';
  g.fillStyle = '#b7c0b0'; for (let x = -40; x < 1080; x += 70) { g.beginPath(); g.ellipse(x, 360 + Math.sin(x) * 20, 70, 90 + Math.cos(x * 3) * 25, 0, 0, 7); g.fill(); }
  g.fillStyle = '#c9cbc8'; g.fillRect(0, 400, 1024, 112);
  return texOf(c);
}

export function buildRoom(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.background = new THREE.Color(0xdcdcd8);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .4;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a857e, .55));
  const sun = new THREE.DirectionalLight(0xfff6ea, 2.2); sun.position.set(7, 4.6, -1.5); sun.target.position.set(0, TABLE.top, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .01; sun.shadow.radius = 4;
  const sc = sun.shadow.camera; sc.left = sc.bottom = -4.5; sc.right = sc.top = 4.5; sc.near = 1; sc.far = 16;
  scene.add(sun, sun.target);

  const std = (color: number, roughness = .9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b;
  };
  const { x: RX, z: RZ, h: RH } = ROOM;

  // ---- shell: floor, ceiling, walls, windows -----------------------------------------------------------------------
  const carpet = std(0x8a8680, 1, { map: texOf(speckle('#ffffff', 46), 18) });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), carpet); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), std(0xf1f1ee)); ceil.rotation.x = Math.PI / 2; ceil.position.y = RH; scene.add(ceil);
  for (const [x, z] of [[-1.6, -1], [1.6, -1], [-1.6, 1.6], [1.6, 1.6]]) box(1.2, .02, .6, new THREE.MeshBasicMaterial({ color: 0xffffff }), x, RH - .01, z);
  const paint = std(0xeeeae4, .95, { map: texOf(speckle('#ffffff', 10), 6) });
  box(RX * 2, RH, .1, paint, 0, RH / 2, -RZ - .05);            // north wall
  box(RX * 2, RH, .1, paint, 0, RH / 2, RZ + .05);             // south wall
  box(.1, RH, RZ * 2, paint, -RX - .05, RH / 2, 0);            // west wall
  // east wall with a long window: sill below, header above, a pier at each end, slim mullions
  const W0 = -3.2, W1 = 3.2, S0 = .8, S1 = 2.45;
  box(.1, S0, RZ * 2, paint, RX + .05, S0 / 2, 0); box(.1, RH - S1, RZ * 2, paint, RX + .05, (RH + S1) / 2, 0);
  box(.1, S1 - S0, W0 + RZ, paint, RX + .05, (S0 + S1) / 2, (W0 - RZ) / 2); box(.1, S1 - S0, RZ - W1, paint, RX + .05, (S0 + S1) / 2, (W1 + RZ) / 2);
  const view = new THREE.Mesh(new THREE.PlaneGeometry(W1 - W0, S1 - S0), new THREE.MeshBasicMaterial({ map: outside() })); view.rotation.y = -Math.PI / 2; view.position.set(RX + .12, (S0 + S1) / 2, 0); scene.add(view);
  const frame = std(0x3a3b3d, .5, { metalness: .4 });
  for (let z = W0; z <= W1 + .01; z += (W1 - W0) / 4) box(.08, S1 - S0, .06, frame, RX + .02, (S0 + S1) / 2, z);
  box(.08, .05, W1 - W0, frame, RX + .02, S0, 0); box(.08, .05, W1 - W0, frame, RX + .02, S1, 0);
  box(.22, .03, W1 - W0 + .1, std(0xf2f2f0, .6), RX - .08, S0 - .01, 0);   // window sill
  const skirt = std(0x4a4a4c, .7);                                         // skirting boards
  box(RX * 2, .08, .02, skirt, 0, .04, -RZ + .01); box(RX * 2, .08, .02, skirt, 0, .04, RZ - .01); box(.02, .08, RZ * 2, skirt, -RX + .01, .04, 0); box(.02, .08, RZ * 2, skirt, RX - .01, .04, 0);
  // a whiteboard on the north wall, a screen on the west wall
  box(2.2, 1.15, .03, std(0xa9abae, .4, { metalness: .5 }), -.6, 1.55, -RZ + .02); box(2.14, 1.09, .02, std(0xf7f7f5, .25), -.6, 1.55, -RZ + .045);
  box(.06, .95, 1.65, std(0x161618, .3), -RX + .04, 1.5, .2);

  // ---- table and chairs (hidden in room mode, when the floor is the model's) ----------------------------------------
  const furniture = new THREE.Group(); scene.add(furniture);
  const top = box(TABLE.w, .04, TABLE.d, new THREE.MeshPhysicalMaterial({ map: wood(), roughness: .48, clearcoat: .35, clearcoatRoughness: .4 }), 0, TABLE.top - .02, 0, furniture);
  top.castShadow = true;
  const leg = std(0x2c2c2e, .5, { metalness: .3 });
  for (const x of [-1.15, 1.15]) { box(.07, TABLE.top - .04, .9, leg, x, (TABLE.top - .04) / 2, 0, furniture); box(.5, .02, 1, leg, x, .01, 0, furniture); }

  const fabric = std(0x2a2b2e, .95), metal = std(0x8e9196, .35, { metalness: .8 });
  const chair = () => {
    const c = new THREE.Group(), rb = (w: number, h: number, d: number, r: number, m: THREE.Material) => { const b = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); b.castShadow = b.receiveShadow = true; c.add(b); return b; };
    rb(.5, .08, .48, .03, fabric).position.set(0, .47, 0);
    const back = rb(.48, .58, .06, .025, fabric); back.position.set(0, .82, .25); back.rotation.x = -.12;
    for (const s of [-1, 1]) { rb(.05, .04, .3, .015, fabric).position.set(s * .27, .66, .02); rb(.03, .18, .03, .01, metal).position.set(s * .27, .56, .08); }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .34, 12), metal); stem.position.y = .26; c.add(stem);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, arm = new THREE.Mesh(new THREE.BoxGeometry(.04, .03, .3), metal); arm.position.set(Math.sin(a) * .15, .07, Math.cos(a) * .15); arm.rotation.y = a; c.add(arm);
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(.025, 10, 8), fabric); wheel.position.set(Math.sin(a) * .29, .025, Math.cos(a) * .29); c.add(wheel); }
    return c;
  };
  // sitters face the table: chairs on the south side face -Z, on the north side +Z; a little out of line, as in real rooms.
  // The middle of the south side is free: that is where the person holding the phone stands.
  for (const [x, z, yaw] of [[-1.05, .95, .08], [1.05, .92, .12], [-.95, -.95, Math.PI - .1], [.05, -1.05, Math.PI + .06], [.95, -.93, Math.PI + .14], [-1.95, .1, -Math.PI / 2 + .1]]) {
    const c = chair(); c.position.set(x, 0, z); c.rotation.y = yaw; furniture.add(c);
  }
  return { furniture };
}
