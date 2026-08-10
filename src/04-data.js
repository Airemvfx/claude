/* ==========================================================================
   Game data — weapons, mods, enemies, bosses, biomes, level graph
   ========================================================================== */

const AMMO = {
  light: { name: 'LIGHT', cap: 300, color: 0xd9b45c },
  heavy: { name: 'HEAVY', cap: 240, color: 0xc08040 },
  shell: { name: 'SHELL', cap: 90, color: 0xb0453a },
  mag: { name: 'MAGNUM', cap: 60, color: 0xcf6a3a },
};

/* weapon models: little box assemblies held in the right hand.
   p = offset (x right, y up, z forward), s = size, c = colour           */
const WM = {
  pistol: [
    { p: [0, 0, .22], s: [.07, .1, .34], c: 0x2a2d33 },
    { p: [0, -.11, .02], s: [.07, .18, .12], c: 0x1b1d21 },
  ],
  smg: [
    { p: [0, 0, .3], s: [.08, .12, .5], c: 0x24272c },
    { p: [0, -.15, .06], s: [.07, .24, .1], c: 0x1a1c20 },
    { p: [0, .09, .18], s: [.05, .06, .22], c: 0x3a3f46 },
  ],
  rifle: [
    { p: [0, 0, .42], s: [.08, .13, .82], c: 0x2b2419 },
    { p: [0, -.14, .1], s: [.07, .22, .12], c: 0x1c1710 },
    { p: [0, .1, .3], s: [.05, .07, .3], c: 0x40372a },
    { p: [0, -.16, .42], s: [.06, .16, .16], c: 0x191b1e },
  ],
  sniper: [
    { p: [0, 0, .55], s: [.075, .12, 1.15], c: 0x1f2a22 },
    { p: [0, .15, .38], s: [.07, .1, .38], c: 0x14181a, e: 0x224466 },
    { p: [0, -.14, .12], s: [.07, .24, .13], c: 0x161a14 },
    { p: [0, -.2, .5], s: [.05, .18, .1], c: 0x14181a },
  ],
  amr: [
    { p: [0, 0, .68], s: [.11, .16, 1.5], c: 0x2c2c2e },
    { p: [0, .18, .4], s: [.08, .12, .5], c: 0x101214, e: 0x335577 },
    { p: [0, -.18, .16], s: [.09, .3, .16], c: 0x171718 },
    { p: [0, 0, 1.36], s: [.16, .16, .22], c: 0x0e0f10 },
  ],
  revolver: [
    { p: [0, 0, .28], s: [.07, .1, .42], c: 0x54585e },
    { p: [0, -.02, .12], s: [.13, .13, .14], c: 0x6a6f76 },
    { p: [0, -.13, .0], s: [.06, .2, .13], c: 0x3b2a1c },
  ],
  shotgun: [
    { p: [0, 0, .45], s: [.11, .13, .9], c: 0x33231a },
    { p: [0, -.14, .12], s: [.08, .22, .14], c: 0x241a13 },
    { p: [-.09, -.04, .3], s: [.05, .09, .4], c: 0x1d1f22 },
  ],
  lmg: [
    { p: [0, 0, .5], s: [.11, .15, 1.0], c: 0x23262a },
    { p: [0, -.22, .22], s: [.2, .26, .3], c: 0x1a1d20 },
    { p: [0, .12, .34], s: [.06, .08, .4], c: 0x33383e },
    { p: [0, -.16, .1], s: [.07, .22, .12], c: 0x15171a },
  ],
  blade: [
    { p: [0, 0, .3], s: [.04, .16, .6], c: 0xb8c0cc, e: 0x223040 },
    { p: [0, 0, -.04], s: [.06, .1, .16], c: 0x3a2a1c },
  ],
  club: [
    { p: [0, 0, .42], s: [.13, .13, .8], c: 0x9a7b4a },
    { p: [0, 0, -.02], s: [.07, .07, .22], c: 0x4a3a24 },
  ],
  staff: [
    { p: [0, .1, .18], s: [.06, .06, 1.1], c: 0x3b2c1d },
    { p: [0, .34, .62], s: [.2, .2, .2], c: 0x101018, e: 0xffffff },
  ],
  wand: [
    { p: [0, .02, .24], s: [.06, .06, .5], c: 0x2a2233 },
    { p: [0, .06, .5], s: [.16, .16, .16], c: 0x1a1424, e: 0xffffff },
  ],
  tome: [
    { p: [0, 0, .2], s: [.3, .08, .36], c: 0x2b1a2c },
    { p: [0, .07, .2], s: [.24, .04, .3], c: 0xd8cfa8, e: 0xffffff },
  ],
  orbstaff: [
    { p: [0, .04, .2], s: [.05, .05, .9], c: 0x22323a },
    { p: [0, .16, .58], s: [.26, .26, .26], c: 0x0c1418, e: 0xffffff },
    { p: [0, -.06, .58], s: [.1, .1, .1], c: 0x0c1418, e: 0xffffff },
  ],
};

/* --------------------------------------------------------------------------
   WEAPONS
   kind: 'melee' | 'gun' | 'magic'
   fire: rounds per minute (guns) / casts per minute (magic)
   proj: how the shot behaves
   -------------------------------------------------------------------------- */
