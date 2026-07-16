// Central version + changelog source. Update this on every release.
export const VERSION = "0.4.0";

export const CHANGELOG = [
  {
    version: "0.4.0",
    date: "2026-07-16",
    title: "Hit the Deck",
    changes: [
      "Zombies react to gunfire with procedural physics — the struck spot flinches (a headshot snaps the head back, a body or leg hit kicks that limb out), the torso staggers backward, and heavier weapons shove them harder.",
      "Death ragdolls — instead of stiffly sinking, the dead crumple under gravity along the bullet's impulse: they topple onto their backs, their limbs flop limp, and they tumble and slide to rest before fading.",
      "More lifelike walk — the pelvis bobs and the hips sway with each step, they lean into their stride, knees bend through the swing with the ankles rolling, the head bobs, and the arms counter-swing against the legs.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-16",
    title: "The Ragged Horde",
    changes: [
      "Animated reloads — the magazine drops from the grip and tumbles to the floor with a thud, the slide racks back and forward, and a circular reload-cycle indicator fills below the crosshair while you're vulnerable.",
      "Fixed zombies facing the wrong way — they now turn to face and lurch straight at you as they close in.",
      "No two zombies are alike: they vary in height and girth, hunch and head-tilt, some are missing an eye or hang their jaw, and many have their guts spilling from a torn belly.",
      "Varied gaits — different stride lengths, arm swings and limps; some drag a mangled leg, and the legless haul themselves across the ground with their arms.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-07-16",
    title: "Recoil & Brass",
    changes: [
      "Guns now punch: a bright muzzle flash flares at the barrel and throws light onto nearby walls and zombies, fading with distance; the weapon kicks back and the muzzle rises with each shot.",
      "Spent shell casings eject and tumble from the gun, bounce on the ground, and clink as the empty brass lands — with a distinct metallic tink.",
      "Zombies rebuilt with real anatomy — jointed hips, thighs, shins and feet, a pelvis and hunched chest, shoulders, upper arms, forearms and hands, plus a neck, rounded head and jaw. They walk with bending knees and swinging arms instead of stiff blocks.",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-16",
    title: "Straighten Up",
    changes: [
      "Fixed reversed movement — the player's facing vector didn't match the camera, so once you turned, WASD/arrow controls inverted (forward drove back, left strafed right). Movement now tracks exactly where you're looking at every angle. Melee swings now land where you aim, too.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-07-16",
    title: "Into the Third Dimension",
    changes: [
      "A ground-up 3D remake of Zombies: Escape the Horde — now a first-person survival shooter built on Three.js, with no build step and Three vendored so it runs offline.",
      "Full 6-degree freedom: pointer-lock mouse-look and WASD on desktop, twin touch controls (left stick moves, right side looks) on phones, with FIRE / reload / swap / sprint buttons.",
      "Four settings to fight through — The Streets, the ruined Mall, a haunted Hospital and the Blackpine Woods — each a walled arena with cover, atmosphere and a glowing EXIT to reach.",
      "Six weapons: combat knife, 9mm pistol, machine gun, pump shotgun, hunting rifle and a bazooka, with per-weapon damage, spread, recoil, reloads and shared ammo pools.",
      "Zombie variety in 3D — shambling walkers, sprinting runners, hulking brutes and acid-lobbing spitters, each with its own size, speed, health and behaviour, animated with a stepping shamble.",
      "Headshots, blood puffs, muzzle flash, screen-shake, a damage vignette, explosive rockets, a live radar minimap and synthesized sound for every gun, hit and groan.",
      "Escalating waves: clear the horde, grab weapon and ammo pickups, then reach the EXIT to advance to the next setting. Survive as long as you can and chase a high score.",
    ],
  },
];
