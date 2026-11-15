"""Colour image for the 32 km far-field terrain (the horizon around the walk area), 4096 px, north up.
Made from the imagery fetch_globe.py already stitched: CTX (colour from Viking) for the whole box, the HiRISE mosaic for the
13 km around the site, and Rocky's HiRISE colour orthophoto for the walk area itself. The two outer layers are tone-matched
to the orthophoto (display only) so the ground does not change colour at each seam."""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
P = Path(__file__).parent.parent / 'public'
t = json.loads((P / 'data' / 'terrain.json').read_text()); b = json.loads((P / 'globe' / 'bounds.json').read_text())
clat, clon = (t['lat_top'] + t['lat_bottom']) / 2, (t['lon_left'] + t['lon_right']) / 2
KM = 2 * math.pi * 3396.19 / 360; HALF = 16.0
box = dict(s=clat - HALF / KM, n=clat + HALF / KM, w=clon - HALF / (KM * math.cos(math.radians(clat))), e=clon + HALF / (KM * math.cos(math.radians(clat))))
N = 4096
def place(canvas, im, s, w, n, e):
    x0 = (w - box['w']) / (box['e'] - box['w']) * N; x1 = (e - box['w']) / (box['e'] - box['w']) * N
    y0 = (box['n'] - n) / (box['n'] - box['s']) * N; y1 = (box['n'] - s) / (box['n'] - box['s']) * N
    im = im.resize((max(1, round(x1 - x0)), max(1, round(y1 - y0))), Image.LANCZOS); canvas.paste(im, (round(x0), round(y0)))
ortho = Image.open(P / 'data' / 'ortho.jpg').convert('RGB')
o = np.asarray(ortho.resize((800, 800))).astype(np.float32); col = (o.max(axis=2) - o.min(axis=2)) > 25
sharp = np.asarray(Image.open(P / 'globe' / 'sharp.jpg').convert('RGB')).astype(np.float32)
for ch in range(3):
    ref = o[..., ch][col]; src = sharp[..., ch]; sharp[..., ch] = (src - src.mean()) / (src.std() + 1e-6) * ref.std() * .85 + ref.mean()
canvas = Image.new('RGB', (N, N), (150, 95, 60))
place(canvas, Image.fromarray(np.clip(sharp, 0, 255).astype(np.uint8)), b['sharp']['s'], b['sharp']['w'], b['sharp']['n'], b['sharp']['e'])
place(canvas, Image.open(P / 'globe' / 'near.jpg'), b['near']['s'], b['near']['w'], b['near']['n'], b['near']['e'])
place(canvas, ortho, t['lat_bottom'], t['lon_left'], t['lat_top'], t['lon_right'])
canvas.save(P / 'terrain' / 'far.jpg', quality=88); print('far.jpg', canvas.size, box)
