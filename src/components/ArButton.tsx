// "View in AR", from Malek's TETHER AR work: the current plan as a room-scale Mount Sharp model.
// iPhone: AR Quick Look of the current plan (built here as USDZ). Android: the WebXR floor-scan page (ar.html).
// Computer: a dialog with the QR code to the phone page and downloads of the current plan.
import { useEffect, useState } from 'react';
import type { Dataset } from '../data';
import { useStore } from '../store';
import { buildArScene, exportAr } from '../ar/arScene';
import { Icon } from './ui';

const BASE = import.meta.env.BASE_URL;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/i.test(navigator.userAgent);

async function makeBlob(data: Dataset, kind: 'glb' | 'usdz', room = false) {
  const s = useStore.getState();
  return exportAr(buildArScene(data, s.fields, s.budget, s.legs, s.base, s.stops, { room }), kind);
}

export default function ArButton({ data }: { data: Dataset }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const arPage = new URL(BASE + 'ar.html', location.href).href;

  useEffect(() => {
    // scripting hook (tools/make_ar_assets.mjs): base64 of the current plan as GLB or USDZ
    (window as unknown as { __exportAr: (k: 'glb' | 'usdz', room?: boolean) => Promise<string> }).__exportAr = async (k, room) => {
      const bytes = new Uint8Array(await (await makeBlob(data, k, !!room)).arrayBuffer());
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open]);

  const go = async () => {
    if (isIOS()) {
      setBusy(true);
      try {
        const url = URL.createObjectURL(await makeBlob(data, 'usdz', true));
        const a = document.createElement('a'); a.rel = 'ar'; a.href = url;
        a.appendChild(document.createElement('img'));   // AR Quick Look needs an <img> child
        document.body.appendChild(a); a.click(); a.remove();
      } finally { setBusy(false); }
      return;
    }
    if (isAndroid()) { location.href = arPage; return; }
    setOpen(true);
  };

  const download = async (kind: 'glb' | 'usdz') => {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await makeBlob(data, kind, true));
      const a = document.createElement('a'); a.href = url; a.download = `rocky-plan-room.${kind}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button className="ar-btn" onClick={go} disabled={busy} title="See Mount Sharp and your route in your room, through a phone camera">
        {Icon.cube}<span>{busy ? 'Building model…' : 'View in AR'}</span>
      </button>
      {open && (
        <div className="ar-bg" onClick={() => setOpen(false)}>
          <div className="ar-dialog" role="dialog" aria-modal="true" aria-labelledby="ar-title" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3 id="ar-title">Mount Sharp in your room</h3>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">{Icon.x}</button>
            </div>
            <div className="ar-body">
              <img src={BASE + 'data/ar/qr.png'} alt="QR code to the phone AR page" width={200} height={200} />
              <div>
                <p>Scan the code with a phone camera. The phone finds your floor and the boxwork terrain spreads across the room, about 6 m wide at true height, with the planned walk drawn on the ground.</p>
                <ul className="ar-how">
                  <li><b>Android, Chrome</b> Scan the floor, tap to place, walk around it (WebXR).</li>
                  <li><b>iPhone</b> Apple's AR Quick Look opens the model. Pinch to resize.</li>
                </ul>
                <p className="small muted">The QR code opens the hosted page with the demo plan. To carry your own plan, download it below, or press View in AR inside Rocky on an iPhone.</p>
                <div className="scene-links" style={{ margin: '0 0 10px' }}><a className="btn" href="#7">Preview it on a table, in 3D</a></div>
                <div className="ar-dl">
                  <button className="btn" onClick={() => download('usdz')} disabled={busy}>Download my plan (.usdz, iPhone)</button>
                  <button className="btn" onClick={() => download('glb')} disabled={busy}>Download my plan (.glb, Android)</button>
                </div>
                <p className="small muted">Terrain: USGS 1 m DEM of Gale crater with HiRISE colour. Same page on this computer: <a href={arPage}>ar.html</a>. AR work from Malek's TETHER.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
