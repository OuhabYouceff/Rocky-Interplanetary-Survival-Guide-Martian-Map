// Room-scale AR: Android Chrome = WebXR (floor scan with visible planes, reticle, tap to place, Mars rises from the floor);
// iPhone = AR Quick Look with the room-scale USDZ (Apple scans the floor itself); desktop = QR + downloads.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './room.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ROOM_GLB = './data/ar/tether_room.glb';
const ROOM_USDZ = './data/ar/tether_room.usdz';
const TABLE_USDZ = './data/ar/tether_demo.usdz';
const TABLE_GLB = './data/ar/tether_demo.glb';
const SIZES = [6, 3, 12];            // model widths in metres (the GLB is authored 6 m wide)

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);

function button(label: string, cls: string, onClick: (() => void) | null, href?: string, rel?: string) {
  const a = document.createElement(href ? 'a' : 'button') as HTMLAnchorElement & HTMLButtonElement;
  a.className = `btn ${cls}`; a.textContent = label;
  if (href) { a.href = href; if (rel) a.rel = rel; }
  if (onClick) a.addEventListener('click', (e) => { if (!href) e.preventDefault(); onClick(); });
  return a;
}

function quickLook(url: string) {
  const a = document.createElement('a'); a.rel = 'ar'; a.href = url; a.appendChild(document.createElement('img'));
  document.body.appendChild(a); a.click(); a.remove();
}

async function setup() {
  const actions = $('actions'), how = $('how');
  const xrOK = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  if (xrOK) {
    actions.append(button('Start AR: Mars in your room', 'primary', () => startXR()));
    how.textContent = 'Android: tap Start, move your phone slowly until a cyan grid covers the floor, then tap “Place Mars here”. Walk around and through it.';
  } else if (isIOS) {
    actions.append(button('Open Mars in your room (AR)', 'primary', () => quickLook(ROOM_USDZ)));
    actions.append(button('Small table model', 'alt', () => quickLook(TABLE_USDZ)));
    how.textContent = 'iPhone/iPad: tap the button, move your phone to scan the floor, and Mount Sharp appears at room scale. Walk around it; pinch to resize.';
  } else if (isAndroid) {
    const glb = new URL(ROOM_GLB, location.href).href;
    actions.append(button('Open in AR (Scene Viewer)', 'primary', null,
      `intent://arvr.google.com/scene-viewer/1.2?file=${encodeURIComponent(glb)}&mode=ar_only&resizable=true&title=${encodeURIComponent('Rocky, Mount Sharp')}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(location.href)};end;`));
    how.textContent = 'This browser has no WebXR AR, so Google’s Scene Viewer opens the model instead. For the full experience, open this page in Chrome.';
  } else {
    const qr = document.createElement('img'); qr.src = './data/ar/qr.png'; qr.className = 'qr'; qr.alt = 'QR code to this page';
    actions.append(qr, button('Download room-scale model (.glb)', 'alt', null, ROOM_GLB), button('Download table model (.glb)', 'alt', null, TABLE_GLB));
    how.textContent = 'On a computer: scan the QR code with a phone. Android Chrome gets the full floor-scanning experience; iPhone opens Apple’s AR Quick Look.';
  }
}

// ---------------- WebXR ----------------
let model: THREE.Object3D | null = null;
const loading = new GLTFLoader().loadAsync(ROOM_GLB).then((g) => { model = g.scene; return g.scene; });

