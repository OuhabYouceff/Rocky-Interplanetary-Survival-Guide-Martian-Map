// Mars globe: CesiumJS on the Mars ellipsoid (the engine NASA JPL's Mars Trek is built on).
// One continuous globe from orbit to the ground, with the Atlas on it:
//   imagery  Viking colour (global) / MOLA elevation / THEMIS thermal, CTX 5 m, HiRISE grey + colour, the Rocky site in colour
//   overlay  IAU place names, live Curiosity and Perseverance traverses and stops, the EVA site
//   tools    search, pick (place / rover stop / point), distance measuring, a scripted intro flight
import './cesiumSetup';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export type BaseKey = 'colour' | 'elevation' | 'thermal';
export type RoverKey = 'MSL' | 'M20';
export interface Stop { sol: number; lat: number; lon: number; km?: number }
export interface Rover { key: RoverKey; name: string; css: string; land: string; stops: Stop[]; km: number }
export type Pick =
  | { kind: 'place'; name: string; lat: number; lon: number; type: string; dia: number; origin: string }
  | { kind: 'rover'; rover: Rover; stop: Stop }
  | { kind: 'site' }
  | { kind: 'point'; lat: number; lon: number };
export interface Suggestion { t: string; sub: string; go: () => void }
export interface IntroHooks { caption: (text: string | null) => void; dive?: () => void; done: () => void; holdMs?: number }
export interface Intro { skip(): void; dive(): void }

export interface GlobeHandle {
  flyTo(lat: number, lon: number, km: number, pitchDeg?: number): void;
  flyToSite(): void;
  home(): void;
  setBase(k: BaseKey): void;
  setMeasure(on: boolean): void;
  clearMeasure(): void;
  search(q: string): Suggestion[];
  playIntro(h: IntroHooks): Intro;       // title hold in orbit (planet on the right), then the dive
  rovers(): Rover[];
  nearest(lat: number, lon: number, n?: number): { name: string; type: string; km: number }[];
  destroy(): void;
}
interface Opts {
  siteRect: [number, number, number, number];
  aimLeft?: boolean;                          // landing: planet sits right of centre while the title is on screen
  onSite: () => void;
  onHeight: (km: number) => void;
  onReady?: () => void;
  onPick?: (p: Pick | null) => void;
  onMeasure?: (metres: number, points: number) => void;
}

