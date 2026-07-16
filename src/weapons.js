// Weapon catalogue for the 3D shooter. Distances are in world units (~metres),
// spread in radians, fireRate in shots/sec. Guns are hitscan (raycast) except
// the bazooka, which fires a travelling rocket that explodes on impact.

export const AMMO_TYPES = ["rounds", "shells", "rockets"]; // melee needs none

export const WEAPONS = {
  knife: {
    name: "Combat Knife", tag: "KNF", kind: "melee", melee: true, damage: 55,
    fireRate: 3.0, range: 2.6, arc: 1.1, knockback: 3, ammoType: null,
    hs: 0.15, sound: "swipe",
  },

  pistol: {
    name: "9mm Pistol", tag: "9mm", kind: "pistol", damage: 30, fireRate: 4.5, pellets: 1,
    spread: 0.012, range: 60, clip: 12, ammoType: "rounds",
    reload: 1.1, knockback: 4, hs: 0.35, sound: "pop",
  },

  smg: {
    name: "Machine Gun", tag: "SMG", kind: "smg", damage: 18, fireRate: 12, pellets: 1,
    spread: 0.045, range: 55, clip: 34, ammoType: "rounds",
    reload: 1.6, knockback: 2.5, auto: true, hs: 0.18, sound: "rattle",
  },

  shotgun: {
    name: "Pump Shotgun", tag: "PMP", kind: "shotgun", damage: 14, fireRate: 1.2, pellets: 9,
    spread: 0.13, range: 32, clip: 6, ammoType: "shells",
    reload: 2.2, knockback: 7, hs: 0.12, sound: "boom",
  },

  rifle: {
    name: "Hunting Rifle", tag: "BLT", kind: "rifle", damage: 85, fireRate: 1.5, pellets: 1,
    spread: 0.002, range: 140, clip: 5, ammoType: "rounds",
    reload: 2.0, knockback: 9, pierce: 3, hs: 0.6, sound: "crack",
  },

  bazooka: {
    name: "Bazooka", tag: "RPG", kind: "bazooka", damage: 130, fireRate: 0.7, pellets: 1,
    range: 120, clip: 1, ammoType: "rockets", speed: 42,
    reload: 2.6, knockback: 16, explosive: 6.5, projectile: true, hs: 0, sound: "launch",
  },
};

// Order used when cycling weapons with Q / mouse-wheel / ↔.
export const WEAPON_ORDER = ["knife", "pistol", "smg", "shotgun", "rifle", "bazooka"];

export function newLoadout() {
  return {
    owned: { knife: true, pistol: true },
    clip: { pistol: WEAPONS.pistol.clip },
    ammo: { rounds: 60, shells: 0, rockets: 0 },
    current: "pistol",
  };
}
