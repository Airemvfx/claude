/* ==========================================================================
   Game — run state, level graph traversal, camera, update/render loop
   ========================================================================== */

class Game {
  constructor(canvas, overlay) {
    this.R = new Renderer(canvas);
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.fx = new FX();
    this.time = 0;
    this.state = 'title';         // title | playing | map | dead | win | transition
    this._tmpDir = [0, 0];
    this.shake = 0;
    this.camPos = v3.create();
    this.camTarget = v3.create();
    this.camLook = v3.create();
    this.viewWidth = 21;          // world units visible across the screen
    this.camFov = 0.80;
    this.grid = new Map();
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.clouds = [];
    this.hazards = [];
    this.toasts = [];
    this.runState = {};
    this.frameTimes = [];
    this.adaptTimer = 0;
    this.paused = false;
    this.autoQuality = true;
  }

  /* ------------------------------ run ------------------------------- */
  newRun(seed) {
    this.seed = seed == null ? (Math.random() * 1e9) | 0 : seed;
    this.rng = new RNG(this.seed);
    this.player = new Player();
    this.runState = {};
    this.discovered = new Set(['block']);
    this.visitedLevels = new Set();
    this.bossesKilled = new Set();
    this.totalKills = 0;
    this.runTime = 0;
    this.deaths = 0;
    this.fx.clear();
    this.state = 'playing';
    this.loadLevel('block');
    this.toast('THE RUINED BLOCK', LEVEL_BY_ID.block.intro, 0xd9a441);
  }

  levelState(id) {
    if (!this.runState[id]) {
      this.runState[id] = {
        seed: (this.seed ^ (id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0)) >>> 0,
        opened: new Set(), bossDead: false, keysTaken: new Set(), cleared: 0, visited: false,
      };
    }
    return this.runState[id];
  }

  loadLevel(id, fromId) {
    const level = LEVEL_BY_ID[id];
    const st = this.levelState(id);
    this.levelId = id;
    this.level = level;
    this.discovered.add(id);
    this.visitedLevels.add(id);
    for (const ex of level.exits) this.discovered.add(ex.to);

    this.world = generateWorld(level, st.seed, this.R);
    this.R.applyEnv(this.world.biome.env);
    this.R.quality.shadowSize = this.R.shadowSize;

    // restore opened containers, assign keys
    const krng = new RNG(st.seed ^ 0x5eed);
    const conts = this.world.containers;
    const keyList = (level.keys || []).filter(k => !st.keysTaken.has(k) && !this.player.keys.has(k));
    for (const keyId of keyList) {
      if (!conts.length) break;
      // prefer a container far from spawn so keys are earned
      let best = null, bd = -1;
      for (let t = 0; t < 40; t++) {
        const c = conts[krng.int(0, conts.length - 1)];
        if (c.key) continue;
        const d = dist2(c.x, c.z, this.world.spawn.x, this.world.spawn.z);
        if (d > bd) { bd = d; best = c; }
      }
      if (best) best.key = keyId;
    }
    for (const c of conts) if (st.opened.has(c.id)) c.opened = true;

    // spawn
    let sp = this.world.spawn;
    if (fromId) {
      const back = this.world.exits.find(e => e.to === fromId);
      if (back) sp = { x: back.x, z: back.z };
    }
    this.player.x = sp.x; this.player.z = sp.z;
    this.player.vx = 0; this.player.vz = 0;

    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.pickups.length = 0;
    this.toasts.length = 0;
    this.clouds.length = 0;
    this.hazards.length = 0;
    this.fx.clear();
    this.boss = null;
    this.bossSpawned = st.bossDead;
    this.spawnBudget = level.count;
    this.spawnTimer = 0;
    this.levelStart = this.time;

    // initial population
    const n0 = Math.round(level.count * .62);
    for (let i = 0; i < n0; i++) this.spawnEnemy(true);

    this.camSnap = true;
    this.world.markVisited(this.player.x, this.player.z, 8);
    computeFlow(this.world, this.player.x, this.player.z);
  }

  enemyTypesFor(level) {
    const out = [];
    for (const k in level.enemies) out.push({ v: k, w: level.enemies[k] });
    return out;
  }