async function startXR() {
  const overlay = $('overlay');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 60);
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2a1e, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-2, 4, 1.5); scene.add(sun);

  // reticle
  const reticle = new THREE.Group(); reticle.matrixAutoUpdate = false; reticle.visible = false;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.17, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fe3ff }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe0703a }));
  reticle.add(ring, dot); scene.add(reticle);

  // Mars holder
  const holder = new THREE.Group(); holder.visible = false; scene.add(holder);
  let sizeIdx = 0, placed = false, moving = true, riseT = -1;

  // detected floor planes (the visible "scan")
  const planeMeshes = new Map<XRPlane, THREE.Mesh>();
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  const planeEdge = new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.7 });

  const session = await navigator.xr!.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['dom-overlay', 'plane-detection', 'light-estimation'],
    domOverlay: { root: overlay },
  } as XRSessionInit);
  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);
  overlay.hidden = false; $('landing').hidden = true;
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = (await session.requestHitTestSource!({ space: viewer }))!;
  const ref = renderer.xr.getReferenceSpace()!;

  const hint = $('hint'), placeBtn = $('place'), controls = $('controls'), sizeBtn = $('size');
  const setHint = (t: string) => { hint.textContent = t; hint.hidden = !t; };

  const place = async () => {
    if (!reticle.visible) return;
    const m = model ?? await loading;
    if (!holder.children.length) holder.add(m);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    reticle.matrix.decompose(p, q, s);
    holder.position.copy(p);
    const cam = renderer.xr.getCamera(); const cp = new THREE.Vector3(); cam.getWorldPosition(cp);
    holder.rotation.set(0, Math.atan2(cp.x - p.x, cp.z - p.z) + Math.PI, 0);   // north edge away from the viewer
    holder.visible = true; placed = true; moving = false; riseT = 0;
    reticle.visible = false; placeBtn.hidden = true; controls.hidden = false;
    planeMeshes.forEach((pm) => (pm.visible = false));
    setHint('Walk around Mount Sharp. The cyan line is the planned Marswalk.');
    setTimeout(() => setHint(''), 6000);
  };
  placeBtn.addEventListener('click', place);
  session.addEventListener('select', () => { if (moving) place(); });
  $('rotL').addEventListener('click', () => (holder.rotation.y += Math.PI / 12));
  $('rotR').addEventListener('click', () => (holder.rotation.y -= Math.PI / 12));
  sizeBtn.addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; const k = SIZES[sizeIdx] / 6; holder.scale.set(k, k, k); sizeBtn.textContent = `${SIZES[sizeIdx]} m`; });
  $('move').addEventListener('click', () => { moving = true; placeBtn.hidden = false; controls.hidden = true; planeMeshes.forEach((pm) => (pm.visible = true)); setHint('Point at the floor, then tap “Place Mars here”.'); });
  $('exit').addEventListener('click', () => session.end());
  session.addEventListener('end', () => { renderer.setAnimationLoop(null); renderer.domElement.remove(); overlay.hidden = true; $('landing').hidden = false; });

  renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
    if (frame) {
      // visible floor scan
      const planes: Set<XRPlane> | undefined = (frame as XRFrame & { detectedPlanes?: Set<XRPlane> }).detectedPlanes;
      if (planes && !placed) planes.forEach((plane) => {
        if (plane.orientation !== 'horizontal') return;
        const pose = frame.getPose(plane.planeSpace, ref); if (!pose) return;
        let mesh = planeMeshes.get(plane);
        const pts = plane.polygon.map((v) => new THREE.Vector2(v.x, -v.z));
        if (!mesh || (mesh.userData.lastChanged !== plane.lastChangedTime)) {
          if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
          const g = new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2);
          mesh = new THREE.Mesh(g, planeMat); mesh.matrixAutoUpdate = false;
          mesh.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((v) => new THREE.Vector3(v.x, 0.002, -v.y))), planeEdge));
          mesh.userData.lastChanged = plane.lastChangedTime; planeMeshes.set(plane, mesh); scene.add(mesh);
        }
        mesh.matrix.fromArray(pose.transform.matrix);
      });
      // reticle from hit test
      if (moving) {
        const hits = frame.getHitTestResults(hitSource);
        if (hits.length) {
          const pose = hits[0].getPose(ref);
          if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); placeBtn.hidden = false; if (!placed) setHint('Floor found. Tap “Place Mars here”.'); }
        } else { reticle.visible = false; if (!placed) setHint('Scanning the floor… move your phone slowly'); }
        ring.scale.setScalar(1 + 0.08 * Math.sin(t / 250));
      }
    }
    // Mars rises out of the floor
    if (riseT >= 0 && riseT < 1) {
      riseT = Math.min(1, riseT + 1 / 90);
      const e = 1 - Math.pow(1 - riseT, 3); const k = SIZES[sizeIdx] / 6;
      holder.scale.set(k, k * Math.max(0.02, e), k);
    }
    renderer.render(scene, camera);
  });
}

setup();
