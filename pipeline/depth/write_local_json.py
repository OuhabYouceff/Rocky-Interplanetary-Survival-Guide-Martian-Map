"""Write app/public/data/rover_images_local.json: rover_images.json + per-image
`local` (photo) and `depth` (depth PNG) relative paths under data/photos/, or null if
that frame was not downloaded. Also adds `near_fraction` = share of depth pixels >= 250
(a proxy for rover hardware filling the foreground) to help pick the cleanest 3D frame,
and a per-waypoint `photo3d` = index of the suggested frame for the 3D view.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "app/public/data/rover_images.json"
DST = ROOT / "app/public/data/rover_images_local.json"
PH = ROOT / "app/public/data/photos"

wps = json.loads(SRC.read_text())
n = 0
for wp in wps:
    best, best_score = None, -1e9
    for i, im in enumerate(wp["images"]):
        iid = Path(im["url"]).stem.replace(".", "_")
        if (PH / f"{iid}.jpg").exists() and (PH / f"{iid}_depth.png").exists():
            d = np.asarray(Image.open(PH / f"{iid}_depth.png"))
            nf = float((d >= 250).mean())
            im["local"] = f"data/photos/{iid}.jpg"
            im["depth"] = f"data/photos/{iid}_depth.png"
            im["near_fraction"] = round(nf, 3)
            n += 1
            # prefer frames matched to this exact rover position (Navcam, site+drive) that look
            # toward the horizon; penalise rover hardware filling the foreground
            el = im["mast_el"] if im["mast_el"] is not None else -10
            score = (0 if im.get("match") == "site_drive" else -6) + el * 0.3 - nf * 60
            if score > best_score:
                best, best_score = i, score
        else:
            im["local"] = None
            im["depth"] = None
    wp["photo3d"] = best
DST.write_text(json.dumps(wps, indent=1))
print(f"wrote {DST} ({n} local frames)")
