/* ==========================================================================
   Player — stats, inventory, movement, rendering
   ========================================================================== */

const BASE_STATS = {
  maxHp: 100, maxArmor: 0, maxShield: 0, maxMana: 100,
  resist: 0, speedMul: 1, dmgMul: 1, critAdd: 0, critMulAdd: 0,
  lifesteal: 0, manaRegenMul: 1, reloadMul: 1, fireMul: 1,
  berserk: 0, ward: 0, ammoCapMul: 1, healOnKill: 0,
};

const PLAYER_SPEED = 5.6;
const MANA_REGEN = 8.5;

class Player {
  constructor() {
    this.x = 0; this.z = 0; this.y = 0;
    this.vx = 0; this.vz = 0;
    this.r = 0.42;
    this.yaw = 0;
    this.phase = 0; this.moveAmt = 0;

    this.stats = Object.assign({}, BASE_STATS);
    this.hp = 100; this.armor = 0; this.shield = 0; this.mana = 100;
    this.shieldT = 0; this.manaT = 0;

    this.weapons = ['fists', 'pistol'];
    this.slot = 1;
    this.mags = { pistol: 15 };
    this.ammo = { light: 60, heavy: 0, shell: 0, mag: 0 };
    this.medkits = 2;
    this.keys = new Set();
    this.mods = {};
    this.modOrder = [];

    this.fireT = 0;
    this.reloadT = 0; this.reloadTotal = 0;
    this.spin = 0;
    this.dashT = 0; this.dashCd = 0; this.iframes = 0;
    this.swingT = 0;
    this.recoil = 0;
    this.noise = 0;
    this.dead = false;
    this.kills = 0; this.xp = 0; this.level = 1; this.xpNext = 60;
    this.blades = [];       // gravewhisper spectral blades
    this.chill = 0;
    this.hitT = 0;
    this.aimPitch = 0;
    this.recomputeStats();
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  get weapon() { return WEAPON_BY_ID[this.weapons[this.slot]] || WEAPON_BY_ID.fists; }
  get magCount() { const w = this.weapon; return w.mag == null ? 0 : (this.mags[w.id] || 0); }
  ammoCap(type) { return Math.round(AMMO[type].cap * this.stats.ammoCapMul); }

  recomputeStats() {
    const s = Object.assign({}, BASE_STATS);
    for (const id of this.modOrder) {
      const m = MOD_BY_ID[id];
      const n = this.mods[id] || 0;
      for (let i = 0; i < n; i++) m.apply(s);
    }
    s.resist = clamp(s.resist, 0, .78);
    s.speedMul = clamp(s.speedMul, .5, 2.4);
    this.stats = s;
    this.hp = Math.min(this.hp, s.maxHp);
    this.armor = Math.min(this.armor, s.maxArmor);
    this.shield = Math.min(this.shield, s.maxShield);
    this.mana = Math.min(this.mana, s.maxMana);
  }

  addMod(id) {
    if (!this.mods[id]) { this.mods[id] = 0; this.modOrder.push(id); }
    this.mods[id]++;
    const before = this.stats.maxHp, beforeA = this.stats.maxArmor, beforeS = this.stats.maxShield, beforeM = this.stats.maxMana;
    this.recomputeStats();
    this.hp += Math.max(0, this.stats.maxHp - before);
    this.armor += Math.max(0, this.stats.maxArmor - beforeA);
    this.shield += Math.max(0, this.stats.maxShield - beforeS);
    this.mana += Math.max(0, this.stats.maxMana - beforeM);
  }

  hasWeapon(id) { return this.weapons.includes(id); }

  giveWeapon(id) {
    const w = WEAPON_BY_ID[id];
    if (!w) return false;
    if (this.hasWeapon(id)) {
      if (w.ammo) this.giveAmmo(w.ammo, Math.ceil(w.mag * 1.2));
      return false;
    }
    this.weapons.push(id);
    if (w.mag) {
      this.mags[id] = w.mag;
      this.giveAmmo(w.ammo, w.mag * 2);
    }
    this.slot = this.weapons.length - 1;
    return true;
  }

  giveAmmo(type, n) {
    const cap = this.ammoCap(type);
    const before = this.ammo[type];
    this.ammo[type] = Math.min(cap, before + n);
    return this.ammo[type] - before;
  }

  cycleWeapon(dir) {
    const n = this.weapons.length;
    if (n <= 1) return;
    this.slot = (this.slot + (dir || 1) + n) % n;
    this.reloadT = 0; this.spin = 0;
    Audio3D.SFX.ui();
  }

  selectSlot(i) {
    if (i >= 0 && i < this.weapons.length) { this.slot = i; this.reloadT = 0; this.spin = 0; }
  }

  /** effective damage for the equipped weapon including mods & berserk */
  damageMul() {
    const s = this.stats;
    let m = s.dmgMul;
    if (s.berserk > 0) {
      const missing = 1 - this.hp / s.maxHp;
      m += s.berserk * missing;
    }
    return m;
  }

  critChance(w) { return clamp((w.crit || 0) + this.stats.critAdd, 0, .95); }
  critMul(w) { return (w.critMul || 2) + this.stats.critMulAdd; }

  fireInterval(w) {
    const rpm = w.fire * this.stats.fireMul;
    return 60 / Math.max(1, rpm);
  }

  canFire() { return this.fireT <= 0 && this.reloadT <= 0 && !this.dead; }

  startReload() {
    const w = this.weapon;
    if (!w.mag || this.reloadT > 0) return false;
    if ((this.mags[w.id] || 0) >= w.mag) return false;
    if (this.ammo[w.ammo] <= 0) return false;
    this.reloadTotal = w.reload * this.stats.reloadMul;
    this.reloadT = this.reloadTotal;
    Audio3D.SFX.reload();
    return true;
  }

  finishReload() {
    const w = this.weapon;
    const need = w.mag - (this.mags[w.id] || 0);
    const take = Math.min(need, this.ammo[w.ammo]);
    this.mags[w.id] = (this.mags[w.id] || 0) + take;
    this.ammo[w.ammo] -= take;
  }

  update(dt, game) {
    if (this.dead) return;
    const s = this.stats;
    this.hitT = Math.max(0, this.hitT - dt);

    // ---- movement ----
    let mx = Input.move.x, mz = Input.move.y;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    let speed = PLAYER_SPEED * s.speedMul;
    if (game.world.isWater(this.x, this.z)) speed *= .62;
    if (this.chill > 0) { speed *= .62; this.chill -= dt; }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.iframes = Math.max(this.iframes, this.dashT + .06);
      speed *= 3.4;
    }
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.iframes = Math.max(0, this.iframes - dt);

    const accel = this.dashT > 0 ? 40 : 26;
    this.vx += (mx * speed - this.vx) * clamp(accel * dt, 0, 1);
    this.vz += (mz * speed - this.vz) * clamp(accel * dt, 0, 1);
    if (ml < .01 && this.dashT <= 0) {
      const damp = Math.exp(-13 * dt);
      this.vx *= damp; this.vz *= damp;
    }
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const res = game.world.resolve(nx, nz, this.r);
    if (Math.abs(res[0] - nx) > 1e-6) this.vx *= .15;
    if (Math.abs(res[1] - nz) > 1e-6) this.vz *= .15;
    this.x = res[0]; this.z = res[1];

    const spd = Math.hypot(this.vx, this.vz);
    this.moveAmt = clamp(spd / (PLAYER_SPEED * .8), 0, 1.35);
    this.phase += dt * (5.2 + spd * 1.5);
    this.y = game.world.isWater(this.x, this.z) ? -.28 : 0;

    // ---- facing ----
    // The right thumb stick aims on touch; everywhere else the player faces
    // wherever they are walking, and that facing is what the weapon fires along.
    const ax = Input.aim.x, az = Input.aim.y;
    if (Input.aimActive && Math.hypot(ax, az) > .1) {
      this.yaw = angleLerp(this.yaw, Math.atan2(ax, az), clamp(dt * 22, 0, 1));
    } else if (ml > .01) {
      this.yaw = angleLerp(this.yaw, Math.atan2(mx, mz), clamp(dt * 20, 0, 1));
    }

    // ---- timers ----
    this.fireT = Math.max(0, this.fireT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.noise = Math.max(0, this.noise - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.finishReload(); }
    }
    // spin-up decay
    const w = this.weapon;
    if (!Input.firing || !w.spinup) this.spin = Math.max(0, this.spin - dt * 1.6);

    // ---- regen ----
    this.manaT = Math.max(0, this.manaT - dt);
    if (this.manaT <= 0 && this.mana < s.maxMana) {
      this.mana = Math.min(s.maxMana, this.mana + MANA_REGEN * s.manaRegenMul * dt);
    }
    this.shieldT = Math.max(0, this.shieldT - dt);
    if (this.shieldT <= 0 && this.shield < s.maxShield) {
      this.shield = Math.min(s.maxShield, this.shield + s.maxShield * .28 * dt);
    }

    // ---- spectral blades (gravewhisper) ----
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const b = this.blades[i];
      b.t -= dt;
      if (b.t <= 0) { this.blades.splice(i, 1); continue; }
      b.a += dt * 3.1;
      b.cd -= dt;
      const bx = this.x + Math.cos(b.a) * b.rad, bz = this.z + Math.sin(b.a) * b.rad;
      b.x = bx; b.z = bz;
      if (b.cd <= 0) {
        const e = game.nearestEnemy(bx, bz, 2.4);
        if (e) {
          b.cd = .55;
          game.damageEnemy(e, b.dmg * this.damageMul(), null, { element: 'void', color: [.5, 1, .8] });
          game.fx.burst(e.x, 1.2, e.z, 8, { r: .4, g: 1, b: .8, speed: 5, life: .35, size: .16 });
        }
      }
    }
  }

  render(R, game) {
    const dashing = this.dashT > 0;
    const w = this.weapon;
    const armed = w.kind !== 'melee' || w.model;
    const aimPose = armed && (Input.aimActive || Input.firing || this.fireT > 0.02);
    let armA, armB;
    const sw = this.swingT > 0 ? Math.sin((1 - this.swingT / .28) * Math.PI) : 0;
    if (w.kind === 'melee') {
      armB = sw > 0 ? -2.1 * sw : (aimPose ? -.55 : undefined);
      armA = sw > 0 ? -.5 * sw : undefined;
    } else {
      const rec = this.recoil * .5;
      armB = -1.45 + rec; armA = -1.15 + rec * .6;
    }
    const skin = hexLin(0xc99a6a), jacket = hexLin(0x6a4a32);
    drawHumanoid(R, {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, scale: 1.02,
      skin, cloth: jacket, phase: this.phase, moveAmt: this.moveAmt,
      flash: this.hitT > 0 ? this.hitT * 1.4 : 0,
      eyes: null, lean: .06 + this.moveAmt * .05,
      armA, armB,
    });
    // held weapon
    if (w.model) {
      const hp2 = handPos({ x: this.x, y: this.y, z: this.z, yaw: this.yaw, scale: 1.02, armA, armB }, 'r');
      const pitch = w.kind === 'melee' ? (sw > 0 ? -1.2 * sw : -.2) : -this.recoil * .35;
      drawWeaponModel(R, w.model, hp2[0], hp2[1], hp2[2], this.yaw, pitch, 1);
      // magic focus glow
      if (w.kind === 'magic') {
        const c = hexLin(w.color);
        const gx = hp2[0] + Math.sin(this.yaw) * .55, gz = hp2[2] + Math.cos(this.yaw) * .55;
        R.light(gx, hp2[1] + .3, gz, 8, c[0], c[1], c[2], 1.6 + Math.sin(game.time * 6) * .3);
        R.particle(true, gx, hp2[1] + .3, gz, .55, c[0], c[1], c[2], .7, 0, 0, 0, 0);
      }
    }
    // spectral blades
    for (const b of this.blades) {
      const y = 1.2 + Math.sin(game.time * 4 + b.a) * .2;
      m4.compose(_E, b.x, y, b.z, 0, b.a + Math.PI / 2, .5, .12, .9, .12);
      R.push('box', _E, mat([.2, .5, .4], .2, [.6, 2.4, 1.6], 0, 3));
      R.particle(true, b.x, y, b.z, .6, .3, .9, .7, .5, 0, 0, 0, 0);
    }
    // dash trail
    if (dashing) {
      R.particle(true, this.x, this.y + .8, this.z, 1.6, .4, .6, .9, .35, 0, 0, 0, 0);
    }
    // shield bubble
    if (this.shield > 1) {
      const f = this.shield / Math.max(1, this.stats.maxShield);
      m4.composeY(_E, this.x, this.y + 1.0, this.z, game.time, 1.45, 2.05, 1.45);
      R.pushT('sphere', _E, mat([.12, .3, .6], .1, [.03, .12, .3], .2, 3, 0, 1, .07 + f * .09));
    }
    // torch light so the player is never lost in the dark
    R.light(this.x, this.y + 1.5, this.z, 13, 1, .86, .66, 1.05);
  }
}
