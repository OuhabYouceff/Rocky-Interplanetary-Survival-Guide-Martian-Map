import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from '../data';
import { lonLatToCell } from '../data';
import { useStore } from '../store';
import { sitingCanvas, sitingRect, type SitingResult } from '../planner/siting';
import { fieldCanvas, hillshadeCanvas, ramp, SLOPE_RAMP, slopeDeg, snapWalkable } from '../terrain';

export type Tool = 'base' | 'stop';

interface Props { data: Dataset; tool: Tool; onPickWaypoint: (rmc: string) => void; siting?: SitingResult | null; readOnly?: boolean }

// Horizon palette: neutral chrome, colour only for meaning (red = beyond the tether / too far, green = safe)
const C = { bg: '#ECECEC', ink: '#1B1B1B', white: '#FFFFFF', danger: '#D83933', ok: '#00A91C' };
const SIGN = '"Inter", system-ui, sans-serif';

export default function MapView({ data, tool, onPickWaypoint, siting, readOnly }: Props) {
  const sitingCv = useMemo(() => (siting ? sitingCanvas(siting) : null), [siting]);
  const { meta } = data;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ s: 1, ox: 0, oy: 0 }); // screen = cell * s + o
  const [size, setSize] = useState({ w: 800, h: 600 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; id: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(true)); }, []);

  const { layers, fields, legs, base, stops, budget, hover, setHover, setBase, addStop, flare, groundModel } = useStore();

  const slope = useMemo(() => slopeDeg(data), [data]);
  const hill = useMemo(() => hillshadeCanvas(data), [data]);
  const slopeCv = useMemo(() => fieldCanvas(meta.w, meta.h, (i) => {
    const s = slope[i]; if (!(s >= 8)) return null; const c = ramp(SLOPE_RAMP, s); return [c[0], c[1], c[2], s > 20 ? 210 : 150];
  }), [slope, meta]);
  const shelterCv = useMemo(() => fieldCanvas(meta.shelter.w, meta.shelter.h, (i) => {
    const v = data.shelter[i] / 2.55; if (v < 8) return null;
    const a = Math.min(200, (v - 8) * 6); return [0, 94, 162, a];
  }), [data, meta]);
  // TETHER's AI sand map (pipeline/vision), same colours as upstream
  const sandCv = useMemo(() => data.terrainClass ? fieldCanvas(meta.w, meta.h, (i) => {
    const c = data.terrainClass![i];
    if (c === 2) return [60, 140, 255, 150];      // loose sand (AI)
    if (c === 3) return [255, 214, 90, 120];      // rough ground (DEM relief)
    return null;
  }) : null, [data, meta]);
  const groundCv = useMemo(() => {
    const g = data.ground; if (!g) return null;
    return fieldCanvas(meta.w, meta.h, (i) => {
      const s = g.sand[i], r = g.rock[i];
      if (s < 0.25 && r < 0.3) return null;
      return s >= r ? [193, 138, 59, Math.min(200, 60 + s * 160)] : [111, 143, 184, Math.min(190, 50 + r * 150)];
    });
  }, [data, meta]);

  const usable = budget.evaHours * 3600 * (1 - budget.reservePct / 100);
  // Reserve map. Lines are drawn k cells thick: k = 1 when zoomed in, k = 3 when the whole site is on screen
  // (a 1-cell line would be averaged away when the 1066-cell grid is shrunk to a few hundred pixels).
  const makeReserve = (k: number) => {
    if (!fields) return null;
    const work = budget.workMinPerStop * 60;
    const W = meta.w, H = meta.h, step = 600; // isochrone every 10 min of walking home
    const band = (i: number) => Math.floor(fields.homeT[i] / step);
    const inside = (i: number) => fields.outT[i] + fields.homeT[i] + work <= usable;
    const differs = (i: number, f: (j: number) => number | boolean) => {
      const x = i % W, y = (i / W) | 0, v = f(i);
      for (let d = 1; d <= k; d++) {
        if (x + d < W && isFinite(fields.homeT[i + d]) && f(i + d) !== v) return true;
        if (y + d < H && isFinite(fields.homeT[i + d * W]) && f(i + d * W) !== v) return true;
      }
      return false;
    };
    return fieldCanvas(meta.w, meta.h, (i) => {
      const home = fields.homeT[i];
      if (!isFinite(home)) return [27, 27, 27, 130];                // no safe walking path at all (too steep)
      if (differs(i, inside)) return [255, 255, 255, 255];          // the tether line: edge of the walk-back rule
      if (!inside(i)) return [216, 57, 51, 115];                    // beyond the tether
      if (differs(i, band)) return band(i) % 3 === 2 ? [255, 255, 255, 150] : [255, 255, 255, 65]; // 10 min, stronger every 30
      return null;                                                   // inside: leave the imagery clean
    });
  };
  const reserveThin = useMemo(() => makeReserve(1), [fields, budget, usable, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const reserveThick = useMemo(() => makeReserve(3), [fields, budget, usable, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const reserveCv = view.s >= 1.6 ? reserveThin : reserveThick;
  const flareCv = useMemo(() => {
    if (!fields) return null;
    const lead = budget.flareLeadMin * 60;
    return fieldCanvas(meta.w, meta.h, (i) => {
      const t = fields.fastT[i]; if (!isFinite(t)) return null;
      if (t <= lead) { const a = 25 + 35 * (t / lead); return [0, 169, 28, a]; }
      return [216, 57, 51, 70];
    });
  }, [fields, budget.flareLeadMin, meta]);

  const traverse = useMemo(() => data.waypoints.map((p) => ({ p, c: lonLatToCell(meta, p.lon, p.lat) })), [data, meta]);
  const targets = useMemo(() => data.targets.map((t) => ({ t, c: lonLatToCell(meta, t.lon, t.lat) })), [data, meta]);

  useEffect(() => {
    const el = wrap.current!; const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height });
    }); ro.observe(el); return () => ro.disconnect();
  }, []);
  const fit = () => {
    const s = Math.min(size.w / meta.w, size.h / meta.h) * 0.98;
    setView({ s, ox: (size.w - meta.w * s) / 2, oy: (size.h - meta.h * s) / 2 });
  };
  useEffect(() => { if (size.w > 50 && size.h > 50) fit(); }, [size.w, size.h, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomBy = (k: number, mx = size.w / 2, my = size.h / 2) => {
    const s = Math.min(40, Math.max(0.15, view.s * k)); const kk = s / view.s;
    setView({ s, ox: mx - (mx - view.ox) * kk, oy: my - (my - view.oy) * kk });
  };

  // draw
  useEffect(() => {
    const c = cv.current!; const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr; c.style.width = size.w + 'px'; c.style.height = size.h + 'px';
    const g = c.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, size.w, size.h);
    g.save(); g.translate(view.ox, view.oy); g.scale(view.s, view.s);
    g.imageSmoothingEnabled = true;
    if (layers.ortho) g.drawImage(data.ortho, 0, 0, meta.w, meta.h);
    if (layers.trek && data.trek) g.drawImage(data.trek, 0, 0, meta.w, meta.h);
    if (layers.hillshade) { g.globalAlpha = layers.ortho || layers.trek ? 0.3 : 1; g.globalCompositeOperation = layers.ortho || layers.trek ? 'multiply' : 'source-over'; g.drawImage(hill, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    g.imageSmoothingEnabled = view.s < 2;
    if (layers.ground && groundCv) g.drawImage(groundCv, 0, 0);
    if (layers.sand && sandCv) g.drawImage(sandCv, 0, 0);
    if (layers.slope) g.drawImage(slopeCv, 0, 0);
    if (layers.shelter) g.drawImage(shelterCv, 0, 0, meta.w, meta.h);
    if (layers.reserve && reserveCv && !flare && !siting) g.drawImage(reserveCv, 0, 0);
    if ((layers.flare || flare) && flareCv) g.drawImage(flareCv, 0, 0);
    if (siting && sitingCv) { const r = sitingRect(siting); g.imageSmoothingEnabled = true; g.drawImage(sitingCv, r.x, r.y, r.w, r.h); }
    g.restore();

    const toS = (cx: number, cy: number): [number, number] => [cx * view.s + view.ox, cy * view.s + view.oy];
    const label = (txt: string, x: number, y: number, size = 12, weight = 600) => {
      g.font = `${weight} ${size}px ${SIGN}`; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 3.5; g.strokeText(txt, x, y); g.fillStyle = '#fff'; g.fillText(txt, x, y);
    };
    // Curiosity traverse
    if (layers.traverse && traverse.length) {
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath();
      traverse.forEach(({ c }, k) => { const [x, y] = toS(c[0], c[1]); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
      if (layers.photos) for (const { p, c } of traverse) {
        if (!data.images[p.rmc]?.length) continue; const [x, y] = toS(c[0], c[1]);
        g.fillStyle = C.white; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill();
        g.strokeStyle = C.ink; g.lineWidth = 1.2; g.stroke();
      }
    }
    // route: navy casing, white line; the walk home is dashed
    legs.forEach((leg, li) => {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      leg.cells.forEach((cell, k) => { const [x, y] = toS(cell % meta.w + 0.5, Math.floor(cell / meta.w) + 0.5); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 7; g.stroke();
      const home = li === legs.length - 1;
      g.strokeStyle = C.white; g.lineWidth = 3;
      if (home) g.setLineDash([8, 6]);
      g.stroke(); g.setLineDash([]);
    });
    // science targets: hollow diamonds, labels skipped where they would collide
    const boxes: [number, number, number, number][] = [];
    const cellPos = (cell: number) => toS(cell % meta.w + 0.5, Math.floor(cell / meta.w) + 0.5);
    for (const sc of [...stops, ...(base != null ? [base] : [])]) { const [x, y] = cellPos(sc); boxes.push([x - 15, y - 15, x + 15, y + 15]); }
    const free = (b: [number, number, number, number]) => !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    if (layers.targets) for (const { t, c } of targets) {
      const [x, y] = toS(c[0], c[1]);
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(-6, -6, 12, 12);
      g.strokeStyle = C.white; g.lineWidth = 2; g.strokeRect(-4.5, -4.5, 9, 9); g.restore();
      const nm = t.name.replace(/\s*\(.*\)\s*/g, '').replace(/["“”]/g, '');
      g.font = `600 12px ${SIGN}`; const tw = g.measureText(nm).width;
      for (const [lx, ly, al] of [[x + 11, y + 4, 'left'], [x - 11, y + 4, 'right'], [x - tw / 2, y - 10, 'left'], [x - tw / 2, y + 20, 'left']] as const) {
        const bx = al === 'right' ? lx - tw : lx, b: [number, number, number, number] = [bx - 2, ly - 11, bx + tw + 2, ly + 3];
        if (free(b)) { boxes.push(b); g.textAlign = al; label(nm, lx, ly); g.textAlign = 'left'; break; }
      }
    }
    // stops and habitat
    const cellXY = (cell: number) => toS(cell % meta.w + 0.5, Math.floor(cell / meta.w) + 0.5);
    stops.forEach((s, k) => {
      const [x, y] = cellXY(s);
      g.fillStyle = C.white; g.strokeStyle = C.ink; g.lineWidth = 2.5;
      g.beginPath(); g.arc(x, y, 12, 0, 7); g.fill(); g.stroke();
      g.fillStyle = C.ink; g.font = `800 13px ${SIGN}`; g.textAlign = 'center'; g.fillText(String(k + 1), x, y + 4.5); g.textAlign = 'left';
    });
    if (base != null) {
      const [x, y] = cellXY(base);
      g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
      g.strokeStyle = C.white; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = C.white; g.font = `800 13px ${SIGN}`; g.textAlign = 'center'; g.fillText('H', x, y + 4.5); g.textAlign = 'left';
    }
    // scale bar + north
    const mPerPx = meta.res / view.s; const nice = [10, 20, 50, 100, 200, 500, 1000].find((m) => m / mPerPx > 80) ?? 1000;
    const L = nice / mPerPx, sx = size.w - L - 26, sy = 26;
    g.fillStyle = C.white; g.fillRect(sx - 10, sy - 18, L + 20, 30);
    g.fillStyle = C.ink; g.fillRect(sx, sy + 2, L, 3); g.fillRect(sx, sy - 3, 2, 8); g.fillRect(sx + L - 2, sy - 3, 2, 8);
    g.font = `700 11px ${SIGN}`; g.textAlign = 'right'; g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, sx + L, sy - 4); g.textAlign = 'left';
    g.fillStyle = C.white; g.fillRect(size.w - 50, 46, 28, 46); g.fillStyle = C.ink;
    g.beginPath(); g.moveTo(size.w - 36, 54); g.lineTo(size.w - 42, 72); g.lineTo(size.w - 36, 68); g.lineTo(size.w - 30, 72); g.closePath(); g.fill();
    g.font = `800 11px ${SIGN}`; g.textAlign = 'center'; g.fillText('N', size.w - 36, 86); g.textAlign = 'left';
    // hover crosshair
    if (hover != null) {
      const [x, y] = cellXY(hover); g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x - 3, y); g.moveTo(x + 3, y); g.lineTo(x + 10, y);
      g.moveTo(x, y - 10); g.lineTo(x, y - 3); g.moveTo(x, y + 3); g.lineTo(x, y + 10); g.stroke();
    }
  }, [view, size, layers, data, meta, hill, slopeCv, shelterCv, groundCv, sandCv, reserveCv, flareCv, legs, base, stops, traverse, targets, hover, flare, siting, sitingCv, fontsReady, groundModel]);

  const toCell = (ev: { clientX: number; clientY: number }) => {
    const r = cv.current!.getBoundingClientRect();
    const cx = Math.floor((ev.clientX - r.left - view.ox) / view.s), cy = Math.floor((ev.clientY - r.top - view.oy) / view.s);
    if (cx < 0 || cy < 0 || cx >= meta.w || cy >= meta.h) return null;
    return cy * meta.w + cx;
  };

  return (
    <div ref={wrap} className="map-wrap">
      <canvas
        ref={cv}
        role="application"
        aria-label={readOnly ? 'Terrain map. Click a point to inspect it.' : tool === 'base' ? 'Terrain map. Click to place the habitat.' : 'Terrain map. Click to add a science stop.'}
        onWheel={(e) => { const r = cv.current!.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy, moved: false, id: e.pointerId }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) { const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (d.moved) setView({ ...view, ox: d.ox + dx, oy: d.oy + dy }); }
          if (e.pointerType === 'mouse') setHover(toCell(e));
        }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null); }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null; if (d?.moved) return;
          const r = cv.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
          const tol = e.pointerType === 'mouse' ? 7 : 16;
          if (layers.photos && layers.traverse) for (const { p, c } of traverse) {
            if (!data.images[p.rmc]?.length) continue;
            const x = c[0] * view.s + view.ox, y = c[1] * view.s + view.oy;
            if (Math.hypot(x - mx, y - my) < tol) { onPickWaypoint(p.rmc); return; }
          }
          const cell = toCell(e); if (cell == null || isNaN(data.z[cell])) return;
          if (e.pointerType !== 'mouse' || readOnly) setHover(cell);
          if (readOnly) return;
          const snapped = snapWalkable(data, slope, cell); if (tool === 'base' || base == null) setBase(snapped); else addStop(snapped);
        }}
      />
      <div className="zoom" style={{ position: 'absolute', right: 14, top: 104, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3 }}>
        <button className="btn layers-btn" onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
        <button className="btn layers-btn" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
        <button className="btn layers-btn" onClick={fit} aria-label="Fit the site" title="Fit the whole site">Fit</button>
      </div>
    </div>
  );
}