const WEAPONS = [
  /* ---------------- melee ---------------- */
  {
    id: 'fists', name: 'BARE FISTS', kind: 'melee', tier: 0, dmg: 9, fire: 150,
    range: 1.75, arc: 1.5, knock: 2.2, model: null, hand: 'none',
    desc: 'Desperation. Swings fast, hits like paper.',
  },
  {
    id: 'knife', name: 'TRENCH KNIFE', kind: 'melee', tier: 1, dmg: 21, fire: 190,
    range: 1.9, arc: 1.1, knock: 1.6, crit: .18, critMul: 2.6, model: WM.blade, hand: 'r',
    desc: 'Quick, quiet, and vicious on a clean hit.',
  },
  {
    id: 'bat', name: 'NAILED BAT', kind: 'melee', tier: 1, dmg: 38, fire: 95,
    range: 2.5, arc: 1.9, knock: 7.5, stun: .5, model: WM.club, hand: 'r',
    desc: 'Slow, wide, and sends the dead flying.',
  },
  {
    id: 'cleaver', name: 'BUTCHER CLEAVER', kind: 'melee', tier: 3, dmg: 74, fire: 105,
    range: 2.7, arc: 2.1, knock: 8, bleed: 14, model: WM.club, hand: 'r',
    boss: true, desc: 'Torn from the Butcher. Deep cuts keep bleeding.',
  },

  /* ---------------- firearms ---------------- */
  {
    id: 'pistol', name: 'M9 SIDEARM', kind: 'gun', cls: 'PISTOL', tier: 1,
    dmg: 17, fire: 380, mag: 15, reload: 1.25, ammo: 'light', spread: .028,
    speed: 78, crit: .07, critMul: 2, model: WM.pistol, sfx: 'shootLight',
    desc: 'Reliable. Never quite enough.',
  },
  {
    id: 'wasp', name: 'WASP MACHINE PISTOL', kind: 'gun', cls: 'SMG', tier: 2,
    dmg: 11, fire: 1050, mag: 33, reload: 1.5, ammo: 'light', spread: .085,
    speed: 74, auto: true, model: WM.smg, sfx: 'shootLight', shake: .5,
    desc: 'Empties a magazine before you finish blinking.',
  },
  {
    id: 'hive', name: 'HIVE SMG', kind: 'gun', cls: 'SMG', tier: 2,
    dmg: 15, fire: 780, mag: 40, reload: 1.7, ammo: 'light', spread: .05,
    speed: 76, auto: true, model: WM.smg, sfx: 'shootLight', shake: .55,
    desc: 'Controllable spray with a fat magazine.',
  },
  {
    id: 'ratchet', name: 'RATCHET AK', kind: 'gun', cls: 'ASSAULT RIFLE', tier: 3,
    dmg: 28, fire: 620, mag: 30, reload: 2.0, ammo: 'heavy', spread: .055,
    speed: 92, auto: true, pierce: 1, model: WM.rifle, sfx: 'shootHeavy', shake: .9,
    desc: 'Kicks like a mule, punches through the first body.',
  },
  {
    id: 'hammerhead', name: 'HAMMERHEAD M4', kind: 'gun', cls: 'ASSAULT RIFLE', tier: 3,
    dmg: 23, fire: 760, mag: 30, reload: 1.75, ammo: 'heavy', spread: .03,
    speed: 96, auto: true, pierce: 1, crit: .1, model: WM.rifle, sfx: 'shootHeavy', shake: .75,
    desc: 'Tight, fast, and forgiving. The workhorse.',
  },
  {
    id: 'longshot', name: 'LONGSHOT DMR', kind: 'gun', cls: 'MARKSMAN RIFLE', tier: 4,
    dmg: 58, fire: 260, mag: 12, reload: 2.1, ammo: 'heavy', spread: .012,
    speed: 130, pierce: 2, crit: .18, critMul: 2.4, model: WM.rifle, sfx: 'shootHeavy', shake: 1.2,
    desc: 'Semi-auto precision. Rewards patience over panic.',
  },
  {
    id: 'widowmaker', name: 'WIDOWMAKER', kind: 'gun', cls: 'SNIPER RIFLE', tier: 5,
    dmg: 150, fire: 52, mag: 5, reload: 2.9, ammo: 'heavy', spread: .002,
    speed: 190, pierce: 4, crit: .3, critMul: 2.8, laser: 0x66ccff,
    model: WM.sniper, sfx: 'shootSniper', shake: 2.2,
    desc: 'One trigger pull, one lane cleared. Laser sight included.',
  },
  {
    id: 'gravecaller', name: 'GRAVECALLER .50', kind: 'gun', cls: 'ANTI-MATERIEL', tier: 6,
    dmg: 300, fire: 34, mag: 4, reload: 3.6, ammo: 'mag', spread: .004,
    speed: 210, pierce: 10, knock: 16, crit: .25, critMul: 2.5, laser: 0xff8844,
    model: WM.amr, sfx: 'shootSniper', shake: 3.4,
    desc: 'Anti-materiel round. Deletes whole columns of the dead.',
  },
  {
    id: 'judge', name: 'THE JUDGE', kind: 'gun', cls: 'REVOLVER', tier: 3,
    dmg: 76, fire: 165, mag: 6, reload: 2.4, ammo: 'mag', spread: .022,
    speed: 110, crit: .26, critMul: 3, knock: 6, model: WM.revolver, sfx: 'shootHeavy', shake: 1.5,
    desc: 'Six rulings. No appeals.',
  },
  {
    id: 'sweeper', name: 'STREETSWEEPER', kind: 'gun', cls: 'AUTO SHOTGUN', tier: 4,
    dmg: 15, fire: 190, mag: 8, reload: 2.6, ammo: 'shell', spread: .17,
    pellets: 9, speed: 66, range: 15, auto: true, knock: 5,
    model: WM.shotgun, sfx: 'shootShell', shake: 1.8,
    desc: 'Nine pellets of room-clearing argument.',
  },
  {
    id: 'grinder', name: 'GRINDER LMG', kind: 'gun', cls: 'MACHINE GUN', tier: 5,
    dmg: 21, fire: 900, mag: 120, reload: 4.4, ammo: 'heavy', spread: .075,
    speed: 88, auto: true, pierce: 1, spinup: .45, model: WM.lmg, sfx: 'shootHeavy', shake: .8,
    desc: 'Spins up, then never stops. Reloads take an age.',
  },

  /* ---------------- magic ---------------- */
  {
    id: 'emberwand', name: 'EMBERWAND', kind: 'magic', cls: 'PYROMANCY', tier: 2,
    dmg: 46, fire: 210, mana: 9, spread: .02, speed: 34, model: WM.wand,
    element: 'fire', color: 0xff7a22, light: [1, .45, .1],
    proj: 'lob', aoe: 3.1, burn: 16, sfx: 440,
    desc: 'Hurls a fireball that bursts into clinging flame.',
  },
  {
    id: 'stormcaller', name: 'STORMCALLER', kind: 'magic', cls: 'ELECTROMANCY', tier: 3,
    dmg: 40, fire: 165, mana: 13, model: WM.staff,
    element: 'shock', color: 0x66ddff, light: [.4, .8, 1],
    proj: 'chain', chains: 5, chainRange: 7.5, chainFalloff: .82, stun: .35, sfx: 720,
    desc: 'Lightning leaps between the dead until the charge runs dry.',
  },
  {
    id: 'frostbrand', name: 'FROSTBRAND', kind: 'magic', cls: 'CRYOMANCY', tier: 3,
    dmg: 30, fire: 260, mana: 10, model: WM.blade,
    element: 'frost', color: 0x9fe8ff, light: [.5, .85, 1],
    proj: 'cone', coneAngle: .85, range: 8.5, slow: .55, slowTime: 3, freeze: .1, sfx: 520,
    desc: 'Exhales a killing cold that locks limbs in place.',
  },
  {
    id: 'voidlance', name: 'VOID LANCE', kind: 'magic', cls: 'ENTROPY', tier: 4,
    dmg: 88, fire: 105, mana: 20, model: WM.orbstaff,
    element: 'void', color: 0xb060ff, light: [.6, .3, 1],
    proj: 'beam', range: 26, pierce: 99, pull: 6, sfx: 300,
    desc: 'A line of unmaking that drags everything it touches inward.',
  },
  {
    id: 'sunflare', name: 'SUNFLARE ROD', kind: 'magic', cls: 'RADIANCE', tier: 4,
    dmg: 62, fire: 90, mana: 22, model: WM.staff,
    element: 'holy', color: 0xffe08a, light: [1, .9, .55],
    proj: 'nova', aoe: 7.5, healPerHit: 3, sfx: 660,
    desc: 'A ring of daylight. Every soul it burns feeds you back.',
  },
  {
    id: 'censer', name: 'ROT CENSER', kind: 'magic', cls: 'PLAGUE', tier: 3,
    dmg: 16, fire: 130, mana: 14, speed: 22, model: WM.wand,
    element: 'poison', color: 0x9ad14a, light: [.5, .9, .3],
    proj: 'lob', aoe: 3.4, cloud: { time: 6.5, dps: 26, radius: 3.6 }, sfx: 240,
    desc: 'Lobs a censer of spores. The cloud does the real work.',
  },
  {
    id: 'meteorsigil', name: 'METEOR SIGIL', kind: 'magic', cls: 'CATACLYSM', tier: 5,
    dmg: 240, fire: 42, mana: 38, model: WM.tome,
    element: 'fire', color: 0xff5a1e, light: [1, .4, .12],
    proj: 'meteor', aoe: 6.5, delay: .95, burn: 30, sfx: 180,
    desc: 'Marks the ground. What answers arrives from very far up.',
  },
  {
    id: 'bloodfang', name: 'BLOODFANG', kind: 'magic', cls: 'HEMOMANCY', tier: 4,
    dmg: 54, fire: 190, mana: 11, speed: 30, model: WM.wand,
    element: 'blood', color: 0xd6203c, light: [1, .15, .2],
    proj: 'seek', seekTurn: 3.6, lifesteal: .3, sfx: 200,
    desc: 'Hungry motes that chase the living dead and feed you.',
  },
  {
    id: 'gravewhisper', name: 'GRAVEWHISPER', kind: 'magic', cls: 'NECROMANCY', tier: 5,
    dmg: 44, fire: 55, mana: 30, model: WM.tome,
    element: 'void', color: 0x86f0c0, light: [.4, 1, .75],
    proj: 'summon', blades: 3, bladeTime: 14, sfx: 340,
    desc: 'Calls spectral blades that orbit you and cut on their own.',
  },
  {
    id: 'prism', name: 'PRISM OF RUIN', kind: 'magic', cls: 'ARCANA', tier: 6,
    dmg: 34, fire: 420, mana: 6, model: WM.orbstaff,
    element: 'arcane', color: 0xff66cc, light: [1, .5, .9],
    proj: 'ricochet', bounces: 4, bounceRange: 9, speed: 60, sfx: 880,
    desc: 'A sustained beam that ricochets from body to body.',
  },
];
const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

