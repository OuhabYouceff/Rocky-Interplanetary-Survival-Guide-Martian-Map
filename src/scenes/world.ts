// The real ground, in 3D. Three nested meshes, all from USGS / NASA data that Rocky already ships:
//   far    32 km around the site, 64 m heights (hi/far.bin), CTX + HiRISE mosaic imagery (public/terrain/far.jpg)
//   site   the 3.2 km walk area, 6 m heights from the 3 m planning grid (elev.bin), HiRISE colour orthophoto at 1 m
//   patch  the ground the scene happens on, 1 m heights (hi/dem) drawn every 2 m, HiRISE colour at 50 cm (hi/img)
// World axes: X east, Y up, Z south, metres, origin at the centre of the walk area. No vertical exaggeration.
// An "overlay" canvas (one pixel per 1.5 m of the walk area) is blended onto the ground for map layers.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Grid } from '../planner/fields';

export interface Meta { w: number; h: number; res: number; zmin: number; zscale: number; lat_top: number; lat_bottom: number; lon_left: number; lon_right: number }
interface Hi { size_m: number; dem: { n: number; tile: number; tiles: number; offset: number; scale: number }; img: { tile: number; tiles: number; res_m: number }; far: { n: number; res_m: number; offset: number; scale: number } }

const bin = (u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.arrayBuffer(); });
const image = (u: string) => new Promise<HTMLImageElement>((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error(u)); im.src = u; });

export const SUN = new THREE.Vector3(-.74, .62, -.26).normalize();   // towards the sun: from the west, as in the HiRISE images

let skyEnvTex: THREE.Texture | null = null;
/** The sky dome's colours as a small equirectangular picture, for reflections (envMap) on visors and suits. Shared, made once. */
export function skyEnv() {
  if (skyEnvTex) return skyEnvTex;
  const w = 128, h = 64, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d')!, im = cx.createImageData(w, h), d = new THREE.Vector3();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const th = (j + .5) / h * Math.PI, ph = (i + .5) / w * Math.PI * 2;      // three's equirect: u = atan(dir.z, dir.x), v = asin(dir.y)
    d.set(-Math.sin(th) * Math.cos(ph), Math.cos(th), -Math.sin(th) * Math.sin(ph));
    let r, g, b;
    if (d.y >= 0) { const t = Math.pow(d.y, .55); r = .85 + (.56 - .85) * t; g = .69 + (.43 - .69) * t; b = .55 + (.35 - .55) * t; const s = Math.pow(Math.max(0, d.dot(SUN)), 14) ; r += .22 * s; g += .2 * s; b += .16 * s; }
    else { const t = Math.min(1, -d.y * 4); r = .62 - .2 * t; g = .42 - .14 * t; b = .3 - .1 * t; }   // the ground below the horizon: dusty brown
    const k = (j * w + i) * 4; im.data[k] = Math.min(255, r * 255); im.data[k + 1] = Math.min(255, g * 255); im.data[k + 2] = Math.min(255, b * 255); im.data[k + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return (skyEnvTex = t);
}

/** A tiling normal map of grit and small stones, made in code (no photo): only its slopes are used, to light the ground near
 *  the camera. Seeded, so every scene gets the same one. Heights are in texels; channels r, g = x, z slope. */
function detailNormals(n = 256) {
  const h = new Float32Array(n * n); let seed = 20261;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let s = 0; s < 1100; s++) {                                  // pebbles of 1 to 12 texels, a few small pits
    const cx = rnd() * n, cy = rnd() * n, r = 1 + rnd() ** 2.2 * 11, a = r * (.25 + rnd() * .45) * (rnd() < .12 ? -.6 : 1), R = Math.ceil(r * 2);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = (Math.floor(cx) + dx + n) % n, y = (Math.floor(cy) + dy + n) % n, q = ((Math.floor(cx) + dx - cx) ** 2 + (Math.floor(cy) + dy - cy) ** 2) / (r * r);
      if (q < 4) h[y * n + x] += a * Math.exp(-q * 1.6);
    }
  }
  for (let i = 0; i < n * n; i++) h[i] += (rnd() - .5) * .6;          // fine grit
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const gx = (h[y * n + (x + 1) % n] - h[y * n + (x + n - 1) % n]) / 2, gy = (h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x]) / 2, l = Math.hypot(gx, gy, 1), k = (y * n + x) * 4;
    d[k] = (-gx / l * .5 + .5) * 255; d[k + 1] = (-gy / l * .5 + .5) * 255; d[k + 2] = 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

