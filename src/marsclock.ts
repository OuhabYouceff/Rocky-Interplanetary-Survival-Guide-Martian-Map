// Mars time at Gale crater (Allison & McEwen 2000, the algorithm behind NASA GISS Mars24).
// Ported from the Marswalk prototype (tablet.js). Gives Curiosity's mission sol and Local Mean Solar Time.
export const GALE_LON_E = 137.4;
const MSL_LANDING = Date.UTC(2012, 7, 6, 5, 17, 57);
const TT_UTC = 37 + 32.184; // leap seconds + TT offset, seconds

/** Mars Sol Date for a Unix time in ms. */
export const msd = (ms: number) => ((ms / 86400000 + 2440587.5 + TT_UTC / 86400) - 2405522.0028779) / 1.0274912517;
const SOL0 = Math.floor(msd(MSL_LANDING) + GALE_LON_E / 360);

export interface MarsTime { sol: number; lmst: string; lmstHours: number; utc: string }

export function marsNow(now = Date.now()): MarsTime {
  const local = msd(now) + GALE_LON_E / 360;
  const h = (local % 1) * 24;
  const hh = Math.floor(h), mm = Math.floor((h % 1) * 60);
  return {
    sol: Math.floor(local) - SOL0,
    lmst: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    lmstHours: h,
    utc: new Date(now).toISOString().slice(11, 16),
  };
}