/* --------------------------------------------------------------------------
   MODS — permanent stacking upgrades
   -------------------------------------------------------------------------- */
const MODS = [
  { id: 'serum', name: 'TITAN SERUM', icon: '✚', color: 0xff6a6a, tier: 1, desc: '+25 max health', apply: s => s.maxHp += 25 },
  { id: 'plate', name: 'ARMOR PLATE', icon: '▣', color: 0xb9c2cc, tier: 1, desc: '+30 armour plating', apply: s => s.maxArmor += 30 },
  { id: 'shieldcore', name: 'SHIELD CORE', icon: '◈', color: 0x66ccff, tier: 2, desc: '+45 recharging shield', apply: s => s.maxShield += 45 },
  { id: 'kevlar', name: 'KEVLAR WEAVE', icon: '▤', color: 0x8f9b7a, tier: 2, desc: '+9% damage resistance', apply: s => s.resist += .09 },
  { id: 'adrenal', name: 'ADRENAL INJECTOR', icon: '⇈', color: 0xffe066, tier: 1, desc: '+12% move speed', apply: s => s.speedMul += .12 },
  { id: 'amp', name: 'DAMAGE AMP', icon: '⚡', color: 0xff9a3c, tier: 2, desc: '+16% weapon damage', apply: s => s.dmgMul += .16 },
  { id: 'crit', name: 'CRIT LENS', icon: '◎', color: 0xff5577, tier: 2, desc: '+8% crit, +25% crit damage', apply: s => { s.critAdd += .08; s.critMulAdd += .25; } },
  { id: 'leech', name: 'LIFESTEAL SIGIL', icon: '♥', color: 0xd6203c, tier: 3, desc: '+6% lifesteal', apply: s => s.lifesteal += .06 },
  { id: 'manacrys', name: 'MANA CRYSTAL', icon: '✦', color: 0xb060ff, tier: 2, desc: '+30 max mana, +30% regen', apply: s => { s.maxMana += 30; s.manaRegenMul += .3; } },
  { id: 'rig', name: 'RELOAD RIG', icon: '⟳', color: 0x9ad14a, tier: 2, desc: '-18% reload, +10% fire rate', apply: s => { s.reloadMul *= .82; s.fireMul += .1; } },
  { id: 'berserk', name: 'BERSERK TOTEM', icon: '☠', color: 0xff3b30, tier: 3, desc: 'up to +45% damage at low health', apply: s => s.berserk += .45 },
  { id: 'ward', name: 'GUARDIAN WARD', icon: '☗', color: 0x7fd4ff, tier: 3, desc: '18% chance to shockwave + brief invulnerability when hit', apply: s => s.ward += .18 },
  { id: 'pouch', name: 'AMMO POUCH', icon: '≡', color: 0xd9b45c, tier: 1, desc: '+50% reserve ammo capacity', apply: s => s.ammoCapMul += .5 },
  { id: 'vampcore', name: 'VAMPIRIC CORE', icon: '✜', color: 0xb0203c, tier: 4, boss: true, desc: 'heal 12 on every kill', apply: s => s.healOnKill += 12 },
  { id: 'juggernaut', name: 'JUGGERNAUT FRAME', icon: '⬢', color: 0xc0a060, tier: 4, boss: true, desc: '+60 max health, +15% resistance, -5% speed', apply: s => { s.maxHp += 60; s.resist += .15; s.speedMul -= .05; } },
  { id: 'overclock', name: 'OVERCLOCK CHIP', icon: '✱', color: 0xff66cc, tier: 4, boss: true, desc: '+30% fire rate, +20% damage', apply: s => { s.fireMul += .3; s.dmgMul += .2; } },
];
const MOD_BY_ID = Object.fromEntries(MODS.map(m => [m.id, m]));

