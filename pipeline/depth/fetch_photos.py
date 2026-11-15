"""Download the best ~2 rover raw images per waypoint from rover_images.json.

Selection per waypoint: the Mastcam colour frame (if any) + the Navcam frame(s)
with mast elevation closest to the horizon. Originals go to a raw cache dir
(default pipeline/depth/_raw, git-ignorable); resized copies are written later by
make_depth.py. Polite: <=4 concurrent requests, small sleeps, generic UA.

usage: python fetch_photos.py [--per 2] [--raw DIR]
"""
import argparse, json, time, random, hashlib, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "app/public/data/rover_images.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def img_id(url: str) -> str:
    return Path(url).stem.replace(".", "_")


def select(wp, per):
    ims = wp["images"]
    mast = [im for im in ims if im["instrument"].startswith("MAST")]
    nav = sorted([im for im in ims if im["instrument"].startswith("NAV")],
                 key=lambda im: -(im["mast_el"] if im["mast_el"] is not None else -90))
    out = mast[:1] + nav
    return out[:per]


def fetch(url, dest: Path):
    if dest.exists() and dest.stat().st_size > 1000:
        return dest, "cached"
    time.sleep(0.2 + random.random() * 0.4)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            dest.write_bytes(data)
            return dest, f"{len(data)//1024} KB"
        except Exception as e:  # noqa
            err = e
            time.sleep(1.5 * (attempt + 1))
    return dest, f"FAIL {err}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=2)
    ap.add_argument("--raw", default=str(Path(__file__).parent / "_raw"))
    a = ap.parse_args()
    raw = Path(a.raw); raw.mkdir(parents=True, exist_ok=True)
    wps = json.loads(SRC.read_text())
    jobs = []
    sel = {}
    for wp in wps:
        for im in select(wp, a.per):
            iid = img_id(im["url"])
            ext = Path(im["url"]).suffix.lower()
            jobs.append((im["url"], raw / f"{iid}{ext}"))
            sel.setdefault(wp["rmc"], []).append(iid)
    (raw / "selection.json").write_text(json.dumps(sel, indent=1))
    with ThreadPoolExecutor(max_workers=4) as ex:
        for dest, msg in ex.map(lambda j: fetch(*j), jobs):
            print(dest.name, msg, flush=True)


if __name__ == "__main__":
    main()
