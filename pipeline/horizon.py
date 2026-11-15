"""Terrain horizon scan on the Gale 1 m DEM, following Guo et al. 2026 (JGR Planets, e2026JE009704).

For an observer 1 m above the DEM, we find the horizon elevation angle e(az) over 360 deg of azimuth,
out to a 20 km radius. Mars curvature is included (R = 3396.19 km).

  ROS(theta)    = fraction of azimuths whose horizon blocks zenith angle theta, i.e. e(az) >= 90 - theta
  Sum ROS*dtheta = (1/90) * integral_0^90 ROS dtheta = mean_az(max(e,0)) / 90   (the paper's Table 1 column)
  Dose decrease  = sum_theta d(theta) ROS(theta) / sum_theta d(theta), where d(theta) is the zenith-angle dose
                   curve digitised from Guo et al. 2021 / 2026 Fig. 2 (GCR protons + He, phi ~ 400 MV)

The DEM is Mars equirectangular (clon 0) in metres on the 3396190 m sphere. Ground E-W distance = dx * cos(lat).
"""
from __future__ import annotations
import numpy as np

R_MARS = 3396190.0

# --- Zenith-angle dose curves digitised from Guo et al. 2026, Fig. 2 (phi = 400 MV), uGy/day/deg ---
# Approximate digitisation; only the SHAPE matters because we use ratios.
_H_THETA = np.array([0, 10, 20, 30, 33, 35, 40, 45, 50, 55, 60, 62, 65, 70, 75, 78, 80, 82, 84, 86, 88, 90], float)
_H_DOSE = np.array([0, .50, .98, 1.30, 1.50, 1.75, 2.02, 1.95, 2.40, 2.65, 2.85, 2.72, 3.40, 3.60, 3.80, 3.95, 3.90, 3.85, 3.30, 2.50, 2.00, 1.40])
_HE_THETA = np.array([0, 10, 20, 30, 40, 50, 55, 60, 65, 70, 75, 78, 80, 84, 86, 88, 90], float)
_HE_DOSE = np.array([0, .10, .21, .31, .41, .50, .57, .59, .55, .53, .50, .45, .40, .22, .15, .08, .03])


def dose_weights(theta_deg: np.ndarray) -> np.ndarray:
    """Relative downward dose per degree of zenith angle (H + He)."""
    return np.interp(theta_deg, _H_THETA, _H_DOSE) + np.interp(theta_deg, _HE_THETA, _HE_DOSE)


class MultiResDEM:
    """A fine DEM window for the near field plus a coarse one for the far field (both in DEM CRS metres)."""

    def __init__(self, fine: np.ndarray, fine_transform, coarse: np.ndarray, coarse_transform, nodata=-32767.0):
        self.fine, self.ft = fine.astype(np.float32), fine_transform
        self.coarse, self.ct = coarse.astype(np.float32), coarse_transform
        self.nodata = nodata
        for a in (self.fine, self.coarse):
            a[~(a > -10000.0)] = np.nan  # Mars surface is never below -9 km; catches -32767 and -3.4e38 nodata
        # Align vertical datums: products differ by hundreds of metres (e.g. CTX vs HiRISE at Gale ~ 595 m).
        h, w = self.fine.shape
        rr, cc = np.mgrid[0:h:25, 0:w:25]
        xs = self.ft.c + (cc + 0.5) * self.ft.a; ys = self.ft.f + (rr + 0.5) * self.ft.e
        zf = self.fine[rr, cc]; zc = self._sample(self.coarse, self.ct, xs, ys)
        ok = np.isfinite(zf) & np.isfinite(zc)
        self.datum_offset = float(np.median(zf[ok] - zc[ok])) if ok.sum() > 20 else 0.0
        self.coarse += self.datum_offset

    @staticmethod
    def _sample(arr, tr, x, y):
        # bilinear sample in a north-up affine grid; NaN outside
        col = (x - tr.c) / tr.a - 0.5
        row = (y - tr.f) / tr.e - 0.5
        c0 = np.floor(col).astype(np.int64); r0 = np.floor(row).astype(np.int64)
        fc = col - c0; fr = row - r0
        h, w = arr.shape
        ok = (c0 >= 0) & (r0 >= 0) & (c0 < w - 1) & (r0 < h - 1)
        c0c = np.clip(c0, 0, w - 2); r0c = np.clip(r0, 0, h - 2)
        z = (arr[r0c, c0c] * (1 - fc) * (1 - fr) + arr[r0c, c0c + 1] * fc * (1 - fr)
             + arr[r0c + 1, c0c] * (1 - fc) * fr + arr[r0c + 1, c0c + 1] * fc * fr)
        return np.where(ok, z, np.nan)

    def sample(self, x, y, use_fine):
        zf = self._sample(self.fine, self.ft, x, y) if use_fine else np.full(np.shape(x), np.nan)
        zc = self._sample(self.coarse, self.ct, x, y)
        return np.where(np.isnan(zf), zc, zf)


def ray_distances(r_max=20000.0, near_step=1.0, near_max=200.0, growth=1.02):
    """1 m steps out to near_max, then geometrically growing steps out to r_max."""
    d = list(np.arange(near_step, near_max, near_step))
    s = near_step
    x = near_max
    while x < r_max:
        s *= growth
        x += max(s, near_step)
        d.append(min(x, r_max))
    return np.array(d)


