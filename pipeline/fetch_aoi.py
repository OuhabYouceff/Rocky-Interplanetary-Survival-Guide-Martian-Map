"""Fetch the app's area of interest (Curiosity boxwork campaign, Mount Sharp, Gale) from:
 - USGS MSL Gale DEM Mosaic 1 m v3 (same DEM as Guo et al. 2026, registered to the rover localisation frame)
 - USGS MSL Gale HiRISE LRGB 25 cm colour mosaic (COG)
Saves local GeoTIFFs in data/aoi/."""
import os, json, numpy as np, rasterio
from rasterio.enums import Resampling

R = 3396190.0
LAT0, LON0 = -4.8085, 137.3855     # centre of the boxwork campaign (sols 4500-5073)
HALF = 1600.0                      # metres -> 3.2 km x 3.2 km
os.makedirs('data/aoi', exist_ok=True)
x0 = np.deg2rad(LON0) * R; y0 = np.deg2rad(LAT0) * R
bounds = (x0 - HALF, y0 - HALF, x0 + HALF, y0 + HALF)
json.dump({'lat0': LAT0, 'lon0': LON0, 'half': HALF, 'bounds': bounds}, open('data/aoi/aoi.json', 'w'))

env = dict(GDAL_DISABLE_READDIR_ON_OPEN='NO', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.ovr', VSI_CACHE='TRUE', CPL_VSIL_CURL_CHUNK_SIZE='10485760', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', VSI_CACHE_SIZE='1000000000', GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='2')
with rasterio.Env(**env):
  if not os.path.exists('data/aoi/dem_1m.tif'):
    d = rasterio.open('/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif')
    win = d.window(*bounds).round_offsets().round_lengths()
    Z = d.read(1, window=win)
    prof = d.profile.copy(); prof.update(width=Z.shape[1], height=Z.shape[0], transform=d.window_transform(win),
                                         tiled=True, compress='deflate', blockxsize=256, blockysize=256)
    with rasterio.open('data/aoi/dem_1m.tif', 'w', **prof) as o: o.write(Z, 1)
    print('dem', Z.shape, np.nanmin(np.where(Z > -1e4, Z, np.nan)), flush=True)

  c = rasterio.open('/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif')
  print('ortho crs', c.crs.to_proj4(), c.res, flush=True)
  win = c.window(*bounds).round_offsets().round_lengths()
  # 0.5 m output
  out_w = int(2 * HALF / 0.5); out_h = out_w
  I = c.read(window=win, out_shape=(c.count, out_h, out_w), resampling=Resampling.average)
  tr = c.window_transform(win) * rasterio.Affine.scale(win.width / out_w, win.height / out_h)
  prof = c.profile.copy(); prof.update(width=out_w, height=out_h, transform=tr, tiled=True, compress='deflate', photometric='RGB',
                                       blockxsize=256, blockysize=256)
  with rasterio.open('data/aoi/ortho_50cm.tif', 'w', **prof) as o: o.write(I)
  print('ortho', I.shape, flush=True)
