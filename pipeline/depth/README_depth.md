# Step inside Curiosity's photo: AI depth for rover raw images

Flat Curiosity raw images are turned into small 3D scenes. A monocular depth network
guesses relative depth for every pixel, and the app re-projects the photo along its
camera rays so you can lean around in it.

**This is illustrative.** The depth is a single-image AI estimate. It is not measured
(Curiosity's Navcam stereo pairs would give measured range, but we don't use them here)
and it is not metric. The UI says so on every 3D view.

## Pipeline

| Step | Script | Output |
|---|---|---|
| 1. Pick and download frames | `fetch_photos.py` | `pipeline/depth/_raw/` (originals, git-ignored) and `_raw/selection.json` |
| 2. Resize and run depth | `make_depth.py` | `app/public/data/photos/<id>.jpg`, `<id>_depth.png`, `manifest.json` |
| 3. Integration JSON | `write_local_json.py` | `app/public/data/rover_images_local.json` |

```bash
python3.11 -m venv .venv-depth && .venv-depth/bin/pip install torch transformers pillow numpy scipy
python3 -I pipeline/depth/fetch_photos.py --per 2       # <=4 parallel requests, generic UA, small sleeps
.venv-depth/bin/python -I pipeline/depth/make_depth.py  # MPS on Apple silicon, ~0.1 s per image
.venv-depth/bin/python -I pipeline/depth/write_local_json.py
```
Tested with torch 2.15.0, transformers 5.23.0, numpy 2.4.6, pillow 13.0.0 and scipy 1.17.1 on Python 3.11.

### Selection
There are 60 waypoints and 195 frames in `rover_images.json` (180 Navcam, 15 Mastcam). For
each waypoint we keep 2 frames: the Mastcam colour frame if there is one, plus the Navcam
frames whose mast elevation is closest to the horizon. That gives **120 frames, 23 MB
in total** (photos at a long side of 1024 px, JPEG q76, with Navcam kept greyscale; depth
maps at a long side of 512 px). The q76 setting keeps the set under the ~25 MB budget.
`--per` and `--quality` change this.

### Depth model
- **Model:** `depth-anything/Depth-Anything-V2-Small-hf` (HuggingFace transformers,
  `AutoModelForDepthEstimation`), 24.8 M parameters.
- **Licence:** Apache-2.0 (the HF model card tag is `license:apache-2.0`). We chose
  Small for licence clarity. Base and Large are **CC-BY-NC-4.0**, which is non-commercial,
  so we did not use them.
- Paper: Yang et al., *Depth Anything V2*, NeurIPS 2024 (arXiv:2406.09414).

### Depth PNG encoding
- 8-bit greyscale PNG at a long side of 512 px, with the same aspect ratio as the photo.
- Values are **normalised relative inverse depth** (disparity-like): **255 = nearest,
  0 = farthest or sky**.
- **Normalised per image**: `lo` is the 0.5th percentile and `hi` is the 99.5th
  percentile, capped at 1.08 × the median of the bottom 4 % of rows. The cap lets
  rover hardware (mast, RTG, deck) saturate at 255 so the terrain keeps the full range.
  Values are not comparable between images.
- **Sky mask:** pixels that are smooth (local std below 0.035), far (disparity below
  0.10) and connected to the top edge are forced to 0. The model already places the
  Martian sky far away, so the mask mostly cleans up haze bands.
- A light Gaussian blur (σ = 1.2 px) reduces terracing. The sky stays hard at 0.

## Viewer: `app/src/components/Photo3D.tsx`
```tsx
<Photo3D image="data/photos/<id>.jpg" depth="data/photos/<id>_depth.png" caption="Navcam · sol 4139" />
// optional: fov (vertical deg, inferred from the file name), depthRange (far/near, default 5), style
```
- A 256×256-segment plane. The vertex shader reads the depth map and places each vertex at
  `rayDir(uv) * z`, with `1/z = mix(1/far, 1/near, d)` and far/near = 5. From the neutral
  camera pose the result is exactly the photo. Parallax appears only when the camera moves.
- **3D/2D toggle:** one eased value drives the displacement, a 14 % dolly-in and an
  ~14 % narrower FOV. 2D matches the JPEG's framing, brightness and colour (raw sRGB
  passthrough with no tonemapping: `flat` and `linear` on the Canvas, `NoColorSpace` on
  the textures). Measured mean brightness is equal; per-pixel differences of 2–4 grey
  levels come from resampling.
- **Motion:** a slow Lissajous sway when idle, hover parallax with a mouse, and drag to
  look around with a mouse or touch. Touch keeps `pan-y`, so the drawer still scrolls.
  When you release, the view springs back. The sway is disabled under
  `prefers-reduced-motion`.
- **Edges:** depth discontinuities, such as hardware against the ground, are shaded
  slightly so stretched triangles read as shadow. Camera travel scales with the FOV and
  stays inside the overscan. Maximum-drag tests on a Navcam frame and on portrait and
  square Mastcam frames showed no dark borders.
- **Fallbacks:** the plain `<img>` is always underneath. If the textures fail or WebGL
  throws, the component shows the flat photo, and the AI label and the 3D/2D toggle are
  hidden. Rendering pauses when the view is off-screen
  (IntersectionObserver).
- **FOV:** Navcam uses its real 45° FOV. Mastcam frames (about 5–11°) use a *virtual*
  30° FOV, because at their true FOV the parallax is almost invisible. This is part of
  why the view is labelled illustrative.

## Caveats
- Single-image depth on greyscale engineering frames. The model was not trained on Mars.
  It gets the overall layout right (ground plane, horizon, rover hardware nearest, sky
  far), but small rocks and shadows can be wrong, and bright patches sometimes pop
  forward.
- Relative, per-image normalisation: you can't read distances or slopes from it, and it
  is never used for the planner.
- Rover hardware shows up as the nearest object and stretches when the view moves.
  `rover_images_local.json` includes `near_fraction` (the share of pixels at depth ≥ 250)
  and a per-waypoint `photo3d` index that suggests the cleanest exact-position Navcam frame.
- Mastcam frames are matched to waypoints by sol, not by exact position, the same as in
  the 2D drawer.
- Each Photo3D creates its own WebGL context. Show one at a time (for example, only the
  selected or first frame in the drawer). Browsers cap the number of contexts at about 16.
- Images: NASA/JPL-Caltech (Navcam) and NASA/JPL-Caltech/MSSS (Mastcam), from the MSL
  raw image archive. We did not alter them apart from resizing and JPEG re-encoding.
