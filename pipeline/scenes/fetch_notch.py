"""Real ground at Maria Gordon Notch (Curiosity's RAD stop of sol 3324), for scene 5. Re-runnable:
  /Users/octa/Desktop/tether-marswalk/.venv/bin/python tools/fetch_notch.py
Reads, over HTTP, the same sources Rocky's pipeline uses (pipeline/validate_rad.py, pipeline/fetch_aoi.py):
  USGS MSL Gale DEM Mosaic 1 m v3                    -> public/notch/dem.bin  (Uint16, 0 = no data, z = offset + v * scale)
  USGS MSL Gale HiRISE LRGB 25 cm colour mosaic (COG)  -> public/notch/img.jpg
  public/notch/meta.json: size, resolution, origin, offset/scale, the stop's position in the window.
Rows run north to south, columns west to east (the DEM's own order)."""
import json, numpy as np, rasterio
from pathlib import Path
from PIL import Image
from rasterio.enums import Resampling

R = 3396190.0
LAT, LON = -4.74765625, 137.3943118          # validation_rad.json P6 / validation_rad_stops.json quiz sol 3324
HALF, IMG = 300.0, 2400                       # 600 m x 600 m; image at 25 cm (the mosaic's own resolution)
OUT = Path(__file__).resolve().parent.parent / 'public' / 'notch'; OUT.mkdir(parents=True, exist_ok=True)
x0, y0 = np.deg2rad(LON) * R, np.deg2rad(LAT) * R
bounds = (x0 - HALF, y0 - HALF, x0 + HALF, y0 + HALF)
env = dict(GDAL_DISABLE_READDIR_ON_OPEN='NO', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.ovr', VSI_CACHE='TRUE', CPL_VSIL_CURL_CHUNK_SIZE='10485760',
           GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES', GDAL_HTTP_MAX_RETRY='5', GDAL_HTTP_RETRY_DELAY='2')
with rasterio.Env(**env):
    d = rasterio.open('/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif')
    print('dem crs', d.crs.to_proj4(), d.res, flush=True)
    N = int(2 * HALF)
    Z = d.read(1, window=d.window(*bounds), out_shape=(N, N), resampling=Resampling.nearest).astype(np.float64)
    ok = (Z > -1e4) & np.isfinite(Z) & (Z != d.nodata if d.nodata is not None else True)
    zmin, zmax = float(Z[ok].min()), float(Z[ok].max()); scale = (zmax - zmin) / 65000
    q = np.where(ok, np.round((Z - zmin) / scale) + 1, 0).astype('<u2')
    (OUT / 'dem.bin').write_bytes(q.tobytes())
    print('dem', Z.shape, 'z', zmin, zmax, 'holes', int((~ok).sum()), flush=True)

    c = rasterio.open('/vsicurl/https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif')
    print('ortho crs', c.crs.to_proj4(), c.res, c.count, flush=True)
    I = c.read(window=c.window(*bounds), out_shape=(c.count, IMG, IMG), resampling=Resampling.average, boundless=True, fill_value=0)
    rgb = np.moveaxis(I[:3], 0, -1)
    if rgb.dtype != np.uint8: rgb = np.clip(rgb / max(1, np.percentile(rgb[rgb > 0], 99.8)) * 255, 0, 255).astype(np.uint8)
    print('ortho', rgb.shape, 'empty px', int((rgb.sum(-1) == 0).sum()), 'per-band means', rgb.reshape(-1, 3).mean(0), flush=True)
    Image.fromarray(rgb).save(OUT / 'img.jpg', quality=88)

json.dump(dict(lat=LAT, lon=LON, size_m=N, res_m=1, img_px=IMG, x0=x0 - HALF, y_top=y0 + HALF, offset=zmin - scale, scale=scale, zmin=zmin, zmax=zmax,
               stop_col=HALF, stop_row=HALF, source_dem='USGS MSL Gale DEM Mosaic 1 m v3', source_img='USGS MSL Gale HiRISE LRGB colour mosaic (25 cm)'),
          open(OUT / 'meta.json', 'w'), indent=1)
print('saved', OUT)
