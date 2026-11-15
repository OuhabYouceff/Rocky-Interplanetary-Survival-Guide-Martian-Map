import { lazy, Suspense, useEffect, useState } from 'react';
import type { Dataset } from '../data';
import { roverPhotos, type RawImage } from '../feeds';
import { Icon } from './ui';

const Photo3D = lazy(() => import('./Photo3D'));
const BASE = import.meta.env.BASE_URL;

export function PhotoDrawer({ data, rmc, onClose }: { data: Dataset; rmc: string; onClose: () => void }) {
  const wp = data.waypoints.find((w) => w.rmc === rmc);
  const imgs = data.images[rmc] ?? [];
  const [live, setLive] = useState<RawImage[] | 'loading' | 'error'>('loading');
  useEffect(() => {
    if (!wp) return; let alive = true; setLive('loading');
    roverPhotos('MSL', wp.sol).then((p) => alive && setLive(p.slice(0, 8))).catch(() => alive && setLive('error'));
    return () => { alive = false; };
  }, [wp]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const k3 = data.photo3d[rmc]; const im3 = k3 != null ? imgs[k3] : imgs.find((x) => x.local && x.depth);

  return (
    <div className="drawer" role="dialog" aria-label="Rover photos">
      <div className="drawer-head">
        <div>
          <h3>What Curiosity saw here</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>Sol {wp?.sol}, site {wp?.site}, drive {wp?.drive}, {wp ? `${Math.round(wp.elev)} m` : ''}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close photos">{Icon.x}</button>
      </div>
      <div className="drawer-body">
        <div className="photos">
          {im3?.local && im3.depth && (
            <figure className="wide">
              <Suspense fallback={<img src={BASE + im3.local} alt="" />}>
                <Photo3D image={BASE + im3.local} depth={BASE + im3.depth} caption={`${im3.instrument}, sol ${wp?.sol}`} />
              </Suspense>
              <figcaption>Drag to look around. Depth estimated by AI (Depth Anything V2), illustrative, not measured.</figcaption>
            </figure>
          )}
          {imgs.filter((x) => x !== im3).map((im, i) => (
            <figure key={i}>
              <img src={im.local ? BASE + im.local : im.url} alt={`${im.instrument}, sol ${wp?.sol}`} loading="lazy" referrerPolicy="no-referrer" />
              <figcaption>{im.instrument.replace(/_/g, ' ')}{im.lmst ? `, ${im.lmst} LMST` : ''}</figcaption>
            </figure>
          ))}
        </div>
        <h3 style={{ font: '700 15px/1.3 var(--f-sign)', margin: '22px 0 8px' }}>All Navcam frames from sol {wp?.sol}</h3>
        {live === 'loading' && <p className="small muted">Loading from NASA's raw image service…</p>}
        {live === 'error' && <p className="small muted">NASA's raw image service did not answer. The photos above are stored copies.</p>}
        {Array.isArray(live) && (live.length
          ? <div className="photos">{live.map((p, i) => <figure key={i}><a href={p.full} target="_blank" rel="noreferrer"><img src={p.small} alt={`${p.caption}, sol ${wp?.sol}`} loading="lazy" referrerPolicy="no-referrer" /></a><figcaption>{p.caption}</figcaption></figure>)}</div>
          : <p className="small muted">No Navcam frames listed for this sol.</p>)}
        <p className="xs muted" style={{ marginTop: 16 }}>Raw images: NASA/JPL-Caltech, MSSS for Mastcam. Stored frames are matched to this rover position by site and drive.</p>
      </div>
    </div>
  );
}
