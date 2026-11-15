import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Dataset } from '../data';
import { useStore } from '../store';
import { fmtDist, fmtTime, type RouteSummary } from '../planner/summary';
import { Icon } from './ui';

const DS = 2; // mesh downsample relative to the planning grid

function useTerrain(data: Dataset) {
  return useMemo(() => {
    const { w, h, res } = data.meta;
    const gw = Math.floor(w / DS), gh = Math.floor(h / DS);
    const geo = new THREE.PlaneGeometry(gw * DS * res, gh * DS * res, gw - 1, gh - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const zmid = data.meta.zmin + 32500 * data.meta.zscale;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const z = data.z[(j * DS) * w + i * DS];
      pos.setY(j * gw + i, isNaN(z) ? -50 : z - zmid);
    }
    geo.computeVertexNormals();
    const tex = new THREE.Texture(data.ortho); tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { geo, tex, zmid, sizeX: gw * DS * res, sizeZ: gh * DS * res };
  }, [data]);
}

function cellToWorld(data: Dataset, cell: number, zmid: number, lift = 0): THREE.Vector3 {
  const { w, h, res } = data.meta;
  const cx = cell % w, cy = Math.floor(cell / w);
  return new THREE.Vector3((cx - w / 2) * res, data.z[cell] - zmid + lift, (cy - h / 2) * res);
}

function Rig({ path, t, follow }: { path: THREE.Vector3[]; t: number; follow: boolean }) {
  const { camera } = useThree();
  useFrame(() => {
    if (!follow || path.length < 2) return;
    const f = t * (path.length - 1); const i = Math.min(path.length - 2, Math.floor(f)); const u = f - i;
    const p = path[i].clone().lerp(path[i + 1], u);
    const ahead = path[Math.min(path.length - 1, i + 12)];
    const eye = p.clone().add(new THREE.Vector3(0, 1.75, 0));
    camera.position.lerp(eye, 0.35);
    const look = ahead.clone().add(new THREE.Vector3(0, 1.4, 0));
    const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    camera.quaternion.slerp(q, 0.12);
  });
  return null;
}

function Orbit({ center, active }: { center: THREE.Vector3; active: boolean }) {
  const { camera, gl } = useThree();
  const st = useRef({ az: 0.6, el: 0.55, r: 1400, drag: false, x: 0, y: 0 });
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { st.current.drag = true; st.current.x = e.clientX; st.current.y = e.clientY; };
    const up = () => { st.current.drag = false; };
    const move = (e: PointerEvent) => {
      if (!st.current.drag) return; const s = st.current;
      s.az -= (e.clientX - s.x) * 0.005; s.el = Math.min(1.45, Math.max(0.08, s.el + (e.clientY - s.y) * 0.004)); s.x = e.clientX; s.y = e.clientY;
    };
    const wheel = (e: WheelEvent) => { st.current.r = Math.min(4000, Math.max(80, st.current.r * Math.exp(e.deltaY * 0.001))); };
    el.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('pointermove', move); el.addEventListener('wheel', wheel, { passive: true });
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move); el.removeEventListener('wheel', wheel); };
  }, [gl]);
  useFrame(() => {
    if (!active) return; const s = st.current;
    const p = new THREE.Vector3(center.x + s.r * Math.cos(s.el) * Math.sin(s.az), center.y + s.r * Math.sin(s.el), center.z + s.r * Math.cos(s.el) * Math.cos(s.az));
    camera.position.lerp(p, 0.15); camera.lookAt(center);
  });
  return null;
}

// ---------------------------------------------------------------- voice (Web Speech API, no deps)
function useVoice(enabled: boolean) {
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => {
    if (!ok) return;
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      voiceRef.current = vs.find((v) => /Samantha|Google UK English Female|Karen|Moira|Serena/i.test(v.name))
        ?? vs.find((v) => v.lang?.startsWith('en-')) ?? null;
    };
    pick(); window.speechSynthesis.addEventListener?.('voiceschanged', pick);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', pick);
  }, [ok]);
  useEffect(() => { if (ok && !enabled) window.speechSynthesis.cancel(); }, [enabled, ok]);
  useEffect(() => () => { if (ok) window.speechSynthesis.cancel(); }, [ok]);
  return (text: string, urgent = false) => {
    (window as unknown as { __tetherVoiceLog?: string[] }).__tetherVoiceLog?.push(text);
    if (!ok || !enabled) return;
    const ss = window.speechSynthesis;
    if (ss.speaking || ss.pending) { if (!urgent) return; ss.cancel(); } // never queue stale callouts
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.rate = 1.04; u.pitch = 0.95; u.volume = 1;
    ss.speak(u);
  };
}

