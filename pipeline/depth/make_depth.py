"""Resize selected rover photos and estimate monocular depth with Depth Anything V2 Small.

Outputs (app/public/data/photos/):
  <id>.jpg        photo, long side <= 1024 px, JPEG q76 (fits ~25 MB budget) (Navcam kept greyscale)
  <id>_depth.png  8-bit greyscale, long side <= 512 px.
                  Encoding: normalised RELATIVE INVERSE DEPTH (disparity-like):
                  255 = nearest, 0 = farthest. Sky is forced to 0 (far).
                  Per-image normalisation (robust percentiles) -> NOT metric.
  manifest.json   list of processed images + stats

usage: python make_depth.py [--only ID ...] [--raw DIR] [--device mps|cpu]
"""
import argparse, json, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
import torch
from transformers import AutoImageProcessor, AutoModelForDepthEstimation
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "app/public/data/photos"
MODEL = "depth-anything/Depth-Anything-V2-Small-hf"  # Apache-2.0


def sky_mask(gray: np.ndarray, disp: np.ndarray) -> np.ndarray:
    """Sky = smooth, far (low disparity) region connected to the top edge.
    gray, disp: same HxW float arrays in [0,1]."""
    h, w = gray.shape
    # local texture (std in 9x9 window)
    m = ndimage.uniform_filter(gray, 9)
    m2 = ndimage.uniform_filter(gray * gray, 9)
    tex = np.sqrt(np.clip(m2 - m * m, 0, None))
    far = disp < 0.10
    smooth = tex < 0.035
    cand = far & smooth
    lab, n = ndimage.label(cand)
    if n == 0:
        return np.zeros_like(cand)
    top = np.unique(lab[: max(2, h // 100), :])
    top = top[top > 0]
    sky = np.isin(lab, top)
    # sky only if it is a meaningful region in the upper part of the frame
    if sky.sum() < 0.01 * h * w:
        return np.zeros_like(cand)
    sky = ndimage.binary_closing(sky, iterations=3)
    sky = ndimage.binary_fill_holes(sky)
    return sky


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default=str(Path(__file__).parent / "_raw"))
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    ap.add_argument("--photo-px", type=int, default=1024)
    ap.add_argument("--depth-px", type=int, default=512)
    ap.add_argument("--quality", type=int, default=76)
    a = ap.parse_args()
    raw = Path(a.raw)
    OUT.mkdir(parents=True, exist_ok=True)
    sel = json.loads((raw / "selection.json").read_text())
    ids = [i for v in sel.values() for i in v]
    if a.only:
        ids = [i for i in ids if i in a.only]

    proc = AutoImageProcessor.from_pretrained(MODEL)
    model = AutoModelForDepthEstimation.from_pretrained(MODEL).to(a.device).eval()

    man_path = OUT / "manifest.json"
    manifest = {e["id"]: e for e in json.loads(man_path.read_text())["images"]} if man_path.exists() else {}
    for iid in ids:
        src = next(raw.glob(iid + ".*"))
        im = Image.open(src)
        is_color = im.mode == "RGB" and "DXXX" in iid
        im = im.convert("RGB" if is_color else "L")
        im.thumbnail((a.photo_px, a.photo_px), Image.LANCZOS)
        im.save(OUT / f"{iid}.jpg", quality=a.quality, optimize=True, progressive=True)

        t0 = time.time()
        inp = proc(images=im.convert("RGB"), return_tensors="pt").to(a.device)
        with torch.no_grad():
            pred = model(**inp).predicted_depth  # (1,h,w) relative inverse depth, larger = nearer
        dw, dh = im.size
        s = a.depth_px / max(dw, dh)
        dw, dh = max(1, round(dw * s)), max(1, round(dh * s))
        pred = torch.nn.functional.interpolate(pred[:, None].float().cpu(), size=(dh, dw), mode="bicubic", align_corners=False)[0, 0].numpy()
        lo, hi = np.percentile(pred, 0.5), np.percentile(pred, 99.5)
        # Rover hardware (mast/RTG/deck) in frame is much nearer than any terrain and would
        # eat the top of the range. Cap 'hi' near the nearest *terrain* (median of the bottom
        # rows, where ground dominates) so hardware saturates at 255 and terrain keeps the range.
        bottom = pred[int(pred.shape[0] * 0.96):, :]
        hi = min(hi, 1.08 * float(np.median(bottom)))
        disp = np.clip((pred - lo) / max(hi - lo, 1e-6), 0, 1)
        gray = np.asarray(im.convert("L").resize((dw, dh), Image.BILINEAR), dtype=np.float32) / 255.0
        sky = sky_mask(gray, disp)
        disp[sky] = 0.0
        # soften terracing / mesh tearing at depth edges; keep sky hard at 0
        d8 = Image.fromarray((disp * 255).round().astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
        d = np.asarray(d8).copy()
        d[sky] = 0
        Image.fromarray(d).save(OUT / f"{iid}_depth.png", optimize=True)
        manifest[iid] = {
            "id": iid, "photo": f"data/photos/{iid}.jpg", "depth": f"data/photos/{iid}_depth.png",
            "source": src.name, "color": is_color, "size": list(im.size), "depth_size": [dw, dh],
            "sky_fraction": round(float(sky.mean()), 3),
        }
        print(f"{iid} {im.size} sky={sky.mean():.2f} {time.time()-t0:.2f}s", flush=True)

    rmc_of = {i: k for k, v in sel.items() for i in v}
    for e in manifest.values():
        e["rmc"] = rmc_of.get(e["id"])
    man_path.write_text(json.dumps({
        "model": MODEL, "model_license": "Apache-2.0",
        "encoding": "8-bit PNG, normalised relative inverse depth per image: 255 = nearest, 0 = farthest/sky. Not metric.",
        "images": sorted(manifest.values(), key=lambda e: (e["rmc"] or "", e["id"])),
    }, indent=1))


if __name__ == "__main__":
    main()