  spawnEnemy(initial) {
    const level = this.level;
    if (this.enemies.length >= level.count + 6) return;
    const pool = this.enemyTypesFor(level);
    const type = this.rng.weighted(pool).v;
    const pts = this.world.spawnPoints;
    if (!pts.length) return;
    let pt = null;
    for (let t = 0; t < 24; t++) {
      const p = pts[this.rng.int(0, pts.length - 1)];
      const d2p = dist2(p.x, p.z, this.player.x, this.player.z);
      if (initial ? d2p > 240 : (d2p > 620 && d2p < 5200)) { pt = p; break; }
    }
    if (!pt) return;
    const eliteChance = level.elites / Math.max(1, level.count);
    const elite = this.rng.chance(eliteChance);
    const e = new Enemy(type, pt.x, pt.z, level.diff, elite);
    this.enemies.push(e);
  }

  maybeSpawnBoss() {
    const level = this.level;
    if (!level.boss || this.bossSpawned || !this.world.bossArena) return;
    const a = this.world.bossArena;
    if (dist2(this.player.x, this.player.z, a.x, a.z) > (a.r + 8) ** 2) return;
    this.bossSpawned = true;
    const b = new Boss(level.boss, a.x, a.z, level.diff);
    this.boss = b;
    this.enemies.push(b);
    Audio3D.SFX.bossRoar();
    this.shake = Math.max(this.shake, 1.4);
    this.toast(b.bdef.name, b.bdef.title, 0xff3b30, 3.4);
    this.R.post.flashColor = [b.bdef.accent[0], b.bdef.accent[1], b.bdef.accent[2]];
    this.R.post.flashAmt = .5;
  }

  onBossPhase(b) {
    Audio3D.SFX.bossRoar();
    this.shake = Math.max(this.shake, 1.0);
    this.fx.ring(b.x, .2, b.z, 1, 16, .8, b.bdef.accent[0], b.bdef.accent[1], b.bdef.accent[2], 1);
    this.toast(b.bdef.name, 'ENRAGES', 0xff3b30, 1.8);
  }

