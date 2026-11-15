import type { ReactNode } from 'react';
import { NAV, isCurrent, type NavId } from '../nav';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const Icon = {
  plan: <svg viewBox="0 0 24 24" {...P}><path d="M4 18 9 6l5 9 2-4 4 7" /><circle cx="9" cy="6" r="1.6" /></svg>,
  auto: <svg viewBox="0 0 24 24" {...P}><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>,
  storm: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></svg>,
  walk: <svg viewBox="0 0 24 24" {...P}><circle cx="13" cy="4.5" r="2" /><path d="m9 21 2.5-6.5L14 17v4M8 11l3-3.5 3 1.5 2 3M11.5 14.5 11 8" /></svg>,
  atlas: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="9" /><path d="M3.5 9h17M3.5 15h17M12 3c-3 3.2-3 14.8 0 18M12 3c3 3.2 3 14.8 0 18" /></svg>,
  sky: <svg viewBox="0 0 24 24" {...P}><path d="M7 17h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 10.1 3.5 3.5 0 0 0 7 17z" /></svg>,
  evidence: <svg viewBox="0 0 24 24" {...P}><path d="M4 20V4M4 20h16" /><circle cx="9" cy="14" r="1.3" /><circle cx="12" cy="11" r="1.3" /><circle cx="16" cy="8" r="1.3" /><path d="m7 17 12-11" strokeDasharray="2 2.5" /></svg>,
  rescue: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="m6 6 3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18" /></svg>,
  base: <svg viewBox="0 0 24 24" {...P}><path d="M3 19h18M5 19a7 7 0 0 1 14 0M10 19v-4h4v4" /><path d="M12 5V3" /></svg>,
  layers: <svg viewBox="0 0 24 24" {...P}><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>,
  up: <svg viewBox="0 0 24 24" {...P}><path d="m6 15 6-6 6 6" /></svg>,
  down: <svg viewBox="0 0 24 24" {...P}><path d="m6 9 6 6 6-6" /></svg>,
  cube: <svg viewBox="0 0 24 24" {...P}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>,
  x: <svg viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  glove: <svg viewBox="0 0 24 24" {...P}><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10V6a1.5 1.5 0 0 1 3 0v6M16 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.6 14.6a1.6 1.6 0 0 1 2.6-1.8L7 13" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>,
};

export type Provenance = 'measured' | 'computed' | 'assumed';
const PROV: Record<Provenance, string> = {
  measured: 'Measured or observed by NASA / USGS instruments',
  computed: 'Calculated by Rocky from measured data',
  assumed: 'A modelling assumption you can change',
};
export function Prov({ k }: { k: Provenance }) {
  return <span className={`prov ${k}`} title={PROV[k]}><i aria-hidden />{k}</span>;
}

export function Slider({ label, value, min, max, step, unit, onChange, hint, prov = 'assumed', format }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void;
  hint?: string; prov?: Provenance; format?: (v: number) => string;
}) {
  return (
    <label className="slider" title={hint}>
      <div className="slider-top"><span>{label}<Prov k={prov} /></span><b>{format ? format(value) : value}{unit}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={label} />
    </label>
  );
}

export function Fact({ label, children, prov }: { label: string; children: ReactNode; prov?: Provenance }) {
  return <div><dt>{label}{prov && <Prov k={prov} />}</dt><dd>{children}</dd></div>;
}

/** The switch between a section's 3D scene and its working tool (same entries as the 3D scenes' top bar). */
export function AltSwitch({ id, view }: { id: NavId; view: string }) {
  const alt = NAV.find((n) => n.id === id)?.alt; if (!alt) return null;
  return <div className="alt-switch" role="group" aria-label="View">{alt.map((a) => <a key={a.hash} href={a.hash} aria-current={isCurrent(a.hash, view) ? 'page' : undefined}>{a.label}</a>)}</div>;
}
