// Small math / helper toolbox (shared across the game).
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;
export const now = () => performance.now();

// Distance on the ground plane (XZ), ignoring height.
export const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist2XZ = (a, b) => {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
};

// Smooth an angle toward a target by t (handles wrap-around).
export const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};