def horizon_elevations(dem: MultiResDEM, x0, y0, n_az=1440, h_obs=1.0, r_max=20000.0, fine_limit=None,
                       dists=None):
    """Horizon elevation angle (deg) for points (x0, y0) arrays over n_az azimuths. Returns shape (N, n_az)."""
    x0 = np.atleast_1d(np.asarray(x0, float)); y0 = np.atleast_1d(np.asarray(y0, float))
    lat = y0 / R_MARS
    coslat = np.cos(lat)
    z0 = dem.sample(x0, y0, True) + h_obs
    if dists is None:
        dists = ray_distances(r_max)
    if fine_limit is None:
        fine_limit = dem.fine.shape[0] * abs(dem.ft.e)  # whole fine window usable
    az = np.deg2rad(np.arange(n_az) * 360.0 / n_az)  # 0 = north, clockwise
    best = np.full((x0.size, n_az), -90.0, dtype=np.float32)
    for j, a in enumerate(az):
        se, ce = np.sin(a), np.cos(a)
        tmax = np.full(x0.size, -np.inf)
        for d in dists:
            # ground displacement d metres along azimuth a -> DEM CRS
            x = x0 + d * se / coslat
            y = y0 + d * ce
            z = dem.sample(x, y, d <= fine_limit)
            drop = d * d / (2 * R_MARS)  # curvature
            t = (z - drop - z0) / d
            tmax = np.fmax(tmax, t)
        best[:, j] = np.degrees(np.arctan(tmax))
    return best


try:
    import numba as _nb

    @_nb.njit(parallel=True, fastmath=True, cache=True)
    def _scan_nb(F, f_c, f_f, f_a, f_e, C, c_c, c_f, c_a, c_e, x0, y0, z0, coslat, dists, fine_limit, n_az):
        N = x0.size
        out = np.empty((N, n_az), np.float32)
        hF, wF = F.shape; hC, wC = C.shape
        for i in _nb.prange(N):
            for j in range(n_az):
                a = 2.0 * np.pi * j / n_az
                se = np.sin(a); ce = np.cos(a)
                tmax = -1e9
                for k in range(dists.size):
                    d = dists[k]
                    x = x0[i] + d * se / coslat[i]; y = y0[i] + d * ce
                    z = np.nan
                    if d <= fine_limit:
                        col = (x - f_c) / f_a - 0.5; row = (y - f_f) / f_e - 0.5
                        c0 = int(np.floor(col)); r0 = int(np.floor(row))
                        if c0 >= 0 and r0 >= 0 and c0 < wF - 1 and r0 < hF - 1:
                            fc = col - c0; fr = row - r0
                            z = (F[r0, c0] * (1 - fc) * (1 - fr) + F[r0, c0 + 1] * fc * (1 - fr)
                                 + F[r0 + 1, c0] * (1 - fc) * fr + F[r0 + 1, c0 + 1] * fc * fr)
                    if not (z == z):
                        col = (x - c_c) / c_a - 0.5; row = (y - c_f) / c_e - 0.5
                        c0 = int(np.floor(col)); r0 = int(np.floor(row))
                        if c0 >= 0 and r0 >= 0 and c0 < wC - 1 and r0 < hC - 1:
                            fc = col - c0; fr = row - r0
                            z = (C[r0, c0] * (1 - fc) * (1 - fr) + C[r0, c0 + 1] * fc * (1 - fr)
                                 + C[r0 + 1, c0] * (1 - fc) * fr + C[r0 + 1, c0 + 1] * fc * fr)
                    if z == z:
                        t = (z - d * d / (2 * 3396190.0) - z0[i]) / d
                        if t > tmax:
                            tmax = t
                out[i, j] = np.degrees(np.arctan(tmax))
        return out

    def horizon_elevations_fast(dem: MultiResDEM, x0, y0, n_az=120, h_obs=1.0, dists=None, fine_limit=1500.0):
        x0 = np.ascontiguousarray(np.atleast_1d(x0), dtype=np.float64)
        y0 = np.ascontiguousarray(np.atleast_1d(y0), dtype=np.float64)
        z0 = (dem.sample(x0, y0, True) + h_obs).astype(np.float64)
        coslat = np.cos(y0 / R_MARS)
        if dists is None:
            dists = ray_distances()
        ft, ct = dem.ft, dem.ct
        return _scan_nb(dem.fine, ft.c, ft.f, ft.a, ft.e, dem.coarse, ct.c, ct.f, ct.a, ct.e,
                        x0, y0, z0, coslat, np.asarray(dists, np.float64), float(fine_limit), int(n_az))
except ImportError:  # pragma: no cover
    horizon_elevations_fast = None


def ros_metrics(elev_deg: np.ndarray):
    """elev_deg (N, n_az) -> dict with sum ROS (fraction), ROS(theta) curve and modelled dose decrease."""
    e = np.clip(np.nan_to_num(elev_deg, nan=0.0), 0.0, 90.0)
    # Blocked fraction of the sky hemisphere's solid angle: integral ROS(theta) sin(theta) dtheta = mean_az sin(e).
    # This reproduces Guo et al. 2026 Table 1 (BG6 18.0% vs 18.0%, P6 33.4% vs 37.9% on the USGS 1 m mosaic).
    sum_ros = np.sin(np.deg2rad(e)).mean(axis=1)
    theta = np.arange(0.5, 90.0, 1.0)
    # ROS(theta): fraction of azimuths with e >= 90 - theta
    ros = (e[:, None, :] >= (90.0 - theta)[None, :, None]).mean(axis=2)
    w = dose_weights(theta)
    dose_dec = (ros * w[None, :]).sum(axis=1) / w.sum()
    return {"sum_ros": sum_ros, "theta": theta, "ros": ros, "dose_decrease": dose_dec}
