# DEADGRID — zombie survival prototype

A 2D top-down pixel-art zombie survival prototype for mobile browsers,
in a single self-contained `index.html` (no dependencies, no build step).

## Features
- **Procedural map** — every run generates a new abandoned block: roads,
  ruined buildings with broken walls, trees, rubble.
- **Looting** — crates, lockers and medical boxes hide medkits, a pistol,
  ammo, and melee weapons (bat, knife). Medboxes bias toward medkits,
  lockers toward weapons.
- **Combat** — melee swings (fists / knife / bat) and an auto-aiming
  pistol that burns ammo. Zombies wander, aggro, and swarm.
- **Pixel art** — all sprites (player & zombie walk animations,
  containers, tiles) are generated at runtime from pixel maps; no assets.
- **Mobile controls** — virtual joystick (left thumb) + attack / loot /
  heal / weapon-swap buttons (right thumb). WASD + J/E/H/Q on desktop.

## Run it
Open `index.html` in any browser, or serve the folder:

```
npx serve .
```

Best played on a phone in portrait.