/* --------------------------------------------------------------------------
   ENEMIES
   -------------------------------------------------------------------------- */
const ENEMIES = {
  walker: {
    name: 'WALKER', hp: 58, speed: 1.85, dmg: 11, range: 1.5, atkCd: 1.0, xp: 6,
    skin: 0x6f8a4e, cloth: 0x4a4436, h: 1.72, w: .42, aggro: 15, gore: 1,
  },
  runner: {
    name: 'RUNNER', hp: 38, speed: 4.35, dmg: 9, range: 1.4, atkCd: .7, xp: 9,
    skin: 0x8aa05c, cloth: 0x5c3a30, h: 1.62, w: .36, aggro: 22, gore: .8, lunge: true,
  },
  brute: {
    name: 'BRUTE', hp: 260, speed: 1.55, dmg: 30, range: 2.0, atkCd: 1.5, xp: 26,
    skin: 0x5e7a44, cloth: 0x3a3228, h: 2.35, w: .66, aggro: 18, gore: 2, knockRes: .75, slam: true,
  },
  spitter: {
    name: 'SPITTER', hp: 66, speed: 1.6, dmg: 15, range: 13, atkCd: 2.1, xp: 16,
    skin: 0x86b04a, cloth: 0x3c4a2a, h: 1.66, w: .44, aggro: 20, gore: 1.2, ranged: 'acid',
  },
  stalker: {
    name: 'STALKER', hp: 74, speed: 3.5, dmg: 22, range: 1.6, atkCd: .9, xp: 20,
    skin: 0x40505a, cloth: 0x1e2630, h: 1.8, w: .38, aggro: 26, gore: 1, fade: true,
  },
  screamer: {
    name: 'SCREAMER', hp: 90, speed: 2.2, dmg: 8, range: 1.5, atkCd: 1.2, xp: 22,
    skin: 0xa88a6a, cloth: 0x50303c, h: 1.7, w: .44, aggro: 24, gore: 1, scream: true,
  },
  bomber: {
    name: 'BLOATER', hp: 110, speed: 1.5, dmg: 46, range: 2.2, atkCd: 1, xp: 24,
    skin: 0x9aac52, cloth: 0x44502c, h: 1.9, w: .74, aggro: 19, gore: 2.4, explode: 4.6,
  },
  hound: {
    name: 'ROT HOUND', hp: 52, speed: 5.0, dmg: 14, range: 1.5, atkCd: .8, xp: 14,
    skin: 0x6a5240, cloth: 0x3a2c22, h: .95, w: .5, aggro: 28, gore: 1, quad: true, lunge: true,
  },
  knight: {
    name: 'BONE KNIGHT', hp: 220, speed: 2.1, dmg: 34, range: 2.2, atkCd: 1.3, xp: 34,
    skin: 0xd8d2c0, cloth: 0x4a4a58, h: 1.95, w: .52, aggro: 20, gore: 1.4, armor: .35, metal: .6,
  },
  revenant: {
    name: 'REVENANT', hp: 150, speed: 2.6, dmg: 26, range: 12, atkCd: 2.4, xp: 40,
    skin: 0x7ad0c0, cloth: 0x203038, h: 1.9, w: .46, aggro: 26, gore: .6,
    ranged: 'void', float: true, emissive: [0.2, 0.9, 0.7],
  },
  frostwight: {
    name: 'FROST WIGHT', hp: 190, speed: 2.4, dmg: 28, range: 1.8, atkCd: 1.1, xp: 38,
    skin: 0xa8dcf0, cloth: 0x2a4a5c, h: 1.85, w: .48, aggro: 24, gore: .8,
    emissive: [0.25, 0.6, 0.9], chill: true,
  },
};

/* --------------------------------------------------------------------------
   BOSSES
   -------------------------------------------------------------------------- */
