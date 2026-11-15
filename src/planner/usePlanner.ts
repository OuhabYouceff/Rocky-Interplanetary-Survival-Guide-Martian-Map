import { useEffect, useRef } from 'react';
import { terrainFactors, type Dataset } from '../data';
import { useStore } from '../store';

export function usePlanner(data: Dataset | null) {
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const routeId = useRef(0);
  const { params, base, stops, setFields, setLegs, groundModel, sandModel } = useStore();

  useEffect(() => {
    if (!data) return;
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.postMessage({ type: 'init', grid: { w: data.meta.w, h: data.meta.h, res: data.meta.res, z: data.z } });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'fields' && m.id === reqId.current) setFields({ homeE: m.homeE, homeT: m.homeT, outE: m.outE, outT: m.outT, fastT: m.fastT, ms: m.ms });
      if (m.type === 'route' && m.id === routeId.current) setLegs(m.legs, m.error ?? null);
    };
    worker.current = w;
    return () => w.terminate();
  }, [data, setFields, setLegs]);

  // THEMIS ground model or TETHER's AI sand map: swap the per-cell cost multipliers before the next fields/route request
  useEffect(() => {
    worker.current?.postMessage({ type: 'terrain', ...terrainFactors(data, groundModel, sandModel) });
  }, [groundModel, sandModel, data]);

  useEffect(() => {
    if (!worker.current || base == null) return;
    const t = setTimeout(() => {
      reqId.current++;
      worker.current!.postMessage({ type: 'fields', id: reqId.current, base, params });
    }, 120);
    return () => clearTimeout(t);
  }, [base, params, data, groundModel, sandModel]);

  useEffect(() => {
    if (!worker.current || base == null) return;
    if (!stops.length) { setLegs([]); return; }
    const t = setTimeout(() => {
      routeId.current++;
      const sampleMassPerStop = Math.max(0, params.loadBack - params.loadOut) / stops.length;
      worker.current!.postMessage({ type: 'route', id: routeId.current, base, stops, params, sampleMassPerStop });
    }, 150);
    return () => clearTimeout(t);
  }, [base, stops, params, data, setLegs, groundModel, sandModel]);
}
