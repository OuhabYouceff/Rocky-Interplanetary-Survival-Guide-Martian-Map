"""Reproduce Guo et al. 2026 (JGR Planets, e2026JE009704) Table 1 blocked-sky ratios at Curiosity RAD parking sites,
using the same DEM the paper used (USGS MSL Gale DEM Mosaic 1 m v3) read over HTTP.
Background periods (BG*) span several drives: we average over the waypoints occupied during the period."""
import json, sys, time
import numpy as np, rasterio
sys.path.insert(0, 'pipeline')
from horizon import MultiResDEM, horizon_elevations, ros_metrics, R_MARS, dose_weights

URL = '/vsicurl/https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
wp = {f['properties']['RMC']: f['properties'] for f in json.load(open('data/raw/MSL_waypoints.json'))['features']}
C = np.load('data/raw/mosaic_ovr16.npy')
ct = rasterio.Affine(*json.load(open('data/raw/mosaic_ovr16_transform.json')))

# period -> (paper sum ROS %, paper measured decrease %, paper modelled Dsky decrease %, waypoint RMCs occupied)
PERIODS = {
    'BG1': (7.9, None, None, {'78_1442': 1.5, '78_1652': 9.0, '78_1946': 3.0, '78_2228': 0.5}),  # sols occupied in 2643.5-2657.5
    'P1': (13.7, 4.0, 6.5, ['79_0']),
    'BG2': (5.4, None, None, ['79_654']),
    'P2': (14.8, 7.1, 10.3, ['79_1222']),
    'BG3': (7.2, None, None, ['80_1398', '80_1708', '80_2136']),
    'P3': (12.7, 6.5, 6.5, ['80_2388']),
    'BG4/5': (11.8, None, None, ['87_792']),
    'P4': (14.4, 3.8, 4.2, ['87_834']),
    'P5': (11.4, 2.1, 1.7, ['87_1444']),
    'BG6': (18.0, None, None, ['92_270']),
    'P6': (37.9, 19.4, 24.1, ['92_84']),
    'BG7': (22.1, None, None, ['96_2600', '96_2724']),
    'P7': (32.8, 9.8, 14.6, ['96_2862']),
    'BG8': (17.8, None, None, ['97_256', '97_434', '97_546']),
    'P8': (29.6, 9.9, 22.0, ['96_3150']),
}
BG_OF = {'P1': 'BG1', 'P2': 'BG2', 'P3': 'BG3', 'P4': 'BG4/5', 'P5': 'BG4/5', 'P6': 'BG6', 'P7': 'BG7', 'P8': 'BG8'}
SITE = {'P1': 'Tower Buttes', 'P2': 'Tower Buttes', 'P3': 'Bloodstone Hill', 'P4': 'Mt Mercou', 'P5': 'Mt Mercou',
        'P6': 'Maria Gordon Notch', 'P7': 'Paraitepuy', 'P8': 'Paraitepuy'}

cache = {}
res = {}
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='NO', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif,.ovr', VSI_CACHE='TRUE',
                  CPL_VSIL_CURL_CHUNK_SIZE='10485760', GDAL_HTTP_MERGE_CONSECUTIVE_RANGES='YES'):
    d = rasterio.open(URL)
    for per, (ros_p, meas, dsky_p, rmcs) in PERIODS.items():
        weights = list(rmcs.values()) if isinstance(rmcs, dict) else [1.0] * len(rmcs)
        rmcs = list(rmcs)
        ros_list, curves = [], []
        for rmc in rmcs:
            p = wp[rmc]
            x0 = np.deg2rad(p['lon']) * R_MARS; y0 = np.deg2rad(p['lat']) * R_MARS
            if rmc not in cache:
                t = time.time()
                win = d.window(x0 - 400, y0 - 400, x0 + 400, y0 + 400).round_offsets().round_lengths()
                F = d.read(1, window=win)
                dem = MultiResDEM(F, d.window_transform(win), C.copy(), ct)
                e = horizon_elevations(dem, [x0], [y0], n_az=1440, h_obs=1.0, fine_limit=390)
                cache[rmc] = e[0]
                print(f'  read+scan {rmc} {time.time() - t:.0f}s', flush=True)
            m = ros_metrics(cache[rmc][None, :])
            ros_list.append(float(m['sum_ros'][0])); curves.append(m['ros'][0])
        ros_curve = np.average(curves, axis=0, weights=weights)
        res[per] = dict(period=per, rmcs=rmcs, ros_ours=100 * float(np.average(ros_list, weights=weights)), ros_paper=ros_p,
                        measured=meas, dsky_paper=dsky_p, ros_curve=ros_curve.tolist(),
                        lat=wp[rmcs[0]]['lat'], lon=wp[rmcs[0]]['lon'], sol=wp[rmcs[0]]['sol'],
                        horizon=[round(float(v), 2) for v in cache[rmcs[0]][::4]])
        print(f"{per:6s} ROS ours {res[per]['ros_ours']:5.1f}%  paper {ros_p:5.1f}%", flush=True)

theta = np.arange(0.5, 90.0, 1.0); w = dose_weights(theta)
for per, bg in BG_OF.items():
    Dp = (w * (1 - np.array(res[per]['ros_curve']))).sum(); Db = (w * (1 - np.array(res[bg]['ros_curve']))).sum()
    res[per]['dsky_ours'] = 100 * (Db - Dp) / Db
    res[per]['site'] = SITE[per]
    print(f"{per} {SITE[per]:20s} dose decrease vs {bg}: model ours {res[per]['dsky_ours']:5.1f}%  paper model {res[per]['dsky_paper']}%  RAD measured {res[per]['measured']}%")
json.dump(res, open('data/validation_rad.json', 'w'), indent=1)
a = np.array([r['ros_ours'] for r in res.values()]); b = np.array([r['ros_paper'] for r in res.values()])
print(f'n={len(a)}  r={np.corrcoef(a, b)[0, 1]:.3f}  mean |diff|={np.abs(a - b).mean():.2f} pts  max={np.abs(a - b).max():.1f}')
print('saved data/validation_rad.json (copy to app/public/data/ for the app)')