const BOSSES = {
  butcher: {
    name: 'THE BUTCHER', title: 'warden of the cellar', hp: 2200, speed: 2.35,
    skin: 0x9a6a52, cloth: 0x6a1f1f, h: 3.0, w: 1.05, xp: 300,
    accent: [1, .2, .12], dropWeapon: 'cleaver', dropKey: 'border_pass', dropMod: 'juggernaut',
    contact: 26,
    phases: [
      { at: 1.0, abilities: ['charge', 'slam'] },
      { at: 0.55, abilities: ['charge', 'slam', 'summon'], speedMul: 1.2, rage: 1.25 },
      { at: 0.22, abilities: ['charge', 'slam', 'summon', 'frenzy'], speedMul: 1.45, rage: 1.5 },
    ],
    minions: ['walker', 'runner'],
  },
  bloatfather: {
    name: 'THE BLOATFATHER', title: 'thing beneath the grates', hp: 3400, speed: 1.5,
    skin: 0x8fae4c, cloth: 0x40502a, h: 3.3, w: 1.5, xp: 480,
    accent: [.5, 1, .2], dropKey: 'crypt_seal', dropMod: 'vampcore', dropWeapon: 'censer',
    contact: 30,
    phases: [
      { at: 1.0, abilities: ['bile', 'pools'] },
      { at: 0.6, abilities: ['bile', 'pools', 'summon'], rage: 1.2 },
      { at: 0.28, abilities: ['bile', 'pools', 'summon', 'burst'], rage: 1.5, speedMul: 1.3 },
    ],
    minions: ['spitter', 'bomber'],
  },
  subjectzero: {
    name: 'SUBJECT ZERO', title: 'the experiment that worked', hp: 4200, speed: 3.1,
    skin: 0xd8c8b8, cloth: 0x30506a, h: 2.6, w: .8, xp: 640,
    accent: [.3, .8, 1], dropKey: 'ash_pass', dropMod: 'overclock', dropWeapon: 'voidlance',
    contact: 24,
    phases: [
      { at: 1.0, abilities: ['blink', 'laser'] },
      { at: 0.66, abilities: ['blink', 'laser', 'shield'], speedMul: 1.15 },
      { at: 0.3, abilities: ['blink', 'laser', 'shield', 'clones'], speedMul: 1.35, rage: 1.3 },
    ],
    minions: ['stalker', 'runner'],
  },
  choir: {
    name: 'CHOIR OF ASH', title: 'what the faithful became', hp: 5200, speed: 1.9,
    skin: 0xe0d0a0, cloth: 0x6a3020, h: 3.4, w: 1.1, xp: 820,
    accent: [1, .55, .15], dropKey: 'spire_key', dropMod: 'overclock', dropWeapon: 'sunflare',
    contact: 30, float: true,
    phases: [
      { at: 1.0, abilities: ['pillars', 'ring'] },
      { at: 0.65, abilities: ['pillars', 'ring', 'summon'], rage: 1.2 },
      { at: 0.3, abilities: ['pillars', 'ring', 'summon', 'inferno'], rage: 1.45, speedMul: 1.2 },
    ],
    minions: ['knight', 'revenant'],
  },
  sovereign: {
    name: 'THE GREY SOVEREIGN', title: 'first of the quiet dead', hp: 9000, speed: 2.6,
    skin: 0x9aa0aa, cloth: 0x2a2a38, h: 3.8, w: 1.2, xp: 2000,
    accent: [.7, .75, 1], dropMod: 'juggernaut', dropWeapon: 'prism', final: true,
    contact: 36, float: true,
    phases: [
      { at: 1.0, abilities: ['meteors', 'blink'] },
      { at: 0.72, abilities: ['meteors', 'blink', 'summon', 'ring'], rage: 1.15 },
      { at: 0.44, abilities: ['meteors', 'blink', 'summon', 'laser', 'shield'], rage: 1.3, speedMul: 1.2 },
      { at: 0.18, abilities: ['meteors', 'blink', 'summon', 'laser', 'inferno'], rage: 1.6, speedMul: 1.45 },
    ],
    minions: ['revenant', 'knight', 'stalker'],
  },
  frostwarden: {
    name: 'THE FROST WARDEN', title: 'sealed in the vault', hp: 6000, speed: 2.2,
    skin: 0xbfe8ff, cloth: 0x1e4058, h: 3.2, w: 1.1, xp: 1200,
    accent: [.5, .85, 1], dropMod: 'juggernaut', dropWeapon: 'gravecaller', dropKey: 'vault_core',
    contact: 32,
    phases: [
      { at: 1.0, abilities: ['ring', 'summon'] },
      { at: 0.6, abilities: ['ring', 'summon', 'laser'], speedMul: 1.2, rage: 1.25 },
      { at: 0.25, abilities: ['ring', 'summon', 'laser', 'meteors'], speedMul: 1.4, rage: 1.5 },
    ],
    minions: ['frostwight', 'knight'],
  },
};

/* --------------------------------------------------------------------------
   KEYS
   -------------------------------------------------------------------------- */
const KEYS = {
  cellar_key: { name: 'RUSTED CELLAR KEY', color: 0xc08040, desc: 'Opens the hatch behind the corner store.' },
  border_pass: { name: 'IRON BORDER PASS', color: 0xb0b8c4, desc: 'Clears the checkpoint at the north barricade.' },
  park_key: { name: 'PARK GATE KEY', color: 0x8fbf5a, desc: 'Unlocks the treeline gate at Blackpine.' },
  grate_key: { name: 'SEWER GRATE KEY', color: 0x7a9a6a, desc: 'Lifts the drowned grate under the forest.' },
  crypt_seal: { name: 'CRYPT SEAL', color: 0xd8c890, desc: 'Breaks the seal on the ossuary door.' },
  lab_card: { name: 'VECTOR KEYCARD', color: 0x66ccff, desc: 'Grants access to the Vector Labs airlock.' },
  ash_pass: { name: 'ASHLAND CLEARANCE', color: 0xff9a3c, desc: 'Opens the blast doors onto the waste.' },
  mire_token: { name: 'MIRE TOKEN', color: 0x9ad14a, desc: 'The ferryman post at Rotmire accepts this.' },
  cathedral_key: { name: 'CATHEDRAL KEY', color: 0xffe08a, desc: 'Turns the great lock of the Cathedral of Ash.' },
  spire_key: { name: 'SPIRE KEY', color: 0xb060ff, desc: 'The Grey Spire answers only to this.' },
  vault_key: { name: 'GLACIER VAULT KEY', color: 0x9fe8ff, desc: 'A cold key for a colder door.' },
  vault_core: { name: 'VAULT CORE', color: 0x9fe8ff, desc: 'Proof you emptied the Glacier Vault.' },
};

/* --------------------------------------------------------------------------
   BIOMES — look & feel per level type
   -------------------------------------------------------------------------- */
