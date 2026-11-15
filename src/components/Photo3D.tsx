// Photo3D: "step inside Curiosity's photo".
// A rover raw image is re-projected into 3D using a monocular depth map
// (Depth Anything V2 Small, see pipeline/depth/README_depth.md). Every vertex of a
// 256x256 grid is pushed out along its own camera ray, so the neutral pose reproduces
// the photo exactly and parallax appears only when the virtual camera moves.
//
// Depth PNG encoding: 8-bit normalised relative inverse depth, 255 = nearest, 0 = far/sky.
// Self-contained: inline styles only (falls back if the app's CSS variables are missing).
// Note: the `components` MCP library was not reachable when this was written, so the
// glass-pill / vignette styling follows the app's existing tokens instead.
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

type Props = {
  image: string;
  depth: string;
  caption?: string;
  /** vertical field of view of the photo in degrees (default: inferred from the file name) */
  fov?: number;
  /** far/near distance ratio used to turn relative inverse depth into geometry (default 5) */
  depthRange?: number;
  style?: CSSProperties;
};

const SEG = 256;

/** Navcam (NLB_/NRB_...) has a 45 deg square FOV. Mastcam frames are ~5-11 deg, which makes
 *  parallax nearly invisible, so they get a wider *virtual* FOV (the effect is illustrative). */
function inferFov(path: string): number {
  const f = path.split('/').pop() ?? '';
  if (/^N[LR][AB]_/.test(f)) return 45;
  if (/DXXX/.test(f) || /M[LR]\d/.test(f)) return 30;
  return 40;
}

const vert = /* glsl */ `
  uniform sampler2D uDepth;
  uniform vec2 uTan;        // tan(half fov) x, y of the source photo
  uniform float uInvNear;
  uniform float uInvFar;
  uniform float uPivot;     // distance of the flat (2D) plane
  uniform float uStrength;  // 0 = flat photo, 1 = full depth
  uniform vec2 uTexel;
  varying vec2 vUv;
  varying float vEdge;
  varying float vDepth;
  float zOf(float d) { return 1.0 / mix(uInvFar, uInvNear, d); }
  void main() {
    vUv = uv;
    float d = texture2D(uDepth, uv).r;
    float dx = abs(texture2D(uDepth, uv + vec2(uTexel.x, 0.0)).r - texture2D(uDepth, uv - vec2(uTexel.x, 0.0)).r);
    float dy = abs(texture2D(uDepth, uv + vec2(0.0, uTexel.y)).r - texture2D(uDepth, uv - vec2(0.0, uTexel.y)).r);
    vEdge = max(dx, dy);
    vDepth = d;
    float z = mix(uPivot, zOf(d), uStrength);
    vec2 ndc = uv * 2.0 - 1.0;
    vec3 p = vec3(ndc * uTan * z, -z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Raw passthrough of the sRGB texel (textures use NoColorSpace, Canvas is flat + linear),
// so 2D and 3D modes match the original JPEG exactly.
const frag = /* glsl */ `
  uniform sampler2D uImage;
  uniform float uStrength;
  varying vec2 vUv;
  varying float vEdge;
  varying float vDepth;
  void main() {
    vec3 c = texture2D(uImage, vUv).rgb;
    // depth discontinuities become stretched "rubber" triangles when the camera moves:
    // shade them slightly so they read as shadowed gaps rather than smears
    float e = smoothstep(0.05, 0.22, vEdge) * uStrength;
    c *= 1.0 - 0.38 * e;
    // whisper of aerial perspective on far terrain (only in 3D)
    c = mix(c, c * 0.92 + vec3(0.035, 0.028, 0.024), (1.0 - vDepth) * 0.35 * uStrength);
    gl_FragColor = vec4(c, 1.0);
  }
