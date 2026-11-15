"""Download pipeline inputs: Curiosity waypoints and a 16x overview of the USGS MSL Gale 1 m DEM mosaic (far field
for the 20 km horizon scan). Run first: python pipeline/fetch_inputs.py"""
import json, os, urllib.request
import numpy as np, rasterio

os.makedirs('data/raw', exist_ok=True)
if not os.path.exists('data/raw/MSL_waypoints.json'):
    urllib.request.urlretrieve('https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json', 'data/raw/MSL_waypoints.json')
    print('waypoints saved')
if not os.path.exists('data/raw/mosaic_ovr16.npy'):
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN='NO', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.ovr',
               CPL_VSIL_CURL_CHUNK_SIZE='10485760', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES')
    with rasterio.Env(**env):
        d = rasterio.open('/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif')
        H, W = d.height // 16, d.width // 16
        C = d.read(1, out_shape=(H, W))
        t = d.transform * rasterio.Affine.scale(d.width / W, d.height / H)
    np.save('data/raw/mosaic_ovr16.npy', C)
    json.dump(list(t)[:6], open('data/raw/mosaic_ovr16_transform.json', 'w'))
    print('overview saved', C.shape)
