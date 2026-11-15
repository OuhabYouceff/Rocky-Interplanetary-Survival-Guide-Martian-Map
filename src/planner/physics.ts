// Suited-astronaut locomotion model, ported from NASA/MIT Pextant (github.com/norheim/pextant, MIT licence):
//   speed vs slope: Marquez 2008 (piecewise, degrees)
//   energy:         Santee et al. 2001 (FixedAstronaut variant: path length along the slope)
// Gravity enters the slope (lifting) term explicitly. The level-walking term in Pextant has no gravity term;
// `levelGravityScaling` is a labelled ASSUMPTION the user can turn on (scales it by (g/9.81)^0.5).

export const G_MARS = 3.71;
export const G_EARTH = 9.81;

export interface ExplorerParams {
  bodyMass: number;   // kg, astronaut
  suitMass: number;   // kg, suit + PLSS
  loadOut: number;    // kg carried outbound (tools)
  loadBack: number;   // kg carried on the return (tools + samples)
  g: number;          // m/s^2
  maxSlopeDeg: number; // hard limit for suited walking (lunar EVA ConOps cites 20 deg)
  maxSpeed: number;    // m/s pace cap; default 0.92 m/s (3.3 km/h), a cautious walking pace for a loaded suited crew
  levelGravityScaling: boolean;
  // Crew-down drill (off when undefined): the walk home is done hauling an incapacitated partner.
  rescueMass?: number;  // kg added on the walk home only (partner + suit)
  rescuePace?: number;  // m/s pace cap on the walk home only
}

/** Parameters and total mass for the walk home; identical to the planned return unless the crew-down drill is on. */
export function homeLoad(p: ExplorerParams): [number, ExplorerParams] {
  const mass = p.bodyMass + p.suitMass + p.loadBack + (p.rescueMass ?? 0);
  return [mass, p.rescuePace ? { ...p, maxSpeed: Math.min(p.maxSpeed, p.rescuePace) } : p];
}

export const DEFAULT_PARAMS: ExplorerParams = {
  bodyMass: 80,
  suitMass: 60,
  loadOut: 15,
  loadBack: 25,
  g: G_MARS,
  maxSlopeDeg: 20,
  maxSpeed: 0.92,
  levelGravityScaling: false,
};

/** Marquez 2008 walking speed (m/s) as a function of slope in degrees (positive = uphill). */
export function speed(slopeDeg: number): number {
  const s = slopeDeg;
  if (s <= -20) return 0.05;
  if (s <= -10) return 0.095 * s + 1.95;
  if (s <= 0) return 0.06 * s + 1.6;
  if (s <= 6) return -0.2 * s + 1.6;
  if (s <= 15) return -0.039 * s + 0.634;
  return 0.05;
}

/**
 * Cost of walking one edge. dl = horizontal length (m), dz = height change (m).
 * Returns [energy J, time s], or null if the slope exceeds the limit.
 */
export function edgeCost(dl: number, dz: number, mass: number, p: ExplorerParams): [number, number] | null {
  const slope = Math.atan2(dz, dl);
  const deg = (slope * 180) / Math.PI;
  if (Math.abs(deg) > p.maxSlopeDeg) return null;
  const L = dl / Math.cos(slope);
  const v = Math.min(speed(deg), p.maxSpeed);
  return [walkEnergy(L, slope, v, mass, p), L / v];
}

/** Santee energy (J) to walk a path of length L (m, along the slope) at slope (radians) and speed v (m/s). */
export function walkEnergy(L: number, slope: number, v: number, mass: number, p: ExplorerParams): number {
  const deg = (slope * 180) / Math.PI;
  const workDz = mass * p.g * L * Math.sin(slope);
  const slopeCost = slope < 0 ? 2.4 * workDz * Math.pow(0.3, Math.abs(deg) / 7.65) : 3.5 * workDz;
  let level = (3.28 * mass + 71.1) * (0.661 * Math.cos(slope) + 0.115 / v) * L;
  if (p.levelGravityScaling) level *= Math.sqrt(p.g / G_EARTH);
  // Santee's downhill term is negative (a credit); Dijkstra needs non-negative edges, so floor at 20% of level cost.
  return Math.max(level + slopeCost, 0.2 * level);
}

/** Metabolic rate (W) of a walker of total mass `mass` at speed v on a treadmill grade (percent) under gravity g: energy for one second of walking. */
export function metabolicWatts(mass: number, g: number, v: number, gradePct: number, levelGravityScaling = false): number {
  return walkEnergy(v, Math.atan(gradePct / 100), v, mass, { ...DEFAULT_PARAMS, g, levelGravityScaling });
}