const TREK = (id: string, ext: string) => `https://trek.nasa.gov/tiles/Mars/EQ/${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const BASE = import.meta.env.BASE_URL;
const GALE = { lon: 137.4, lat: -5.4 };          // crater centre (IAU gazetteer)
const MPD = (2 * Math.PI * 3389500) / 360;       // metres per degree on the mean Mars sphere
const BASES: Record<BaseKey, { id: string; ext: string; max: number; credit: string }> = {
  colour: { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7, credit: 'Viking colour mosaic: NASA/USGS via Mars Trek' },
  elevation: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', max: 7, credit: 'MOLA colour shaded relief: NASA/JPL/GSFC via Mars Trek' },
  thermal: { id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', ext: 'png', max: 9, credit: 'THEMIS day IR: NASA/JPL/ASU via Mars Trek' },
};
type NameRow = [string, number, number, string, number, string, string];

export function createMarsGlobe(el: HTMLElement, opts: Opts): GlobeHandle {
  const E = Cesium.Ellipsoid.MARS;
  Cesium.Ellipsoid.default = E;
  const viewer = new Cesium.Viewer(el, {
    baseLayer: false, globe: new Cesium.Globe(E), mapProjection: new Cesium.GeographicProjection(E),
    skyAtmosphere: new Cesium.SkyAtmosphere(E),
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    requestRenderMode: true, maximumRenderTimeChange: Infinity,   // render only when something changes (camera, tiles, data)
  });
  const scene = viewer.scene, camera = viewer.camera, globe = scene.globe;
  const redraw = () => { if (!viewer.isDestroyed()) scene.requestRender(); };
  globe.showGroundAtmosphere = false;          // required for imagery on a non-Earth ellipsoid
  globe.baseColor = Cesium.Color.fromCssColorString('#2b1a12');
  globe.enableLighting = false;                // the mosaics already carry the sun's shading
  globe.maximumScreenSpaceError = 2;
  globe.tileCacheSize = 400;
  if (scene.skyAtmosphere) { scene.skyAtmosphere.hueShift = -0.12; scene.skyAtmosphere.saturationShift = -0.35; scene.skyAtmosphere.brightnessShift = -0.25; }
  scene.fog.enabled = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 1500;
  scene.screenSpaceCameraController.maximumZoomDistance = 40_000_000;
  const deg = (lon: number, lat: number, h = 0) => Cesium.Cartesian3.fromDegrees(lon, lat, h, E);

  // ---------- imagery (finer layers only load when close: minimumTerrainLevel) ----------
  const geo = new Cesium.GeographicTilingScheme({ ellipsoid: E });
  const L = viewer.imageryLayers;
  const baseLayer = (k: BaseKey) => new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: TREK(BASES[k].id, BASES[k].ext), tilingScheme: geo, maximumLevel: BASES[k].max, credit: BASES[k].credit }));
  // a stored 2048x1024 Viking mosaic shows the planet at once while the Mars Trek tiles stream in
  Cesium.SingleTileImageryProvider.fromUrl(BASE + 'data/mars_2k.jpg', { rectangle: Cesium.Rectangle.MAX_VALUE, credit: 'Viking colour mosaic: NASA/USGS' })
    .then((p) => { if (viewer.isDestroyed()) return; const l = new Cesium.ImageryLayer(p); L.add(l); L.lowerToBottom(l); redraw(); }).catch(() => {});
  let base = baseLayer('colour'); L.add(base);
  const ctx = new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}', tilingScheme: geo, tileWidth: 512, tileHeight: 512, maximumLevel: 12, credit: 'CTX: NASA/JPL/MSSS, Caltech Murray Lab' }), { minimumTerrainLevel: 5 });
  L.add(ctx); ctx.alpha = 0;
  const HIRISE_RECT = Cesium.Rectangle.fromDegrees(137.1224669, -4.9254743, 137.7298129, -4.2489588);
  L.add(new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: TREK('curiosity_hirise_mosaic', 'png'), tilingScheme: geo, minimumLevel: 10, maximumLevel: 16, rectangle: HIRISE_RECT, credit: 'HiRISE: NASA/JPL/UArizona via Mars Trek' }), { minimumTerrainLevel: 9, alpha: 0.75 }));
  // colour HiRISE along Curiosity's traverse: the basemap of NASA's "Where is Curiosity?" map (MMGIS, TMS, Mercator)
  L.add(new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({ url: 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/MSL_Gale_HiRISE-LRGB_78quads/{z}/{x}/{reverseY}.png',
    tilingScheme: new Cesium.WebMercatorTilingScheme({ ellipsoid: E }), minimumLevel: 10, maximumLevel: 16, rectangle: HIRISE_RECT, credit: 'HiRISE colour: NASA/JPL/UArizona, NASA MMGIS' }), { minimumTerrainLevel: 9 }));
  const [w, s, e, n] = opts.siteRect;
  let orthoAdded = false;   // the 3 MB site image loads only once the camera comes below 600 km
  const addOrtho = () => { if (orthoAdded) return; orthoAdded = true;
    Cesium.SingleTileImageryProvider.fromUrl(BASE + 'data/ortho.jpg', { rectangle: Cesium.Rectangle.fromDegrees(w, s, e, n), credit: 'HiRISE colour: USGS / NASA/JPL/UArizona' })
      .then((p) => { if (!viewer.isDestroyed()) { L.add(new Cesium.ImageryLayer(p, { minimumTerrainLevel: 8 })); redraw(); } }).catch(() => {}); };

  // ---------- place names (USGS/IAU gazetteer); a label shows when it faces the camera ----------
  const labels = scene.primitives.add(new Cesium.LabelCollection());
  const named: { l: Cesium.Label; p: Cesium.Cartesian3 }[] = [];
  let NAMES: NameRow[] = [];
  fetch(BASE + 'data/mars_names.json').then((r) => r.json()).then((j: { items: NameRow[] }) => {
    if (viewer.isDestroyed()) return;
    NAMES = j.items;
    for (const row of j.items) {
      const [name, lat, lon, type, dia, origin] = row;
      const big = dia >= 300, p = deg(lon, lat);
      const l = labels.add({
        position: p, text: name, font: `${big ? 600 : 500} ${big ? 15 : 12}px Inter, "Public Sans", sans-serif`,
        fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,.85)'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER, verticalOrigin: Cesium.VerticalOrigin.CENTER,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, dia > 0 ? Math.min(8e6, Math.max(5e4, dia * 1000 * (el.clientWidth < 700 ? 8 : 16))) : 3e4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        id: { kind: 'place', name, lat, lon, type, dia, origin } satisfies Pick,
      });
      named.push({ l, p });
    }
    cull(); redraw();
  }).catch(() => {});
  const cull = () => {
    const c = camera.positionWC;
    for (const { l, p } of named) { const d = Cesium.Cartesian3.subtract(c, p, new Cesium.Cartesian3()); l.show = Cesium.Cartesian3.dot(d, p) > 0; }
  };
  camera.percentageChanged = 0.02;
  camera.changed.addEventListener(cull);

  // ---------- rovers: traverses, stops and current position (NASA MMGIS, live) ----------
  const lines = scene.primitives.add(new Cesium.PolylineCollection());
  const stopPts = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const ROVERS: Rover[] = [
    { key: 'MSL', name: 'Curiosity', css: '#ffffff', land: '6 August 2012', stops: [], km: 0 },
    { key: 'M20', name: 'Perseverance', css: '#73b3e7', land: '18 February 2021', stops: [], km: 0 },
  ];
  let mslPath: Cesium.Cartesian3[] = [];
  const mslLines: Cesium.Polyline[] = [];
  const roversReady = Promise.all(ROVERS.map(async (r) => {
    try {
      // live from NASA MMGIS, with the copy stored in public/data/rovers when the feed is slow, down or refuses the client
      const live = `https://mars.nasa.gov/mmgis-maps/${r.key}/Layers/json/${r.key}`, local = `${BASE}data/rovers/${r.key}`;
      const get = (f: string) => fetch(`${live}_${f}.json`).then((x) => { if (!x.ok) throw new Error(String(x.status)); return x.json(); })
        .catch(() => fetch(`${local}_${f}.json`).then((x) => x.json()));
      const [tr, wp] = await Promise.all([get('traverse'), get('waypoints')]);
      if (viewer.isDestroyed()) return;
      const colour = Cesium.Color.fromCssColorString(r.css);
      const flat: number[] = [];   // one polyline per rover: the drives are consecutive, and one primitive draws far faster than thousands
      for (const f of tr.features as { geometry: { type: string; coordinates: number[][] | number[][][] } }[]) {
        const segs = (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates]) as number[][][];
        for (const seg of segs) for (const q of seg) flat.push(q[0], q[1], 60);
      }
      if (flat.length >= 6) {
        const pos = Cesium.Cartesian3.fromDegreesArrayHeights(flat, E);
        if (r.key === 'MSL') mslPath = pos;
        // a polyline expands each point into several vertices: keep each under the 16-bit index limit (~8000 points)
        for (let i = 0; i < pos.length - 1; i += 7999) {
          const pl = lines.add({ positions: pos.slice(i, i + 8000), width: 2.5, material: Cesium.Material.fromType('Color', { color: colour }) });
          if (r.key === 'MSL') mslLines.push(pl);
        }
      }
      r.stops = (wp.features as { properties: Record<string, number> }[]).map((f) => f.properties)
        .filter((p) => p.lat != null).map((p) => ({ sol: p.sol, lat: p.lat, lon: p.lon, km: p.dist_km ?? (p.dist_total_m != null ? p.dist_total_m / 1000 : undefined) }))
        .sort((a, b) => a.sol - b.sol);
      r.km = Math.max(0, ...r.stops.map((x) => x.km ?? 0));
      for (const st of r.stops) stopPts.add({ position: deg(st.lon, st.lat, 60), pixelSize: 5, color: colour, outlineColor: Cesium.Color.fromCssColorString('rgba(0,0,0,.6)'), outlineWidth: 1,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9e3), /* clickable stops: close up only */ disableDepthTestDistance: Number.POSITIVE_INFINITY, id: { kind: 'rover', rover: r, stop: st } satisfies Pick });
      const last = r.stops[r.stops.length - 1];
      if (last) viewer.entities.add({ position: deg(last.lon, last.lat, 60),
        point: { pixelSize: 10, color: colour, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e6) },
        label: { text: r.name, font: '700 13px Inter, sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -18), disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3e6) },
        properties: { pick: { kind: 'rover', rover: r, stop: last } satisfies Pick } });
      redraw();
    } catch (err) { console.warn(`${r.name} feed or drawing failed`, err); /* the globe works without it */ }
  }));

  // ---------- the EVA site ----------
  const site = viewer.entities.add({ rectangle: { coordinates: Cesium.Rectangle.fromDegrees(w, s, e, n), height: 80, fill: false, outline: true, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 } });
  const siteLabel = viewer.entities.add({ position: deg((w + e) / 2, n, 80),
    label: { text: 'Rocky EVA site', font: '700 14px Inter, sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -6),
      disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4e5) } });

  // ---------- measuring ----------
  let measuring = false; const mPts: Cesium.Cartesian3[] = [];
  const mLine = lines.add({ positions: [], width: 2.5, material: Cesium.Material.fromType('PolylineDash', { color: Cesium.Color.fromCssColorString('#D83933'), dashLength: 14 }) });
  const mDots = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const measureLength = () => {
    let m = 0; const g = new Cesium.EllipsoidGeodesic(undefined, undefined, E);
    for (let i = 1; i < mPts.length; i++) { g.setEndPoints(E.cartesianToCartographic(mPts[i - 1]), E.cartesianToCartographic(mPts[i])); m += g.surfaceDistance; }
    return m;
  };
  const redrawMeasure = () => {
    mLine.positions = mPts.map((p) => { const c = E.cartesianToCartographic(p); return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 80, E); });
    opts.onMeasure?.(measureLength(), mPts.length); redraw();
  };

  // ---------- picking ----------
  const click = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  click.setInputAction((m: { position: Cesium.Cartesian2 }) => {
    if (measuring) {
      const p = camera.pickEllipsoid(m.position, E); if (!p) return;
      mPts.push(p); mDots.add({ position: p, pixelSize: 8, color: Cesium.Color.fromCssColorString('#D83933'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      redrawMeasure(); redraw(); return;
    }
    const hit = scene.pick(m.position) as { id?: unknown } | undefined;
    if (hit?.id === site || hit?.id === siteLabel) { opts.onPick?.({ kind: 'site' }); opts.onSite(); return; }
    const id = hit?.id as (Pick | Cesium.Entity | undefined);
    if (id instanceof Cesium.Entity) { const pk = id.properties?.pick?.getValue(); if (pk) { opts.onPick?.(pk as Pick); return; } }
    else if (id && typeof id === 'object' && 'kind' in id) { opts.onPick?.(id as Pick); return; }
    const p = camera.pickEllipsoid(m.position, E);
    if (p) { const c = E.cartesianToCartographic(p); opts.onPick?.({ kind: 'point', lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) }); }
    else opts.onPick?.(null);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ---------- idle rotation, CTX fading in with altitude ----------
  let lastInput = -Infinity, intro = false;   // -Infinity: performance.now() starts at page load
  const touch = () => { lastInput = performance.now(); };
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) scene.canvas.addEventListener(ev, touch, { passive: true });
  let lastKm = -1, lastEmit = 0, spin = 0;
  scene.preRender.addEventListener(() => {
    const km = camera.positionCartographic.height / 1000;
    ctx.alpha = 0.55 * Math.min(1, Math.max(0, (900 - km) / 600));
    if (km < 600) addOrtho();   // grey CTX over the colour mosaic: detail from CTX, colour underneath
    const now = performance.now();
    if (now - lastEmit > 200 && Math.abs(km - lastKm) > lastKm * 0.01) { lastKm = km; lastEmit = now; opts.onHeight(km); }   // at most 5 updates a second
  });
  let readyFired = false;
  const rotate = () => {   // slow spin in orbit while nobody touches the globe; keeps drawing while tiles stream in
    spin = requestAnimationFrame(rotate);
    if (!globe.tilesLoaded) redraw();
    else if (!readyFired) { readyFired = true; opts.onReady?.(); }
    if (intro && !holding) return;
    if (camera.positionCartographic.height > 2.5e6 && performance.now() - lastInput > 8000) { camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.0007); redraw(); }
  };
  let holding = false;
  spin = requestAnimationFrame(rotate);

  const AIM = () => (opts.aimLeft && el.clientWidth > 900 ? 0.2 : 0);
  const ORBIT = () => deg(GALE.lon - 25, GALE.lat + 10, 11_500_000);
  camera.setView({ destination: ORBIT() }); camera.lookLeft(AIM());
  const fly = (dest: Cesium.Cartesian3, pitch: number, duration: number, complete?: () => void, heading = 0) =>
    camera.flyTo({ destination: dest, orientation: { heading: Cesium.Math.toRadians(heading), pitch: Cesium.Math.toRadians(pitch), roll: 0 }, duration, complete,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT });
  const SITE_VIEW = () => deg((w + e) / 2, s - 0.2, 18_000);

  if (import.meta.env.DEV) (window as unknown as { __rockyGlobe: unknown }).__rockyGlobe = { viewer, ROVERS, lines, get mslPath() { return mslPath.length; } };
  const handle: GlobeHandle = {
    flyTo(lat, lon, km, pitch = -90) { touch(); fly(deg(lon, lat, km * 1000), pitch, 3); },
    flyToSite() { touch(); fly(SITE_VIEW(), -38, 6); },
    home() { touch(); camera.flyTo({ destination: ORBIT(), duration: 4, complete: () => camera.lookLeft(AIM()) }); },
    setBase(k) { L.remove(base, true); base = baseLayer(k); L.add(base); L.lowerToBottom(base); redraw(); },
    setMeasure(on) { measuring = on; if (!on) handle.clearMeasure(); },
    clearMeasure() { mPts.length = 0; mDots.removeAll(); redrawMeasure(); },
    rovers: () => ROVERS,
    nearest(lat, lon, k = 3) {
      const r = (d: number) => (d * Math.PI) / 180, R = 3389.5;
      const dist = (a: number, b: number) => { const dl = r(a - lat), dn = r(b - lon); const x = Math.sin(dl / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(a)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(x))); };
      return NAMES.map((x) => ({ name: x[0], type: x[3], km: dist(x[1], x[2]) })).sort((a, b) => a.km - b.km).slice(0, k);
    },
    search(q) {
      const t = q.trim().toLowerCase(); if (!t) return [];
      const out: Suggestion[] = [];
      const ll = t.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([ns])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([ew])?$/i);
      if (ll) { const la = +ll[1] * (ll[2] === 's' ? -1 : 1); let lo = +ll[3] * (ll[4] === 'w' ? -1 : 1); if (lo > 180) lo -= 360;
        out.push({ t: `${Math.abs(la).toFixed(3)}° ${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(3)}° ${lo >= 0 ? 'E' : 'W'}`, sub: 'Coordinates', go: () => { handle.flyTo(la, lo, 60); opts.onPick?.({ kind: 'point', lat: la, lon: lo }); } }); }
      const sm = t.match(/^(?:(curiosity|msl|perseverance|percy|m20)\s*)?sol\s*(\d+)$/);
      if (sm) for (const r of ROVERS.filter((r) => !sm[1] || (/^(p|m20)/.test(sm[1]) ? r.key === 'M20' : r.key === 'MSL'))) {
        const sol = +sm[2]; const st = r.stops.reduce<Stop | null>((b, x) => (x.sol <= sol && (!b || x.sol >= b.sol) ? x : b), null);
        if (st) out.push({ t: `${r.name}, sol ${st.sol}`, sub: st.sol === sol ? 'Rover position' : `Last stop on or before sol ${sol}`, go: () => { handle.flyTo(st.lat, st.lon, 4, -60); opts.onPick?.({ kind: 'rover', rover: r, stop: st }); } });
      }
      if ('rocky marswalk eva site boxwork'.includes(t) || t.startsWith('eva')) out.push({ t: 'Rocky EVA site', sub: "Curiosity's boxwork, Mount Sharp", go: () => { handle.flyToSite(); opts.onPick?.({ kind: 'site' }); } });
      for (const r of ROVERS) if (r.name.toLowerCase().includes(t) && r.stops.length) { const st = r.stops[r.stops.length - 1];
        out.push({ t: r.name, sub: `Rover, latest sol ${st.sol}`, go: () => { handle.flyTo(st.lat, st.lon, 30, -60); opts.onPick?.({ kind: 'rover', rover: r, stop: st }); } }); }
      const hits = NAMES.filter((x) => x[0].toLowerCase().includes(t)).sort((a, b) => (Number(b[0].toLowerCase().startsWith(t)) - Number(a[0].toLowerCase().startsWith(t))) || b[4] - a[4]);
      for (const x of hits.slice(0, 8 - out.length)) out.push({ t: x[0], sub: `${x[3]}${x[4] ? `, ${x[4]} km` : ''}`, go: () => {
        handle.flyTo(x[1], x[2], Math.max(8, (x[4] || 5) * 2.4)); opts.onPick?.({ kind: 'place', name: x[0], lat: x[1], lon: x[2], type: x[3], dia: x[4], origin: x[5] }); } });
      return out.slice(0, 8);
    },
    // The opening sequence, after TETHER's demo film: title over Mars, then one dive from orbit to the site while
    // Curiosity's route draws itself on the ground.
    playIntro(h) {
      intro = true;
      let cancelled = false, timer = 0, raf = 0, release: (() => void) | null = null;
      const wait = (ms: number) => new Promise<void>((res) => { timer = window.setTimeout(res, ms); });
      const flyP = (dest: Cesium.Cartesian3, pitch: number, dur: number, heading = 0) => new Promise<void>((res) => fly(dest, pitch, dur, res, heading));
      const finish = () => {
        if (cancelled) return; cancelled = true; intro = false; clearTimeout(timer); cancelAnimationFrame(raf);
        mslLines.forEach((p) => { p.show = true; }); drawLine.show = false;
        holding = false; release?.(); release = null;
        camera.cancelFlight(); camera.setView({ destination: SITE_VIEW(), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-38), roll: 0 } });
        redraw(); h.caption(null); h.done();
      };
      // own collection: updating it must not rebuild the vertex buffers of both full traverses
      const drawLines = scene.primitives.add(new Cesium.PolylineCollection());
      const drawLine = drawLines.add({ positions: [], width: 3, material: Cesium.Material.fromType('Color', { color: Cesium.Color.WHITE }) });
      (async () => {
        // title hold: the planet turns on the right while the title reads on the left
        camera.setView({ destination: ORBIT() }); camera.lookLeft(AIM());
        holding = true; lastInput = -Infinity;
        await new Promise<void>((res) => { release = res; timer = window.setTimeout(res, h.holdMs ?? 6500); });
        holding = false; if (cancelled) return;
        h.dive?.();
        h.caption('Mars: 6,779 km across, about half the size of Earth.');
        await flyP(deg(GALE.lon, GALE.lat, 4_200_000), -90, 4.5); if (cancelled) return;
        const gale = NAMES.find((x) => x[0] === 'Gale');
        h.caption(`Gale crater: ${gale ? Math.round(gale[4]) : 154} km wide. Curiosity landed here on 6 August 2012.`);
        await flyP(deg(GALE.lon, GALE.lat - 1.1, 260_000), -62, 4.5); if (cancelled) return;
        await roversReady; if (cancelled) return;
        const msl = ROVERS[0], last = msl.stops[msl.stops.length - 1];
        h.caption(msl.stops.length ? `Curiosity's route so far: ${msl.km.toFixed(1)} km, sol 0 to sol ${last.sol.toLocaleString()}.` : "Curiosity's route up Mount Sharp.");
        mslLines.forEach((p) => { p.show = false; });
        const t0 = performance.now(), DRAW = 5200, step = Math.max(1, Math.ceil(mslPath.length / 3000));
        const thin = mslPath.filter((_, i) => i % step === 0);   // <= 3000 vertices for the animated line
        let lastDraw = 0;
        const draw = (now: number) => {
          if (cancelled) return;
          const f = Math.min(1, (now - t0) / DRAW);
          if (now - lastDraw > 130 || f === 1) { lastDraw = now; drawLine.positions = thin.slice(0, Math.max(2, Math.floor(f * thin.length))); redraw(); }
          if (f < 1) raf = requestAnimationFrame(draw);
        };
        if (thin.length > 1) raf = requestAnimationFrame(draw);
        await flyP(deg(137.39, -4.95, 52_000), -52, 5.2, 8); if (cancelled) return;
        h.caption("Its boxwork on Mount Sharp: the Rocky site, where every walk keeps a safe way home.");
        await flyP(SITE_VIEW(), -38, 4); if (cancelled) return;
        await wait(2600);
        finish();
      })();
      return { skip: finish, dive: () => { if (release) { clearTimeout(timer); release(); release = null; } } };
    },
    destroy() { cancelAnimationFrame(spin); click.destroy(); if (!viewer.isDestroyed()) viewer.destroy(); },
  };
  return handle;
}

export const metresPerDegree = MPD;