  /* --------------------------- spatial grid -------------------------- */
  rebuildGrid() {
    this.grid.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const k = (Math.floor(e.x / 3) << 16) ^ (Math.floor(e.z / 3) & 0xffff);
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(e);
    }
  }
  nearby(x, z, out) {
    out.length = 0;
    const ci = Math.floor(x / 3), cj = Math.floor(z / 3);
    for (let j = cj - 1; j <= cj + 1; j++) {
      for (let i = ci - 1; i <= ci + 1; i++) {
        const a = this.grid.get((i << 16) ^ (j & 0xffff));
        if (a) for (const e of a) out.push(e);
      }
    }
    return out;
  }
  separation(e) {
    const list = this._sepList || (this._sepList = []);
    this.nearby(e.x, e.z, list);
    let sx = 0, sz = 0;
    for (const o of list) {
      if (o === e || o.dead) continue;
      const dx = e.x - o.x, dz = e.z - o.z;
      const d2 = dx * dx + dz * dz;
      const rr = (e.r + o.r) * 1.05;
      if (d2 > rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (rr - d) / rr;
      sx += dx / d * push; sz += dz / d * push;
    }
    this._sepOut = this._sepOut || [0, 0];
    this._sepOut[0] = sx * 1.5; this._sepOut[1] = sz * 1.5;
    return this._sepOut;
  }

  nearestEnemy(x, z, maxR, exclude) {
    let best = null, bd = maxR * maxR;
    for (const e of this.enemies) {
      if (e.dead || e === exclude) continue;
      const d = dist2(x, z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* ------------------------------ update ----------------------------- */
  update(dt) {
    this.time += dt;
    const P = this.player;
    if (this.state !== 'playing') { this.fx.update(dt, this.world); return; }

    this.runTime += dt;
    P.update(dt, this);
    this.world.markVisited(P.x, P.z, 7);

    // flow field refresh
    this._flowT = (this._flowT || 0) - dt;
    if (this._flowT <= 0) { this._flowT = .28; computeFlow(this.world, P.x, P.z); }

    this.rebuildGrid();
    this.maybeSpawnBoss();

    // enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this);
      if (e.dead && e.deathT > 2.6) this.enemies.splice(i, 1);
    }
    // respawn trickle
    const alive = this.enemies.filter(e => !e.dead).length;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && alive < this.level.count) {
      this.spawnTimer = clamp(2.6 - this.level.diff * .12, .7, 3);
      this.spawnEnemy(false);
    }

    this.updateProjectiles(dt);
    this.updateHazards(dt);
    this.updatePickups(dt);
    this.updateInteract(dt);
    this.fx.update(dt, this.world);
    this.updateToasts(dt);

    // world lights (flicker)
    // camera
    this.updateCamera(dt);

    // post fx
    const post = this.R.post;
    post.damage = Math.max(0, post.damage - dt * 2.2);
    post.heal = Math.max(0, post.heal - dt * 1.6);
    post.flashAmt = Math.max(0, post.flashAmt - dt * 1.4);
    const lowHp = 1 - clamp(P.hp / P.stats.maxHp, 0, 1);
    post.chroma = lerp(post.chroma, lowHp * .55 + post.damage * .4, clamp(dt * 6, 0, 1));
    post.vignette = .68 + lowHp * .5;
    post.desat = (this.world.biome.env.desat || 0) + lowHp * .25;

    if (P.hp <= 0 && !P.dead) this.killPlayer();
  }

  /** Keep a roughly constant slice of the world on screen whatever the
      aspect ratio — portrait phones are the binding constraint. */
  fitCamera(extraWidth) {
    const R = this.R;
    const aspect = R.W / R.H;
    const fov = 0.80;
    const targetHalfW = (this.viewWidth + (extraWidth || 0)) / 2;
    let d = targetHalfW / (Math.tan(fov / 2) * Math.max(aspect, 0.3));
    d = clamp(d, 30, 64);
    const pitch = 0.97;                    // ~56 degrees down
    this.camFov = fov;
    return { hgt: d * Math.sin(pitch), dist: d * Math.cos(pitch), d };
  }

  updateCamera(dt) {
    const P = this.player;
    const lead = 3.2;
    const tx = P.x + Math.sin(P.yaw) * lead * (Input.aimActive ? 1 : .35);
    const tz = P.z + Math.cos(P.yaw) * lead * (Input.aimActive ? 1 : .35);
    const fit = this.fitCamera(this.boss && !this.boss.dead ? 6 : 0);
    let dist = fit.dist, hgt = fit.hgt;
    this.R.shadowExtent = clamp(fit.d * 0.78, 26, 52);
    const k = this.camSnap ? 1 : clamp(dt * 5.5, 0, 1);
    this.camLook[0] = lerp(this.camLook[0], tx, k);
    this.camLook[2] = lerp(this.camLook[2], tz, k);
    this.camLook[1] = lerp(this.camLook[1], P.y + .9, k);
    this.camSnap = false;

    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shake * this.shake;
    const sx = (Math.random() - .5) * sh * 1.5;
    const sz = (Math.random() - .5) * sh * 1.5;
    const sy = (Math.random() - .5) * sh * 1.0;

    v3.set(this.camPos, this.camLook[0] + sx, this.camLook[1] + hgt + sy, this.camLook[2] + dist + sz);
    v3.set(this.camTarget, this.camLook[0] + sx * .4, this.camLook[1], this.camLook[2] + sz * .4);
    this.R.setCamera(this.camPos, this.camTarget, this.camFov || 0.80);
  }

  updatePickups(dt) {
    const P = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += dt;
      const d2p = dist2(p.x, p.z, P.x, P.z);
      if (d2p < 9 && p.age > .35) {
        // magnetise
        const d = Math.sqrt(d2p) || 1;
        p.x += (P.x - p.x) / d * dt * 9;
        p.z += (P.z - p.z) / d * dt * 9;
      }
      if (d2p < 1.1) { this.collect(p); this.pickups.splice(i, 1); }
    }
  }

  updateToasts(dt) {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t += dt;
      if (t.t >= t.life) this.toasts.splice(i, 1);
    }
  }

  toast(title, sub, color, life) {
    this.toasts.push({ title, sub, color: color == null ? 0xe4dcc4 : color, t: 0, life: life || 2.6 });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  /* ------------------------- interaction ---------------------------- */
  updateInteract(dt) {
    const P = this.player;
    let best = null, bd = 3.1 * 3.1;
    for (const c of this.world.containers) {
      if (c.opened) continue;
      const d = dist2(c.x, c.z, P.x, P.z);
      if (d < bd) { bd = d; best = { kind: 'container', obj: c }; }
    }
    for (const ex of this.world.exits) {
      const d = dist2(ex.x, ex.z, P.x, P.z);
      if (d < bd) { bd = d; best = { kind: 'exit', obj: ex }; }
    }
    this.interact = best;
    if (best && Input.tap('interact')) this.doInteract();
  }

  doInteract() {
    const it = this.interact;
    if (!it) return;
    if (it.kind === 'container') this.openContainer(it.obj);
    else this.useExit(it.obj);
  }

  useExit(ex) {
    if (ex.key && !this.player.keys.has(ex.key)) {
      this.toast('LOCKED', KEYS[ex.key].name + ' REQUIRED', 0xb03a2e, 2.2);
      Audio3D.SFX.empty();
      return;
    }
    Audio3D.SFX.unlock();
    const st = this.levelState(this.levelId);
    st.visited = true;
    const target = LEVEL_BY_ID[ex.to];
    this.state = 'transition';
    this.transT = 0;
    this.transTo = ex.to;
    this.transFrom = this.levelId;
    this.R.post.flashColor = [0, 0, 0];
  }

  finishTransition() {
    const to = this.transTo, from = this.transFrom;
    this.loadLevel(to, from);
    const lv = LEVEL_BY_ID[to];
    this.toast(lv.name, lv.intro, 0xd9a441, 3.4);
    this.state = 'playing';
  }

  openContainer(c) {
    c.opened = true;
    this.levelState(this.levelId).opened.add(c.id);
    Audio3D.SFX.loot();
    const def = CONTAINERS[c.type];
    const col = hexLin(def.color);
    this.fx.burst(c.x, .7, c.z, 16, { r: col[0], g: col[1], b: col[2], speed: 4, life: .7, size: .16, add: false, grav: -11 });
    this.shake = Math.max(this.shake, .18);

    if (c.key) {
      this.spawnPickup('key', c.x, c.z, { id: c.key });
      this.levelState(this.levelId).keysTaken.add(c.key);
    }
    const rolls = 1 + (this.rng.chance(.45) ? 1 : 0) + (c.type === 'cache' || c.type === 'reliquary' ? 1 : 0);
    const diff = this.level.diff * (this.level.lootMul || 1);
    for (let i = 0; i < rolls; i++) {
      const pick = this.rng.weighted(Object.entries(def.weights).map(([k, w]) => ({ v: k, w })));
      this.rollLoot(pick.v, c.x, c.z, diff);
    }
  }

  rollLoot(kind, x, z, diff) {
    const rng = this.rng;
    const jitter = () => [x + rng.range(-1, 1), z + rng.range(-1, 1)];
    if (kind === 'med') {
      const [px, pz] = jitter();
      this.spawnPickup('med', px, pz, { n: rng.int(1, 2) });
    } else if (kind === 'ammo') {
      const types = ['light', 'heavy', 'shell', 'mag'];
      // bias toward ammo the player can actually use
      const owned = new Set(this.player.weapons.map(w => WEAPON_BY_ID[w].ammo).filter(Boolean));
      const pool = types.map(t => ({ v: t, w: owned.has(t) ? 6 : 1 }));
      const t = rng.weighted(pool).v;
      const [px, pz] = jitter();
      const amt = t === 'light' ? rng.int(24, 46) : t === 'heavy' ? rng.int(18, 36) : t === 'shell' ? rng.int(6, 14) : rng.int(5, 11);
      this.spawnPickup('ammo', px, pz, { type: t, n: amt });
    } else if (kind === 'mana') {
      const [px, pz] = jitter();
      this.spawnPickup('mana', px, pz, { n: rng.int(30, 60) });
    } else if (kind === 'weapon') {
      const pool = lootWeaponPool(diff).filter(w => !this.player.hasWeapon(w.id));
      const w = pool.length ? rng.weighted(pool.map(w => ({ v: w, w: Math.max(1, 7 - w.tier) }))).v
        : rng.pick(lootWeaponPool(diff));
      const [px, pz] = jitter();
      this.spawnPickup('weapon', px, pz, { id: w.id, color: w.color || 0xb0b8c4 });
    } else if (kind === 'mod') {
      const pool = lootModPool(diff);
      const m = rng.weighted(pool.map(m => ({ v: m, w: Math.max(1, 5 - m.tier) }))).v;
      const [px, pz] = jitter();
      this.spawnPickup('mod', px, pz, { id: m.id });
    }
  }

  spawnPickup(kind, x, z, data) {
    const res = this.world.resolve(x, z, .4);
    this.pickups.push(new Pickup(kind, res[0], res[1], data));
  }

  collect(p) {
    const P = this.player;
    Audio3D.SFX.pickup();
    if (p.kind === 'med') {
      P.medkits += p.data.n;
      this.toast('MEDKIT', '×' + p.data.n, 0xff6a6a, 1.4);
    } else if (p.kind === 'ammo') {
      const got = P.giveAmmo(p.data.type, p.data.n);
      this.toast(AMMO[p.data.type].name + ' AMMO', '+' + got, AMMO[p.data.type].color, 1.4);
    } else if (p.kind === 'mana') {
      P.mana = Math.min(P.stats.maxMana, P.mana + p.data.n);
      this.toast('MANA', '+' + p.data.n, 0xb060ff, 1.4);
    } else if (p.kind === 'weapon') {
      const w = WEAPON_BY_ID[p.data.id];
      const isNew = P.giveWeapon(p.data.id);
      this.toast(w.name, isNew ? w.desc : 'AMMO SALVAGED', w.kind === 'magic' ? w.color : 0xd9a441, 3.0);
      if (isNew) Audio3D.SFX.levelUp();
    } else if (p.kind === 'mod') {
      const m = MOD_BY_ID[p.data.id];
      P.addMod(p.data.id);
      this.toast(m.name, m.desc, m.color, 3.0);
      Audio3D.SFX.levelUp();
      this.R.post.flashColor = hexLin(m.color); this.R.post.flashAmt = .35;
    } else if (p.kind === 'key') {
      P.keys.add(p.data.id);
      const k = KEYS[p.data.id];
      this.toast(k.name, k.desc, k.color, 3.6);
      Audio3D.SFX.key();
      this.R.post.flashColor = hexLin(k.color); this.R.post.flashAmt = .4;
    }
  }

  useMedkit() {
    const P = this.player;
    if (P.medkits <= 0 || P.hp >= P.stats.maxHp) { Audio3D.SFX.empty(); return; }
    P.medkits--;
    const heal = Math.round(P.stats.maxHp * .42);
    P.hp = Math.min(P.stats.maxHp, P.hp + heal);
    this.R.post.heal = 1;
    Audio3D.SFX.shield();
    this.fx.burst(P.x, 1, P.z, 22, { r: .3, g: 1, b: .5, speed: 3.4, life: .8, size: .16, grav: 1.5 });
    this.fx.text(P.x, 1.9, P.z, '+' + heal, '#7fe89a', 1.1);
  }

  dash() {
    const P = this.player;
    if (P.dashCd > 0 || P.dead) return;
    P.dashCd = 1.25;
    P.dashT = .19;
    P.iframes = .3;
    Audio3D.SFX.dash();
    this.fx.burst(P.x, .6, P.z, 14, { r: .5, g: .7, b: 1, speed: 3, life: .4, size: .2, grav: -1 });
  }

  killPlayer() {
    const P = this.player;
    P.dead = true;
    this.state = 'dead';
    Audio3D.SFX.death();
    this.shake = 1.6;
    this.fx.burst(P.x, 1, P.z, 40, { r: .8, g: .1, b: .1, speed: 6, life: 1.2, size: .22, add: false, grav: -9 });
    if (navigator.vibrate) { try { navigator.vibrate([90, 60, 160]); } catch (e) { } }
    this.onDead && this.onDead();
  }

  /* ------------------------------ render ----------------------------- */
  render(dt) {
    const R = this.R;
    R.begin(dt);
    if (!this.world) return;

    // static world lights, with flicker
    for (const L of this.world.lights) {
      const d2p = dist2(L.x, L.z, this.player.x, this.player.z);
      if (d2p > 44 * 44) continue;
      let inten = L.i;
      if (L.flicker) {
        const f = Math.sin(this.time * 11 + L.x * 3.1 + L.z * 1.7) * .5 + Math.sin(this.time * 23 + L.z) * .5;
        inten *= 1 + f * .16 * L.flicker;
      }
      R.light(L.x, L.y, L.z, L.rad, L.r, L.g, L.b, inten);
      if (L.flicker > .5) {
        R.particle(true, L.x, L.y + .25 + Math.sin(this.time * 4 + L.x) * .06, L.z, .5 + Math.sin(this.time * 9 + L.z) * .08,
          L.r * .5, L.g * .3, L.b * .12, .45, 0, 0, 0, 0);
      }
    }

    // containers
    for (const c of this.world.containers) this.renderContainer(R, c);
    // exits
    for (const ex of this.world.exits) this.renderExit(R, ex);
    // hazards
    this.renderHazards(R);
    // pickups
    for (const p of this.pickups) p.render(R, this);
    // enemies
    for (const e of this.enemies) e.render(R, this);
    // projectiles
    this.renderProjectiles(R);
    // player
    if (!this.player.dead || this.state !== 'dead') this.player.render(R, this);
    // fx
    this.fx.render(R);
    // aim laser
    this.renderAim(R);

    R.render();
    this.renderOverlay();
  }

  renderContainer(R, c) {
    const def = CONTAINERS[c.type];
    const col = hexLin(def.color);
    const open = c.opened;
    const m = mat(open ? [col[0] * .45, col[1] * .45, col[2] * .45] : col, .75, null, def.metal || 0);
    const h = def.h, w = def.w;
    m4.composeY(_E, c.x, h / 2, c.z, c.ry, w, h, w * .8);
    R.push('box', _E, m);
    // lid
    m4.composeY(_E, c.x, h + .06, c.z + (open ? .3 : 0), c.ry + (open ? .4 : 0), w * 1.05, .12, w * .84);
    R.push('box', _E, mat(open ? [col[0] * .4, col[1] * .4, col[2] * .4] : [col[0] * 1.15, col[1] * 1.15, col[2] * 1.15], .6, null, def.metal || 0));
    if (def.accent) {
      const a = hexLin(def.accent);
      m4.composeY(_E, c.x, h * .6, c.z, c.ry, w * .5, h * .3, w * .86);
      R.push('box', _E, mat(a, .5, open ? null : [a[0] * .8, a[1] * .8, a[2] * .8], 0, open ? 0 : 3));
    }
    if (!open) {
      const glow = .5 + .5 * Math.sin(this.time * 2.4 + c.id);
      R.light(c.x, h + .5, c.z, 5.5, 1, .78, .35, .55 + glow * .3);
      if (c.key) {
        const kc = hexLin(KEYS[c.key].color);
        R.particle(true, c.x, h + .6 + Math.sin(this.time * 2 + c.id) * .1, c.z, .7, kc[0], kc[1], kc[2], .7, 0, 0, 0, 0);
      }
    }
  }

  renderExit(R, ex) {
    const locked = ex.key && !this.player.keys.has(ex.key);
    const col = locked ? [1, .25, .18] : [.35, 1, .5];
    const t = this.time;
    // frame
    const m = mat([.22, .22, .25], .6, null, .4);
    for (const side of [-1, 1]) {
      m4.composeY(_E, ex.x + Math.cos(ex.ry) * side * 1.5, 1.6, ex.z + Math.sin(ex.ry) * side * 1.5, ex.ry, .45, 3.2, .45);
      R.push('box', _E, m);
    }
    m4.composeY(_E, ex.x, 3.3, ex.z, ex.ry, 3.6, .45, .5);
    R.push('box', _E, m);
    // portal sheet
    m4.composeY(_E, ex.x, 1.6, ex.z, ex.ry, 2.7, 3.0, .12);
    R.pushT('box', _E, mat([col[0] * .2, col[1] * .2, col[2] * .2], .1,
      [col[0] * (1.2 + Math.sin(t * 3) * .3), col[1] * (1.2 + Math.sin(t * 3) * .3), col[2] * (1.2 + Math.sin(t * 3) * .3)],
      0, 3, 0, 1, .5));
    R.light(ex.x, 2, ex.z, 12, col[0], col[1], col[2], 2.2);
    R.particle(true, ex.x, .06, ex.z, 5, col[0] * .25, col[1] * .25, col[2] * .25, .6, 0, 2, 0, 0);
    for (let i = 0; i < 3; i++) {
      const a = t * 1.2 + i / 3 * TAU;
      R.particle(true, ex.x + Math.cos(a) * 1.6, .4 + ((t * .8 + i / 3) % 1) * 3, ex.z + Math.sin(a) * 1.6,
        .4, col[0], col[1], col[2], .55, 0, 0, 0, 0);
    }
  }

  renderAim(R) {
    const P = this.player;
    const w = P.weapon;
    if (P.dead) return;
    if (w.laser) {
      const c = hexLin(w.laser);
      const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
      const ox = P.x + dx * .6, oz = P.z + dz * .6;
      let len = 34;
      for (let d = 1; d < 34; d += .5) {
        if (this.world.isSolid(ox + dx * d, oz + dz * d)) { len = d; break; }
      }
      const steps = Math.ceil(len / 1.2);
      for (let i = 0; i < steps; i++) {
        const d = (i / steps) * len + .6;
        R.particle(true, ox + dx * d, 1.15, oz + dz * d, .1, c[0] * .8, c[1] * .8, c[2] * .8, .35, 0, 0, 0, 0);
      }
      R.particle(true, ox + dx * len, 1.15, oz + dz * len, .4, c[0], c[1], c[2], .8, 0, 0, 0, 0);
    }
    // subtle aim arc on the ground
    if (Input.aimActive) {
      const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
      for (let i = 1; i <= 4; i++) {
        const d = 1.4 + i * .7;
        R.particle(true, P.x + dx * d, .06, P.z + dz * d, .28 - i * .03, .9, .8, .6, .16, 0, 2, 0, 0);
      }
    }
  }

  /* ------------------------ frame driver ---------------------------- */
  frame(dt) {
    // drive HUD chrome from state so it can never desync from the map screen
    document.body.classList.toggle('mapopen', this.state === 'map');
    if (this.state === 'transition') {
      this.transT += dt;
      this.R.post.flashAmt = this.transT < .35 ? this.transT / .35 : Math.max(0, 1 - (this.transT - .35) / .5);
      if (this.transT > .36 && !this._didTrans) { this._didTrans = true; this.finishTransition(); }
      if (this.transT > .9) { this._didTrans = false; this.R.post.flashAmt = 0; }
    } else {
      this._didTrans = false;
    }
    if (!this.paused) this.update(dt);
    this.render(dt);
    this.adaptQuality(dt);
  }

  adaptQuality(dt) {
    if (!this.autoQuality) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.adaptTimer -= dt;
    if (this.adaptTimer > 0 || this.frameTimes.length < 45) return;
    this.adaptTimer = 2.5;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const q = this.R.quality;
    if (avg > 0.033 && q.renderScale > 0.6) {
      q.renderScale = Math.max(0.6, q.renderScale - 0.12);
      if (q.renderScale <= .74 && q.ssao) q.ssao = false;
      this.onResize && this.onResize();
    } else if (avg < 0.019 && q.renderScale < 1) {
      q.renderScale = Math.min(1, q.renderScale + 0.08);
      this.onResize && this.onResize();
    }
  }
}