export async function makeWorld(stage: HTMLElement, patchAt: (w: { meta: Meta; z3: Float32Array; cellXZ: (c: number) => [number, number] }) => Promise<{ x: number; z: number; size: number }>) {
  const [meta, hi] = await Promise.all([fetch('data/terrain.json').then((r) => r.json()) as Promise<Meta>, fetch('data/hi/meta.json').then((r) => r.json()) as Promise<Hi>]);
  const { w: W, h: H, res } = meta, SIZE = W * res, HALF = SIZE / 2;
  const q = new Uint16Array(await bin('data/elev.bin')), z3 = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z3[i] = q[i] === 0 ? NaN : meta.zmin + (q[i] - 1) * meta.zscale;
  const grid: Grid = { w: W, h: H, res, z: z3 };
  const cellXZ = (c: number): [number, number] => [((c % W) + .5) * res - HALF, (Math.floor(c / W) + .5) * res - HALF];
  const cellAt = (x: number, z: number) => Math.max(0, Math.min(H - 1, Math.floor((z + HALF) / res))) * W + Math.max(0, Math.min(W - 1, Math.floor((x + HALF) / res)));

  // ---- the 1 m patch -------------------------------------------------------------------------------------------
  const P = await patchAt({ meta, z3, cellXZ }), STEP = 2, pn = Math.floor(P.size / STEP) + 1, px0 = P.x - P.size / 2, pz0 = P.z - P.size / 2;
  const T = hi.dem.tile, tiles = new Map<number, Uint16Array>();
  { const c0 = Math.floor((px0 + HALF) / T), c1 = Math.floor((px0 + P.size + HALF) / T), r0 = Math.floor((pz0 + HALF) / T), r1 = Math.floor((pz0 + P.size + HALF) / T), jobs: Promise<void>[] = [];
    for (let r = Math.max(0, r0); r <= Math.min(hi.dem.tiles - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(hi.dem.tiles - 1, c1); c++)
      jobs.push(bin(`data/hi/dem/${r}_${c}.bin`).then((b) => { tiles.set(r * 100 + c, new Uint16Array(b)); }).catch(() => undefined));
    await Promise.all(jobs); }
  const dem1 = (x: number, z: number) => {                         // nearest 1 m sample; NaN where the tile is missing
    const c = Math.max(0, Math.min(hi.dem.n - 1, Math.round(x + HALF - .5))), r = Math.max(0, Math.min(hi.dem.n - 1, Math.round(z + HALF - .5)));
    const t = tiles.get(Math.floor(r / T) * 100 + Math.floor(c / T)); if (!t) return NaN;
    const v = t[(r % T) * T + (c % T)]; return v === 0 ? NaN : hi.dem.offset + v * hi.dem.scale;
  };
  const y3 = (x: number, z: number) => {                           // bilinear on the 3 m grid
    const fx = Math.max(0, Math.min(W - 1.001, (x + HALF) / res - .5)), fz = Math.max(0, Math.min(H - 1.001, (z + HALF) / res - .5));
    const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * W + c;
    const a = z3[i], b = z3[i + 1], d = z3[i + W], e = z3[i + W + 1];
    if (!(a === a && b === b && d === d && e === e)) return [a, b, d, e].find((v) => v === v) ?? meta.zmin;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
  };
  const ph = new Float32Array(pn * pn);
  for (let j = 0; j < pn; j++) for (let i = 0; i < pn; i++) { const x = px0 + i * STEP, z = pz0 + j * STEP, v = dem1(x, z); ph[j * pn + i] = v === v ? v : y3(x, z); }
  const ZREF = y3(P.x, P.z);
  /** Height of the drawn ground at a world position, metres above the scene's reference level. */
  const ground = (x: number, z: number) => {
    const fx = (x - px0) / STEP, fz = (z - pz0) / STEP;
    if (fx >= 0 && fz >= 0 && fx < pn - 1 && fz < pn - 1) {      // on the patch: the same two triangles per 2 m square the mesh draws
      const c = Math.floor(fx), r = Math.floor(fz), tx = fx - c, tz = fz - r, i = r * pn + c, b = ph[i + 1], d = ph[i + pn];
      return (tx + tz <= 1 ? ph[i] + (b - ph[i]) * tx + (d - ph[i]) * tz : ph[i + pn + 1] + (d - ph[i + pn + 1]) * (1 - tx) + (b - ph[i + pn + 1]) * (1 - tz)) - ZREF;
    }
    return y3(x, z) - ZREF;
  };

  // ---- renderer, sky, light --------------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 1, 60000);
  const HAZE = new THREE.Color(0xd9b08c);
  scene.fog = new THREE.Fog(HAZE, 1800, 30000);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(45000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 sun; varying vec3 vD;
      void main(){ float h = clamp(vD.y, 0., 1.);
        vec3 c = mix(vec3(.85, .69, .55), vec3(.56, .43, .35), pow(h, .55));      // butterscotch at the horizon, darker overhead
        c += vec3(.22, .2, .16) * pow(max(dot(vD, sun), 0.), 14.);                // forward-scattered glow around the sun
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  })));
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x8a5a3c, 1.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0006; sun.shadow.normalBias = .04;
  scene.add(sun, sun.target);
  /** Aim the shadow box at the part of the scene that has figures in it. */
  const lightOn = (c: THREE.Vector3, radius: number) => {
    sun.target.position.copy(c); sun.position.copy(c).addScaledVector(SUN, 400);
    const s = sun.shadow.camera; s.left = s.bottom = -radius; s.right = s.top = radius; s.near = 50; s.far = 900; s.updateProjectionMatrix();
  };

  // ---- the three ground meshes -------------------------------------------------------------------------------------
  const OV = 2132, ocv = document.createElement('canvas'); ocv.width = ocv.height = OV;
  const octx = ocv.getContext('2d')!, otex = new THREE.CanvasTexture(ocv); otex.colorSpace = THREE.SRGBColorSpace; otex.anisotropy = 8;
  // Close-up ground: the colour is only ever the real image. What changes is lighting: (a) on the patch the slopes come from the
  // real 1 m DEM (the mesh is drawn every 2 m), (b) within ~25 m of the camera a tiling normal map of grit and pebbles (made in
  // code, see detailNormals) adds small-scale shading that fades out with distance, (c) relief shading is a little stronger.
  const detail = detailNormals(), maxAniso = renderer.capabilities.getMaxAnisotropy();
  const mat = (map: THREE.Texture, hole: [number, number, number, number] | null, overlay: boolean, near?: { dem?: THREE.Texture; x0: number; z0: number; size: number }) => {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    if (near) m.defines = { GROUND_NEAR: '', ...(near.dem ? { DEM_NORMALS: '' } : {}) };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uOverlay = { value: otex }; sh.uniforms.uHole = { value: new THREE.Vector4(...(hole ?? [1, 1, -1, -1])) }; sh.uniforms.uSize = { value: SIZE }; sh.uniforms.uOn = { value: overlay ? 1 : 0 };
      sh.uniforms.uDetail = { value: detail }; sh.uniforms.uDem = { value: near?.dem ?? null }; sh.uniforms.uDemBox = { value: new THREE.Vector3(near?.x0 ?? 0, near?.z0 ?? 0, near?.size ?? 1) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform sampler2D uOverlay, uDetail, uDem; uniform vec4 uHole; uniform vec3 uDemBox; uniform float uSize, uOn;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          #ifdef GROUND_NEAR
          { vec3 nW = inverseTransformDirection(normal, viewMatrix);
            #ifdef DEM_NORMALS
            vec2 duv = (vWp.xz - uDemBox.xy) / uDemBox.z;
            if (duv.x > 0. && duv.y > 0. && duv.x < 1. && duv.y < 1.) { vec3 dn = texture2D(uDem, duv).rgb; nW = normalize(vec3(dn.r * 2. - 1., dn.b, dn.g * 2. - 1.)); }
            #endif
            nW = normalize(vec3(nW.x * 1.3, nW.y, nW.z * 1.3));                       // slightly stronger relief
            float fade = 1. - smoothstep(12., 34., distance(vWp, cameraPosition));
            if (fade > 0.) { vec2 d = (texture2D(uDetail, vWp.xz / 3.7).rg * 2. - 1.) * .65 + (texture2D(uDetail, vWp.xz / 1.13 + .31).rg * 2. - 1.) * .45;
              nW = normalize(nW + vec3(d.x, 0., d.y) * fade); }
            normal = normalize((viewMatrix * vec4(nW, 0.)).xyz); }
          #endif`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (vWp.x > uHole.x && vWp.x < uHole.z && vWp.z > uHole.y && vWp.z < uHole.w) discard;
          vec2 ouv = vec2(vWp.x / uSize + .5, .5 - vWp.z / uSize);
          if (uOn > .5 && ouv.x > 0. && ouv.x < 1. && ouv.y > 0. && ouv.y < 1.) { vec4 ov = texture2D(uOverlay, ouv); diffuseColor.rgb = mix(diffuseColor.rgb, ov.rgb, ov.a); }`);
    };
    return m;
  };
  const tex = (im: TexImageSource) => { const t = im instanceof HTMLCanvasElement ? new THREE.CanvasTexture(im) : new THREE.Texture(im as HTMLImageElement); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.needsUpdate = true; return t; };
  /** A square heightfield mesh: n x n vertices, side metres wide, centred at (cx, cz); uv covers the square, north at v = 1. */
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

  const fq = new Uint16Array(await bin('data/hi/far.bin')), FN = hi.far.n, FSIDE = (FN - 1) * hi.far.res_m;
  const [farIm, orthoIm] = await Promise.all([image('terrain/far.jpg'), image('data/ortho.jpg')]);
  // the far field sits a little low so it never pokes through the finer meshes at their shared edges
  const far = new THREE.Mesh(field(FN, FSIDE, 0, 0, (i, j) => hi.far.offset + fq[j * FN + i] * hi.far.scale - ZREF - 6), mat(tex(farIm), [-HALF + 90, -HALF + 90, HALF - 90, HALF - 90], false));
  const SN = Math.floor(W / 2);
  const site = new THREE.Mesh(field(SN, (SN - 1) * 2 * res, -res / 2, -res / 2, (i, j) => { const v = z3[(j * 2) * W + i * 2]; return (v === v ? v : meta.zmin) - ZREF - .6; }),
    mat(tex(orthoIm), [px0 + 6, pz0 + 6, px0 + P.size - 6, pz0 + P.size - 6], true, { x0: 0, z0: 0, size: 1 }));
  // 50 cm colour for the patch, drawn from the dataset's tiles
  const mpp = hi.img.res_m, IP = Math.min(4096, Math.round(P.size / mpp)), icv = document.createElement('canvas'); icv.width = icv.height = IP;
  { const ic = icv.getContext('2d')!, k = IP / P.size, tm = hi.img.tile * mpp, jobs: Promise<void>[] = [];
    ic.drawImage(orthoIm, (px0 + HALF) / SIZE * orthoIm.width, (pz0 + HALF) / SIZE * orthoIm.height, P.size / SIZE * orthoIm.width, P.size / SIZE * orthoIm.height, 0, 0, IP, IP);   // fallback under the tiles
    for (let r = Math.max(0, Math.floor((pz0 + HALF) / tm)); r <= Math.min(hi.img.tiles - 1, Math.floor((pz0 + P.size + HALF) / tm)); r++)
      for (let c = Math.max(0, Math.floor((px0 + HALF) / tm)); c <= Math.min(hi.img.tiles - 1, Math.floor((px0 + P.size + HALF) / tm)); c++)
        jobs.push(image(`data/hi/img/${r}_${c}.jpg`).then((im) => { ic.drawImage(im, (c * tm - HALF - px0) * k, (r * tm - HALF - pz0) * k, tm * k + .5, tm * k + .5); }).catch(() => undefined));
    await Promise.all(jobs); }
  // slopes of the real 1 m DEM over the patch, as a normal texture (x, y, z in r, b, g; row = south)
  const DN = Math.round(P.size) + 1, dn = new Uint8Array(DN * DN * 4);
  { const hh = new Float32Array(DN * DN);
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) { const x = px0 + i, z = pz0 + j, v = dem1(x, z); hh[j * DN + i] = v === v ? v : y3(x, z); }
    for (let j = 0; j < DN; j++) for (let i = 0; i < DN; i++) {
      const gx = (hh[j * DN + Math.min(DN - 1, i + 1)] - hh[j * DN + Math.max(0, i - 1)]) / 2, gz = (hh[Math.min(DN - 1, j + 1) * DN + i] - hh[Math.max(0, j - 1) * DN + i]) / 2, l = Math.hypot(gx, 1, gz), k = (j * DN + i) * 4;
      dn[k] = (-gx / l * .5 + .5) * 255; dn[k + 1] = (-gz / l * .5 + .5) * 255; dn[k + 2] = (1 / l) * 255; dn[k + 3] = 255;
    } }
  const demTex = new THREE.DataTexture(dn, DN, DN); demTex.generateMipmaps = true; demTex.minFilter = THREE.LinearMipmapLinearFilter; demTex.magFilter = THREE.LinearFilter; demTex.anisotropy = maxAniso; demTex.needsUpdate = true;
  const patch = new THREE.Mesh(field(pn, (pn - 1) * STEP, px0 + (pn - 1) * STEP / 2, pz0 + (pn - 1) * STEP / 2, (i, j) => ph[j * pn + i] - ZREF), mat(tex(icv), null, true, { dem: demTex, x0: px0 - .5, z0: pz0 - .5, size: DN }));
  patch.receiveShadow = true; site.receiveShadow = true;
  scene.add(far, site, patch);

  // ---- things scenes put on the ground ---------------------------------------------------------------------------
  const at = (x: number, z: number, lift = 0) => new THREE.Vector3(x, ground(x, z) + lift, z);
  const cellPos = (c: number, lift = 0) => { const [x, z] = cellXZ(c); return at(x, z, lift); };
  /** A flat ribbon lying on the ground along a path of world XZ points: drawn like a painted line, lit by the sun, soft-edged
   *  and slightly see-through; its solid core is narrower close to the camera and the full width far away. `lift` is the height
   *  above the drawn ground; the line is also pulled a little towards the camera in depth so bumps do not cut through it. */
  const ribbon = (pts: [number, number][], width: number, color: number, opacity = 1, lift = .04) => {
    const fine: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2)); for (let k = 0; k < n; k++) fine.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
    fine.push(pts[pts.length - 1]);
    // smooth the stair-steps of a grid path
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < fine.length - 1; i++) fine[i] = [(fine[i - 1][0] + fine[i][0] * 2 + fine[i + 1][0]) / 4, (fine[i - 1][1] + fine[i][1] * 2 + fine[i + 1][1]) / 4];
    // then resample every metre so the line follows the ground's 2 m triangles closely
    const even: [number, number][] = [fine[0]];
    for (let i = 1; i < fine.length; i++) { const [ax, az] = fine[i - 1], [bx, bz] = fine[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az))); for (let k = 1; k <= n; k++) even.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
    const pos: number[] = [], across: number[] = [], idx: number[] = [];
    even.forEach(([x, z], i) => {
      const [px, pz] = even[Math.max(0, i - 1)], [nx, nz] = even[Math.min(even.length - 1, i + 1)], l = Math.hypot(nx - px, nz - pz) || 1, ox = -(nz - pz) / l * width / 2, oz = (nx - px) / l * width / 2;
      pos.push(x + ox, ground(x + ox, z + oz) + lift, z + oz, x - ox, ground(x - ox, z - oz) + lift, z - oz); across.push(-1, 1);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('across', new THREE.Float32BufferAttribute(across, 1)); g.setIndex(idx); g.computeVertexNormals();
    const mt = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false });
    mt.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float across; varying float vAcross, vDist;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vAcross = across; vDist = length(mvPosition.xyz);
          { float pull = clamp(vDist * .006, .1, 3.); gl_Position = projectionMatrix * vec4(mvPosition.xyz * (1. - pull / max(vDist, .01)), 1.); }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAcross, vDist;')
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          { float a = abs(vAcross), core = mix(.42, .8, smoothstep(10., 90., vDist)), soft = max(fwidth(a) * 1.2, mix(.16, .08, smoothstep(10., 90., vDist)));
            diffuseColor.a *= .82 * (1. - smoothstep(core - soft, core + soft, a)); diffuseColor.rgb *= .86; }`);
    };
    const m = new THREE.Mesh(g, mt); m.receiveShadow = true; m.renderOrder = 1;
    scene.add(m); return m;
  };
  const chips: { el: HTMLElement; p: THREE.Vector3 }[] = [];
  /** A label pinned to a point in the world. */
  const chip = (html: string, p: THREE.Vector3, cls = '') => { const el = document.createElement('div'); el.className = `chip ${cls}`; el.innerHTML = html; stage.append(el); chips.push({ el, p }); return el; };

  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 8; controls.maxDistance = 9000;
  const tick: ((t: number, dt: number) => void)[] = [];
  const size = () => { const w = stage.clientWidth, h = stage.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  addEventListener('resize', size); size();
  const v = new THREE.Vector3(); let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    for (const f of tick) f(now / 1000, dt);
    controls.update();
    // keep the camera above the ground
    const gy = ground(camera.position.x, camera.position.z) + 1.5; if (camera.position.y < gy) camera.position.y = gy;
    renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const c of chips) { v.copy(c.p).project(camera); const on = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1; c.el.style.display = on ? '' : 'none'; if (on) { c.el.style.left = `${(v.x * .5 + .5) * w}px`; c.el.style.top = `${(-v.y * .5 + .5) * h}px`; } }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { meta, grid, z3, W, H, res, SIZE, scene, camera, renderer, controls, ground, at, cellXZ, cellPos, cellAt, ribbon, chip, lightOn, tick,
    overlay: { canvas: ocv, ctx: octx, size: OV, update: () => { otex.needsUpdate = true; } } };
}
export type World = Awaited<ReturnType<typeof makeWorld>>;
