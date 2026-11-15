// Screen 1, the arrival: a globe of Mars built from real orbital imagery, and one continuous dive to the walk site.
// Layers, coarse to fine (all NASA/USGS, see tools/fetch_globe.py):
//   whole planet   Viking colour mosaic, 4096 x 2048
//   Gale crater    CTX detail carrying Viking colour, about 80 m per pixel
//   Mount Sharp    the same at about 10 m per pixel
//   boxwork        Rocky's own HiRISE colour orthophoto of the 3.2 km walk area, 1 m per pixel
// Units are kilometres. URL: #1?t=0..1 freezes the dive at that point (for screenshots).
import * as THREE from 'three';
import { chrome } from './chrome';
import { next, planner } from './main';

const R = 3389.5;                                   // mean radius of Mars, km
const D2R = Math.PI / 180;
const ll = (lat: number, lon: number, r = R) => new THREE.Vector3(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));

/** A piece of sphere between two latitudes and longitudes, textured edge to edge. */
function patchGeometry(s: number, w: number, n: number, e: number, seg: number, r: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
    const u = i / seg, v = j / seg, p = ll(s + (n - s) * v, w + (e - w) * u, r);
    pos.push(p.x, p.y, p.z); uv.push(u, v);
  }
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

const SUN = ll(12, 78).normalize();                 // sun direction: Gale in afternoon light, night falling on the eastern limb
const HAZE = new THREE.Vector3(.86, .60, .42);      // dust colour of the Martian limb
function surface(tex: THREE.Texture, feather: number) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, sun: { value: SUN }, haze: { value: HAZE }, feather: { value: feather }, fade: { value: 1 } },
    transparent: feather > 0, depthWrite: feather === 0,
    vertexShader: 'varying vec2 vUv; varying vec3 vN, vP; void main(){ vUv = uv; vN = normalize(position); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D map; uniform vec3 sun, haze; uniform float feather, fade; varying vec2 vUv; varying vec3 vN, vP;
      void main(){
        vec3 c = texture2D(map, vUv).rgb;
        float day = smoothstep(-.12, .35, dot(vN, sun));             // soft terminator
        c *= mix(.035, 1.0, day);
        float limb = pow(1. - max(dot(vN, normalize(cameraPosition - vP)), 0.), 5.);   // dust haze thickens toward the limb
        c = mix(c, haze * (.25 + .75 * day), limb * .75);
        float a = 1.;
        if (feather > 0.) { vec2 d = min(vUv, 1. - vUv); a = smoothstep(0., feather, min(d.x, d.y)); }
        gl_FragColor = vec4(c, a * fade);
        #include <colorspace_fragment>
      }`,
  });
}

export default function screen1() {
  const { stage, setPill } = chrome('Atlas', { text: 'Choose a site' }, { rail: false });
  stage.insertAdjacentHTML('beforeend', `
    <div class="alt" id="alt"></div>
    <div class="ring" id="ring"></div><div class="chip" id="chip">Gale crater · Mount Sharp</div><div class="chip" id="sitechip">Walk area · 3.2 km</div>
    <div class="hero" id="arrive" style="opacity:0;pointer-events:none"><h1>Curiosity's boxwork</h1><p>3.2 km of Mount Sharp at 1 m per pixel: the ground Rocky plans on.</p><button class="cta" id="plan">Walk it in 3D</button> <button class="cta ghost" id="open">Open the planner</button></div>
    <div class="hero" id="hero"><h1>Can we still walk home?</h1><p>Every walk on Mars starts with that question. Rocky answers it for one real place, metre by metre.</p><button class="cta" id="dive">Dive to the site</button> <button class="cta ghost" id="open0">Open the planner</button></div>
    <div class="ladder" id="ladder">
      <div><b>Orbit</b><span>6,779 km across</span></div><div><b>Gale crater</b><span>154 km wide</span></div>
      <div><b>Mount Sharp</b><span>5 km high</span></div><div><b>Boxwork</b><span>3.2 km walk area</span></div>
    </div>
    <div class="credit" id="credit"></div>`);
  const $ = (id: string) => document.getElementById(id)!;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, 100, 60000);
  const load = (u: string) => { const t = new THREE.TextureLoader().load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

  scene.add(new THREE.Mesh(patchGeometry(-90, -180, 90, 180, 192, R), surface(load('globe/global.jpg'), 0)));
  const layers: { mesh: THREE.Mesh; from: number }[] = [];        // finer imagery fades in below an altitude (km)
  const addLayer = (b: { s: number; w: number; n: number; e: number }, url: string, lift: number, from: number, feather: number) => {
    const m = new THREE.Mesh(patchGeometry(b.s, b.w, b.n, b.e, 48, R + lift), surface(load(url), feather)); m.renderOrder = layers.length + 1; scene.add(m); layers.push({ mesh: m, from });
  };
  let site = { s: -4.8355, w: 137.3585, n: -4.7815, e: 137.4125 };
  Promise.all([fetch('globe/bounds.json').then((r) => r.json()), fetch('data/terrain.json').then((r) => r.json())]).then(([b, t]) => {
    site = { s: t.lat_bottom, w: t.lon_left, n: t.lat_top, e: t.lon_right };
    addLayer(b.region, 'globe/region.jpg', .15, 12000, .1);
    addLayer(b.crater, 'globe/crater.jpg', .25, 2600, .12);
    addLayer(b.sharp, 'globe/sharp.jpg', .35, 700, .08);
    addLayer(b.near, 'globe/near.jpg', .45, 30, .06);
    addLayer(site, 'data/ortho.jpg', .5, 15, .012);
    // white frame around the walk area
    const c = [[site.s, site.w], [site.s, site.e], [site.n, site.e], [site.n, site.w], [site.s, site.w]].map(([la, lo]) => ll(la, lo, R + .52));
    frame = new THREE.Line(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true })); frame.renderOrder = 9; scene.add(frame);
  });
  let frame: THREE.Line | null = null;

  // Dust glow just outside the limb: for each view ray that misses the planet, brightness falls off with its closest distance to the surface.
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R + 420, 96, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { sun: { value: SUN }, haze: { value: HAZE } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 sun, haze; varying vec3 vP;
      void main(){ vec3 rd = normalize(vP - cameraPosition); vec3 near = cameraPosition + rd * max(dot(-cameraPosition, rd), 0.); float d = length(near);
        float g = exp(-max(d - ${R.toFixed(1)}, 0.) / 55.) * .55; float day = smoothstep(-.25, .3, dot(normalize(near), sun));
        gl_FragColor = vec4(haze * g * (.08 + .92 * day), 1.); }`,
  })));
  // stars
  { const p: number[] = []; for (let i = 0; i < 2600; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(50000); p.push(v.x, v.y, v.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd6e6, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .8 }))); }

  // The dive: four stations, interpolated in latitude, longitude and the logarithm of altitude.
  const GALE = { lat: -5.4, lon: 137.8 }, SHARP = { lat: -4.92, lon: 137.52 };
  const mid = () => ({ lat: (site.s + site.n) / 2, lon: (site.w + site.e) / 2 });
  const stations = () => [
    { lat: 6, lon: 118, alt: 13500, shift: .17 },                 // orbit: globe set to the right of the headline
    { lat: GALE.lat, lon: GALE.lon, alt: 330, shift: 0 },
    { lat: SHARP.lat, lon: SHARP.lon, alt: 62, shift: 0 },
    { lat: mid().lat, lon: mid().lon, alt: 6.4, shift: 0 },
  ];
  const ease = (x: number) => x * x * (3 - 2 * x);
  let t = 0, playing = false, t0 = 0; const DUR = 11000;
  const q = new URLSearchParams(location.hash.split('?')[1] ?? ''); if (q.has('t')) t = +q.get('t')!;
  const dive = () => { if (playing || t >= 1) return; playing = true; t0 = performance.now() - t * DUR; };
  $('dive').onclick = dive; $('open0').onclick = () => planner('plan');
  // Belt and braces: clicking the planet itself, or pressing Enter or Space, starts the dive too.
  renderer.domElement.addEventListener('click', dive);
  addEventListener('keydown', (ev) => { const e = ev as KeyboardEvent; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dive(); } });
  // Right arrow: dive first, then on to scene 2. Left arrow during or after the dive: back to orbit.
  (window as unknown as { __keys: (e: KeyboardEvent) => boolean }).__keys = (e) => {
    if (e.key === 'ArrowRight' && t < 1) { if (!playing) $('dive').click(); return true; }
    if (e.key === 'ArrowLeft' && t > 0) { playing = false; t = 0; return true; }
    return false;
  };
  $('plan').onclick = next; $('open').onclick = () => planner('plan');

  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; };
  addEventListener('resize', size); size();
  const proj = new THREE.Vector3();
  function frameLoop(now: number) {
    if (playing) { t = Math.min(1, (now - t0) / DUR); if (t >= 1) playing = false; }
    const forced = (window as unknown as { __t?: number }).__t; if (forced != null) t = forced;      // the recorder sets the dive position frame by frame
    const S = stations(), x = t * (S.length - 1), i = Math.min(S.length - 2, Math.floor(x)), f = ease(x - i), a = S[i], b = S[i + 1];
    const lat = a.lat + (b.lat - a.lat) * f, lon = a.lon + (b.lon - a.lon) * f, alt = Math.exp(Math.log(a.alt) + (Math.log(b.alt) - Math.log(a.alt)) * f), shift = a.shift + (b.shift - a.shift) * f;
    cam.position.copy(ll(lat, lon, R + alt)); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
    cam.near = Math.max(.5, alt * .4); cam.far = alt + R * 2.2 + 60000;
    const w = stage.clientWidth, h = stage.clientHeight; cam.setViewOffset(w, h, -shift * w, 0, w, h); cam.updateProjectionMatrix();
    for (const L of layers) (L.mesh.material as THREE.ShaderMaterial).uniforms.fade.value = THREE.MathUtils.smoothstep(alt, L.from * .45, L.from) * -1 + 1;
    if (frame) (frame.material as THREE.LineBasicMaterial).opacity = 1 - THREE.MathUtils.smoothstep(alt, 400, 2500);
    renderer.render(scene, cam);

    // marker and labels
    const gale = ll(GALE.lat, GALE.lon, R + 1), vis = gale.clone().normalize().dot(cam.position.clone().normalize()) > .15;
    proj.copy(gale).project(cam); const px = (proj.x * .5 + .5) * w, py = (-proj.y * .5 + .5) * h, far = alt > 2500;
    ($('ring').style.cssText = `left:${px}px;top:${py}px;display:${vis && far ? 'block' : 'none'}`);
    ($('chip').style.cssText = `left:${px}px;top:${py}px;display:${vis && far ? 'block' : 'none'}`);
    $('hero').style.opacity = String(1 - THREE.MathUtils.smoothstep(t, 0, .12)); $('hero').style.pointerEvents = t > .05 ? 'none' : 'auto'; $('hero').style.visibility = t > .12 ? 'hidden' : 'visible';
    $('arrive').style.opacity = String(THREE.MathUtils.smoothstep(t, .94, 1)); $('arrive').style.pointerEvents = t >= 1 ? 'auto' : 'none'; $('arrive').style.visibility = t > .9 ? 'visible' : 'hidden';
    proj.copy(ll(site.n, site.e, R + .52)).project(cam);
    $('sitechip').style.cssText = `left:${(proj.x * .5 + .5) * w}px;top:${(-proj.y * .5 + .5) * h}px;transform:translate(8px,-110%);display:${alt < 2500 && alt > 9 ? 'block' : 'none'}`;
    const step = alt > 2500 ? 0 : alt > 150 ? 1 : alt > 14 ? 2 : 3;
    [...$('ladder').children].forEach((el, k) => el.classList.toggle('on', k === step));
    $('alt').textContent = `Altitude ${alt >= 100 ? Math.round(alt).toLocaleString('en-US') : alt.toFixed(1)} km`;
    $('credit').innerHTML = ['Viking colour mosaic: NASA/USGS via Mars Trek', 'CTX: NASA/JPL/MSSS via Mars Trek, colour from Viking', 'CTX: NASA/JPL/MSSS via Mars Trek, colour from Viking', 'HiRISE colour: USGS, NASA/JPL/University of Arizona'][step] + '<br>* Logo: AI-generated image';
    setPill(['Choose a site', 'Gale crater', 'Mount Sharp', 'Walk area ready'][step], step === 3 ? 'ok' : '');
    (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
}