const BIOMES = {
  street: {
    env: {
      sunDir: [.42, .68, .52], sunColor: [2.5, 2.05, 1.42],
      skyTop: [.19, .30, .50], skyHorizon: [.66, .54, .40], groundCol: [.10, .10, .09],
      ambient: [.24, .32, .46], bounce: [.24, .18, .12],
      fogColor: [.46, .46, .46], fogDensity: .011, fogHeight: .05,
      stars: 0, cloud: .55, giStrength: 1, exposure: 1.05, bloom: .5,
      lift: [0, 0, 0], gain: [1.02, 1, .97], desat: .05,
    },
    ground: 0x37372f, groundRough: .92, road: 0x24242a, wall: 0x6b6255, wall2: 0x4c473d,
    accent: 0x8a4a3a, propWood: 0x6b5236, foliage: 0x4a6a34,
  },
  street_night: {
    env: {
      sunDir: [-.3, .55, -.4], sunColor: [.34, .40, .62],
      skyTop: [.03, .05, .11], skyHorizon: [.10, .09, .16], groundCol: [.02, .02, .03],
      ambient: [.09, .12, .2], bounce: [.05, .04, .05],
      fogColor: [.10, .11, .16], fogDensity: .028, fogHeight: .04,
      stars: 1, cloud: .3, giStrength: 1.5, exposure: 1.25, bloom: .8,
      lift: [.005, .008, .016], gain: [.95, .98, 1.08], desat: .08,
    },
    ground: 0x2a2c30, groundRough: .9, road: 0x1c1d21, wall: 0x4a4640, wall2: 0x3c3830,
    accent: 0x8a4a3a, propWood: 0x4a3826, foliage: 0x2c4022, lamps: true,
  },
  dungeon: {
    env: {
      sunDir: [.3, .9, .2], sunColor: [.05, .05, .06],
      skyTop: [.02, .02, .03], skyHorizon: [.04, .03, .03], groundCol: [.01, .01, .01],
      ambient: [.05, .045, .04], bounce: [.03, .02, .015],
      fogColor: [.06, .05, .045], fogDensity: .05, fogHeight: .02,
      stars: 0, cloud: 0, giStrength: 2.2, exposure: 1.35, bloom: .95,
      lift: [.012, .006, .002], gain: [1.06, .98, .9], desat: .04,
    },
    ground: 0x413830, groundRough: .95, road: 0x2e2822, wall: 0x554a3e, wall2: 0x463c32,
    accent: 0xff6a22, propWood: 0x4a3624, foliage: 0x3a4a28, indoor: true, torches: true,
  },
  forest: {
    env: {
      sunDir: [.35, .62, .58], sunColor: [1.5, 1.42, .95],
      skyTop: [.16, .28, .38], skyHorizon: [.48, .52, .38], groundCol: [.06, .09, .05],
      ambient: [.24, .34, .28], bounce: [.14, .20, .10],
      fogColor: [.30, .38, .30], fogDensity: .026, fogHeight: .045,
      stars: 0, cloud: .7, giStrength: 1.2, exposure: 1.1, bloom: .55,
      lift: [0, .004, 0], gain: [.95, 1.05, .92], desat: .02,
    },
    ground: 0x2e3a22, groundRough: .95, road: 0x3e3626, wall: 0x4a4034, wall2: 0x3c3428,
    accent: 0x6a8a3a, propWood: 0x53401f, foliage: 0x3d6626,
  },
  sewer: {
    env: {
      sunDir: [.2, .92, .3], sunColor: [.08, .1, .09],
      skyTop: [.02, .03, .03], skyHorizon: [.03, .04, .04], groundCol: [.01, .012, .01],
      ambient: [.05, .07, .07], bounce: [.03, .045, .04],
      fogColor: [.06, .09, .08], fogDensity: .055, fogHeight: .02,
      stars: 0, cloud: 0, giStrength: 2.4, exposure: 1.3, bloom: .9,
      lift: [.002, .012, .008], gain: [.9, 1.06, 1.0], desat: .06,
    },
    ground: 0x33382f, groundRough: .85, road: 0x272c26, wall: 0x3e463a, wall2: 0x333a30,
    accent: 0x7ad14a, propWood: 0x3a3226, foliage: 0x2e4422, indoor: true, torches: true,
    floorSpecial: 0x1e2a1c,
    water: { color: 0x2a3a26, level: -0.55, emissive: 0x0a1808 },
  },
  crypt: {
    env: {
      sunDir: [.4, .85, .3], sunColor: [.09, .09, .1],
      skyTop: [.03, .03, .04], skyHorizon: [.04, .04, .05], groundCol: [.01, .01, .012],
      ambient: [.07, .07, .09], bounce: [.04, .038, .035],
      fogColor: [.08, .08, .10], fogDensity: .045, fogHeight: .025,
      stars: 0, cloud: 0, giStrength: 2.0, exposure: 1.3, bloom: .95,
      lift: [.006, .006, .014], gain: [.98, .97, 1.08], desat: .1,
    },
    ground: 0x4a463c, groundRough: .9, road: 0x38352e, wall: 0x5e5a4e, wall2: 0x4e4a40,
    accent: 0x9fd8ff, propWood: 0x453a2c, foliage: 0x3a4436, indoor: true, torches: true,
  },
  lab: {
    env: {
      sunDir: [.3, .9, .3], sunColor: [.12, .14, .16],
      skyTop: [.03, .04, .05], skyHorizon: [.05, .06, .07], groundCol: [.02, .02, .02],
      ambient: [.12, .15, .18], bounce: [.07, .08, .09],
      fogColor: [.09, .12, .14], fogDensity: .034, fogHeight: .03,
      stars: 0, cloud: 0, giStrength: 1.8, exposure: 1.1, bloom: 0.72,
      lift: [0, .004, .01], gain: [.94, 1.0, 1.08], desat: .0,
    },
    ground: 0x9aa0a6, groundRough: .35, road: 0x70767c, wall: 0xb0b6bc, wall2: 0x8a9096,
    accent: 0x44ddff, propWood: 0x6a7076, foliage: 0x4a8a6a, indoor: true, panels: true,
  },
  waste: {
    env: {
      sunDir: [.55, .5, -.2], sunColor: [1.5, .95, .55],
      skyTop: [.35, .22, .16], skyHorizon: [.78, .46, .24], groundCol: [.14, .09, .06],
      ambient: [.42, .30, .22], bounce: [.28, .18, .10],
      fogColor: [.62, .42, .26], fogDensity: .022, fogHeight: .04,
      stars: 0, cloud: .35, giStrength: 1.0, exposure: .88, bloom: .55,
      lift: [.012, .004, 0], gain: [1.1, .96, .84], desat: .12,
    },
    ground: 0x6a5238, groundRough: .95, road: 0x54432e, wall: 0x6e5c46, wall2: 0x5a4a38,
    accent: 0xff8a3c, propWood: 0x5a4530, foliage: 0x6a6238,
  },
  swamp: {
    env: {
      sunDir: [-.35, .5, .5], sunColor: [.7, .82, .58],
      skyTop: [.10, .16, .16], skyHorizon: [.28, .34, .26], groundCol: [.04, .06, .04],
      ambient: [.16, .22, .18], bounce: [.09, .13, .08],
      fogColor: [.20, .27, .22], fogDensity: .042, fogHeight: .03,
      stars: .3, cloud: .85, giStrength: 1.5, exposure: 1.2, bloom: .8,
      lift: [.002, .01, .006], gain: [.92, 1.04, .95], desat: .08,
    },
    ground: 0x36402c, groundRough: .95, road: 0x2c3426, wall: 0x40422e, wall2: 0x36382a,
    accent: 0x9ad14a, propWood: 0x3e3220, foliage: 0x36521f, floorSpecial: 0x1d2616,
    water: { color: 0x22301e, level: -0.42, emissive: 0x081204 },
  },
  cathedral: {
    env: {
      sunDir: [.25, .78, .55], sunColor: [1.35, .9, .5],
      skyTop: [.12, .07, .06], skyHorizon: [.42, .22, .12], groundCol: [.06, .03, .02],
      ambient: [.20, .14, .11], bounce: [.18, .09, .05],
      fogColor: [.30, .18, .12], fogDensity: .034, fogHeight: .022,
      stars: .2, cloud: .3, giStrength: 1.9, exposure: 1.15, bloom: 0.85,
      lift: [.016, .006, .002], gain: [1.08, .95, .86], desat: .04,
    },
    ground: 0x554a40, groundRough: .7, road: 0x453c34, wall: 0x6a5c4c, wall2: 0x564a3e,
    accent: 0xffa03c, propWood: 0x4e3a24, foliage: 0x4a4432, indoor: true, torches: true,
  },
  spire: {
    env: {
      sunDir: [-.4, .6, -.5], sunColor: [.55, .6, .95],
      skyTop: [.02, .02, .06], skyHorizon: [.14, .10, .22], groundCol: [.02, .02, .04],
      ambient: [.14, .15, .26], bounce: [.08, .07, .14],
      fogColor: [.14, .12, .24], fogDensity: .03, fogHeight: .022,
      stars: 1, cloud: .55, giStrength: 1.8, exposure: 1.15, bloom: 0.9,
      lift: [.006, .004, .02], gain: [.94, .95, 1.14], desat: .02,
    },
    ground: 0x3a3a48, groundRough: .55, road: 0x2c2c38, wall: 0x4a4a5c, wall2: 0x3c3c4c,
    accent: 0xb060ff, propWood: 0x3a3444, foliage: 0x3a4a52, indoor: false, torches: true,
  },
  ice: {
    env: {
      sunDir: [.3, .68, .55], sunColor: [.85, .98, 1.25],
      skyTop: [.20, .32, .52], skyHorizon: [.62, .74, .88], groundCol: [.18, .24, .3],
      ambient: [.26, .34, .46], bounce: [.20, .26, .36],
      fogColor: [.46, .56, .70], fogDensity: .03, fogHeight: .035,
      stars: 0, cloud: .6, giStrength: 1.1, exposure: .82, bloom: .7,
      lift: [.004, .008, .016], gain: [.94, 1.0, 1.12], desat: .04,
    },
    ground: 0x8fb2c6, groundRough: .4, road: 0x748fa4, wall: 0x86a4bc, wall2: 0x6d8ba4,
    accent: 0x9fe8ff, propWood: 0x5a6a76, foliage: 0x6a8a9a, indoor: true, torches: true,
    floorSpecial: 0x6e93aa,
    water: { color: 0x4a7a96, level: -0.5, emissive: 0x0a2030 },
  },
};

