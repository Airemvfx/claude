# DEADGRID 3D — zombie survival

A 3D top-down zombie survival game for mobile browsers, in a single
self-contained `index.html`. No dependencies, no build tools, no assets —
the renderer, the world, the models and the sound are all generated at
runtime from code.

## The renderer

A custom WebGL2 engine written from scratch (no three.js — artifacts block
external scripts, and it keeps the whole game one file):

- **Instanced forward+ pipeline** — shadow pass → normal/depth prepass →
  SSAO → sky → opaque → transparent → particles → bloom → composite.
- **Cascaded-free sun shadows** with texel-snapped ortho projection and
  5-tap Poisson PCF, so edges don't crawl as the camera moves.
- **Baked global illumination.** Each level bakes an irradiance grid: light
  floods out from sky-open cells and from every torch, brazier and console
  panel, attenuating through the level and blocked by walls. The alpha
  channel stores sky visibility, which gates direct sun — that is what
  keeps interiors dark even though the roofs aren't modelled. Torch light
  bleeding down a corridor is real bounced light, not a fudge.
- **SSAO** (16-sample hemisphere kernel, blurred at half res) for contact
  shadows.
- **PBR-ish shading** — GGX specular, hemisphere ambient, up to 16 dynamic
  point lights for muzzle flashes, fireballs, magic projectiles and pickups.
- **Post** — bright-pass bloom with a 5-level tent-filter chain, ACES
  tonemap, gamma, contrast/saturation grade, per-biome lift/gain, vignette,
  film grain, chromatic aberration that rises as you take damage.
- **Adaptive quality** — render scale and SSAO back off automatically if
  frame times slip.

Every mesh is procedural (box, cylinder, cone, icosphere, prism,
octahedron, plane) and every character is a blocky rig animated on the CPU:
walk cycles, attack swings, lean, death collapse.

## The game

**Twelve linked areas.** Ruined block → cellar → night street → forest →
sewers → crypt → labs → ashfall waste → swamp → cathedral → the Grey Spire,
plus an optional Glacier Vault. Each is procedurally generated from one of
five generators (street blocks, BSP rooms, organic terrain, sewer tunnels,
ring arena) skinned by a biome with its own palette, sun, fog and props.

**Keys gate the graph.** Every locked exit — cellar hatch, border
checkpoint, sewer grate, lab airlock, blast doors, ferry post, the
cathedral's great lock — needs a specific key found in that area's
containers or dropped by a boss. Press **M** for the world map: the level
graph with unlocked, visited and unknown nodes, plus a fog-of-war map of
where you've walked.

**23 weapons.** Melee (fists, knife, nailed bat, the Butcher's cleaver),
11 firearms (pistol, two SMGs, two assault rifles, marksman rifle, sniper,
anti-materiel .50, revolver, auto shotgun, LMG with spin-up), and 10 magic
weapons on a mana pool — fireball, chain lightning, frost cone, void beam
that drags enemies in, healing holy nova, poison cloud, delayed meteor,
lifesteal seekers, orbiting spectral blades, and a ricocheting arcane beam.

**Six bosses**, each with 3–4 phases that add abilities as their health
drops: charges, ground slams, minion summons, bile arcs, toxic pools,
blinks, sweeping lasers, shields, fire pillars, expanding rings, meteor
storms. They drop a key, a unique weapon and a rare mod.

**16 stacking mods** for survivability and scaling — max health, armour
plating, a recharging shield, damage resistance, move speed, damage amp,
crit, lifesteal, mana, reload speed, berserk (damage as health drops),
a guardian ward that shockwaves attackers, and boss-only frames.

**Elites, status effects and hazards** — burn, poison, bleed, slow, freeze
and stun; toxic clouds, fire pools, meteor markers and boss beams.

## Controls

| | |
|---|---|
| Left thumb | move (virtual stick, anywhere on the left half) |
| Right thumb | aim and fire (twin-stick) |
| WASD / arrows | move |
| Mouse | aim, click to fire |
| E | loot / use exit |
| R | reload |
| Space | dash (i-frames) |
| H | medkit |
| Q / wheel / 1-9 | switch weapon |
| M | world map |

## Build

`index.html` is generated from the modules in `src/`:

```
node build.js
```

Then open `index.html`, or serve the folder with `npx serve .`.
Best played on a phone in portrait.

Needs WebGL2 (any browser since ~2021).
