// The real ground at Maria Gordon Notch (Curiosity's stop of sol 3324), for scene 5. Same ideas as world.ts, another place:
//   notch  600 m x 600 m, USGS MSL Gale DEM Mosaic 1 m v3 at 1 m, HiRISE colour mosaic at 25 cm (public/notch, tools/fetch_notch.py)
//   far    Rocky's 32 km far field (hi/far.bin, 64 m; terrain/far.jpg) for the skyline beyond, with a hole where the notch mesh is
// World axes: X east, Y up, Z south, metres, origin at the rover's stop, y = 0 at the ground there. No vertical exaggeration.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Meta } from './world';

interface NotchMeta { lat: number; lon: number; size_m: number; img_px: number; offset: number; scale: number; stop_col: number; stop_row: number }
const bin = (u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.arrayBuffer(); });
const image = (u: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(u)); im.src = u; });
const R_MARS = 3396190, RAD = Math.PI / 180;
// ponytail: sun from the east-south-east, 35 degrees up (mid-morning), so the east-facing wall of the notch is lit. Not a dated sun position.
const SUN = new THREE.Vector3(Math.sin(115 * RAD) * Math.cos(35 * RAD), Math.sin(35 * RAD), -Math.cos(115 * RAD) * Math.cos(35 * RAD));

export async function makeNotch(stage: HTMLElement) {
  const [nm, terrain, hi] = await Promise.all([fetch('notch/meta.json').then((r) => r.json()) as Promise<NotchMeta>, fetch('data/terrain.json').then((r) => r.json()) as Promise<Meta>,
    fetch('data/hi/meta.json').then((r) => r.json()) as Promise<{ far: { n: number; res_m: number; offset: number; scale: number } }>]);
  const [dq, fq, img, farIm] = await Promise.all([bin('notch/dem.bin').then((b) => new Uint16Array(b)), bin('data/hi/far.bin').then((b) => new Uint16Array(b)), image('notch/img.jpg'), image('terrain/far.jpg')]);
  const N = nm.size_m, HALF = N / 2;
  // DEM pixel (c, r) has its centre at x = c + .5 - stop_col, z = r + .5 - stop_row (rows run north to south)
  const zAbs = (c: number, r: number) => { const v = dq[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))]; return v ? nm.offset + v * nm.scale : NaN; };
  const sample = (x: number, z: number) => {                       // bilinear on the 1 m grid, absolute metres
    const fx = Math.max(0, Math.min(N - 1.001, x + nm.stop_col - .5)), fz = Math.max(0, Math.min(N - 1.001, z + nm.stop_row - .5)), c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r;
    return (zAbs(c, r) * (1 - tx) + zAbs(c + 1, r) * tx) * (1 - tz) + (zAbs(c, r + 1) * (1 - tx) + zAbs(c + 1, r + 1) * tx) * tz;
  };
  const ZREF = sample(0, 0);
  const ground = (x: number, z: number) => sample(x, z) - ZREF;
  const at = (x: number, z: number, lift = 0) => new THREE.Vector3(x, ground(x, z) + lift, z);

  // ---- renderer, sky, light (as world.ts) -----------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, .1, 60000);
  scene.fog = new THREE.Fog(0xd9b08c, 1800, 30000);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(45000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 sun; varying vec3 vD;
      void main(){ float h = clamp(vD.y, 0., 1.);
        vec3 c = mix(vec3(.85, .69, .55), vec3(.56, .43, .35), pow(h, .55));
        c += vec3(.22, .2, .16) * pow(max(dot(vD, sun), 0.), 14.);
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  })));
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x8a5a3c, 2.1));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0006; sun.shadow.normalBias = .04;
  sun.target.position.set(0, 0, 0); sun.position.copy(SUN).multiplyScalar(300);
  { const s = sun.shadow.camera; s.left = s.bottom = -60; s.right = s.top = 60; s.near = 50; s.far = 700; }
  scene.add(sun, sun.target);

  // ---- ground meshes ---------------------------------------------------------------------------------------------
  const tex = (im: HTMLImageElement) => { const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.needsUpdate = true; return t; };
  const field = (n: number, side: number, cx: number, cz: number, height: (i: number, j: number) => number) => {
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      pos[k * 3] = cx - side / 2 + (i / (n - 1)) * side; pos[k * 3 + 1] = height(i, j); pos[k * 3 + 2] = cz - side / 2 + (j / (n - 1)) * side;
      uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = 1 - j / (n - 1);
    }
    for (let j = 0, k = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i; idx[k++] = a; idx[k++] = a + n; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = a + n; idx[k++] = a + n + 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    return g;
  };
  // the notch: one vertex per DEM pixel centre; the image covers the DEM's full extent (half a pixel beyond the outer centres)
  const notchGeo = field(N, N - 1, HALF - nm.stop_col, HALF - nm.stop_row, (i, j) => zAbs(i, j) - ZREF);
  { const uv = notchGeo.getAttribute('uv') as THREE.BufferAttribute; for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * (N - 1) + .5) / N, (uv.getY(k) * (N - 1) + .5) / N); }
  const notch = new THREE.Mesh(notchGeo, new THREE.MeshStandardMaterial({ map: tex(img), roughness: 1, metalness: 0 }));
  notch.castShadow = true;   // ponytail: the ground takes no shadows so the walls stay readable; the HiRISE image already carries its own shading
  // far field: centred on the walk area's centre, which lies this far from the stop (equirectangular metres, as the DEM)
  const clat = (terrain.lat_top + terrain.lat_bottom) / 2, clon = (terrain.lon_left + terrain.lon_right) / 2;
  const fx0 = (clon - nm.lon) * RAD * R_MARS, fz0 = -(clat - nm.lat) * RAD * R_MARS, FN = hi.far.n, FSIDE = (FN - 1) * hi.far.res_m;
  const farMat = new THREE.MeshStandardMaterial({ map: tex(farIm), roughness: 1, metalness: 0 }), hole = HALF - 3;
  farMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <map_fragment>', `#include <map_fragment>\nif (abs(vWp.x) < ${hole.toFixed(1)} && abs(vWp.z) < ${hole.toFixed(1)}) discard;`);
  };
  // it sits a little low so it never pokes through the 1 m mesh at the seam
  const far = new THREE.Mesh(field(FN, FSIDE, fx0, fz0, (i, j) => hi.far.offset + fq[j * FN + i] * hi.far.scale - ZREF - 2), farMat);
    scene.add(notch, far);

  // ---- labels, controls, loop -------------------------------------------------------------------------------------
  const chips: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  const chip = (html: string, p: THREE.Vector3, cls = '') => { const el = document.createElement('div'); el.className = `chip ${cls}`; el.innerHTML = html; stage.append(el); chips.push({ el, p }); return el; };
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 1; controls.maxDistance = 2000;
  const tick: ((t: number) => void)[] = [];
  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', size); size();
  const view = { draw: () => renderer.render(scene, camera), chips: true };
  const v = new THREE.Vector3();
  const loop = (now: number) => {
    for (const f of tick) f(now / 1000);
    controls.update();
    const gy = ground(camera.position.x, camera.position.z) + .6; if (camera.position.y < gy) camera.position.y = gy;
    view.draw();
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const c of chips) { v.copy(c.p).project(camera); const on = view.chips && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05; c.el.style.display = on ? '' : 'none'; if (on) { c.el.style.left = `${(v.x * .5 + .5) * w}px`; c.el.style.top = `${(-v.y * .5 + .5) * h}px`; } }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return { scene, camera, renderer, controls, ground, at, chip, tick, view, meta: nm };
}
