# Changelog

All notable changes to **Zombies 3D: Escape the Horde**. The in-game
**Menu → Changelog** is generated from [`src/version.js`](./src/version.js);
keep the two in sync.

## v0.1.1 — Straighten Up (2026-07-16)

- Fixed reversed movement — the player's facing vector didn't match the camera,
  so once you turned, WASD/arrow controls inverted (forward drove back, left
  strafed right). Movement now tracks exactly where you're looking at every
  angle. Melee swings land where you aim, too.

## v0.1.0 — Into the Third Dimension (2026-07-16)

- A ground-up 3D remake of *Zombies: Escape the Horde* — now a first-person
  survival shooter built on Three.js, with no build step and Three vendored so
  it runs offline.
- Full 6-degree freedom: pointer-lock mouse-look and WASD on desktop, twin touch
  controls (left stick moves, right side looks) on phones, with FIRE / reload /
  swap / sprint buttons.
- Four settings to fight through — The Streets, the ruined Mall, a haunted
  Hospital and the Blackpine Woods — each a walled arena with cover, atmosphere
  and a glowing EXIT to reach.
- Six weapons: combat knife, 9mm pistol, machine gun, pump shotgun, hunting
  rifle and a bazooka, with per-weapon damage, spread, recoil, reloads and
  shared ammo pools.
- Zombie variety in 3D — shambling walkers, sprinting runners, hulking brutes
  and acid-lobbing spitters, each with its own size, speed, health and
  behaviour, animated with a stepping shamble.
- Headshots, blood puffs, muzzle flash, screen-shake, a damage vignette,
  explosive rockets, a live radar minimap and synthesized sound for every gun,
  hit and groan.
- Escalating waves: clear the horde, grab weapon and ammo pickups, then reach
  the EXIT to advance to the next setting. Survive as long as you can and chase a
  high score.