/* --------------------------------------------------------------------------
   LEVELS — the world graph
   exits: { to, kind, key?, label }
   -------------------------------------------------------------------------- */
const LEVELS = [
  {
    id: 'block', idx: 0, name: 'THE RUINED BLOCK', short: 'BLOCK', biome: 'street', gen: 'street',
    size: 92, diff: 1, mapPos: [0.10, 0.78],
    enemies: { walker: 10, runner: 3 }, count: 22, elites: 0,
    keys: ['cellar_key'], lootMul: 1,
    exits: [
      { to: 'cellar', kind: 'hatch', key: 'cellar_key', label: 'CELLAR HATCH' },
      { to: 'northgate', kind: 'gate', key: 'border_pass', label: 'NORTH BARRICADE' },
    ],
    intro: 'The block is quiet. Whatever is left in the houses, take it.',
  },
  {
    id: 'cellar', idx: 1, name: 'THE CELLAR', short: 'CELLAR', biome: 'dungeon', gen: 'dungeon',
    size: 78, diff: 2, mapPos: [0.24, 0.90],
    enemies: { walker: 8, runner: 5, hound: 3 }, count: 26, elites: 1,
    boss: 'butcher', lootMul: 1.35,
    exits: [{ to: 'block', kind: 'stairs', label: 'STAIRS UP' }],
    intro: 'Something below has been busy. It kept the parts it liked.',
  },
  {
    id: 'northgate', idx: 2, name: 'NORTHGATE STREET', short: 'NORTHGATE', biome: 'street_night', gen: 'street',
    size: 100, diff: 3, mapPos: [0.13, 0.60],
    enemies: { walker: 10, runner: 6, spitter: 3, brute: 2, screamer: 2 }, count: 34, elites: 2,
    keys: ['park_key'], lootMul: 1.2,
    exits: [
      { to: 'block', kind: 'gate', label: 'SOUTH BARRICADE' },
      { to: 'blackpine', kind: 'gate', key: 'park_key', label: 'PARK GATE' },
    ],
    intro: 'Night on Northgate. The streetlights still work. That is worse.',
  },
  {
    id: 'blackpine', idx: 3, name: 'BLACKPINE FOREST', short: 'BLACKPINE', biome: 'forest', gen: 'forest',
    size: 108, diff: 4, mapPos: [0.28, 0.46],
    enemies: { walker: 8, runner: 8, hound: 6, brute: 3, stalker: 3 }, count: 38, elites: 2,
    keys: ['grate_key'], lootMul: 1.15,
    exits: [
      { to: 'northgate', kind: 'trail', label: 'PARK GATE' },
      { to: 'sewers', kind: 'grate', key: 'grate_key', label: 'DROWNED GRATE' },
    ],
    intro: 'The pines swallow sound. Things move between the trunks.',
  },
  {
    id: 'sewers', idx: 4, name: 'DROWNED SEWERS', short: 'SEWERS', biome: 'sewer', gen: 'sewer',
    size: 88, diff: 5, mapPos: [0.44, 0.58],
    enemies: { walker: 8, spitter: 8, bomber: 5, hound: 5, brute: 3 }, count: 40, elites: 3,
    boss: 'bloatfather', lootMul: 1.4,
    exits: [{ to: 'blackpine', kind: 'grate', label: 'GRATE UP' },
    { to: 'ossuary', kind: 'door', key: 'crypt_seal', label: 'SEALED DOOR' }],
    intro: 'Waist-deep and rising. Something fat is breathing down here.',
  },
  {
    id: 'ossuary', idx: 5, name: 'OSSUARY CRYPT', short: 'OSSUARY', biome: 'crypt', gen: 'crypt',
    size: 94, diff: 6, mapPos: [0.58, 0.72],
    enemies: { knight: 8, walker: 8, stalker: 5, revenant: 4, brute: 3 }, count: 42, elites: 3,
    keys: ['lab_card'], lootMul: 1.3,
    exits: [
      { to: 'sewers', kind: 'door', label: 'SEALED DOOR' },
      { to: 'labs', kind: 'airlock', key: 'lab_card', label: 'VECTOR AIRLOCK' },
    ],
    intro: 'Rows and rows of the tidy dead. Some of them stood up.',
  },
  {
    id: 'labs', idx: 6, name: 'VECTOR LABS', short: 'LABS', biome: 'lab', gen: 'lab',
    size: 86, diff: 7, mapPos: [0.72, 0.60],
    enemies: { stalker: 8, runner: 8, revenant: 5, knight: 4, bomber: 4 }, count: 44, elites: 4,
    boss: 'subjectzero', lootMul: 1.5,
    exits: [
      { to: 'ossuary', kind: 'airlock', label: 'AIRLOCK' },
      { to: 'ashfall', kind: 'blastdoor', key: 'ash_pass', label: 'BLAST DOORS' },
    ],
    intro: 'Clean floors. Bright lights. Every containment cell is open.',
  },
  {
    id: 'ashfall', idx: 7, name: 'ASHFALL WASTE', short: 'ASHFALL', biome: 'waste', gen: 'waste',
    size: 120, diff: 8, mapPos: [0.84, 0.44],
    enemies: { brute: 8, walker: 10, hound: 8, spitter: 6, bomber: 5 }, count: 48, elites: 4,
    keys: ['mire_token', 'vault_key'], lootMul: 1.35,
    exits: [
      { to: 'labs', kind: 'blastdoor', label: 'BLAST DOORS' },
      { to: 'rotmire', kind: 'ferry', key: 'mire_token', label: 'FERRY POST' },
      { to: 'glacier', kind: 'vault', key: 'vault_key', label: 'GLACIER VAULT' },
    ],
    intro: 'Open ground under an orange sky. Nothing to hide behind.',
  },
  {
    id: 'rotmire', idx: 8, name: 'ROTMIRE SWAMP', short: 'ROTMIRE', biome: 'swamp', gen: 'swamp',
    size: 112, diff: 9, mapPos: [0.72, 0.28],
    enemies: { bomber: 8, spitter: 8, revenant: 6, brute: 6, hound: 6 }, count: 50, elites: 5,
    keys: ['cathedral_key'], lootMul: 1.4,
    exits: [
      { to: 'ashfall', kind: 'ferry', label: 'FERRY POST' },
      { to: 'cathedral', kind: 'door', key: 'cathedral_key', label: 'GREAT LOCK' },
    ],
    intro: 'The water is warm and it moves on its own.',
  },
  {
    id: 'cathedral', idx: 9, name: 'CATHEDRAL OF ASH', short: 'CATHEDRAL', biome: 'cathedral', gen: 'cathedral',
    size: 100, diff: 10, mapPos: [0.56, 0.16],
    enemies: { knight: 10, revenant: 8, walker: 8, stalker: 6, brute: 5 }, count: 52, elites: 5,
    boss: 'choir', lootMul: 1.6,
    exits: [
      { to: 'rotmire', kind: 'door', label: 'GREAT LOCK' },
      { to: 'spire', kind: 'ascent', key: 'spire_key', label: 'THE ASCENT' },
    ],
    intro: 'They sang until the fire took their throats. They are still singing.',
  },
  {
    id: 'spire', idx: 10, name: 'THE GREY SPIRE', short: 'SPIRE', biome: 'spire', gen: 'spire',
    size: 84, diff: 12, mapPos: [0.34, 0.08],
    enemies: { revenant: 10, knight: 8, stalker: 8, brute: 6 }, count: 46, elites: 6,
    boss: 'sovereign', lootMul: 1.8, final: true,
    exits: [{ to: 'cathedral', kind: 'ascent', label: 'DESCENT' }],
    intro: 'Above the ash. The thing that started all of this is waiting.',
  },
  {
    id: 'glacier', idx: 11, name: 'GLACIER VAULT', short: 'VAULT', biome: 'ice', gen: 'vault',
    size: 82, diff: 11, mapPos: [0.93, 0.20], optional: true,
    enemies: { frostwight: 10, knight: 8, stalker: 6, brute: 4 }, count: 44, elites: 5,
    boss: 'frostwarden', lootMul: 2.0,
    exits: [{ to: 'ashfall', kind: 'vault', label: 'VAULT DOOR' }],
    intro: 'Sealed before the fall, and something inside kept the cold company.',
  },
];
const LEVEL_BY_ID = Object.fromEntries(LEVELS.map(l => [l.id, l]));

