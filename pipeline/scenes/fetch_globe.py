"""Real imagery for the orbit-to-site dive, stitched from public NASA map tiles (cached in tools/cache):
  global.jpg  Viking colour mosaic of all Mars (NASA/USGS via Mars Trek), 4096 x 2048
  crater.jpg  Gale crater region: CTX detail (NASA/JPL/MSSS) carrying Viking colour
  sharp.jpg   Mount Sharp north-west flank: the same, finer
Colour for the two close-ups comes from the Viking mosaic and brightness from CTX (pan-sharpening); nothing is painted.
Tiles are geographic: size = 180/2^z degrees, row = floor((90-lat)/size), col = floor((lon+180)/size)."""
import io, json, math, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
HERE = Path(__file__).parent; CACHE = HERE / 'cache'; OUT = HERE.parent / 'public' / 'globe'
VIKING = ('https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{r}/{c}.jpg', 256, 'vik')
CTX = ('https://trek.nasa.gov/tiles/Mars/EQ/Gale_CTX_BlockAdj_dd/1.0.0/default/default028mm/{z}/{r}/{c}.png', 256, 'galectx')   # NASA JPL Mars Trek, covers 135.18-139.24 E, 6.57-2.81 S

def tile(src, z, r, c):
    url, px, tag = src; f = CACHE / f'{tag}_{z}_{r}_{c}.img'
    if not f.exists():
        for k in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url.format(z=z, r=r, c=c), headers={'User-Agent': 'Mozilla/5.0'}), timeout=40) as u:
                    f.write_bytes(u.read()); break
            except Exception as e:
                if k == 3: print('  missing', tag, z, r, c, e); return Image.new('RGB', (px, px))
                time.sleep(1.5)
    try: return Image.open(io.BytesIO(f.read_bytes())).convert('RGB')
    except Exception: return Image.new('RGB', (px, px))

def mosaic(src, z, s, w, n, e):
    """Stitch the tiles covering a lat/lon box and crop to it exactly. Returns the image."""
    size = 180 / 2 ** z; px = src[1]
    r0, r1 = math.floor((90 - n) / size), math.floor((90 - s) / size - 1e-9)
    c0, c1 = math.floor((w + 180) / size), math.floor((e + 180) / size - 1e-9)
    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    im = Image.new('RGB', ((c1 - c0 + 1) * px, (r1 - r0 + 1) * px))
    with ThreadPoolExecutor(8) as ex:
        for (r, c), t in zip(jobs, ex.map(lambda j: tile(src, z, *j), jobs)): im.paste(t.resize((px, px)), ((c - c0) * px, (r - r0) * px))
    k = px / size
    return im.crop((round((w + 180 - c0 * size) * k), round((90 - n - r0 * size) * k), round((e + 180 - c0 * size) * k), round((90 - s - r0 * size) * k)))

def sharpen(colour, detail):
    """Viking colour x CTX brightness."""
    colour = colour.resize(detail.size, Image.BICUBIC).convert('YCbCr'); y = detail.convert('L')
    y0, cb, cr = colour.split()
    y = Image.composite(y, y0, y.point(lambda v: 255 if v > 4 else 0))     # where CTX has no data, keep the Viking brightness
    return Image.merge('YCbCr', (y, cb, cr)).convert('RGB')

OUT.mkdir(parents=True, exist_ok=True); CACHE.mkdir(exist_ok=True)
g = mosaic(VIKING, 3, -90, -180, 90, 180); g.save(OUT / 'global.jpg', quality=90); print('global', g.size)
boxes = {'crater': dict(s=-6.57, w=135.19, n=-2.81, e=139.24, zc=7, zd=9), 'sharp': dict(s=-5.30, w=137.15, n=-4.55, e=137.90, zc=7, zd=12)}
meta = {}
for name, b in boxes.items():
    col = mosaic(VIKING, b['zc'], b['s'], b['w'], b['n'], b['e']); det = mosaic(CTX, b['zd'], b['s'], b['w'], b['n'], b['e'])
    if max(det.size) > 4096: det = det.resize((round(det.width * 4096 / max(det.size)), round(det.height * 4096 / max(det.size))), Image.LANCZOS)
    out = sharpen(col, det); out.save(OUT / f'{name}.jpg', quality=88); meta[name] = dict(s=b['s'], w=b['w'], n=b['n'], e=b['e'], px=out.size); print(name, out.size)
# Wider context so the close-ups never show their edges: Viking colour around Gale, and the HiRISE mosaic (2.7 m per pixel here) around the walk area.
b = dict(s=-11.6, w=131.6, n=0.8, e=144.0); r = mosaic(VIKING, 7, b['s'], b['w'], b['n'], b['e']); r.save(OUT / 'region.jpg', quality=90); meta['region'] = dict(b, px=r.size); print('region', r.size)
import numpy as np
t = json.loads((OUT.parent / 'data' / 'terrain.json').read_text()); clat, clon = (t['lat_top'] + t['lat_bottom']) / 2, (t['lon_left'] + t['lon_right']) / 2
b = dict(s=clat - .11, w=clon - .11, n=clat + .11, e=clon + .11)
HIRISE = ('https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/{z}/{r}/{c}.png', 256, 'hirise')   # NASA/JPL/UArizona via Mars Trek
det = mosaic(HIRISE, 14, b['s'], b['w'], b['n'], b['e']); det = det.resize((4096, 4096), Image.LANCZOS)
near = np.asarray(sharpen(mosaic(VIKING, 7, b['s'], b['w'], b['n'], b['e']), det)).astype(np.float32)
# Tone match (display only): give the CTX surround the same average colour and contrast as the HiRISE colour orthophoto it frames.
o = np.asarray(Image.open(OUT.parent / 'data' / 'ortho.jpg').convert('RGB').resize((800, 800))).astype(np.float32)
coloured = (o.max(axis=2) - o.min(axis=2)) > 25                      # skip the strip where HiRISE has no colour
for ch in range(3):
    src = near[..., ch]; ref = o[..., ch][coloured]
    near[..., ch] = (src - src.mean()) / (src.std() + 1e-6) * ref.std() * .9 + ref.mean()
Image.fromarray(np.clip(near, 0, 255).astype(np.uint8)).save(OUT / 'near.jpg', quality=88); meta['near'] = dict(b, px=[4096, 4096]); print('near ok')
(OUT / 'bounds.json').write_text(json.dumps(meta))
