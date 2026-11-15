"""Export AOI products for the web app (app/public/data/):
  terrain.json   grid metadata (CRS = Mars equirectangular clon0, R = 3396190 m; y north-up)
  elev.bin       Uint16 elevation on the planning grid: z = zmin + v * zscale (0 = no data)
  ortho.jpg      HiRISE colour basemap resampled to the AOI (1 m)
  shelter.bin    Uint8 blocked-sky fraction (solid angle, %) on a coarser grid, Guo et al. 2026 method
  dose.bin       Uint8 GCR dose relative to open flat ground (%, 100 = unshielded)
"""
import json, os, sys, time
import numpy as np, rasterio
from rasterio.enums import Resampling
from PIL import Image
sys.path.insert(0, 'pipeline')
from horizon import MultiResDEM, horizon_elevations_fast, ros_metrics, ray_distances, dose_weights, R_MARS

OUT = 'app/public/data'
os.makedirs(OUT, exist_ok=True)
PLAN_RES = float(os.environ.get('PLAN_RES', 3.0))
SHELTER_RES = float(os.environ.get('SHELTER_RES', 8.0))
N_AZ = int(os.environ.get('N_AZ', 120))

src = rasterio.open('data/aoi/dem_1m.tif')
Z1 = src.read(1).astype(np.float32)
Z1[~(Z1 > -1e4)] = np.nan
H1, W1 = Z1.shape
tr1 = src.transform

# ---- planning grid (block-average) ----
f = int(round(PLAN_RES / tr1.a))
h, w = H1 // f, W1 // f
Zp = np.nanmean(Z1[:h * f, :w * f].reshape(h, f, w, f), axis=(1, 3))
zmin = float(np.nanmin(Zp)); zmax = float(np.nanmax(Zp))
zscale = (zmax - zmin) / 65000.0
q = np.where(np.isfinite(Zp), np.round((Zp - zmin) / zscale) + 1, 0).astype('<u2')
q.tofile(f'{OUT}/elev.bin')
x_left, y_top = tr1.c, tr1.f
res = tr1.a * f
lat_top = np.rad2deg(y_top / R_MARS); lat_bot = np.rad2deg((y_top - h * res) / R_MARS)
lon_left = np.rad2deg(x_left / R_MARS); lon_right = np.rad2deg((x_left + w * res) / R_MARS)
coslat = np.cos(np.deg2rad((lat_top + lat_bot) / 2))
meta = dict(w=w, h=h, res=res, ground_res_x=res * coslat, ground_res_y=res, x_left=x_left, y_top=y_top,
            zmin=zmin, zscale=zscale, lat_top=lat_top, lat_bottom=lat_bot, lon_left=lon_left, lon_right=lon_right,
            crs='Mars 2000 sphere, equirectangular clon0 (R=3396190 m)',
            source='USGS MSL Gale DEM Mosaic 1m v3 (Parker & Calef / USGS Astrogeology)')
print('planning grid', w, h, res, zmin, zmax, flush=True)

# ---- ortho ----
o = rasterio.open('data/aoi/ortho_50cm.tif')
I = o.read(out_shape=(o.count, H1, W1), resampling=Resampling.average)
I = np.moveaxis(I[:3], 0, -1)
# reproject-free: both are clon0 equirectangular; crop/resample ortho to DEM bounds
ob = o.bounds; db = src.bounds
if abs(ob.left - db.left) > 1 or abs(ob.top - db.top) > 1:
    win = o.window(db.left, db.bottom, db.right, db.top)
    I = o.read(window=win, out_shape=(o.count, H1, W1), resampling=Resampling.average)
    I = np.moveaxis(I[:3], 0, -1)
# gentle contrast stretch
lo, hi = np.percentile(I[I > 0], [0.5, 99.5])
I = np.clip((I.astype(np.float32) - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
Image.fromarray(I).save(f'{OUT}/ortho.jpg', quality=82, optimize=True)
meta['ortho'] = dict(w=W1, h=H1, file='ortho.jpg', source='USGS MSL Gale HiRISE LRGB 25cm mosaic (HiRISE, UArizona/NASA/JPL)')
print('ortho saved', I.shape, flush=True)

# ---- shelter map ----
far = np.load('data/raw/mosaic_ovr16.npy'); ft = rasterio.Affine(*json.load(open('data/raw/mosaic_ovr16_transform.json')))
dem = MultiResDEM(Z1.copy(), tr1, far.copy(), ft)
fs = int(round(SHELTER_RES / tr1.a))
hs, ws = H1 // fs, W1 // fs
cols, rows = np.meshgrid(np.arange(ws), np.arange(hs))
X = (tr1.c + (cols.ravel() * fs + fs / 2) * tr1.a)
Y = (tr1.f + (rows.ravel() * fs + fs / 2) * tr1.e)
d = ray_distances(20000, near_step=1.0, near_max=120.0, growth=1.04)
t = time.time()
sum_ros = np.zeros(X.size, np.float32); dose = np.zeros(X.size, np.float32)
theta = np.arange(0.5, 90.0, 1.0); wts = dose_weights(theta)
CH = 20000
for i in range(0, X.size, CH):
    e = horizon_elevations_fast(dem, X[i:i + CH], Y[i:i + CH], n_az=N_AZ, dists=d, fine_limit=1500)
    m = ros_metrics(e)
    sum_ros[i:i + CH] = m['sum_ros']
    dose[i:i + CH] = 1 - (m['ros'] * wts[None, :]).sum(1) / wts.sum()
    print(f'  shelter {i + CH}/{X.size}  {time.time() - t:.0f}s', flush=True)
np.clip(np.round(sum_ros * 100 * 2.55), 0, 255).astype(np.uint8).reshape(hs, ws).tofile(f'{OUT}/shelter.bin')
np.clip(np.round(dose * 100 * 2.55), 0, 255).astype(np.uint8).reshape(hs, ws).tofile(f'{OUT}/dose.bin')
meta['shelter'] = dict(w=ws, h=hs, res=tr1.a * fs, scale='value/2.55 = percent', n_az=N_AZ, h_obs=1.0, radius_m=20000,
                       method='Guo et al. 2026 JGR Planets e2026JE009704 horizon scan; dose from zenith-angle GCR curve (their Fig. 2)')
json.dump(meta, open(f'{OUT}/terrain.json', 'w'), indent=1)
print('done', time.time() - t, flush=True)
