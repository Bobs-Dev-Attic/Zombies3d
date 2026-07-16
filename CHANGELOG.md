# Changelog

All notable changes to **Zombies 3D: Escape the Horde**. The in-game
**Menu → Changelog** is generated from [`src/version.js`](./src/version.js);
keep the two in sync.

## v0.3.0 — The Ragged Horde (2026-07-16)

- Animated reloads — the magazine drops from the grip and tumbles to the floor
  with a thud, the slide racks back and forward, and a circular reload-cycle
  indicator fills below the crosshair while you're vulnerable.
- Fixed zombies facing the wrong way — they now turn to face and lurch straight
  at you as they close in.
- No two zombies are alike: they vary in height and girth, hunch and head-tilt,
  some are missing an eye or hang their jaw, and many have their guts spilling
  from a torn belly.
- Varied gaits — different stride lengths, arm swings and limps; some drag a
  mangled leg, and the legless haul themselves across the ground with their
  arms.

## v0.2.0 — Recoil & Brass (2026-07-16)

- Guns now punch: a bright muzzle flash flares at the barrel and throws light
  onto nearby walls and zombies, fading with distance; the weapon kicks back and
  the muzzle rises with each shot.
- Spent shell casings eject and tumble from the gun, bounce on the ground, and
  clink as the empty brass lands — with a distinct metallic tink.
- Zombies rebuilt with real anatomy — jointed hips, thighs, shins and feet, a
  pelvis and hunched chest, shoulders, upper arms, forearms and hands, plus a
  neck, rounded head and jaw. They walk with bending knees and swinging arms
  instead of stiff blocks.

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
