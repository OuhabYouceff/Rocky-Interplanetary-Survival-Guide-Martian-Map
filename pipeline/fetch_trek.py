"""Fetch NASA JPL Mars Trek WMTS tiles (Gale CTX block-adjusted mosaic) covering the AOI and stitch them into an
AOI-aligned image for the app (app/public/data/trek_ctx.jpg). Trek's EQ tiling: geographic, zoom 0 = 2x1 tiles,
tile size = 180/2^z degrees, row = floor((90 - lat)/size), col = floor((lon + 180)/size)."""
import io, json, math, os, sys, time, urllib.request
import numpy as np
from PIL import Image

LAYER = os.environ.get('TREK_LAYER', 'Gale_CTX_BlockAdj_dd')
Z = int(os.environ.get('TREK_Z', 13))
meta = json.load(open('app/public/data/terrain.json'))
lat_t, lat_b, lon_l, lon_r = meta['lat_top'], meta['lat_bottom'], meta['lon_left'], meta['lon_right']
size = 180.0 / 2 ** Z
r0, r1 = math.floor((90 - lat_t) / size), math.floor((90 - lat_b) / size)
c0, c1 = math.floor((lon_l + 180) / size), math.floor((lon_r + 180) / size)
mosaic = Image.new('RGB', ((c1 - c0 + 1) * 256, (r1 - r0 + 1) * 256))
ok = 0
for r in range(r0, r1 + 1):
    for c in range(c0, c1 + 1):
        for ext in ('png', 'jpg'):
            url = f'https://trek.nasa.gov/tiles/Mars/EQ/{LAYER}/1.0.0/default/default028mm/{Z}/{r}/{c}.{ext}'
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as f:
                    im = Image.open(io.BytesIO(f.read())).convert('RGB')
                mosaic.paste(im, ((c - c0) * 256, (r - r0) * 256)); ok += 1; break
            except Exception as e:  # noqa
                last = e
        time.sleep(0.1)
print('tiles', ok, 'of', (r1 - r0 + 1) * (c1 - c0 + 1), 'zoom', Z)
# crop to AOI bounds
px_per_deg = 256 / size
x0 = (lon_l + 180 - c0 * size) * px_per_deg; x1 = (lon_r + 180 - c0 * size) * px_per_deg
y0 = (90 - lat_t - r0 * size) * px_per_deg; y1 = (90 - lat_b - r0 * size) * px_per_deg
crop = mosaic.crop((int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1)))).resize((1600, 1600), Image.LANCZOS)
a = np.asarray(crop).astype(np.float32); lo, hi = np.percentile(a, [1, 99])
crop = Image.fromarray(np.clip((a - lo) / max(1, hi - lo) * 255, 0, 255).astype(np.uint8))
crop.save('app/public/data/trek_ctx.jpg', quality=82)
meta['trek'] = dict(file='trek_ctx.jpg', layer=LAYER, zoom=Z, source='NASA JPL Mars Trek WMTS (trek.nasa.gov), CTX block-adjusted mosaic of Gale')
json.dump(meta, open('app/public/data/terrain.json', 'w'), indent=1)
print('saved trek_ctx.jpg')