`;

type Motion = {
  target: number; // 1 = 3D, 0 = 2D
  mode: number; // eased
  hover: boolean;
  hx: number; hy: number; // hover position, -1..1
  dragging: boolean;
  dx: number; dy: number; // drag offset
  ox: number; oy: number; // smoothed camera offset
  reduced: boolean;
};

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function Scene({ img, dep, vfov, aspect, range, motion }: {
  img: THREE.Texture; dep: THREE.Texture; vfov: number; aspect: number; range: number; motion: RefObject<Motion>;
}) {
  const camera = useThree((st) => st.camera);
  const size = useThree((st) => st.size);
  const viewAspect = size.width / Math.max(1, size.height);
  // cover-fit: if the box is not the photo's aspect, crop instead of stretching
  const coverV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov / 2)) * Math.min(1, aspect / viewAspect)));
  const near = 1;
  const far = near * range;
  const pivot = 2 / (1 / near + 1 / far); // harmonic middle of the depth range
  const tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2));
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1, SEG, SEG), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uImage: { value: img },
      uDepth: { value: dep },
      uTan: { value: new THREE.Vector2(tanV * aspect, tanV) },
      uInvNear: { value: 1 / near },
      uInvFar: { value: 1 / far },
      uPivot: { value: pivot },
      uStrength: { value: 0 },
      uTexel: { value: new THREE.Vector2(1 / SEG, 1 / SEG) },
    },
  }), [img, dep, tanV, aspect, far, pivot]);
  useEffect(() => () => { geo.dispose(); }, [geo]);
  useEffect(() => () => { mat.dispose(); }, [mat]);

  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, rawDt) => {
    const m = motion.current;
    if (!m) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    m.mode += (m.target - m.mode) * (1 - Math.exp(-dt * 2.6));
    const s = smoother(clamp(m.mode, 0, 1));

    if (!m.dragging) { m.dx *= Math.exp(-dt * 1.4); m.dy *= Math.exp(-dt * 1.4); }
    const sway = m.reduced ? 0 : 1;
    let tx = sway * (0.55 * Math.sin(t * 0.31) + 0.18 * Math.sin(t * 0.83 + 1.3));
    let ty = sway * (0.35 * Math.sin(t * 0.23 + 0.7) + 0.10 * Math.sin(t * 0.61));
    if (m.hover && !m.dragging) { tx = tx * 0.25 + m.hx * 0.8; ty = ty * 0.25 + m.hy * 0.6; }
    tx = clamp(tx + m.dx, -1.25, 1.25);
    ty = clamp(ty + m.dy, -1.0, 1.0);
    const k = 1 - Math.exp(-dt * (m.dragging ? 9 : 3.2));
    m.ox += (tx - m.ox) * k;
    m.oy += (ty - m.oy) * k;

    // camera: dolly in a touch, translate within a small "head box", always look at the pivot
    const amp = near * 0.095 * s * Math.min(1, tanV / Math.tan(THREE.MathUtils.degToRad(22.5)));
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(m.ox * amp, m.oy * amp * 0.65, -near * 0.14 * s);
    look.set(m.ox * amp * 0.15, m.oy * amp * 0.1, -pivot);
    cam.lookAt(look);
    const fov = THREE.MathUtils.lerp(coverV, coverV * 0.86, s);
    if (Math.abs(cam.fov - fov) > 1e-4 || cam.aspect !== viewAspect) {
      cam.fov = fov; cam.aspect = viewAspect; cam.updateProjectionMatrix();
    }
    mat.uniforms.uStrength.value = s;
  });

  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
}

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

type TexState = { key: string; img?: THREE.Texture; dep?: THREE.Texture; aspect?: number; failed?: boolean };
function useTextures(image: string, depth: string): TexState {
  const [state, setState] = useState<TexState>({ key: '' });
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string) => new Promise<THREE.Texture>((res, rej) => loader.load(url, res, undefined, rej));
    const key = image + '|' + depth;
    Promise.all([load(image), load(depth)]).then(([img, dep]) => {
      if (!alive) { img.dispose(); dep.dispose(); return; }
      img.colorSpace = THREE.NoColorSpace;
      img.anisotropy = 8;
      img.minFilter = THREE.LinearMipmapLinearFilter;
      dep.colorSpace = THREE.NoColorSpace;
      dep.generateMipmaps = false;
      dep.minFilter = THREE.LinearFilter;
      dep.magFilter = THREE.LinearFilter;
      const el = img.image as HTMLImageElement;
      setState({ key, img, dep, aspect: el.naturalWidth / el.naturalHeight });
    }).catch(() => { if (alive) setState({ key, failed: true }); });
    return () => { alive = false; };
  }, [image, depth]);
  useEffect(() => () => { state.img?.dispose(); state.dep?.dispose(); }, [state]);
  return state.key === image + '|' + depth ? state : { key: '' };
}

const glass: CSSProperties = {
  background: 'rgba(14,16,20,.52)',
  backdropFilter: 'blur(14px) saturate(140%)',
  WebkitBackdropFilter: 'blur(14px) saturate(140%)',
  border: '1px solid rgba(255,255,255,.10)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), 0 6px 18px rgba(0,0,0,.35)',
};

export default function Photo3D({ image, depth, caption, fov, depthRange = 5, style }: Props) {
  const tex = useTextures(image, depth);
  const vfov = fov ?? inferFov(image);
  const wrap = useRef<HTMLDivElement>(null);
  const [is3D, setIs3D] = useState(true);
  const [visible, setVisible] = useState(true);
  const [interacted, setInteracted] = useState(false);
  const [glFailed, setGlFailed] = useState(false);
  const motion = useRef<Motion>({
    target: 1, mode: 0, hover: false, hx: 0, hy: 0, dragging: false, dx: 0, dy: 0, ox: 0, oy: 0,
    reduced: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  });
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => { motion.current.target = is3D ? 1 : 0; }, [is3D]);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const aspect = tex.aspect ?? 1;
  const ready = !!(tex.img && tex.dep) && !glFailed;
  const fallbackImg = <img src={image} alt={caption ?? 'Rover photo'} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;

  const rel = (e: RPointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1), w: r.width, h: r.height };
  };
  const onMove = (e: RPointerEvent) => {
    const m = motion.current; const p = rel(e);
    if (m.dragging) {
      m.dx = clamp(m.dx + ((e.clientX - last.current.x) / p.w) * 3.2, -1.4, 1.4);
      m.dy = clamp(m.dy - ((e.clientY - last.current.y) / p.h) * 2.4, -1.1, 1.1);
      last.current = { x: e.clientX, y: e.clientY };
    } else if (e.pointerType === 'mouse') { m.hover = true; m.hx = p.x; m.hy = p.y; }
  };
  const onDown = (e: RPointerEvent) => {
    const m = motion.current; m.dragging = true; last.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (!interacted) setInteracted(true);
  };
  const onUp = () => { motion.current.dragging = false; };
  const onLeave = () => { motion.current.hover = false; };

  return (
    <figure style={{ margin: 0, ...style }}>
      <div
        ref={wrap}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
        style={{
          position: 'relative', width: '100%', aspectRatio: String(aspect), overflow: 'hidden', borderRadius: 12,
          background: '#07080a', cursor: is3D && ready ? 'grab' : 'default', touchAction: 'pan-y', userSelect: 'none',
          border: '1px solid var(--line, #232831)', isolation: 'isolate', maxHeight: '70vh',
        }}
      >
        {fallbackImg}
        {ready && (
          <GLBoundary fallback={null} onError={() => setGlFailed(true)}>
            <div style={{ position: 'absolute', inset: 0, animation: 'p3d-in .9s cubic-bezier(.2,.7,.2,1) both' }}>
              <Canvas
                flat linear
                dpr={[1, 2]}
                frameloop={visible ? 'always' : 'never'}
                gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
                camera={{ fov: vfov, near: 0.02, far: 100, position: [0, 0, 0] }}
                onCreated={({ gl }) => gl.setClearColor('#07080a')}
                style={{ position: 'absolute', inset: 0 }}
              >
                <Scene img={tex.img!} dep={tex.dep!} vfov={vfov} aspect={aspect} range={depthRange} motion={motion} />
              </Canvas>
            </div>
          </GLBoundary>
        )}
        {/* vignette + inner rim light */}
        <div aria-hidden style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 12,
          background: 'radial-gradient(120% 95% at 50% 45%, transparent 55%, rgba(0,0,0,.42) 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05), inset 0 -40px 60px -30px rgba(0,0,0,.55)',
        }} />

        {ready && <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', padding: 3, borderRadius: 999, ...glass }} role="group" aria-label="View mode">
          {(['3D', '2D'] as const).map((k) => {
            const on = (k === '3D') === is3D;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setIs3D(k === '3D')}
                style={{
                  font: '600 11px/1 var(--mono, ui-monospace, Menlo, monospace)', letterSpacing: '.12em',
                  padding: '6px 11px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  color: on ? '#fff3ea' : 'rgba(235,230,221,.62)',
                  background: on ? 'linear-gradient(180deg, rgba(224,112,58,.95), rgba(190,82,36,.95))' : 'transparent',
                  boxShadow: on ? '0 2px 10px rgba(224,112,58,.35), inset 0 1px 0 rgba(255,255,255,.25)' : 'none',
                  transition: 'background .35s cubic-bezier(.2,.7,.2,1), color .35s',
                }}
              >{k}</button>
            );
          })}
        </div>}

        {is3D && ready && (
          <div style={{
            position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
            padding: '7px 12px', borderRadius: 999, font: '500 11.5px/1 var(--sans, system-ui, sans-serif)',
            color: 'rgba(255,255,255,.88)', opacity: interacted ? 0 : 1, transition: 'opacity .6s ease .1s',
            animation: interacted ? undefined : 'p3d-hint 4.5s ease 1.2s both', ...glass,
          }}>Drag to look around</div>
        )}

        <div style={{
          position: 'absolute', left: 10, bottom: 10, right: 10, display: 'flex', pointerEvents: 'none',
        }}>
          <span style={{
            padding: '5px 9px', borderRadius: 8, font: '500 10.5px/1.3 var(--sans, system-ui, sans-serif)',
            color: 'rgba(235,230,221,.82)', maxWidth: '100%', ...glass,
            opacity: is3D && ready ? 1 : 0, transform: is3D && ready ? 'none' : 'translateY(4px)', transition: 'opacity .4s, transform .4s',
          }}>
            <span style={{ color: 'var(--mars, #e0703a)', fontWeight: 700 }}>●</span>{' '}
            Depth estimated by AI (Depth Anything V2) — illustrative, not measured
          </span>
        </div>
        <style>{`
          @keyframes p3d-in { from { opacity: 0; filter: blur(6px); } to { opacity: 1; filter: blur(0); } }
          @keyframes p3d-hint { 0% { opacity: 0; } 15% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }
        `}</style>
      </div>
      {caption && (
        <figcaption style={{ fontSize: 11, color: 'var(--muted, #8d939d)', marginTop: 4, fontFamily: 'var(--mono, ui-monospace, Menlo, monospace)' }}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