export default function Hud3D({ data, summary }: { data: Dataset; summary: RouteSummary | null }) {
  const terrain = useTerrain(data);
  const { fields, budget } = useStore();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const voiceArmed = useRef(false);
  const say = useVoice(voiceOn);

  const pts = useMemo(() => summary?.points ?? [], [summary]);
  const path = useMemo(() => pts.map((p) => cellToWorld(data, p.cell, terrain.zmid, 0.4)), [pts, data, terrain.zmid]);
  const tube = useMemo(() => {
    if (path.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(path.filter((_, i) => i % 2 === 0 || i === path.length - 1));
    return new THREE.TubeGeometry(curve, Math.min(4000, path.length * 2), 0.25, 6, false);
  }, [path]);

  useEffect(() => {
    if (!playing) return; let raf = 0; let last = performance.now();
    const step = (now: number) => { const dt = (now - last) / 1000; last = now; setT((v) => { const n = v + dt / 45; if (n >= 1) { setPlaying(false); return 1; } return n; }); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [playing]);

  const idx = pts.length ? Math.min(pts.length - 1, Math.round(t * (pts.length - 1))) : 0;
  const cur = pts[idx];
  const home = cur && fields ? fields.homeT[cur.cell] : NaN;
  const stopsAhead = cur ? summary!.points.slice(idx).find((p, k, a) => k > 0 && a[k - 1] && p.leg !== a[k - 1].leg) : undefined;
  const nextDist = stopsAhead && cur ? stopsAhead.dist - cur.dist : NaN;
  const T = budget.evaHours * 3600;
  const reserve = cur ? cur.margin : 1;
  // TETHER's tether state (upstream Hud3D): amber below 35% reserve, red (critical) below the reserve rule
  const rule = budget.reservePct / 100;
  const level: 'ok' | 'amb' | 'crit' = reserve < rule ? 'crit' : reserve < 0.35 ? 'amb' : 'ok';
  const tColor = level === 'crit' ? '#D83933' : level === 'amb' ? '#E5A000' : '#ffffff';

  // ---- voice callouts (ported from TETHER's Walk it (3D)): only during playback, only on downward crossings
  const vs = useRef({ idx: -1, decade: 10, level: 'ok' as string, leg: 0, turn: Infinity });
  useEffect(() => {
    const v = vs.current;
    if (!playing || !cur) { v.idx = idx; return; }
    if (v.idx < 0 || idx < v.idx) { v.idx = idx; v.decade = Math.ceil(reserve * 10); v.level = level; v.leg = cur.leg; v.turn = Infinity; return; }
    v.idx = idx;
    if (level !== v.level) {
      if (level === 'crit') say('Tether critical. Turn back now.', true);
      else if (level === 'amb' && v.level === 'ok') say(`Reserve ${Math.round(reserve * 100)} percent. Tether amber.`, true);
      v.level = level; return;
    }
    if (cur.leg !== v.leg) {
      const last = cur.leg === (summary?.points[summary.points.length - 1]?.leg ?? -1);
      say(last ? `Heading home. Walk home ${Math.max(1, Math.round(home / 60))} minutes.` : `Stop ${cur.leg} reached. Walk home ${Math.max(1, Math.round(home / 60))} minutes.`);
      v.leg = cur.leg; return;
    }
    // turn-back countdown: the next point on the plan where the reserve rule would be broken
    if (level !== 'crit') {
      const j = pts.findIndex((p, k) => k > idx && p.margin < rule);
      const mins = j > 0 ? Math.ceil((pts[j].t - cur.t) / 60) : Infinity;
      for (const th of [10, 5]) if (mins <= th && v.turn > th) { say(`Turn back in ${mins} minutes.`); v.turn = th; return; }
    }
    const dec = Math.ceil(reserve * 10);
    if (dec < v.decade) { v.decade = dec; if (dec <= 8 && level === 'ok') say(`Reserve ${dec * 10} percent.`); }
  }, [idx, playing]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasPlaying = useRef(false);
  useEffect(() => { if (playing) wasPlaying.current = true; else if (t < 1) wasPlaying.current = false; }, [playing, t]);
  const ended = t >= 1;
  useEffect(() => {
    if (ended && cur && voiceArmed.current && wasPlaying.current) say(`Airlock reached. Lowest reserve ${Math.round((summary?.minMargin ?? 0) * 100)} percent.`, true);
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!playing && typeof window !== 'undefined' && 'speechSynthesis' in window && t < 1) window.speechSynthesis.cancel(); }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPlay = () => {
    if (!playing && !voiceArmed.current) {
      voiceArmed.current = true; setVoiceOn(true);
      if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance('Tether linked.'); u.rate = 1.04; window.speechSynthesis.speak(u); }
    }
    if (t >= 1) setT(0); setPlaying(!playing); setFollow(true);
  };
  const center = useMemo(() => path[Math.floor(path.length / 2)] ?? new THREE.Vector3(), [path]);

  if (!summary || pts.length < 2) return (
    <div className="empty-state"><div><h2>No route to walk yet</h2><p>Add science stops on the Plan screen, or use the Autopilot, and the route will appear here in 3D.</p></div></div>
  );
  const tone = level === 'crit' ? 'tone-bad' : level === 'amb' ? 'tone-warn' : '';
  return (
    <div className="walk" style={{ height: '100%' }}>
      <Canvas camera={{ fov: 60, near: 0.5, far: 30000, position: [0, 800, 1400] }} gl={{ antialias: true }}>
        <color attach="background" args={['#c9a27e']} />
        <fog attach="fog" args={['#caa585', 800, 6000]} />
        <hemisphereLight args={['#ffe2c4', '#3b2a20', 0.9]} />
        <directionalLight position={[-800, 900, -400]} intensity={1.4} />
        <mesh geometry={terrain.geo}><meshStandardMaterial map={terrain.tex} roughness={1} metalness={0} /></mesh>
        {tube && <mesh geometry={tube}><meshBasicMaterial color={tColor} transparent opacity={0.9} /></mesh>}
        {path.length > 0 && (
          <mesh position={path[0].clone().add(new THREE.Vector3(0, 3, 0))}><coneGeometry args={[3, 6, 3]} /><meshBasicMaterial color="#D83933" /></mesh>
        )}
        <Rig path={path} t={t} follow={follow} />
        <Orbit center={center} active={!follow} />
      </Canvas>
      {cur && (
        <div className={`tether-chip ${level}`} role="status">
          <i className="dot" />
          <span>Tether · {level === 'crit' ? 'Critical, turn back' : level === 'amb' ? 'Amber' : 'Nominal'}</span>
        </div>
      )}
      {cur && follow && (
        <div className="hud" aria-live="off">
          <dl className="hud-tl">
            <dt>Suit time used</dt><dd>{fmtTime(cur.t)}</dd>
            <dt>Walk home from here</dt><dd>{fmtTime(home)}</dd>
          </dl>
          <dl className="hud-tr">
            <dt>Reserve</dt><dd className={tone}>{Math.round(reserve * 100)}%</dd>
            <div className="hud-bar"><i style={{ width: `${Math.max(0, Math.min(1, reserve)) * 100}%` }} /><b style={{ left: `${budget.reservePct}%` }} /></div>
          </dl>
          <dl className="hud-bl">
            <dt>Next stop</dt><dd>{isFinite(nextDist) ? fmtDist(nextDist) : 'Habitat'}</dd>
            <dt>Elevation</dt><dd className="sm">{Math.round(cur.z)} m, {cur.dose.toFixed(0)}% of open-sky dose</dd>
          </dl>
          <dl className="hud-br">
            <dt>Suit budget</dt><dd className="sm">{fmtTime(T)}, rule {budget.reservePct}%</dd>
          </dl>
          <div className="hud-reticle" />
        </div>
      )}
      <div className="walk-bar">
        <button className="btn primary" onClick={onPlay} aria-label={playing ? 'Pause' : 'Walk the route'}>
          {playing ? Icon.pause : Icon.play}{playing ? 'Pause' : 'Walk'}
        </button>
        <input type="range" min={0} max={1} step={0.001} value={t} onChange={(e) => { setT(+e.target.value); setFollow(true); }} aria-label="Position along the route" />
        <button className="btn" aria-pressed={voiceOn} onClick={() => { voiceArmed.current = true; setVoiceOn(!voiceOn); }} title="Spoken callouts (browser speech synthesis)">{voiceOn ? 'Voice on' : 'Voice off'}</button>
        <button className="btn" aria-pressed={!follow} onClick={() => setFollow(!follow)}>{follow ? 'Overview' : 'Helmet view'}</button>
      </div>
    </div>
  );
}