/* --------------------------------------------------------------------------
   LOOT tables per container type. Weapon drops scale with level difficulty.
   -------------------------------------------------------------------------- */
const CONTAINERS = {
  crate: { name: 'WOODEN CRATE', color: 0x6b5236, w: 1.0, h: .8, tex: 2, texScale: 4.0, weights: { ammo: 5, med: 2, weapon: 2, mod: 1, mana: 1 } },
  locker: { name: 'STEEL LOCKER', color: 0x4a5560, w: .9, h: 1.9, metal: .6, tex: 4, texScale: 1.8, weights: { weapon: 5, ammo: 4, mod: 2, med: 1, mana: 1 } },
  medbox: { name: 'MEDICAL BOX', color: 0xd8d4cc, w: .8, h: .6, accent: 0xcc3333, tex: 4, texScale: 2.4, weights: { med: 6, mod: 2, ammo: 1, mana: 2 } },
  cache: { name: 'ARMS CACHE', color: 0x3c4a34, w: 1.4, h: .9, metal: .35, tex: 4, texScale: 1.5, weights: { weapon: 6, ammo: 5, mod: 4, med: 2, mana: 2 } },
  reliquary: { name: 'RELIQUARY', color: 0x6a5a34, w: 1.0, h: 1.3, metal: .5, accent: 0xffd070, tex: 8, texScale: 2.2, weights: { mod: 6, weapon: 4, mana: 4, med: 2, ammo: 1 } },
};

/** weapons that can spawn at a given difficulty */
function lootWeaponPool(diff) {
  return WEAPONS.filter(w => !w.boss && w.tier > 0 && w.tier <= Math.max(2, Math.ceil(diff * 0.62) + 1));
}
function lootModPool(diff) {
  return MODS.filter(m => !m.boss && m.tier <= Math.max(1, Math.ceil(diff * 0.42)));
}
