# 🧟 Zombies 3D: Escape the Horde

A **first-person 3D zombie survival shooter** — the 3D remake of
[Zombies: Escape the Horde](https://github.com/Bobs-Dev-Attic/Zombies). Fight
through the Streets, a ruined Mall, a haunted Hospital and the Blackpine Woods,
gather weapons, gun down the horde, and reach the glowing **EXIT** before you're
overrun.

Built as a **zero-build static web app** — vanilla JavaScript + [Three.js](https://threejs.org)
(vendored, so it runs offline) rendering real 3D. No bundler, no install step;
serve the folder and play.

**▶️ Current version: `0.1.0`** — see [`CHANGELOG.md`](./CHANGELOG.md) or the
in-game **Menu → Changelog**.

## Features

- 🕹️ **True first person** — pointer-lock mouse-look + WASD on desktop; twin
  touch controls on phones (left stick moves, right side looks) with on-screen
  FIRE / reload / swap / sprint.
- 🌆 **Four settings** — The Streets, the Mall, the Hospital and the Blackpine
  Woods, each a walled arena with themed lighting, fog and cover.
- 🔫 **Six weapons** — combat knife, 9mm pistol, machine gun, pump shotgun,
  hunting rifle and a bazooka, each with its own damage, spread, recoil,
  reloads, knockback and shared ammo pools. Hitscan guns plus a travelling,
  exploding rocket.
- 🧟 **Zombie variety** — shambling walkers, sprinting runners, hulking brutes
  and acid-lobbing spitters, each with its own size, speed, health and AI.
- 🎯 **Headshots & gore** — aim high to drop most zombies instantly; blood
  puffs, muzzle flash, tracers, screen-shake and a damage vignette sell every
  hit.
- 🏃 **Stamina** — sprinting drains stamina; run dry and you're slowed until it
  recovers.
- 🧭 **Live radar minimap**, weapon & ammo pickups, and escalating waves — clear
  the horde, then reach the **EXIT** to advance to the next setting.
- 🔊 **Synthesized sound** — every gunshot, explosion, reload, pickup and groan
  is generated live with the Web Audio API (no audio files).

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Look / Aim | Mouse (click to lock) | Drag the right half of the screen |
| Move | WASD / Arrows | Left virtual stick |
| Sprint | Hold Shift | » button (toggle) / push stick fully |
| Fire | Left-click / Space (hold) | FIRE button |
| Reload | R | ⟳ |
| Swap weapon | Q / mouse-wheel / 1–9 | ↔ |
| Pause | Esc | — |

## Run locally

It's a static site — serve the folder with anything:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the served URL. On desktop, click the game to lock the mouse. On
iOS/Android use **Add to Home Screen** for a fullscreen, app-like experience.

> Because the game uses ES modules and an import map, it must be **served over
> HTTP** (not opened as a `file://` URL).

## Deploy to Vercel

No build step is required — [`vercel.json`](./vercel.json) configures it as a
static deployment.

```bash
npm i -g vercel
vercel        # preview
vercel --prod # production
```

Or import the GitHub repo at [vercel.com/new](https://vercel.com/new) with the
defaults (Framework Preset: **Other**, no build command, output = repo root).

## Project structure

```
index.html        # shell: canvas, HUD, touch UI, menus, import map
styles.css        # UI / HUD styling
vendor/
  three.module.min.js   # vendored Three.js (r160)
src/
  main.js         # entry point — wires DOM/UI to the game
  game.js         # scene/renderer, loop, waves, combat, particles, HUD
  world.js        # arena generation, colliders, exit
  player.js       # first-person controller (look, move, stamina, health)
  zombie.js       # zombie types, AI and 3D models
  weapons.js      # weapon catalogue & loadout
  input.js        # pointer-lock mouse + keyboard + twin touch controls
  audio.js        # synthesized Web Audio SFX
  util.js         # math helpers
  version.js      # single source of truth for version + changelog
```

## Credits

3D rendering by [Three.js](https://threejs.org) (MIT). Everything else is
original. Gameplay concept ported from the 2D
[Zombies: Escape the Horde](https://github.com/Bobs-Dev-Attic/Zombies).

## License

MIT.
