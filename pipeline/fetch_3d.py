"""Higher-fidelity data for the 3D helmet view, cut to exactly the planner's grid (public/data/terrain.json).

 - Near field: USGS MSL Gale DEM Mosaic 1 m v3 at its full 1 m resolution, 400 m tiles (uint16, 2 cm steps).
 - Colour:     USGS MSL Gale HiRISE LRGB colour mosaic (COG), 50 cm/pixel, 256 m JPEG tiles.
 - Far field:  the same DEM's 16x overview (data/raw/mosaic_ovr16.npy from pipeline/fetch_inputs.py), 24 km around
               the site at 32 m, shifted to the 1 m DEM's vertical datum by the median difference over the site.
Writes public/data/hi/ (meta.json + dem/ + img/ + far.bin). Run from the project root with the TETHER venv:
    python pipeline/fetch_3d.py [path/to/data/raw] [--far-only]
"""
import json, os, sys, numpy as np, rasterio
from rasterio.enums import Resampling
from PIL import Image

OUT = 'public/data/hi'
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
RAW = ARGS[0] if ARGS else 'data/raw'
FAR_ONLY = '--far-only' in sys.argv
meta = json.load(open('public/data/terrain.json'))
W, RES = meta['w'], meta['res']
SIZE = W * RES                                  # 3198 m
xl, yt = meta['x_left'], meta['y_top']
bounds = (xl, yt - SIZE, xl + SIZE, yt)
os.makedirs(f'{OUT}/dem', exist_ok=True); os.makedirs(f'{OUT}/img', exist_ok=True)
env = dict(GDAL_DISABLE_READDIR_ON_OPEN='NO', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.ovr', VSI_CACHE='TRUE', CPL_VSIL_CURL_CHUNK_SIZE='10485760',
           GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', VSI_CACHE_SIZE='1000000000', GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='2')
info = json.load(open(f'{OUT}/meta.json')) if FAR_ONLY else {'size_m': SIZE, 'source_dem': 'USGS MSL Gale DEM Mosaic 1m v3', 'source_img': 'USGS MSL Gale HiRISE LRGB 78 quads (sharp COG)'}

with rasterio.Env(**env):
  if not FAR_ONLY:
    # ---- 1 m DEM
      d = rasterio.open('/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif')
      n = int(round(SIZE))                         # 3198 samples at 1 m
      win = d.window(*bounds)
      Z = d.read(1, window=win, out_shape=(n, n), resampling=Resampling.bilinear).astype(np.float64)
      bad = ~(Z > -1e4)
      print('dem', Z.shape, 'nodata', int(bad.sum()), flush=True)
      if bad.any():                                # fill rare holes with the nearest valid row value
          Z[bad] = np.nanmedian(np.where(bad, np.nan, Z))
      zmin = float(np.floor(Z.min())); scale = 0.02
      q = np.clip(np.round((Z - zmin) / scale), 0, 65535).astype('<u2')
      T = 400
      nt = int(np.ceil(n / T))
      for r in range(nt):
          for c in range(nt):
              tile = np.zeros((T, T), '<u2'); part = q[r * T:(r + 1) * T, c * T:(c + 1) * T]
              tile[:part.shape[0], :part.shape[1]] = part
              if part.shape[1] < T: tile[:, part.shape[1]:] = tile[:, part.shape[1] - 1:part.shape[1]]
              if part.shape[0] < T: tile[part.shape[0]:, :] = tile[part.shape[0] - 1:part.shape[0], :]
              tile.tofile(f'{OUT}/dem/{r}_{c}.bin')
      info['dem'] = {'n': n, 'res_m': 1.0, 'tile': T, 'tiles': nt, 'offset': zmin, 'scale': scale, 'dtype': 'uint16 little-endian, row 0 = north'}

      # ---- 50 cm colour
      o = rasterio.open('/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif')
      m = int(round(SIZE / 0.5))                   # 6396 px
      I = o.read([1, 2, 3], window=o.window(*bounds), out_shape=(3, m, m), resampling=Resampling.average)
      print('img', I.shape, I.dtype, flush=True)
      I = np.moveaxis(I, 0, -1)
      if I.dtype != np.uint8:
          lo, hi = np.percentile(I, [0.5, 99.5]); I = np.clip((I - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
      P = 512; mt = int(np.ceil(m / P))
      for r in range(mt):
          for c in range(mt):
              tile = I[r * P:(r + 1) * P, c * P:(c + 1) * P]
              pad = np.zeros((P, P, 3), np.uint8); pad[:tile.shape[0], :tile.shape[1]] = tile
              Image.fromarray(pad).save(f'{OUT}/img/{r}_{c}.jpg', quality=84, optimize=True, progressive=True)
      info['img'] = {'px': m, 'res_m': 0.5, 'tile': P, 'tiles': mt}

# ---- far field from the 16x overview
C = np.load(f'{RAW}/mosaic_ovr16.npy').astype(np.float64)
ct = rasterio.Affine(*json.load(open(f'{RAW}/mosaic_ovr16_transform.json')))
C[~(C > -1e4)] = np.nan
from scipy import ndimage   # fill gaps in the mosaic with the nearest real height (not a flat floor)
_, (ri, ci) = ndimage.distance_transform_edt(np.isnan(C), return_indices=True); C = C[ri, ci]
FAR, FR = 32000.0, 64.0
n = int(round(SIZE))
if FAR_ONLY:   # 1 m DEM for the datum match, from the tiles written earlier
    dm = info['dem']; T = dm['tile']; Z = np.zeros((dm['tiles'] * T, dm['tiles'] * T))
    for r in range(dm['tiles']):
        for c in range(dm['tiles']): Z[r * T:(r + 1) * T, c * T:(c + 1) * T] = np.fromfile(f'{OUT}/dem/{r}_{c}.bin', '<u2').reshape(T, T) * dm['scale'] + dm['offset']
cx, cy = xl + SIZE / 2, yt - SIZE / 2
k = int(FAR / FR) + 1
xs = cx - FAR / 2 + np.arange(k) * FR; ys = cy + FAR / 2 - np.arange(k) * FR
X, Y = np.meshgrid(xs, ys)
inv = ~ct
col, row = inv * (X, Y)
c0 = np.clip(np.floor(col - 0.5).astype(int), 0, C.shape[1] - 2); r0 = np.clip(np.floor(row - 0.5).astype(int), 0, C.shape[0] - 2)
fc = np.clip(col - 0.5 - c0, 0, 1); fr = np.clip(row - 0.5 - r0, 0, 1)
F = (C[r0, c0] * (1 - fc) * (1 - fr) + C[r0, c0 + 1] * fc * (1 - fr) + C[r0 + 1, c0] * (1 - fc) * fr + C[r0 + 1, c0 + 1] * fc * fr)
# datum: median of (1 m DEM - overview) over the site
inside = (np.abs(X - cx) < SIZE / 2) & (np.abs(Y - cy) < SIZE / 2) & np.isfinite(F)
ii = ((yt - Y[inside]) / 1.0).astype(int).clip(0, n - 1); jj = ((X[inside] - xl) / 1.0).astype(int).clip(0, n - 1)
off = float(np.median(Z[ii, jj] - F[inside]))
F = F + off
F[~np.isfinite(F)] = np.nanmin(F)
fmin = float(np.floor(F.min())); fscale = 0.1
np.clip(np.round((F - fmin) / fscale), 0, 65535).astype('<u2').tofile(f'{OUT}/far.bin')
info['far'] = {'n': k, 'res_m': FR, 'size_m': (k - 1) * FR, 'offset': fmin, 'scale': fscale, 'datum_shift_m': round(off, 2),
               'source': 'USGS MSL Gale DEM Mosaic 1m v3, 16x overview, shifted to the 1 m datum'}
print('far', F.shape, 'datum shift', round(off, 1), 'm', flush=True)
json.dump(info, open(f'{OUT}/meta.json', 'w'), indent=1)
print('done', flush=True)
