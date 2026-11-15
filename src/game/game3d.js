/* Marswalk 3D: first-person EVA game + 3D survey map. Ported from the Marswalk prototype (game3d.js).
 * Terrain: USGS MSL Gale DEM 1 m, on the planner's 3 m grid (the same cells the planner routes on).
 * Texture: HiRISE from the dataset (offline), then HiRISE / CTX tiles from NASA Mars Trek drawn live on top.
 * Physics, walk-home times, guide line and stops all come from the host through K (see src/game/adapter.ts):
 * the same Santee / Marquez model and walk-home map as the Plan screen.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TEX = 4096;
const HI_EXPOSURE = 0.92;   // the colour HiRISE is bright (dust-covered); slightly lower exposure keeps the ground from washing out          // imagery texture size (≈1 m/px over 4 km)
const U = 2;               // display upsampling of the elevation grid
const G_MARS = 3.71;
// Horizon palette on a dark HUD: white text, red = danger, amber = caution, green = go / done
const C = { cyan: '#ffffff', amber: '#f2b705', red: '#ff5a52', green: '#3ddc68', violet: '#bdbdc0', route: '#ffffff', white: '#ffffff' };
const LENSES = [
  ['imagery', 'Imagery only'],
  ['walk', 'Walkability'],
  ['slope', 'Slope'],
  ['sand', 'Sand and rock (THEMIS night IR)'],
  ['hazard', 'Hazards: too steep, sand, rock'],
  ['elev', 'Elevation'],
];

export function createGame(root, K, { onChange = () => {} } = {}) {
  const { N, SIZE, CELL, elev, slope, sand, rock, pass, stops, P } = K;
  const BASE = K.elevMin;
  const mk = (tag, cls, parent = root) => { const e = document.createElement(tag); if (cls) e.className = cls; parent.appendChild(e); return e; };

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = HI_EXPOSURE;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  root.appendChild(renderer.domElement);
  const hud = mk('canvas', 'g-hud'), hctx = hud.getContext('2d');
  const labels = mk('div', 'g-labels');
  const help = mk('div', 'g-help');
  const cam = mk('div', 'g-cam');
  const summary = mk('div', 'g-summary');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 40000);
  camera.rotation.order = 'YXZ';
  const world = new THREE.Group(); scene.add(world);

  // ---------- elevation for display: real 4 m HiRISE grid if available, else 17 m grid upsampled ----------
  let M, HC, X0, hi;
  if (K.hiElev) { M = K.hiElev.n; HC = SIZE / M; X0 = HC / 2; hi = K.hiElev.data; }
  else {
    M = (N - 1) * U + 1; HC = CELL / U; X0 = CELL / 2; hi = new Float32Array(M * M);
    const at = (r, c) => elev[Math.max(0, Math.min(N - 1, r)) * N + Math.max(0, Math.min(N - 1, c))];
    const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    const tmp = new Float32Array(N * M);
    for (let r = 0; r < N; r++) for (let f = 0; f < M; f++) { const s = f / U, c = Math.floor(s), t = s - c; tmp[r * M + f] = cr(at(r, c - 1), at(r, c), at(r, c + 1), at(r, c + 2), t); }
    const tm = (r, f) => tmp[Math.max(0, Math.min(N - 1, r)) * M + f];
    for (let g = 0; g < M; g++) { const s = g / U, r = Math.floor(s), t = s - r; for (let f = 0; f < M; f++) hi[g * M + f] = cr(tm(r - 1, f), tm(r, f), tm(r + 1, f), tm(r + 2, f), t); }
  }
  // ---------- 1 m near field: real DEM tiles streamed around the astronaut (K.hi, see adapter.ts) ----------
  const HI = K.hi || null;
  const demTiles = new Map();
  function dem1(x, y) {
    if (!HI) return NaN;
    const T = HI.dem.tile, n = HI.dem.n, fx = x - 0.5, fy = SIZE - y - 0.5;  // 1 m pixel centres
    const c0 = Math.floor(fx), r0 = Math.floor(fy), tx = fx - c0, ty = fy - r0;
    const at = (r, c) => { r = r < 0 ? 0 : r >= n ? n - 1 : r; c = c < 0 ? 0 : c >= n ? n - 1 : c; const t = demTiles.get(((r / T) | 0) * 1000 + ((c / T) | 0)); return t ? t[(r % T) * T + (c % T)] : NaN; };
    return (at(r0, c0) * (1 - tx) + at(r0, c0 + 1) * tx) * (1 - ty) + (at(r0 + 1, c0) * (1 - tx) + at(r0 + 1, c0 + 1) * tx) * ty;
  }
  function ensureTiles(cx, cy, half) {
    const T = HI.dem.tile, n = HI.dem.n, jobs = [];
    const c0 = Math.max(0, Math.floor((cx - half) / T)), c1 = Math.min(HI.dem.tiles - 1, Math.floor(Math.min(n - 1, cx + half) / T));
    const r0 = Math.max(0, Math.floor((SIZE - cy - half) / T)), r1 = Math.min(HI.dem.tiles - 1, Math.floor(Math.min(n - 1, SIZE - cy + half) / T));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const key = r * 1000 + c; if (demTiles.has(key)) continue;
      jobs.push(HI.loadDem(r, c).then(t => { if (t) demTiles.set(key, t); }));
    }
    return Promise.all(jobs);
  }
  function ground(x, y) { const h = dem1(x, y); return h === h ? h : ground3(x, y); }
  function ground3(x, y) {
    const fx = Math.max(0, Math.min(M - 1.001, (x - X0) / HC)), fy = Math.max(0, Math.min(M - 1.001, (SIZE - y - X0) / HC));
    const c = fx | 0, r = fy | 0, tx = fx - c, ty = fy - r, i = r * M + c;
    return (hi[i] * (1 - tx) + hi[i + 1] * tx) * (1 - ty) + (hi[i + M] * (1 - tx) + hi[i + M + 1] * tx) * ty;
  }
  // fine-scale slope (deg) at a point, from the display grid: small steep steps block the walker too
  const fineSlope = (x, y) => { const d = Math.max(HC, 2); return Math.atan(Math.hypot(ground(x + d, y) - ground(x - d, y), ground(x, y + d) - ground(x, y - d)) / (2 * d)) * 180 / Math.PI; };
  const toW = (x, y, h) => new THREE.Vector3(x - SIZE / 2, (h - BASE) * world.scale.y, SIZE / 2 - y);
  const fromW = v => [v.x + SIZE / 2, SIZE / 2 - v.z];

  // ---------- imagery texture (live NASA Mars Trek tiles) ----------
  const imgCv = document.createElement('canvas'); imgCv.width = imgCv.height = TEX;
  const ic = imgCv.getContext('2d'); ic.fillStyle = '#6b5544'; ic.fillRect(0, 0, TEX, TEX);
  if (K.ortho) { if (!HI) ic.filter = 'grayscale(1)'; ic.drawImage(K.ortho, 0, 0, TEX, TEX); ic.filter = 'none'; }   // dataset HiRISE colour, offline
  const tex = new THREE.CanvasTexture(imgCv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mmCv = document.createElement('canvas'); mmCv.width = mmCv.height = 1024;   // minimap copy
  let texDirty = true, lastFlush = 0, tilesLoaded = 0, tilesTotal = 0;
  const box = { lonW: K.lonW, latN: K.latN, dLon: K.dLon, dLat: K.dLat };
  function tiles(ctx, bx, px, id, z, ext) {
    const D = 180 / 2 ** z, jobs = [];
    const c0 = Math.floor((bx.lonW + 180) / D), c1 = Math.floor((bx.lonW + bx.dLon + 180) / D);
    const r0 = Math.floor((90 - bx.latN) / D), r1 = Math.floor((90 - bx.latN + bx.dLat) / D);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      tilesTotal++;
      jobs.push(new Promise(res => {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => {
          const lon = -180 + c * D, lat = 90 - r * D;
          ctx.drawImage(im, (lon - bx.lonW) / bx.dLon * px, (bx.latN - lat) / bx.dLat * px, D / bx.dLon * px + 0.6, D / bx.dLat * px + 0.6);
          tilesLoaded++; texDirty = true; res(1);
        };
        im.onerror = () => { tilesLoaded++; res(0); };
        im.src = `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/${z}/${r}/${c}.${ext}`;
      }));
    }
    return Promise.all(jobs);
  }
  if (!HI) tiles(ic, box, TEX, 'Gale_CTX_BlockAdj_dd', 12, 'png').then(() => tiles(ic, box, TEX, 'curiosity_hirise_mosaic', 15, 'png'));

  const DS = HI ? 1024 : 1300, detail = { cx: -1e9, cy: -1e9, loading: false };
  // 50 cm HiRISE colour tiles from the dataset (public/data/hi/img), drawn into one 2048 px canvas around the astronaut
  function localDetail(ctx, x0, yTop, size, px) {
    const P = HI.img.tile, m = HI.img.tiles, mpp = HI.img.res_m, k = px / size, jobs = [];
    const c0 = Math.max(0, Math.floor(x0 / (P * mpp))), c1 = Math.min(m - 1, Math.floor((x0 + size) / (P * mpp)));
    const r0 = Math.max(0, Math.floor((SIZE - yTop) / (P * mpp))), r1 = Math.min(m - 1, Math.floor((SIZE - yTop + size) / (P * mpp)));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) jobs.push(new Promise(res => {
      const im = new Image(); im.onload = () => { ctx.drawImage(im, (c * P * mpp - x0) * k, (r * P * mpp - (SIZE - yTop)) * k, P * mpp * k + 0.5, P * mpp * k + 0.5); res(1); };
      im.onerror = () => res(0); im.src = HI.imgUrl(r, c);
    }));
    return Promise.all(jobs);
  }
  const detailTex = new THREE.CanvasTexture(document.createElement('canvas')); detailTex.colorSpace = THREE.SRGBColorSpace;
  function updateDetail() {
    if (detail.loading || Math.hypot(S.x - detail.cx, S.y - detail.cy) < (HI ? 260 : 380)) return;
    detail.loading = true;
    const cx = S.x, cy = S.y, cvD = document.createElement('canvas'); cvD.width = cvD.height = 2048;
    const bx = { lonW: K.lonW + (cx - DS / 2) / SIZE * K.dLon, latN: K.latS + (cy + DS / 2) / SIZE * K.dLat, dLon: DS / SIZE * K.dLon, dLat: DS / SIZE * K.dLat };
    (HI ? localDetail(cvD.getContext('2d'), cx - DS / 2, cy + DS / 2, DS, 2048) : tiles(cvD.getContext('2d'), bx, 2048, 'curiosity_hirise_mosaic', 16, 'png')).then(() => {
      detailTex.image = cvD; detailTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); detailTex.needsUpdate = true;
      U_.detailMap.value = detailTex; U_.detailBox.value.set(cx - DS / 2 - SIZE / 2, SIZE / 2 - (cy + DS / 2), DS); U_.detailOn.value = 1;
      detail.cx = cx; detail.cy = cy; detail.loading = false;
    });
  }

  // ---------- data lenses (grid → small texture mixed in the terrain shader) ----------
  const lensData = new Uint8Array(N * N * 4);
  const lensTex = new THREE.DataTexture(lensData, N, N); lensTex.magFilter = lensTex.minFilter = THREE.LinearFilter; lensTex.colorSpace = THREE.SRGBColorSpace;
  const lensCv = document.createElement('canvas'); lensCv.width = lensCv.height = N;
  const ramp = (st, t) => { for (let k = 1; k < st.length; k++) if (t <= st[k][0]) { const [a, ca] = st[k - 1], [b, cb] = st[k], f = (t - a) / (b - a || 1); return ca.map((v, j) => v + (cb[j] - v) * f); } return st[st.length - 1][1]; };
  function lensColor(key, i) {
    if (key === 'walk') {
      if (!pass[i]) return [229, 70, 60, 210];
      const s = Math.max(0, 1 - Math.max(slope[i] / K.maxSlope, rock[i], sand[i] * 0.9));
      return [...ramp([[0, [230, 90, 60]], [0.5, [240, 200, 70]], [1, [80, 210, 110]]], s), 150];
    }
    if (key === 'slope') return [...ramp([[0, [9, 96, 225]], [8, [46, 150, 245]], [14, [220, 238, 255]], [20, [234, 254, 7]], [30, [228, 55, 0]], [45, [142, 17, 0]]], slope[i]), 170];
    if (key === 'sand') return K.sandT[i] >= K.rockT[i] ? [217, 169, 91, 40 + 190 * K.sandT[i]] : [143, 177, 220, 40 + 190 * K.rockT[i]];
    if (key === 'hazard') return !pass[i] ? [228, 55, 0, 220] : sand[i] > 0.55 ? [217, 169, 91, 160] : rock[i] > 0.5 ? [143, 177, 220, 160] : [0, 0, 0, 0];
    if (key === 'elev') return [...ramp([[0, [30, 60, 140]], [0.3, [40, 160, 150]], [0.55, [205, 200, 90]], [0.8, [205, 110, 60]], [1, [250, 240, 230]]], (elev[i] - K.elevMin) / (K.elevMax - K.elevMin)), 170];
    return [0, 0, 0, 0];
  }
  let lensKey = 'imagery';
  function buildLens(key) {
    const id = lensCv.getContext('2d').createImageData(N, N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, col = lensColor(key, i);
      id.data.set(col, i * 4); lensData.set(col, ((N - 1 - r) * N + c) * 4);
    }
    lensCv.getContext('2d').putImageData(id, 0, 0);
    lensTex.needsUpdate = true; texDirty = true;
  }

  // ---------- terrain mesh ----------
  const U_ = {
    lensMap: { value: lensTex }, lensAmt: { value: 0 }, scanC: { value: new THREE.Vector2() }, scanR: { value: 0 },
    scanOn: { value: 0 }, scanFade: { value: 0 }, cStep: { value: 2 },
    colourOn: { value: HI ? 1 : 0 }, patchOn: { value: 0 }, patchBox: { value: new THREE.Vector4(0, 0, 0, 0) },
    detailMap: { value: null }, detailBox: { value: new THREE.Vector3(0, 0, 1) }, detailOn: { value: 0 }, microOn: { value: 1 },
  };
  // Mars colour from the greyscale HiRISE brightness (dark basalt sand -> rusty dust -> pale bedrock)
  const PALETTE_GLSL = `
    float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
    vec3 marsAlbedo(float g){ g = clamp((pow(g, 1.0 / 2.2) - 0.12) / 0.72, 0.0, 1.0);
      vec3 c1 = vec3(0.045, 0.024, 0.016), c2 = vec3(0.27, 0.12, 0.055), c3 = vec3(0.60, 0.36, 0.20);
      return g < 0.5 ? mix(c1, c2, g * 2.0) : mix(c2, c3, (g - 0.5) * 2.0); }
`;
  function makeTerrainMat(isPatch) {
  const tMat = new THREE.MeshLambertMaterial({ map: tex });
  tMat.customProgramCacheKey = () => (isPatch ? 'terrain-patch' : 'terrain-base');
  tMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U_);
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vW;\nuniform sampler2D lensMap, detailMap; uniform float lensAmt, scanR, scanOn, scanFade, cStep, detailOn, microOn, colourOn, patchOn; uniform vec2 scanC; uniform vec3 detailBox; uniform vec4 patchBox;\n' + PALETTE_GLSL +
      sh.fragmentShader.replace('#include <map_fragment>', `
      ${isPatch ? '' : 'if (patchOn > 0.5 && vW.x > patchBox.x && vW.x < patchBox.z && vW.z > patchBox.y && vW.z < patchBox.w) discard;'}
      vec4 sampledDiffuseColor = texture2D(map, vMapUv);
      float gv = sampledDiffuseColor.r; vec3 cv = sampledDiffuseColor.rgb;
      vec2 dUv = (vW.xz - detailBox.xy) / detailBox.z;
      if (detailOn > 0.5 && dUv.x > 0.0 && dUv.y > 0.0 && dUv.x < 1.0 && dUv.y < 1.0) {
        vec4 dc = texture2D(detailMap, vec2(dUv.x, 1.0 - dUv.y));
        float edge = smoothstep(0.0, 0.08, dUv.x) * smoothstep(0.0, 0.08, dUv.y) * smoothstep(0.0, 0.08, 1.0 - dUv.x) * smoothstep(0.0, 0.08, 1.0 - dUv.y);
        gv = mix(gv, dc.r, dc.a * edge); cv = mix(cv, dc.rgb, dc.a * edge);
      }
      // true-colour HiRISE (LRGB, slightly enhanced): pull saturation back a little; greyscale imagery falls back to the palette
      float lum = dot(cv, vec3(0.299, 0.587, 0.114));
      vec3 alb = colourOn > 0.5 ? pow(mix(vec3(lum), cv, 0.95), vec3(1.35)) * 1.25 : marsAlbedo(gv);   // contrast curve: the mosaic is stretched flat
      float camD = length(vW - cameraPosition);
      float nf = (1.0 - smoothstep(15.0, 220.0, camD)) * microOn;
      float nz = vn(vW.xz * 2.3 + 1.7) * 0.4 + vn(vW.xz * 0.7) * 0.4 + vn(vW.xz * 8.3 + 5.1) * 0.2;
      alb *= 1.0 + (nz - 0.5) * 0.42 * nf;
      diffuseColor.rgb *= alb;
      vec4 lz = texture2D(lensMap, vMapUv);
      float dS = distance(vW.xz, scanC);
      float inScan = scanOn > 0.5 ? 1.0 - smoothstep(scanR - 4.0, scanR, dS) : 1.0;
      diffuseColor.rgb = mix(diffuseColor.rgb, lz.rgb, lz.a * lensAmt * inScan);
      if (scanOn > 0.5) {
        float ring = smoothstep(scanR - 30.0, scanR, dS) * (1.0 - smoothstep(scanR, scanR + 2.0, dS));
        float y = vW.y / cStep; float f = fract(y); float w = fwidth(y);
        float line = 1.0 - smoothstep(0.0, 1.5 * w, min(f, 1.0 - f));
        diffuseColor.rgb += vec3(0.25, 0.85, 1.0) * (ring * 1.6 + line * 0.55 * inScan * scanFade);
      }`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float bh = vn(vW.xz * 0.9 + 3.1) * 0.7 + vn(vW.xz * 2.7 + 7.7) * 0.3;
        vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2);
        normal = normalize(abs(det) * normal - grad * 0.34 * nf);
      }`);
  };
  return tMat;
  }
  const tMat = makeTerrainMat(false), pMat = makeTerrainMat(true);
  {
    const pos = new Float32Array(M * M * 3), uv = new Float32Array(M * M * 2);
    for (let g = 0; g < M; g++) for (let f = 0; f < M; f++) {
      const k = g * M + f, x = X0 + f * HC, y = SIZE - (X0 + g * HC);
      pos[k * 3] = x - SIZE / 2; pos[k * 3 + 1] = hi[k] - BASE; pos[k * 3 + 2] = SIZE / 2 - y;
      uv[k * 2] = x / SIZE; uv[k * 2 + 1] = y / SIZE;
    }
    const idx = new Uint32Array((M - 1) * (M - 1) * 6); let p = 0;
    for (let g = 0; g < M - 1; g++) for (let f = 0; f < M - 1; f++) {
      const a = g * M + f, b = a + 1, c = a + M, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    var terrain = new THREE.Mesh(geo, tMat); terrain.castShadow = terrain.receiveShadow = true; world.add(terrain);
    // skirt (gives the "floating slab" look in map mode)
    const sp = [], bottom = K.elevMin - 80 - BASE, edge = [];
    for (let f = 0; f < M; f++) edge.push(f);
    for (let g = 1; g < M; g++) edge.push(g * M + M - 1);
    for (let f = M - 2; f >= 0; f--) edge.push((M - 1) * M + f);
    for (let g = M - 2; g >= 0; g--) edge.push(g * M);
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k], b = edge[k + 1];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      sp.push(ax, ay, az, bx, by, bz, ax, bottom, az, bx, by, bz, bx, bottom, bz, ax, bottom, az);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.computeVertexNormals();
    var skirt = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x4a3426, side: THREE.DoubleSide })); world.add(skirt);
  }

  // outer terrain (helmet view horizon). With K.far: the real USGS DEM (16x overview, 32 km at 64 m) under CTX imagery;
  // otherwise CTX on edge-extended heights (prototype behaviour).
  const OD = K.far ? (K.far.n - 1) * K.far.res : 24000;
  const outer = K.far ? (() => {
    const F = K.far, n = F.n, cvS = 2048;
    const cv = document.createElement('canvas'); cv.width = cv.height = cvS;
    const cx = cv.getContext('2d'); cx.fillStyle = '#7a5a44'; cx.fillRect(0, 0, cvS, cvS);
    const ot = new THREE.CanvasTexture(cv); ot.colorSpace = THREE.SRGBColorSpace; ot.anisotropy = 8;
    const span = OD / K.M_PER_DEG;   // planner grid: equirectangular metres, no cos(lat) on longitude
    tiles(cx, { lonW: K.LON0 - span / 2, latN: K.LAT0 + span / 2, dLon: span, dLat: span }, cvS, 'Gale_CTX_BlockAdj_dd', 11, 'png').then(() => { ot.needsUpdate = true; });
    const g = new THREE.PlaneGeometry(OD, OD, n - 1, n - 1); g.rotateX(-Math.PI / 2);   // row 0 = north, like the data
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const X = p.getX(k), Z = p.getZ(k), x = X + SIZE / 2, y = SIZE / 2 - Z;
      const inSite = Math.abs(X) < SIZE / 2 + 2 && Math.abs(Z) < SIZE / 2 + 2, deep = Math.abs(X) < SIZE / 2 - 60 && Math.abs(Z) < SIZE / 2 - 60;
      const h = inSite ? ground3(Math.max(0, Math.min(SIZE, x)), Math.max(0, Math.min(SIZE, y))) - (deep ? 40 : 1.5) : F.data[k];
      p.setY(k, h - BASE);
    }
    g.computeVertexNormals();
    const om = new THREE.MeshLambertMaterial({ map: ot });
    om.onBeforeCompile = sh => { sh.fragmentShader = PALETTE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vMapUv); diffuseColor.rgb *= marsAlbedo(sampledDiffuseColor.r);'); };
    const m = new THREE.Mesh(g, om); m.receiveShadow = true; world.add(m); return m;
  })() : (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    const cx = cv.getContext('2d'); cx.fillStyle = '#7a5a44'; cx.fillRect(0, 0, 1024, 1024);
    const ot = new THREE.CanvasTexture(cv); ot.colorSpace = THREE.SRGBColorSpace;
    const ob = { lonW: K.LON0 - (OD / 2) / (K.M_PER_DEG * Math.cos(K.LAT0 * Math.PI / 180)), latN: K.LAT0 + (OD / 2) / K.M_PER_DEG, dLon: OD / (K.M_PER_DEG * Math.cos(K.LAT0 * Math.PI / 180)), dLat: OD / K.M_PER_DEG };
    tiles(cx, ob, 1024, 'Gale_CTX_BlockAdj_dd', 10, 'png').then(() => { ot.needsUpdate = true; });
    const g = new THREE.PlaneGeometry(OD, OD, 160, 160); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const X = p.getX(k), Z = p.getZ(k), x = X + SIZE / 2, y = SIZE / 2 - Z;
      const inside = Math.abs(X) < SIZE / 2 - 60 && Math.abs(Z) < SIZE / 2 - 60;
      p.setY(k, ground(Math.max(0, Math.min(SIZE, x)), Math.max(0, Math.min(SIZE, y))) - BASE - (inside ? 40 : 1.5));
    }
    g.computeVertexNormals();
    const om = new THREE.MeshLambertMaterial({ map: ot });
    om.onBeforeCompile = sh => { sh.fragmentShader = PALETTE_GLSL + sh.fragmentShader.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vMapUv); diffuseColor.rgb *= marsAlbedo(sampledDiffuseColor.r);'); };
    const m = new THREE.Mesh(g, om); m.receiveShadow = true; world.add(m); return m;
  })();

  // ---------- near-field patch: 1 m terrain, 640 m square, rebuilt as the astronaut walks ----------
  const PATCH = 640;
  const patch = { cx: -1e9, cy: -1e9, busy: false, mesh: null };
  function updatePatch() {
    if (!HI || mode !== 'pov' || patch.busy || Math.hypot(S.x - patch.cx, S.y - patch.cy) < 180) return;
    patch.busy = true; const cx = Math.round(S.x), cy = Math.round(S.y);
    ensureTiles(cx, cy, PATCH / 2 + 4).then(() => { if (mode === 'pov') buildPatch(cx, cy); patch.busy = false; });
  }
  function buildPatch(cx, cy) {
    const PN = PATCH + 1, n = PN + 2, x0 = cx - PATCH / 2, yN = cy + PATCH / 2;   // +1 ring each side = skirt
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let g = 0; g < n; g++) for (let f = 0; f < n; f++) {
      const gi = Math.min(PN - 1, Math.max(0, g - 1)), fi = Math.min(PN - 1, Math.max(0, f - 1)), k = g * n + f;
      const x = Math.max(0.5, Math.min(SIZE - 0.5, x0 + fi)), y = Math.max(0.5, Math.min(SIZE - 0.5, yN - gi));
      const skirt = g === 0 || f === 0 || g === n - 1 || f === n - 1;
      pos[k * 3] = x - SIZE / 2; pos[k * 3 + 1] = ground(x, y) - BASE - (skirt ? 3 : 0); pos[k * 3 + 2] = SIZE / 2 - y;
      uv[k * 2] = x / SIZE; uv[k * 2 + 1] = y / SIZE;
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6); let q = 0;
    for (let g = 0; g < n - 1; g++) for (let f = 0; f < n - 1; f++) { const a = g * n + f, b = a + 1, c = a + n, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    if (!patch.mesh) { patch.mesh = new THREE.Mesh(geo, pMat); patch.mesh.castShadow = patch.mesh.receiveShadow = true; world.add(patch.mesh); }
    else { patch.mesh.geometry.dispose(); patch.mesh.geometry = geo; }
    const xa = Math.max(0, x0) - SIZE / 2 + 1, xb = Math.min(SIZE, x0 + PATCH) - SIZE / 2 - 1, za = SIZE / 2 - Math.min(SIZE, yN) + 1, zb = SIZE / 2 - Math.max(0, yN - PATCH) - 1;
    U_.patchBox.value.set(xa, za, xb, zb); U_.patchOn.value = 1; terrain.castShadow = false;
    patch.cx = cx; patch.cy = cy;
    // things placed on the coarser grid sit on the 1 m surface now
    reGroundRocks(xa, za, xb, zb); pebbles.userData.key = ''; rebuildStatic(); rebuildBeacons(); buildGuide();
  }

  // ---------- boulders (density from the rock index; individual positions illustrative) ----------
  const rocks = (() => {
    let seed = 7; const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
    const want = []; for (let i = 0; i < N * N; i++) { const n = rock[i] * rock[i] * 5 + rnd(); for (let k = 1; k <= n; k++) want.push(i); }
    const count = Math.min(30000, want.length);
    const mkGeo = sd => {
      let g = new THREE.IcosahedronGeometry(1, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
      const p = g.attributes.position, v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        const n = Math.sin(v.x * 2.1 + sd) * Math.cos(v.y * 2.7 + sd * 1.7) * Math.sin(v.z * 1.9 + sd * 0.6);
        const f = 1 + 0.28 * n + 0.12 * Math.sin((v.x + v.z) * 6 + sd) - (v.y < -0.3 ? 0.35 * (-0.3 - v.y) : 0);
        p.setXYZ(k, v.x * f, v.y * f * 0.8, v.z * f);
      }
      g.computeVertexNormals(); return g;
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const group = new THREE.Group(); const per = Math.ceil(count / 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), col = new THREE.Color();
    for (let vI = 0; vI < 3; vI++) {
      const im = new THREE.InstancedMesh(mkGeo(vI * 3.7 + 1), mat, per); im.castShadow = im.receiveShadow = true;
      for (let k = 0; k < per; k++) {
        const i = want[Math.floor(rnd() * want.length)];
        const x = ((i % N) + rnd()) * CELL, y = SIZE - (Math.floor(i / N) + rnd()) * CELL;
        const sz = (0.12 + rnd() ** 4 * 1.6) * (0.6 + rock[i]);
        s.set(sz * (0.8 + 0.6 * rnd()), sz * (0.5 + 0.5 * rnd()), sz * (0.8 + 0.6 * rnd()));
        q.setFromEuler(e.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.4));
        m4.compose(new THREE.Vector3(x - SIZE / 2, ground(x, y) - BASE - 0.12 * sz, SIZE / 2 - y), q, s);
        (im.userData.items ||= []).push([x, y, sz, q.clone(), s.clone()]);
        const t = rnd(); im.setMatrixAt(k, m4); im.setColorAt(k, col.setRGB(0.10 + 0.08 * t, 0.055 + 0.04 * t, 0.035 + 0.025 * t));
      }
      group.add(im);
    }
    const im = group;
    world.add(im); return im;
  })();
  function reGroundRocks(xa, za, xb, zb) {
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    rocks.children.forEach(im => {
      im.userData.items.forEach(([x, y, sz, q, s], k) => {
        const X = x - SIZE / 2, Z = SIZE / 2 - y; if (X < xa || X > xb || Z < za || Z > zb) return;
        m4.compose(v.set(X, ground(x, y) - BASE - 0.12 * sz, Z), q, s); im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
    });
  }

  const PEB_T = 6, PEB_R = 6, PEB_PER = 22;
  const pebbles = (() => {
    let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) * 0.55 * (0.8 + 0.4 * Math.sin(k * 12.9)));
    g.computeVertexNormals();
    const n = (2 * PEB_R + 1) ** 2 * PEB_PER;
    const im = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff }), n); im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    world.add(im); im.userData.key = ''; return im;
  })();
  function updatePebbles() {
    const tx0 = Math.floor(S.x / PEB_T), ty0 = Math.floor(S.y / PEB_T), key = tx0 + ',' + ty0;
    if (pebbles.userData.key === key) return; pebbles.userData.key = key;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color(), v = new THREE.Vector3();
    let k = 0;
    for (let dy = -PEB_R; dy <= PEB_R; dy++) for (let dx = -PEB_R; dx <= PEB_R; dx++) {
      const tx = tx0 + dx, ty = ty0 + dy; let sd = (tx * 73856093) ^ (ty * 19349663);
      const rnd = () => ((sd = Math.imul(sd ^ (sd >>> 15), 2246822507) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
      for (let j = 0; j < PEB_PER; j++) {
        const x = (tx + rnd()) * PEB_T, y = (ty + rnd()) * PEB_T, c = K.cellOfXY(x, y);
        const keep = rnd() < 0.25 + 0.75 * rock[c] - 0.5 * sand[c];
        const sz = keep ? 0.025 + rnd() ** 3 * 0.22 : 0;
        sc.set(sz * (0.7 + 0.6 * rnd()), sz, sz * (0.7 + 0.6 * rnd())); q.setFromEuler(e.set(0, rnd() * 6.28, rnd() * 0.3));
        m4.compose(v.set(x - SIZE / 2, ground(x, y) - BASE - 0.2 * sz, SIZE / 2 - y), q, sc);
        pebbles.setMatrixAt(k, m4); const t = rnd(); pebbles.setColorAt(k++, col.setRGB(0.09 + 0.1 * t, 0.05 + 0.05 * t, 0.032 + 0.03 * t));
      }
    }
    pebbles.instanceMatrix.needsUpdate = true; pebbles.instanceColor.needsUpdate = true;
  }

  // ---------- sky + light ----------
  const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, day: { value: 1 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // Mars sky, after Viking / Pathfinder / Curiosity imagery: suspended dust absorbs blue and makes a butterscotch
    // daytime sky; forward (Mie) scattering by the same dust gives a whitish-blue aureole near the sun that fades by
    // ~30 degrees and turns blue at sunset. The sun disc is ~2/3 of its size seen from Earth (0.35 degrees).
    fragmentShader: `varying vec3 vD; uniform vec3 sunDir; uniform float day;
      void main(){ vec3 d = normalize(vD); vec3 sd = normalize(sunDir); float h = max(d.y, 0.0), mu = dot(d, sd), sunH = sd.y;
        vec3 col = mix(vec3(0.84, 0.64, 0.45), vec3(0.40, 0.27, 0.18), pow(h, 0.45));
        float low = smoothstep(0.35, -0.02, sunH);
        float aur = pow(max(mu, 0.0), 10.0);
        vec3 halo = mix(vec3(0.95, 0.88, 0.78), vec3(0.55, 0.68, 0.90), low);
        col = mix(col, col * vec3(0.55, 0.42, 0.36), low * (1.0 - aur));
        col += halo * aur * mix(0.5, 1.15, low);
        col += vec3(1.0, 0.97, 0.92) * smoothstep(0.99998, 0.999996, mu) * 10.0;
        col *= mix(0.04, 1.0, day); gl_FragColor = vec4(col, 1.0); }`,
  }));
  sky.renderOrder = -1; scene.add(sky);
  const sun = new THREE.DirectionalLight(0xfff4e8, 2.4); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  const setShadowBox = r => { const sc = sun.shadow.camera; sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.near = 10; sc.far = 14000; sc.updateProjectionMatrix(); };
  setShadowBox(260);
  const hemi = new THREE.HemisphereLight(0xd8b48a, 0x5a3a28, 0.6); scene.add(hemi);
  const fog = new THREE.FogExp2(0xc9a27e, K.far ? 0.000045 : 0.00019);   // thin dusty air: Mount Sharp stays visible 15 km out
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // floating dust (cosmetic)
  const dust = (() => {
    const n = 1400, p = new Float32Array(n * 3); for (let k = 0; k < n * 3; k++) p[k] = (Math.random() - 0.5) * (k % 3 === 1 ? 14 : 70);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8a878, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(pts); return pts;
  })();

  // ---------- glowing ribbons (guide line, planned route, rover track) ----------
  function ribbonMat(color, { dash = false, space = 6, op = 1, additive = true } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uDash: { value: dash ? 1 : 0 }, uSpace: { value: space }, uOp: { value: op }, uGlow: { value: additive ? 2.2 : 1 } },
      vertexShader: 'attribute float along; attribute float side; varying float vA; varying float vS; varying float vD; void main(){ vA = along; vS = side; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform float uTime, uDash, uSpace, uOp, uGlow; uniform vec3 uColor; varying float vA; varying float vS; varying float vD;
        void main(){ float e = 1.0 - abs(vS); float a = 0.25 + 0.75 * pow(e, 1.5);
          if (uDash > 0.5) { float f = fract(vA / uSpace - abs(vS) * 0.45 - uTime); a *= f < 0.4 ? 1.0 : 0.12; }
          a *= smoothstep(1.5, 7.0, vD);
          gl_FragColor = vec4(uColor * uGlow, a * uOp); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
  }
  function chaikin(p, it) {
    for (let n = 0; n < it; n++) {
      if (p.length < 3) return p;
      const q = [p[0]];
      for (let i = 0; i < p.length - 1; i++) { const [ax, ay] = p[i], [bx, by] = p[i + 1]; q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); }
      q.push(p[p.length - 1]); p = q;
    }
    return p;
  }
  function ribbonGeo(pts, width, lift, step) {
    pts = chaikin(pts, 2);
    const rs = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = rs[rs.length - 1], [bx, by] = pts[i], d = Math.hypot(bx - ax, by - ay);
      if (d < step * 0.3 && i < pts.length - 1) continue;
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 1; k <= n; k++) rs.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
    }
    const pos = [], al = [], sd = [], ix = []; let acc = 0;
    for (let i = 0; i < rs.length; i++) {
      const a = rs[Math.max(0, i - 1)], b = rs[Math.min(rs.length - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      if (i > 0) acc += Math.hypot(rs[i][0] - rs[i - 1][0], rs[i][1] - rs[i - 1][1]);
      for (const sgn of [-1, 1]) {
        const x = rs[i][0] - ty * width / 2 * sgn, y = rs[i][1] + tx * width / 2 * sgn;
        pos.push(x - SIZE / 2, ground(x, y) - BASE + lift, SIZE / 2 - y); al.push(acc); sd.push(sgn);
      }
      if (i > 0) { const k = i * 2; ix.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(al, 1)); g.setAttribute('side', new THREE.Float32BufferAttribute(sd, 1));
    g.setIndex(ix); return g;
  }
  const R = {
    guide: new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat('#73b3e7', { dash: true, space: 5, op: 0.8, additive: false })),
    route: new THREE.Group(), track: new THREE.Group(),
  };
  R.guide.frustumCulled = false; R.guide.renderOrder = 3;
  world.add(R.guide, R.route, R.track);
  const routeMat = ribbonMat(C.route, { op: 0.5, additive: false }), trackMat = ribbonMat(C.violet, { op: 0.5, additive: false });
  const ribbonW = () => mode === 'map' ? { w: 16, lift: 3, step: 15 } : { w: 0.7, lift: 0.12, step: 3 };
  function setRibbon(group, runs, mat) {
    group.children.forEach(m => m.geometry.dispose()); group.clear();
    const { w, lift, step } = ribbonW();
    runs.filter(r => r.length > 1).forEach(r => { const m = new THREE.Mesh(ribbonGeo(r, w, lift, step), mat); m.frustumCulled = false; m.renderOrder = 2; group.add(m); });
  }
  let trackRuns = [];
  function rebuildStatic() {
    const rt = K.route;
    setRibbon(R.route, rt && !rt.error ? [rt.pts.map(p => [p.x, p.y])] : [], routeMat);
    trackRuns = []; let run = [];
    for (const t of K.track) {
      const [x, y] = K.latLngToXY(t.lat, t.lon);
      if (x > 0 && y > 0 && x < SIZE && y < SIZE) run.push([x, y]); else if (run.length) { trackRuns.push(run); run = []; }
    }
    if (run.length) trackRuns.push(run);
    setRibbon(R.track, trackRuns, trackMat);
  }

  // ---------- stop beacons ----------
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true); beamGeo.translate(0, 0.5, 0);
  const beacons = new THREE.Group(); world.add(beacons);
  function beaconColor(s) { return s.home ? C.amber : S.visited.has(s.id) ? C.green : s === target() ? C.cyan : '#9fdcff'; }
  function rebuildBeacons() {
    beacons.clear();
    stops.forEach(s => {
      const g = new THREE.Group(); g.userData.stop = s;
      const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(beaconColor(s)) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; varying float vY; void main(){ gl_FragColor = vec4(uColor * 1.6, pow(1.0 - vY, 3.0) * 0.3); }',
      }));
      beam.scale.set(0.45, 160, 0.45);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(beaconColor(s)).multiplyScalar(3), transparent: true, opacity: 0.95 }));
      gem.position.y = 6; g.add(beam, gem);
      g.position.copy(toW(s.x, s.y, ground(s.x, s.y))); g.position.y /= world.scale.y || 1;
      beacons.add(g);
    });
  }

  // ---------- game state ----------
  const S = {
    x: stops[0].x, y: stops[0].y, h: 0, pitch: -0.05, z: 0, vz: 0, t: 0, dist: 0, speed: 0, bob: 0,
    visited: new Set(), warp: 5, guide: true, showRoute: true, showTrack: true, auto: false, working: null, done: false,
    lens: 0, scan: null, blockedMsg: 0, warned: {}, path: null, pathETA: 0, pathCell: -1, pathTarget: null, lastPath: 0,
  };
  const target = () => stops.find(s => !s.home && !S.visited.has(s.id)) || stops[0];
  const faceTarget = () => { const t = target(); S.h = Math.atan2(t.x - S.x, t.y - S.y); };
  faceTarget();
  let mode = 'pov';
  const O = { target: new THREE.Vector3(0, 0, 0), dist: 1900, az: 0.6, el: 0.72 };   // orbit camera (map mode)
  let exag = 2;
  const keys = {};
  const toasts = [];
  const toast = (text, color = C.cyan, sec = 3.5) => { toasts.push({ text, color, until: performance.now() + sec * 1000 }); if (toasts.length > 4) toasts.shift(); };

  // ---------- guide path (live A* from the astronaut to the next stop) ----------
  function updatePath(now) {
    if (!(S.guide || S.auto) || now - S.lastPath < 250) return;
    const tg = target(); let cell = K.cellOfXY(S.x, S.y); if (!pass[cell]) cell = K.nearestPassable(cell);
    if (cell === S.pathCell && tg === S.pathTarget) return;
    S.lastPath = now; S.pathCell = cell; S.pathTarget = tg;
    const p = K.astar(cell, tg.cell);
    S.path = p; S.pathETA = 0;
    if (!p) { R.guide.geometry.dispose(); R.guide.geometry = new THREE.BufferGeometry(); return; }
    for (let i = 1; i < p.length; i++) { const u = p[i - 1], v = p[i]; S.pathETA += K.edgeTime(u, v, (u % N !== v % N && ((u / N) | 0) !== ((v / N) | 0)) ? Math.SQRT2 : 1); }
    buildGuide();
  }
  function buildGuide() {
    if (!S.path) return;
    const pts = [[S.x, S.y], ...S.path.slice(1).map(c => [K.cellX(c), K.cellY(c)])];
    const tg = S.pathTarget; pts.push([tg.x, tg.y]);
    const w = mode === 'map' ? { w: 12, lift: 4, step: 12 } : { w: 0.55, lift: 0.18, step: 2 };
    R.guide.geometry.dispose(); R.guide.geometry = ribbonGeo(pts, w.w, w.lift, w.step);
    R.guide.material.uniforms.uSpace.value = mode === 'map' ? 40 : 5;
  }

  // ---------- input ----------
  const cv = renderer.domElement;
  addEventListener('keydown', e => {
    if (!visible || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    keys[e.code] = true;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyG': S.guide = !S.guide; S.pathCell = -1; toast(S.guide ? 'Guide line ON: follow the arrows to the next stop' : 'Guide line OFF'); onChange(); break;
      case 'KeyF': startScan(); break;
      case 'KeyV': setLens((S.lens + 1) % LENSES.length); toast('Data lens: ' + LENSES[S.lens][1]); onChange(); break;
      case 'KeyM': setMode(mode === 'pov' ? 'map' : 'pov'); onChange(); break;
      case 'KeyP': S.auto = !S.auto; if (S.auto) S.pathCell = -1; toast(S.auto ? 'Autopilot: walking the guide line to the next stop' : 'Autopilot off'); break;
      case 'KeyE': interact(); break;
      case 'KeyR': S.showRoute = !S.showRoute; onChange(); break;
      case 'KeyT': S.showTrack = !S.showTrack; onChange(); break;
      case 'Digit1': setWarp(1); break; case 'Digit2': setWarp(5); break; case 'Digit3': setWarp(20); break;
      case 'Space': if (mode === 'pov' && S.z === 0) S.vz = 2.4; break;
    }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  cv.addEventListener('click', () => { if (mode === 'pov' && document.pointerLockElement !== cv) cv.requestPointerLock?.()?.catch?.(() => {}); });
  document.addEventListener('pointerlockchange', () => { help.style.display = document.pointerLockElement === cv || mode !== 'pov' || !visible ? 'none' : 'flex'; });
  let drag = null;
  cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }; });
  addEventListener('mouseup', () => { drag = null; });
  addEventListener('mousemove', e => {
    if (!visible) return;
    if (mode === 'pov' && document.pointerLockElement === cv) {
      S.h += e.movementX * 0.0022; S.pitch = Math.max(-1.3, Math.min(1.2, S.pitch - e.movementY * 0.0022));
    } else if (drag && mode === 'map') {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.b === 2 || drag.shift) {
        const f = O.dist / 900, ca = Math.cos(O.az), sa = Math.sin(O.az);
        O.target.x -= (dx * ca - dy * sa) * f; O.target.z -= (dx * sa + dy * ca) * f;
        O.target.x = Math.max(-SIZE, Math.min(SIZE, O.target.x)); O.target.z = Math.max(-SIZE, Math.min(SIZE, O.target.z));
      } else { O.az -= dx * 0.005; O.el = Math.max(0.12, Math.min(1.45, O.el - dy * 0.004)); }
    } else if (drag && mode === 'pov') {
      S.h += (e.clientX - drag.x) * 0.004; S.pitch = Math.max(-1.3, Math.min(1.2, S.pitch - (e.clientY - drag.y) * 0.004)); drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { if (mode === 'map') { e.preventDefault(); O.dist = Math.max(250, Math.min(14000, O.dist * Math.exp(e.deltaY * 0.0012))); } }, { passive: false });
  const ray = new THREE.Raycaster();
  cv.addEventListener('dblclick', e => {
    if (mode !== 'map') return;
    const r = cv.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObject(terrain)[0]; if (!hit) return;
    const [x, y] = fromW(hit.point), c = K.cellOfXY(x, y);
    if (!pass[c]) { toast(`Can't stand there: ${blockReason(c)}`, C.red); return; }
    S.x = x; S.y = y; S.pathCell = -1; toast('Astronaut moved. Press M for the helmet view.');
  });

  function blockReason(c) {
    if (!(slope[c] <= K.maxSlope)) return `too steep (${slope[c].toFixed(0)}°, limit ${K.maxSlope}°)`;
    return 'no data';
  }
  function interact() {
    if (S.working || S.done) return;
    const near = nearStop();
    if (!near) { toast('Nothing to do here. Walk to a beacon.', C.cyan); return; }
    if (near.home) {
      if (S.visited.size >= stops.length - 1) return finish();
      S.homeConfirm = (S.homeConfirm || 0) + 1;
      if (S.homeConfirm >= 2) return finish();
      toast(`${stops.length - 1 - S.visited.size} stops left. Press E again to end the EVA early.`, C.amber);
      return;
    }
    if (S.visited.has(near.id)) { toast(`Stop ${near.id} is already sampled.`); return; }
    S.working = { stop: near, t0: performance.now(), dur: 3500, tStart: S.t };
    toast(`Sampling ${near.name}, ${P.work} min of suit time`, C.cyan);
    showCam(near);
  }
  const nearStop = () => stops.find(s => Math.hypot(s.x - S.x, s.y - S.y) < 22);

  function startScan() {
    if (mode !== 'pov') { toast('Scan works in the helmet view', C.amber); return; }
    S.scan = { t0: performance.now() };
    U_.scanOn.value = 1; U_.scanC.value.set(S.x - SIZE / 2, SIZE / 2 - S.y);
    if (S.lens === 0) { buildLens('hazard'); lensKey = 'hazard'; }
    toast('Terrain scan: red too steep, tan sand, blue rock. Lines every 2 m of height', C.cyan, 5);
  }
  function setLens(i) {
    S.lens = i; lensKey = LENSES[i][0];
    if (lensKey !== 'imagery') { buildLens(lensKey); U_.lensAmt.value = 0.75; } else if (!S.scan) U_.lensAmt.value = 0;
    texDirty = true;
  }
  function setWarp(w) { S.warp = w; toast(`Time speed ×${w}`); onChange(); }
  function setMode(m) {
    mode = m;
    if (m === 'map') {
      document.exitPointerLock?.();
      world.scale.y = exag; scene.fog = null; scene.background = new THREE.Color(0xececec);
      sky.visible = false; outer.visible = false; skirt.visible = true; rocks.visible = false; beacons.visible = false; pebbles.visible = false;
      U_.patchOn.value = 0; terrain.castShadow = true; if (patch.mesh) patch.mesh.visible = false;
      U_.scanOn.value = 0; U_.cStep.value = 2 * exag; camera.near = 5; setShadowBox(2600); U_.microOn.value = 0; dust.visible = false; { const cx = stops.reduce((a, q) => a + q.x, 0) / stops.length, cy = stops.reduce((a, q) => a + q.y, 0) / stops.length; O.target.set(cx - SIZE / 2, (ground(cx, cy) - BASE) * exag, SIZE / 2 - cy); }
    } else {
      world.scale.y = 1; scene.fog = fog; scene.background = null; sky.visible = true; outer.visible = true; skirt.visible = false;
      if (patch.mesh) { patch.mesh.visible = true; U_.patchOn.value = 1; terrain.castShadow = false; }
      rocks.visible = S.showRocks !== false; beacons.visible = true; pebbles.visible = true; camera.near = 0.3; U_.cStep.value = 2; setShadowBox(260); U_.microOn.value = 1; dust.visible = true;
    }
    camera.updateProjectionMatrix();
    rebuildStatic(); rebuildBeacons(); buildGuide();
    labels.style.display = m === 'map' ? 'block' : 'none';
    help.style.display = m === 'pov' && document.pointerLockElement !== cv ? 'flex' : 'none';
  }

  // ---------- simulation ----------
  function okAt(x, y) { return (pass[K.cellOfXY(x, y)] && (!K.hiElev || fineSlope(x, y) < 32)) || !pass[K.cellOfXY(S.x, S.y)]; }
  function step(dt, now) {
    if (S.done) return;
    const boost = keys.ShiftLeft || keys.ShiftRight ? 4 : 1, mult = S.warp * boost;
    if (S.working) {
      const f = Math.min(1, (now - S.working.t0) / S.working.dur);
      S.t = S.working.tStart + f * P.work / 60;
      if (f >= 1) {
        const st = S.working.stop; S.visited.add(st.id); S.working = null; S.pathCell = -1; rebuildBeacons();
        const nx = target();
        toast(`Sample secured at ${st.name}`, C.green, 4);
        toast(nx.home ? 'All stops done. Walk back to the habitat (yellow beacon).' : `Next: stop ${nx.id}, ${nx.name}`, C.cyan, 5);
      }
      return;
    }
    S.t += dt * mult / 3600;
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    if (keys.ArrowLeft) S.h -= 1.5 * dt; if (keys.ArrowRight) S.h += 1.5 * dt;
    if (S.auto && S.path) {
      const tg = target();
      if (Math.hypot(tg.x - S.x, tg.y - S.y) < 12) { S.auto = false; toast(`Arrived at ${tg.home ? 'the habitat' : 'stop ' + tg.id}. Press E to ${tg.home ? 'end the EVA' : 'sample'}.`, C.green); }
      else {
        const k = Math.min(S.path.length - 1, 2), aim = k >= S.path.length - 1 ? [tg.x, tg.y] : [K.cellX(S.path[k]), K.cellY(S.path[k])];
        let d = Math.atan2(aim[0] - S.x, aim[1] - S.y) - S.h; d = Math.atan2(Math.sin(d), Math.cos(d));
        S.h += Math.max(-3 * dt, Math.min(3 * dt, d)); f = 1; s = 0;
      }
    }
    S.speed = 0;
    if (f || s) {
      const l = Math.hypot(f, s); f /= l; s /= l;
      const dx = Math.sin(S.h) * f + Math.cos(S.h) * s, dy = Math.cos(S.h) * f - Math.sin(S.h) * s;
      const ci = K.cellOfXY(S.x, S.y), grade = (ground(S.x + dx * 3, S.y + dy * 3) - ground(S.x, S.y)) / 3;
      const v = K.speed(grade, sand[ci], rock[ci]) / 3.6;
      S.speed = v * 3.6;
      const mv = v * dt * mult;
      let nx = S.x + dx * mv, ny = S.y + dy * mv;
      if (nx < CELL || ny < CELL || nx > SIZE - CELL || ny > SIZE - CELL) {
        nx = Math.max(CELL, Math.min(SIZE - CELL, nx)); ny = Math.max(CELL, Math.min(SIZE - CELL, ny));
        if (now - S.blockedMsg > 2500) { toast('Edge of the surveyed area (3.2 km square of 1 m terrain)', C.amber); S.blockedMsg = now; }
      }
      const ox = S.x, oy = S.y;
      if (okAt(nx, ny)) { S.x = nx; S.y = ny; }
      else if (okAt(nx, S.y)) S.x = nx;
      else if (okAt(S.x, ny)) S.y = ny;
      else if (now - S.blockedMsg > 2000) { const c = K.cellOfXY(nx, ny); toast('Blocked: ' + (pass[c] ? `local step too steep (${fineSlope(nx, ny).toFixed(0)}°)` : blockReason(c)), C.red); S.blockedMsg = now; }
      const moved = Math.hypot(S.x - ox, S.y - oy); S.dist += moved; S.bob += moved * 1.9;
    }
    S.vz -= G_MARS * dt; S.z = Math.max(0, S.z + S.vz * dt); if (S.z === 0) S.vz = Math.max(0, S.vz);
    // warnings
    const m = margin();
    const warn = (k, cond, text, col) => { if (cond && !S.warned[k]) { S.warned[k] = 1; toast(text, col, 6); } if (!cond) S.warned[k] = 0; };
    warn('low', m < 0.5 && m >= 0, 'Caution: under 30 min of margin for the walk back', C.amber);
    warn('neg', m < 0, 'Turn back: not enough suit time left to reach the habitat', C.red);
    const near = nearStop(); warn('near:' + (near?.id || ''), !!near && !S.working && !(near.home && S.visited.size === 0), near ? (near.home ? 'At the habitat. Press E to end the EVA' : S.visited.has(near.id) ? `Stop ${near.id} is already sampled` : `Arrived at ${near.name}. Press E to collect a sample`) : '', C.green);
  }
  function margin() { const c = K.cellOfXY(S.x, S.y); return (P.suit - P.reserve) - (S.t + K.home[c]); }
  function finish() {
    S.done = true; S.auto = false; document.exitPointerLock?.();
    const m = margin();
    summary.innerHTML = `<h3>${m < 0 ? 'Back, past the safety line' : 'EVA complete'}</h3>
      <dl class="sg"><dt>Stops sampled</dt><dd>${S.visited.size} of ${stops.length - 1}</dd><dt>Distance walked</dt><dd>${(S.dist / 1000).toFixed(2)} km</dd>
      <dt>Suit time used</dt><dd>${K.fmtH(S.t)} of ${P.suit} h</dd><dt>Suit time left</dt><dd style="color:${P.suit - S.t < P.reserve ? C.red : C.white}">${K.fmtH(Math.max(0, P.suit - S.t))}</dd>
      <dt>Cosmic-ray dose</dt><dd>${(S.t * K.doseRate() * 1000).toFixed(0)} µSv</dd><dt>The planned route</dt><dd>${K.route ? (K.route.dist / 1000).toFixed(2) + ' km, ' + K.fmtH(K.route.total) : 'none'}</dd></dl>
      <button class="btn primary" id="gAgain">Walk again</button>`;
    summary.style.display = 'block';
    summary.querySelector('#gAgain').onclick = () => reset();
  }
  function reset() {
    Object.assign(S, { x: stops[0].x, y: stops[0].y, t: 0, dist: 0, z: 0, vz: 0, done: false, working: null, auto: false, homeConfirm: 0, warned: {}, pathCell: -1 });
    S.visited.clear(); faceTarget(); summary.style.display = 'none'; cam.style.display = 'none'; rebuildBeacons();
  }

  // ---------- Curiosity Navcam ground truth at stops ----------
  async function showCam(s) {
    if (!s.sol) return;
    cam.innerHTML = `<div class="ch"><b>What Curiosity saw here</b><span>Navcam, sol ${s.sol}</span><button aria-label="Close">✕</button></div><div class="ci">Loading NASA raw images…</div>`;
    cam.style.display = 'block'; cam.querySelector('button').onclick = () => { cam.style.display = 'none'; };
    try {
      const items = await K.navcam(s);
      cam.querySelector('.ci').innerHTML = items.slice(0, 2).map(it => `<a href="${it.https_url || it.url}" target="_blank" rel="noopener"><img src="${it.https_url || it.url}" alt="Navcam sol ${s.sol}" referrerpolicy="no-referrer"></a>`).join('') || 'No Navcam frames listed for this sol.';
    } catch { cam.querySelector('.ci').textContent = 'NASA raw image service did not answer.'; }
  }

  // ---------- HUD ----------
  let W = 1, H = 1, dpr = 1, visor = null, hs = 1;
  function resize() {
    const Wr = root.clientWidth || 1, Hr = root.clientHeight || 1; dpr = Math.min(2, devicePixelRatio || 1);
    hs = Math.max(0.55, Math.min(1, Wr / 1300, Hr / 820)); W = Wr / hs; H = Hr / hs;
    renderer.setSize(Wr, Hr, false); composer.setSize(Wr, Hr); bloom.resolution.set(Wr, Hr); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = W / H; camera.updateProjectionMatrix();
    hud.width = Wr * dpr; hud.height = Hr * dpr;
    visor = document.createElement('canvas'); visor.width = Wr * dpr; visor.height = Hr * dpr;
    const v = visor.getContext('2d'); v.scale(dpr * hs, dpr * hs);
    const g = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.75, 'rgba(4,10,14,.35)'); g.addColorStop(1, 'rgba(2,6,10,.9)');
    v.fillStyle = g; v.fillRect(0, 0, W, H);
    v.strokeStyle = 'rgba(255,255,255,.35)'; v.lineWidth = 1.5;
    v.beginPath(); v.ellipse(W / 2, H * 0.5, W * 0.62, H * 0.78, 0, Math.PI * 1.12, Math.PI * 1.88); v.stroke();
    v.beginPath(); v.ellipse(W / 2, H * 0.5, W * 0.62, H * 0.78, 0, Math.PI * 0.14, Math.PI * 0.86); v.stroke();
    const br = (x, y, sx, sy) => { v.beginPath(); v.moveTo(x, y + sy * 26); v.lineTo(x, y); v.lineTo(x + sx * 26, y); v.stroke(); };
    v.strokeStyle = 'rgba(255,255,255,.6)'; br(14, 14, 1, 1); br(W - 14, 14, -1, 1); br(14, H - 14, 1, -1); br(W - 14, H - 14, -1, -1);
    // faint scanlines
    v.fillStyle = 'rgba(255,255,255,.025)'; for (let y = 0; y < H; y += 3) v.fillRect(0, y, W, 1);
  }
  new ResizeObserver(resize).observe(root);

  const font = (w, px) => `${w} ${px}px Inter, "Public Sans", ui-sans-serif, system-ui`;
  const dist = d => d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(2)} km`;
  function panel(x, y, w, h, title) {
    const c = hctx;
    c.fillStyle = 'rgba(0,0,0,.5)'; c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 10, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - 10); c.lineTo(x + w - 10, y + h); c.lineTo(x, y + h); c.lineTo(x, y + 10); c.closePath(); c.fill(); c.stroke();
    if (title) { c.fillStyle = 'rgba(255,255,255,.75)'; c.font = font(700, 11); c.textAlign = 'left'; c.fillText(title, x + 12, y + 16); c.fillRect(x + 12, y + 21, 24, 2); }
  }
  function bar(x, y, w, frac, col, segs = 20) {
    const c = hctx, sw = w / segs;
    for (let k = 0; k < segs; k++) { c.fillStyle = k < Math.round(frac * segs) ? col : 'rgba(255,255,255,.12)'; c.fillRect(x + k * sw, y, sw - 2, 8); }
  }
  function project(x, y, h) {
    const v = toW(x, y, h); const cs = v.clone().applyMatrix4(camera.matrixWorldInverse);
    v.project(camera);
    return { sx: (v.x + 1) / 2 * W, sy: (1 - v.y) / 2 * H, behind: cs.z > 0, cs };
  }
  function drawHUD() {
    const c = hctx; c.setTransform(dpr * hs, 0, 0, dpr * hs, 0, 0); c.clearRect(0, 0, W, H);
    c.drawImage(visor, 0, 0, W, H);
    const tg = target(), deg = ((S.h * 180 / Math.PI) % 360 + 360) % 360;
    const ci = K.cellOfXY(S.x, S.y), m = margin(), left = P.suit - S.t;
    // compass tape
    const tw = Math.min(560, W * 0.46), tx = W / 2 - tw / 2;
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(tx, 18, tw, 30);
    c.save(); c.beginPath(); c.rect(tx, 18, tw, 46); c.clip();
    for (let a = Math.floor(deg - 70); a <= deg + 70; a++) {
      if (a % 5) continue;
      const x = W / 2 + (a - deg) / 70 * tw / 2, n = ((a % 360) + 360) % 360;
      c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(x, 18, 1, n % 15 ? 5 : 10);
      if (n % 45 === 0) { c.font = font(n % 90 ? 600 : 700, n % 90 ? 12 : 15); c.textAlign = 'center'; c.fillStyle = n === 0 ? C.amber : C.cyan; c.fillText({ 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[n], x, 44); }
    }
    stops.forEach(s => {
      let b = Math.atan2(s.x - S.x, s.y - S.y) * 180 / Math.PI - deg; b = ((b + 540) % 360) - 180;
      if (Math.abs(b) > 70) return;
      const x = W / 2 + b / 70 * tw / 2, col = beaconColor(s);
      c.fillStyle = col; c.font = font(700, 11); c.textAlign = 'center'; c.fillText(s.id, x, 60);
      if (s === tg) { c.beginPath(); c.moveTo(x, 50); c.lineTo(x - 5, 42); c.lineTo(x + 5, 42); c.fill(); }
    });
    c.restore();
    c.fillStyle = C.cyan; c.font = font(700, 13); c.textAlign = 'center'; c.fillText(`${Math.round(deg)}°`, W / 2, 78);
    c.fillRect(W / 2 - 1, 14, 2, 8);
    // objective (top-left)
    const td = Math.hypot(tg.x - S.x, tg.y - S.y);
    panel(24, 24, 300, 84, `Objective ${Math.min(S.visited.size + 1, stops.length)} of ${stops.length}`);
    c.textAlign = 'left'; c.fillStyle = C.white; c.font = font(700, 18); c.fillText((tg.home ? 'Habitat' : `${tg.id}  ${tg.name}`).slice(0, 32), 36, 58);
    c.fillStyle = 'rgba(220,240,245,.8)'; c.font = font(600, 13);
    const dz = ground(tg.x, tg.y) - ground(S.x, S.y);
    c.fillText(`${dist(td)},  ${dz >= 0 ? '▲' : '▼'} ${Math.abs(dz).toFixed(0)} m,  ${S.path && S.guide ? Math.round(S.pathETA * 60) + ' min on the guide line' : 'G shows the guide line'}`, 36, 80);
    c.fillStyle = 'rgba(220,240,245,.55)'; c.font = font(500, 12); c.fillText(tg.home ? 'Walk back to the habitat' : (tg.goal || '').length > 46 ? tg.goal.slice(0, 45) + '…' : (tg.goal || ''), 36, 98);
    // vitals (bottom-left)
    const vx = 24, vy = H - 214;
    panel(vx, vy, 270, 190, 'Suit');
    const row = (k, val, y, col = C.white) => { c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,.7)'; c.font = font(600, 12); c.fillText(k, vx + 12, y); c.textAlign = 'right'; c.fillStyle = col; c.font = font(700, 15); c.fillText(val, vx + 258, y); };
    const o2 = Math.max(0, left / P.suit), o2c = left < P.reserve ? C.red : o2 < 0.35 ? C.amber : C.cyan;
    row('Suit time left', `${K.fmtH(Math.max(0, left))}  ${Math.round(o2 * 100)}%`, vy + 44, o2c); bar(vx + 12, vy + 52, 246, o2, o2c);
    const dose = S.t * K.doseRate();
    row('Cosmic-ray dose', `${(dose * 1000).toFixed(0)} µSv`, vy + 82, P.sep ? C.amber : C.white); bar(vx + 12, vy + 90, 246, Math.min(1, dose / 0.5), P.sep ? C.amber : C.violet);
    const hour = P.start + S.t, rems = K.REMS;
    row('Air outside', `${K.tempAt(hour).toFixed(0)} °C`, vy + 120);
    row('Pressure', rems ? `${rems.pressure} Pa, REMS` : 'about 750 Pa', vy + 142);
    row('Gale local time', `${K.clock(hour)}   T+${K.fmtH(S.t)}`, vy + 164);
    row('Time speed', `×${S.warp}${keys.ShiftLeft || keys.ShiftRight ? ', boost ×4' : ''}`, vy + 182, 'rgba(255,255,255,.7)');
    // return margin (right, under minimap)
    const MS = Math.min(250, H * 0.32), mx = W - MS - 24, my = 24;
    drawMinimap(mx, my, MS);
    const st = m < 0 ? ['Turn back', C.red] : m < 0.5 ? ['Caution', C.amber] : ['Go', C.green];
    panel(mx, my + MS + 12, MS, 74, 'Walk-back margin');
    c.textAlign = 'left'; c.fillStyle = st[1]; c.font = font(700, 26); c.fillText(m < 0 ? '-' + K.fmtH(-m) : K.fmtH(m), mx + 12, my + MS + 62);
    c.textAlign = 'right'; c.font = font(700, 14); c.fillText(st[0], mx + MS - 12, my + MS + 44);
    c.fillStyle = 'rgba(220,240,245,.7)'; c.font = font(600, 12); c.fillText(`habitat ${isFinite(K.home[ci]) ? Math.round(K.home[ci] * 60) + ' min' : 'no path'}`, mx + MS - 12, my + MS + 62);
    // ground readout (bottom centre)
    const safe = !pass[ci] ? ['Too steep', C.red] : slope[ci] > 15 || sand[ci] > 0.55 || rock[ci] > 0.5 ? ['Caution', C.amber] : ['Good', C.green];
    const irv = K.THERM ? K.THERM.night[ci] : NaN, ir = Number.isFinite(irv) ? irv : null;
    const parts = [['Ground', safe[0], safe[1]], ['Slope', slope[ci].toFixed(0) + '°'], ['Sand', Math.round(sand[ci] * 100) + '%'], ['Rock', Math.round(rock[ci] * 100) + '%'],
      ...(ir != null ? [['Night IR', ir.toFixed(0) + (K.sandT[ci] > 0.15 ? ' sandy' : K.rockT[ci] > 0.15 ? ' rocky' : '')]] : []),
      ['Elevation', ground(S.x, S.y).toFixed(0) + ' m'], ['Pace', S.speed.toFixed(1) + ' km/h']];
    c.font = font(700, 14); const pw = parts.map(p => Math.max(c.measureText(p[1]).width, 50) + 26), tot = pw.reduce((a, b) => a + b, 0);
    let px = W / 2 - tot / 2; const py = H - 62;
    panel(px - 10, py - 4, tot + 20, 46);
    parts.forEach(([k, v, col], i) => {
      c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,.7)'; c.font = font(600, 11); c.fillText(k, px + 6, py + 14);
      c.fillStyle = col || C.white; c.font = font(700, 15); c.fillText(v, px + 6, py + 33); px += pw[i];
    });
    c.fillStyle = 'rgba(255,255,255,.6)'; c.font = font(600, 12); c.textAlign = 'center';
    c.fillText(`Lens: ${LENSES[S.lens][1]}.   WASD or ZQSD to walk, mouse to look, G guide, F scan, V lens, P autopilot, E sample, M 3D map`, W / 2, H - 76);
    // reticle
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(W / 2, H / 2, 9, 0.3, Math.PI - 0.3); c.stroke(); c.beginPath(); c.arc(W / 2, H / 2, 9, Math.PI + 0.3, -0.3); c.stroke();
    c.fillStyle = C.cyan; c.fillRect(W / 2 - 1, H / 2 - 1, 2, 2);
    // world markers for stops
    stops.forEach(s => {
      const gz = ground(s.x, s.y), p = project(s.x, s.y, gz + 8), d = Math.hypot(s.x - S.x, s.y - S.y), col = beaconColor(s), isT = s === tg;
      let { sx, sy } = p; let off = p.behind || sx < 40 || sx > W - 40 || sy < 90 || sy > H - 120;
      if (p.behind) { sx = W - sx; sy = H - sy; }
      if (off && !isT) return;
      if (off) {
        const ang = Math.atan2(sy - H / 2, sx - W / 2), rx = W / 2 - 70, ry = H / 2 - 120;
        sx = W / 2 + Math.cos(ang) * rx; sy = H / 2 + Math.sin(ang) * ry;
        c.save(); c.translate(sx, sy); c.rotate(ang); c.fillStyle = col; c.beginPath(); c.moveTo(16, 0); c.lineTo(2, -9); c.lineTo(2, 9); c.fill(); c.restore();
      }
      const r = isT ? 11 : 7, pulse = isT ? 1 + 0.15 * Math.sin(performance.now() / 200) : 1;
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(sx, sy - r * pulse); c.lineTo(sx + r * pulse, sy); c.lineTo(sx, sy + r * pulse); c.lineTo(sx - r * pulse, sy); c.closePath(); c.stroke();
      if (isT) { c.globalAlpha = 0.25; c.fillStyle = col; c.fill(); c.globalAlpha = 1; }
      c.fillStyle = col; c.font = font(700, isT ? 14 : 12); c.textAlign = 'center';
      c.fillText(`${s.home ? 'H' : s.id}  ${dist(d)}`, sx, sy - r - 8);
      if (isT && !off) { c.font = font(600, 12); c.fillStyle = 'rgba(240,250,255,.8)'; c.fillText(s.name, sx, sy + r + 16); }
    });
    // interaction prompt / work progress
    const near = nearStop();
    if (S.working) {
      const f = Math.min(1, (performance.now() - S.working.t0) / S.working.dur);
      panel(W / 2 - 170, H * 0.62, 340, 52, `Sampling ${S.working.stop.name}`.slice(0, 44));
      bar(W / 2 - 158, H * 0.62 + 32, 316, f, C.amber, 30);
    } else if (near && !S.done && !(near.home && S.visited.size === 0)) {
      c.font = font(700, 16); c.textAlign = 'center'; c.fillStyle = C.green;
      c.fillText(near.home ? 'Press E to end the EVA' : S.visited.has(near.id) ? `${near.name} sampled` : `Press E to sample ${near.name}`, W / 2, H * 0.62);
    }
    if (S.auto) { c.font = font(700, 14); c.fillStyle = C.cyan; c.textAlign = 'center'; c.fillText('Autopilot on the guide line. P to stop', W / 2, 100); }
    drawToasts();
  }
  function drawToasts() {
    const c = hctx, now = performance.now();
    for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].until < now) toasts.splice(i, 1);
    toasts.forEach((t, i) => {
      const y = H * 0.22 + i * 30, a = Math.min(1, (t.until - now) / 500);
      c.globalAlpha = a; c.font = font(700, 15); const w = c.measureText(t.text).width + 30;
      c.fillStyle = 'rgba(0,0,0,.72)'; c.fillRect(W / 2 - w / 2, y - 18, w, 26);
      c.fillStyle = t.color; c.fillRect(W / 2 - w / 2, y - 18, 3, 26); c.textAlign = 'center'; c.fillText(t.text, W / 2, y);
      c.globalAlpha = 1;
    });
  }
  // minimap (north-up, like a field survey map: imagery, route, Curiosity track, labelled stops)
  function drawMinimap(x0, y0, S0) {
    const c = hctx, Rm = 700, sc = S0 / (2 * Rm);
    c.save();
    c.beginPath(); c.roundRect(x0, y0, S0, S0, 6); c.fillStyle = '#1b1b1b'; c.fill(); c.clip();
    const k = 1024 / SIZE;
    c.drawImage(mmCv, (S.x - Rm) * k, (SIZE - S.y - Rm) * k, 2 * Rm * k, 2 * Rm * k, x0, y0, S0, S0);
    const mp = (x, y) => [x0 + (x - S.x + Rm) * sc, y0 + (S.y + Rm - y) * sc];
    const line = (pts, col, w, dash) => { c.beginPath(); pts.forEach((p, i) => { const [a, b] = mp(p[0], p[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    if (S.showTrack) trackRuns.forEach(r => line(r, C.violet, 2.5));
    const rt = K.route; if (S.showRoute && rt && !rt.error) line(rt.pts.map(p => [p.x, p.y]), C.route, 2.5);
    if (S.guide && S.path) line([[S.x, S.y], ...S.path.slice(1).map(q => [K.cellX(q), K.cellY(q)])], '#73b3e7', 2, [5, 4]);
    stops.forEach(s => {
      let [a, b] = mp(s.x, s.y); const inside = a > x0 + 6 && a < x0 + S0 - 6 && b > y0 + 6 && b < y0 + S0 - 6;
      a = Math.max(x0 + 10, Math.min(x0 + S0 - 10, a)); b = Math.max(y0 + 10, Math.min(y0 + S0 - 10, b));
      c.fillStyle = s.home ? '#1b1b1b' : S.visited.has(s.id) ? C.green : '#ffffff';
      c.beginPath(); c.arc(a, b, 7, 0, 7); c.fill(); if (s.home) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); } c.fillStyle = s.home ? '#fff' : '#1b1b1b'; c.font = font(800, 11); c.textAlign = 'center'; c.fillText(s.home ? 'H' : s.id, a, b + 4);
      if (inside) {
        c.font = font(600, 11); const txt = (s.home ? 'Habitat' : s.name).slice(0, 22), w = c.measureText(txt).width + 10;
        c.fillStyle = 'rgba(255,255,255,.95)'; c.fillRect(a + 10, b - 9, w, 17); c.fillStyle = '#1b1b1b'; c.textAlign = 'left'; c.fillText(txt, a + 15, b + 4);
      }
    });
    c.save(); c.translate(x0 + S0 / 2, y0 + S0 / 2); c.rotate(S.h);
    c.fillStyle = '#ff5a52'; c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -10); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); c.fill(); c.stroke();
    c.globalAlpha = 0.18; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 60, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); c.fill(); c.restore();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.beginPath(); c.roundRect(x0, y0, S0, S0, 6); c.stroke();
    c.fillStyle = C.white; c.font = font(800, 13); c.textAlign = 'center'; c.fillText('N', x0 + S0 / 2, y0 + 15);
    c.fillStyle = 'rgba(220,240,245,.85)'; c.font = font(600, 11); c.textAlign = 'left';
    c.fillRect(x0 + 10, y0 + S0 - 12, 200 * sc, 2); c.fillText('200 m', x0 + 10, y0 + S0 - 16);
  }

  // ---------- map-mode labels (DOM, like a 3D survey map) ----------
  const lblEls = new Map();
  function updateLabels() {
    if (mode !== 'map') return;
    const items = [...stops.map(s => ({ key: s.id, s, x: s.x, y: s.y })), { key: 'you', x: S.x, y: S.y }];
    items.forEach(it => {
      let e = lblEls.get(it.key);
      if (!e) { e = mk('div', 'ml', labels); lblEls.set(it.key, e); }
      const s = it.s;
      e.className = 'ml' + (s ? (s.home ? ' home' : S.visited.has(s.id) ? ' done' : '') : ' you');
      e.innerHTML = s ? `<i>${s.home ? 'H' : s.id}</i>${s.home ? 'Habitat' : s.name}` : '<i>●</i>You';
      const p = project(it.x, it.y, ground(it.x, it.y) + 3);
      e.style.display = p.behind ? 'none' : 'flex';
      it.e = e; it.sx = p.sx * hs; it.sy = p.sy * hs; it.w = e.offsetWidth || 120; it.vis = !p.behind;
    });
    // declutter: push overlapping labels upward (the stem grows)
    const placed = [];
    items.filter(i => i.vis).sort((a, b) => b.sy - a.sy).forEach(it => {
      let lift = 0;
      for (let tries = 0; tries < 12; tries++) {
        const top = it.sy - 58 - lift, hit = placed.find(q => Math.abs(q.sx - it.sx) < (q.w + it.w) / 2 + 4 && Math.abs(q.top - top) < 30);
        if (!hit) break; lift += 32;
      }
      placed.push({ sx: it.sx, w: it.w, top: it.sy - 58 - lift });
      it.e.style.setProperty('--lift', lift + 'px');
      it.e.style.transform = `translate(${it.sx}px, ${it.sy - lift}px)`;
    });
  }
  function drawMapHUD() {
    const c = hctx; c.setTransform(dpr * hs, 0, 0, dpr * hs, 0, 0); c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.96)'; c.fillRect(16, 16, 360, 112);
    c.font = font(800, 16); c.fillStyle = '#1b1b1b'; c.textAlign = 'left';
    c.fillText('3D survey map, boxwork, Mount Sharp', 28, 40);
    c.font = font(500, 12); c.fillStyle = '#58585b';
    c.fillText(`USGS 1 m terrain, height ×${exag}, HiRISE and CTX imagery`, 28, 60);
    const lg = [['#ffffff', 'Planned route (least effort)'], ['#bdbdc0', "Curiosity's path (NASA)"], ['#73b3e7', 'Guide line to the next stop']];
    lg.forEach(([col, t], i) => { c.fillStyle = col; c.fillRect(28, 71 + i * 17, 18, 5); c.strokeStyle = '#8c8c8f'; c.lineWidth = 1; c.strokeRect(28, 71 + i * 17, 18, 5); c.fillStyle = '#58585b'; c.fillText(t, 54, 77 + i * 17); });
    c.fillStyle = '#58585b'; c.textAlign = 'center';
    c.fillText('Drag to rotate, right-drag to pan, wheel to zoom, double-click to place the astronaut, M for the helmet view', W / 2, H - 18);
    drawToasts();
  }

  // ---------- loop ----------
  let raf = 0, last = 0, visible = false, tU = 0, lastLens = '';
  function updateSun() {
    const hour = P.start + S.t, a = mode === 'map' ? Math.PI * 0.32 : Math.PI * (hour - 6.2) / 12.3;
    const day = Math.max(0, Math.min(1, Math.sin(a) * 2.2 + 0.1));
    const dir = new THREE.Vector3(Math.cos(a), Math.max(0.05, Math.sin(a)), -0.28).normalize();
    const fc = mode === 'pov' ? toW(S.x, S.y, ground(S.x, S.y)) : O.target.clone(); sun.target.position.copy(fc); sun.position.copy(fc).addScaledVector(dir, 6000);
    sun.intensity = 0.1 + 3.0 * day; hemi.intensity = 0.15 + 0.55 * day;
    sky.material.uniforms.sunDir.value.copy(dir); sky.material.uniforms.day.value = day;
    fog.color.setRGB(0.80 * (0.06 + 0.94 * day), 0.62 * (0.06 + 0.94 * day), 0.45 * (0.06 + 0.94 * day));
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000 || 0)); last = now; tU += dt;
    if (mode === 'pov') {
      step(dt, now);
      const g = ground(S.x, S.y), bob = S.speed > 0 ? Math.sin(S.bob) * 0.035 : 0;
      camera.position.copy(toW(S.x, S.y, g + K.EYE + S.z + bob));
      camera.rotation.set(S.pitch, -S.h, 0);
      sky.position.copy(camera.position);
    } else {
      const ce = Math.cos(O.el);
      camera.position.set(O.target.x + O.dist * ce * Math.sin(O.az), O.target.y + O.dist * Math.sin(O.el), O.target.z + O.dist * ce * Math.cos(O.az));
      camera.lookAt(O.target);
    }
    updatePath(now); if (mode === 'pov') { updateDetail(); updatePebbles(); updatePatch(); }
    R.guide.visible = S.guide && !!S.path; R.route.visible = S.showRoute; R.track.visible = S.showTrack;
    R.guide.material.uniforms.uTime.value = tU * 0.9;
    beacons.children.forEach(b => {
      b.children[1].rotation.y = tU; b.children[1].position.y = 6 + Math.sin(tU * 2) * 0.6;
      const st = b.userData.stop; b.children[0].visible = mode === 'map' || Math.hypot(st.x - S.x, st.y - S.y) > 4;   // don't look out through a beam you stand in
    });
    if (S.scan) {
      const t = (now - S.scan.t0) / 1000;
      U_.scanR.value = Math.min(650, t * 320); U_.scanFade.value = Math.max(0, 1 - Math.max(0, t - 6) / 4);
      U_.lensAmt.value = S.lens ? 0.75 : 0.8 * U_.scanFade.value;
      if (t > 10) { S.scan = null; U_.scanOn.value = 0; if (!S.lens) { U_.lensAmt.value = 0; lensKey = 'imagery'; } else buildLens(LENSES[S.lens][0]); }
    }
    if (texDirty && now - lastFlush > 600) {
      texDirty = false; lastFlush = now; tex.needsUpdate = true;
      const m = mmCv.getContext('2d'); m.drawImage(imgCv, 0, 0, 1024, 1024);
      if (lensKey !== 'imagery') { m.globalAlpha = 0.6; m.imageSmoothingEnabled = true; m.drawImage(lensCv, 0, 0, 1024, 1024); m.globalAlpha = 1; }
    }
    if (lensKey !== lastLens) { lastLens = lensKey; texDirty = true; }
    updateSun();
    dust.position.copy(camera.position); dust.rotation.y += dt * 0.02;
    composer.render();
    if (mode === 'pov') drawHUD(); else drawMapHUD();
    updateLabels();
  }
  help.innerHTML = `<div class="hc"><h3>Helmet view</h3><p>Click to take control</p>
    <dl class="keys"><dt>WASD or ZQSD</dt><dd>walk</dd><dt>Mouse</dt><dd>look around</dd><dt>Shift</dt><dd>boost, time ×4</dd>
    <dt>Space</dt><dd>jump, at Mars gravity (0.38 g)</dd><dt>G</dt><dd>guide line to the next stop</dd><dt>F</dt><dd>terrain scan, hazards and contours</dd>
    <dt>V</dt><dd>data lens</dd><dt>E</dt><dd>collect a sample, end the EVA</dd><dt>P</dt><dd>autopilot along the guide line</dd><dt>M</dt><dd>3D survey map</dd>
    <dt>1 2 3</dt><dd>time ×1, ×5, ×20</dd><dt>Esc</dt><dd>free the mouse</dd></dl></div>`;

  setMode('pov');
  return {
    show(on) {
      visible = on; root.style.display = on ? 'block' : 'none';
      if (on) { resize(); rebuildStatic(); rebuildBeacons(); S.pathCell = -1; last = performance.now(); raf = requestAnimationFrame(frame); help.style.display = mode === 'pov' ? 'flex' : 'none'; }
      else { cancelAnimationFrame(raf); document.exitPointerLock?.(); }
    },
    setMode: m => { setMode(m); onChange(); },
    setLens: i => { setLens(i); onChange(); },
    setWarp: w => setWarp(w),
    setExag: v => { exag = v; if (mode === 'map') setMode('map'); },
    set: (k, v) => { S[k] = v; if (k === 'showRocks') rocks.visible = v && mode === 'pov'; if (k === 'guide') S.pathCell = -1; onChange(); },
    scan: startScan, reset,
    get state() { return { mode, guide: S.guide, showRoute: S.showRoute, showTrack: S.showTrack, lens: S.lens, warp: S.warp, x: S.x, y: S.y, t: S.t, tilesLoaded, tilesTotal }; },
    // render a still from an exact camera pose (used to compare with real rover photos); terrain only, no illustrative rocks
    still({ x, y, eye = 1.95, fwd, up, fovV, w, h, offH = h, hour }) {
      const vis = [rocks.visible, pebbles.visible, beacons.visible, R.guide.visible, R.route.visible, R.track.visible, dust.visible];
      rocks.visible = pebbles.visible = beacons.visible = R.guide.visible = R.route.visible = R.track.visible = dust.visible = false;
      const tSave = S.t, sx = S.x, sy = S.y; if (hour != null) S.t = hour - P.start; S.x = x; S.y = y; updateSun(); updateDetail();
      const n2t = v => new THREE.Vector3(v[1], -v[2], -v[0]);
      camera.position.copy(toW(x, y, ground(x, y) + eye)); camera.up.copy(n2t(up)); camera.lookAt(camera.position.clone().add(n2t(fwd)));
      camera.fov = fovV; camera.aspect = w / offH; camera.setViewOffset(w, offH, 0, 0, w, h); camera.updateProjectionMatrix();
      sky.position.copy(camera.position);
      renderer.setPixelRatio(1); renderer.setSize(w, h, false); composer.setPixelRatio?.(1); composer.setSize(w, h);
      composer.render(); const url = renderer.domElement.toDataURL('image/png');
      camera.clearViewOffset(); camera.fov = 70; camera.up.set(0, 1, 0);
      [rocks.visible, pebbles.visible, beacons.visible, R.guide.visible, R.route.visible, R.track.visible, dust.visible] = vis;
      S.t = tSave; S.x = sx; S.y = sy; renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); composer.setPixelRatio?.(Math.min(2, devicePixelRatio || 1)); resize();
      return url;
    },
    LENSES, _dbg: { camera, scene, S, terrain, ground, tex, world, frame, O, keys, R, setMode, hi, M, imgCv, bloom, sun, hemi, renderer, fog, U_ },
  };
}
