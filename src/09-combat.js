/* ==========================================================================
   Combat — firing, projectiles, magic, damage, hazards, boss abilities
   ========================================================================== */

Object.assign(Game.prototype, {

  /* ============================ firing ============================== */
  tryFire(dt) {
    const P = this.player;
    if (P.dead || this.state !== 'playing') { this._wasFiring = Input.firing; return; }
    const w = P.weapon;
    const fresh = Input.firing && !this._wasFiring;
    this._wasFiring = Input.firing;
    if (!Input.firing) return;

    const continuous = w.auto || w.kind === 'melee' || w.kind === 'magic';
    if (!continuous && !fresh) return;
    if (!P.canFire()) return;

    if (w.kind === 'melee') this.meleeAttack(w);
    else if (w.kind === 'magic') this.castMagic(w);
    else this.fireGun(w, fresh);
  },

  meleeAttack(w) {
    const P = this.player;
    P.fireT = P.fireInterval(w);
    P.swingT = .28;
    Audio3D.SFX.swing();
    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    const reach = w.range + .5;
    let hit = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - P.x, ez = e.z - P.z;
      const d = Math.hypot(ex, ez);
      if (d > reach + e.r) continue;
      const dot = (ex * dx + ez * dz) / (d || 1);
      if (dot < Math.cos(w.arc)) continue;
      hit++;
      const dmg = w.dmg * P.damageMul();
      this.damageEnemy(e, dmg, w, { knock: w.knock, melee: true });
      if (w.stun) applyStatus(e, 'stun', w.stun, 1);
      if (w.bleed) applyStatus(e, 'bleed', 4, w.bleed);
    }
    // swing arc fx
    for (let i = 0; i < 9; i++) {
      const a = P.yaw + (i / 8 - .5) * w.arc * 1.5;
      const d = reach * .8;
      this.fx.spawn(P.x + Math.sin(a) * d, 1.15, P.z + Math.cos(a) * d, 0, 0, 0,
        .16, .2, .9, .9, 1, .35, { grav: 0, drag: 4, add: true });
    }
    if (hit) { this.shake = Math.max(this.shake, .16); Audio3D.SFX.hitFlesh(); }
  },

  fireGun(w, fresh) {
    const P = this.player;
    const mag = P.mags[w.id] || 0;
    if (mag <= 0) {
      if (fresh) {
        Audio3D.SFX.empty();
        if (P.ammo[w.ammo] > 0) P.startReload();
      }
      P.fireT = .18;
      return;
    }
    // spin-up
    if (w.spinup) {
      P.spin = Math.min(1, P.spin + (1 / w.spinup) * (1 / 60) * 3.2);
      if (P.spin < .25) { P.fireT = .04; return; }
    }
    const spinScale = w.spinup ? lerp(2.1, 1, P.spin) : 1;
    P.fireT = P.fireInterval(w) * spinScale;
    P.mags[w.id] = mag - 1;
    P.recoil = Math.min(1.4, P.recoil + .55);
    P.noise = 1.2;
    Audio3D.SFX[w.sfx || 'shootLight']();
    this.shake = Math.max(this.shake, (w.shake || .4) * .32);
    if (navigator.vibrate && (w.shake || 0) > 1.4) { try { navigator.vibrate(12); } catch (e) { } }

    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    const mx = P.x + dx * .85, mz = P.z + dz * .85, my = 1.15;
    // muzzle flash
    this.fx.spawn(mx + dx * .3, my, mz + dz * .3, 0, 0, 0, .07, .9, 1, .8, .45, 1, { grav: 0, drag: 6 });
    this.fx.burst(mx + dx * .4, my, mz + dz * .4, 4, {
      r: 1, g: .7, b: .3, speed: 6, life: .16, size: .12, vx: dx * 6, vz: dz * 6, grav: -2,
    });
    this._muzzle = { x: mx, z: mz, t: .06 };

    const pellets = w.pellets || 1;
    const dmg = w.dmg * P.damageMul();
    for (let i = 0; i < pellets; i++) {
      const spread = (w.spread || 0) * (1 + P.recoil * .55) * (P.moveAmt > .4 ? 1.35 : 1);
      const a = P.yaw + (Math.random() - .5) * spread * 2 + (Math.random() - .5) * spread;
      this.projectiles.push(new Projectile({
        kind: 'bullet', x: mx, y: my, z: mz,
        vx: Math.sin(a) * w.speed, vy: 0, vz: Math.cos(a) * w.speed,
        dmg, pierce: (w.pierce || 0) + 1, hits: null,
        life: (w.range || 40) / w.speed, w, knock: w.knock || 1.2,
        color: [1, .85, .5], size: w.tier >= 5 ? .2 : .12, trail: w.tier >= 4,
      }));
    }
    if ((P.mags[w.id] || 0) <= 0 && P.ammo[w.ammo] > 0) P.startReload();
  },

  castMagic(w) {
    const P = this.player;
    if (P.mana < w.mana) {
      if (!this._wasFiringLow) { Audio3D.SFX.empty(); this._wasFiringLow = true; }
      P.fireT = .25;
      return;
    }
    this._wasFiringLow = false;
    P.mana -= w.mana;
    P.manaT = 1.0;
    P.fireT = P.fireInterval(w);
    P.recoil = Math.min(1.2, P.recoil + .3);
    Audio3D.SFX.magic(w.sfx || 440, w.element === 'shock' ? 'sawtooth' : 'sine');
    const col = hexLin(w.color);
    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    const ox = P.x + dx * .9, oz = P.z + dz * .9, oy = 1.2;
    const dmg = w.dmg * P.damageMul();
    this.shake = Math.max(this.shake, .12);
    this.fx.burst(ox, oy, oz, 6, { r: col[0], g: col[1], b: col[2], speed: 3, life: .3, size: .18, grav: 0 });

    switch (w.proj) {
      case 'lob': {
        const p = new Projectile({
          kind: 'lob', x: ox, y: oy, z: oz,
          vx: dx * w.speed, vy: 7.5, vz: dz * w.speed,
          dmg, life: 4, w, color: col, size: .34, aoe: w.aoe, burn: w.burn, cloud: w.cloud,
        });
        this.projectiles.push(p);
        break;
      }
      case 'seek': {
        for (let i = 0; i < 2; i++) {
          const a = P.yaw + (i - .5) * .25;
          this.projectiles.push(new Projectile({
            kind: 'seek', x: ox, y: oy, z: oz,
            vx: Math.sin(a) * w.speed, vy: 0, vz: Math.cos(a) * w.speed,
            dmg: dmg * .6, life: 3.2, w, color: col, size: .3,
            turn: w.seekTurn, lifesteal: w.lifesteal,
          }));
        }
        break;
      }
      case 'ricochet': {
        this.projectiles.push(new Projectile({
          kind: 'ricochet', x: ox, y: oy, z: oz,
          vx: dx * w.speed, vy: 0, vz: dz * w.speed,
          dmg, life: 2.2, w, color: col, size: .26,
          bounces: w.bounces, bounceRange: w.bounceRange, hitSet: new Set(),
        }));
        break;
      }
      case 'chain': this.chainLightning(ox, oy, oz, dx, dz, w, dmg); break;
      case 'cone': this.coneBlast(w, dmg); break;
      case 'beam': this.beamCast(w, dmg); break;
      case 'nova': this.novaCast(w, dmg); break;
      case 'meteor': this.meteorCast(w, dmg); break;
      case 'summon': this.summonBlades(w, dmg); break;
    }
  },

  /* --------------------------- magic effects ------------------------- */
  chainLightning(ox, oy, oz, dx, dz, w, dmg) {
    const col = hexLin(w.color);
    let src = { x: ox, y: oy, z: oz };
    let target = this.nearestEnemyInCone(ox, oz, dx, dz, w.chainRange * 1.6, .9);
    const hit = new Set();
    let d = dmg;
    for (let i = 0; i < w.chains && target; i++) {
      hit.add(target.uid);
      this.lightningArc(src.x, src.y, src.z, target.x, 1.2, target.z, col);
      this.damageEnemy(target, d, w, { element: 'shock', color: col });
      if (w.stun) applyStatus(target, 'stun', w.stun, 1);
      d *= w.chainFalloff;
      src = { x: target.x, y: 1.2, z: target.z };
      let next = null, bd = w.chainRange * w.chainRange;
      for (const e of this.enemies) {
        if (e.dead || hit.has(e.uid)) continue;
        const dd = dist2(e.x, e.z, target.x, target.z);
        if (dd < bd) { bd = dd; next = e; }
      }
      target = next;
    }
    if (!hit.size) {
      // fizzle into the air
      this.lightningArc(ox, oy, oz, ox + dx * 9, 1.4, oz + dz * 9, col);
    }
    Audio3D.SFX.zap();
  },

  lightningArc(x0, y0, z0, x1, y1, z1, col) {
    const n = 9;
    let px = x0, py = y0, pz = z0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const jx = (Math.random() - .5) * 1.1 * (1 - Math.abs(t - .5) * 2 + .3);
      const jz = (Math.random() - .5) * 1.1 * (1 - Math.abs(t - .5) * 2 + .3);
      const nx2 = lerp(x0, x1, t) + jx, ny = lerp(y0, y1, t) + (Math.random() - .5) * .5, nz2 = lerp(z0, z1, t) + jz;
      this.fx.spawn((px + nx2) / 2, (py + ny) / 2, (pz + nz2) / 2, 0, 0, 0, .13, .3,
        col[0] * 2, col[1] * 2, col[2] * 2, 1, { grav: 0, drag: 8 });
      px = nx2; py = ny; pz = nz2;
    }
  },

  nearestEnemyInCone(x, z, dx, dz, range, cosLimit) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - x, ez = e.z - z;
      const d2e = ex * ex + ez * ez;
      if (d2e > bd) continue;
      const d = Math.sqrt(d2e) || 1;
      if ((ex * dx + ez * dz) / d < cosLimit) continue;
      bd = d2e; best = e;
    }
    return best;
  },

  coneBlast(w, dmg) {
    const P = this.player;
    const col = hexLin(w.color);
    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - P.x, ez = e.z - P.z;
      const d = Math.hypot(ex, ez);
      if (d > w.range) continue;
      if ((ex * dx + ez * dz) / (d || 1) < Math.cos(w.coneAngle)) continue;
      if (!this.world.los(P.x, P.z, e.x, e.z)) continue;
      this.damageEnemy(e, dmg, w, { element: 'frost', color: col });
      applyStatus(e, 'slow', w.slowTime, w.slow);
      if (Math.random() < (w.freeze || 0) * 3) applyStatus(e, 'freeze', 1.1, 1);
    }
    for (let i = 0; i < 34; i++) {
      const a = P.yaw + (Math.random() - .5) * w.coneAngle * 2;
      const sp = 6 + Math.random() * 12;
      this.fx.spawn(P.x + dx, 1.2, P.z + dz, Math.sin(a) * sp, Math.random() * 1.2, Math.cos(a) * sp,
        .55, .3, col[0], col[1], col[2], .8, { grav: -1, drag: 2.4 });
    }
    Audio3D.SFX.frost();
  },

  beamCast(w, dmg) {
    const P = this.player;
    const col = hexLin(w.color);
    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    let len = w.range;
    for (let d = 1; d < w.range; d += .4) {
      if (this.world.isSolid(P.x + dx * d, P.z + dz * d)) { len = d; break; }
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ex = e.x - P.x, ez = e.z - P.z;
      const along = ex * dx + ez * dz;
      if (along < 0 || along > len) continue;
      const perp = Math.abs(ex * dz - ez * dx);
      if (perp > 1.5 + e.r) continue;
      this.damageEnemy(e, dmg, w, { element: 'void', color: col });
      if (w.pull) {
        const pd = Math.hypot(ex, ez) || 1;
        e.vx -= ex / pd * w.pull; e.vz -= ez / pd * w.pull;
      }
    }
    const steps = Math.ceil(len * 2.2);
    for (let i = 0; i < steps; i++) {
      const d = (i / steps) * len;
      this.fx.spawn(P.x + dx * d, 1.2, P.z + dz * d, (Math.random() - .5) * .6, (Math.random() - .5) * .6, (Math.random() - .5) * .6,
        .3, .55, col[0] * 1.6, col[1] * 1.6, col[2] * 1.6, .9, { grav: 0, drag: 3 });
    }
    this.shake = Math.max(this.shake, .3);
  },

  novaCast(w, dmg) {
    const P = this.player;
    const col = hexLin(w.color);
    let healed = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d > w.aoe + e.r) continue;
      const falloff = clamp(1 - d / (w.aoe * 1.4), .35, 1);
      this.damageEnemy(e, dmg * falloff, w, { element: 'holy', color: col, knock: 3 });
      healed += w.healPerHit || 0;
    }
    if (healed > 0) {
      P.hp = Math.min(P.stats.maxHp, P.hp + healed);
      this.fx.text(P.x, 2.1, P.z, '+' + Math.round(healed), '#ffe08a', .9);
      this.R.post.heal = Math.min(1, this.R.post.heal + .5);
    }
    this.fx.ring(P.x, .1, P.z, .5, w.aoe, .45, col[0], col[1], col[2], 1);
    this.fx.burst(P.x, 1, P.z, 40, { r: col[0], g: col[1], b: col[2], speed: 11, life: .55, size: .28, grav: -2, up: .3 });
    this.shake = Math.max(this.shake, .35);
  },

  meteorCast(w, dmg) {
    const P = this.player;
    const target = this.nearestEnemy(P.x + Math.sin(P.yaw) * 8, P.z + Math.cos(P.yaw) * 8, 16)
      || { x: P.x + Math.sin(P.yaw) * 9, z: P.z + Math.cos(P.yaw) * 9 };
    this.addMeteor(target.x, target.z, w.aoe, dmg, hexLin(w.color), w.delay, w.burn);
  },

  addMeteor(x, z, aoe, dmg, col, delay, burn, byBoss) {
    this.hazards.push({
      type: 'meteor', x, z, r: aoe, t: 0, life: delay, dmg, col, burn, byBoss: !!byBoss,
    });
    Audio3D.SFX.telegraph();
  },

  summonBlades(w, dmg) {
    const P = this.player;
    for (let i = 0; i < w.blades; i++) {
      P.blades.push({ a: i / w.blades * TAU, rad: 2.2, t: w.bladeTime, cd: 0, dmg, x: P.x, z: P.z });
    }
    if (P.blades.length > 9) P.blades.splice(0, P.blades.length - 9);
    const col = hexLin(w.color);
    this.fx.ring(P.x, .1, P.z, .5, 3.2, .5, col[0], col[1], col[2], 1);
  },

  /* ------------------------- projectile update ----------------------- */
  updateProjectiles(dt) {
    const list = this.projectiles;
    const near = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0 || p.dead) {
        if (p.kind === 'lob') this.projectileBurst(p);
        list.splice(i, 1); continue;
      }
      if (p.kind === 'lob') p.vy -= 16 * dt;
      if (p.kind === 'seek') {
        const t = this.nearestEnemy(p.x, p.z, 14);
        if (t) {
          const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1;
          const sp = Math.hypot(p.vx, p.vz) || 1;
          p.vx = lerp(p.vx, dx / d * sp, clamp(p.turn * dt, 0, 1));
          p.vz = lerp(p.vz, dz / d * sp, clamp(p.turn * dt, 0, 1));
        }
      }

      const speed = Math.hypot(p.vx, p.vy, p.vz);
      const steps = Math.max(1, Math.min(8, Math.ceil(speed * dt / .55)));
      const sdt = dt / steps;
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
        // world collision
        if (this.world.isSolid(p.x, p.z) || p.y < .05) {
          if (p.kind === 'lob') { this.projectileBurst(p); done = true; p.dead = true; break; }
          this.impactSparks(p);
          p.dead = true; done = true; break;
        }
        // enemies
        this.nearby(p.x, p.z, near);
        for (const e of near) {
          if (e.dead) continue;
          if (p.hitSet && p.hitSet.has(e.uid)) continue;
          const rr = e.r + p.size + .28;
          if (dist2(p.x, p.z, e.x, e.z) > rr * rr) continue;
          const eh = (e.def.h || 1.7) * (e.scale || 1);
          if (p.y > eh + .5) continue;
          this.hitProjectile(p, e);
          if (p.dead) { done = true; break; }
        }
        if (p.trail && s % 2 === 0) {
          this.fx.spawn(p.x, p.y, p.z, 0, 0, 0, .1, p.size * .8,
            p.color[0], p.color[1], p.color[2], .5, { grav: 0, drag: 5 });
        }
      }
      if (p.dead) {
        if (p.kind === 'lob') this.projectileBurst(p);
        list.splice(i, 1);
      }
    }
  },

  hitProjectile(p, e) {
    const w = p.w;
    if (p.kind === 'lob') { this.projectileBurst(p); p.dead = true; return; }
    if (p.enemyShot) {
      // enemy bullets never hit other enemies
      return;
    }
    const opts = { knock: p.knock, element: w && w.element, color: p.color };
    const dealt = this.damageEnemy(e, p.dmg, w, opts);
    if (p.lifesteal) {
      const P = this.player;
      const h = dealt * p.lifesteal;
      P.hp = Math.min(P.stats.maxHp, P.hp + h);
      if (h > .5) this.fx.text(P.x, 2.0, P.z, '+' + Math.round(h), '#ff6a8a', .8);
    }
    if (p.kind === 'ricochet') {
      p.hitSet.add(e.uid);
      if (p.bounces > 0) {
        p.bounces--;
        const next = this.nearestEnemyExcluding(p.x, p.z, p.bounceRange, p.hitSet);
        if (next) {
          const dx = next.x - p.x, dz = next.z - p.z, d = Math.hypot(dx, dz) || 1;
          const sp = Math.hypot(p.vx, p.vz);
          p.vx = dx / d * sp; p.vz = dz / d * sp;
          p.life = Math.max(p.life, .8);
          this.fx.spawn(p.x, p.y, p.z, 0, 0, 0, .2, .5, p.color[0], p.color[1], p.color[2], 1, { grav: 0, drag: 4 });
        } else p.dead = true;
      } else p.dead = true;
      return;
    }
    if (p.hitSet) p.hitSet.add(e.uid);
    else { p.hitSet = new Set(); p.hitSet.add(e.uid); }
    p.pierce--;
    if (p.pierce <= 0) { p.dead = true; this.impactSparks(p); }
  },

  nearestEnemyExcluding(x, z, r, set) {
    let best = null, bd = r * r;
    for (const e of this.enemies) {
      if (e.dead || set.has(e.uid)) continue;
      const d = dist2(x, z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  },

  projectileBurst(p) {
    if (p._burst) return;
    p._burst = true;
    const w = p.w;
    const col = p.color;
    const aoe = p.aoe || 2.6;
    this.explode(p.x, Math.max(.4, p.y), p.z, aoe, p.dmg, col, {
      burn: p.burn, cloud: p.cloud, element: w && w.element,
    });
  },

  impactSparks(p) {
    this.fx.burst(p.x, p.y, p.z, 5, {
      r: p.color[0], g: p.color[1], b: p.color[2], speed: 3.5, life: .22, size: .1, grav: -6,
    });
  },

  explode(x, y, z, r, dmg, col, opt) {
    opt = opt || {};
    Audio3D.SFX.boom(r / 3);
    this.shake = Math.max(this.shake, clamp(r * .1, .2, .9));
    this.fx.ring(x, .08, z, .4, r * 1.15, .38, col[0], col[1], col[2], 1);
    this.fx.burst(x, y, z, 34, {
      r: col[0], g: col[1], b: col[2], speed: r * 3.4, life: .6, size: .34, grav: -6, up: .5,
    });
    this.fx.burst(x, y, z, 16, {
      r: .25, g: .22, b: .2, speed: r * 1.6, life: 1.5, size: .8, grav: .6, add: false, a: .5, drag: 2.6, grow: .7,
    });
    this.fx.decal(x, z, r * 1.2, col[0] * .12, col[1] * .1, col[2] * .08, .5, 22);
    if (!opt.enemyOnly) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - x, e.z - z);
        if (d > r + e.r) continue;
        const f = clamp(1 - d / (r * 1.35), .3, 1);
        this.damageEnemy(e, dmg * f, null, { knock: r * 1.6, element: opt.element, color: col });
        if (opt.burn) applyStatus(e, 'burn', 4, opt.burn);
      }
    }
    if (opt.hurtPlayer) {
      const P = this.player;
      const d = Math.hypot(P.x - x, P.z - z);
      if (d < r + P.r) this.hurtPlayer(opt.hurtPlayer * clamp(1 - d / (r * 1.3), .3, 1), null);
    }
    if (opt.cloud) {
      this.hazards.push({
        type: 'cloud', x, z, r: opt.cloud.radius, t: 0, life: opt.cloud.time,
        dps: opt.cloud.dps, col, tick: 0,
      });
    }
    if (opt.fire) {
      this.hazards.push({ type: 'fire', x, z, r: r * .8, t: 0, life: opt.fire, dps: dmg * .25, col, tick: 0 });
    }
  },

  /* --------------------------- damage --------------------------------- */
  damageEnemy(e, dmg, w, opt) {
    if (e.dead) return 0;
    opt = opt || {};
    const P = this.player;
    let d = dmg;
    let crit = false;
    if (!opt.dot && !opt.silent && w) {
      if (Math.random() < P.critChance(w)) { crit = true; d *= P.critMul(w); }
    }
    if (e.def.armor) d *= (1 - e.def.armor);
    if (e.isBoss && e.shield > 0) {
      const absorbed = Math.min(e.shield, d);
      e.shield -= absorbed;
      d -= absorbed;
      this.fx.burst(e.x, 1.8, e.z, 4, { r: .4, g: .8, b: 1, speed: 4, life: .3, size: .2 });
      if (e.shield <= 0) this.toast(e.bdef.name, 'SHIELD BROKEN', 0x66ccff, 1.4);
    }
    d = Math.max(1, d);
    e.hp -= d;
    e.flash = 1;
    e.alerted = true;
    if (opt.knock && !e.isBoss) {
      const kr = 1 - (e.def.knockRes || 0);
      const dx = e.x - P.x, dz = e.z - P.z, dd = Math.hypot(dx, dz) || 1;
      e.vx += dx / dd * opt.knock * kr;
      e.vz += dz / dd * opt.knock * kr;
    }
    if (!opt.silent) {
      const col = opt.color || [1, .3, .2];
      this.fx.burst(e.x, 1.1 + Math.random() * .6, e.z, opt.melee ? 7 : 5, {
        r: col[0] * .9 + .4, g: col[1] * .6, b: col[2] * .5, speed: 4.5, life: .35, size: .13, grav: -8, add: false,
      });
      if (Math.random() < .5) this.fx.decal(e.x + (Math.random() - .5), e.z + (Math.random() - .5), .8 + Math.random() * .6, .18, .02, .02, .6, 30);
      if (crit) { Audio3D.SFX.crit(); this.fx.text(e.x, 2.2, e.z, Math.round(d) + '!', '#ffdd55', 1.35); }
      else this.fx.text(e.x, 2.0, e.z, String(Math.round(d)), opt.dot ? '#9ad14a' : '#ffffff', .95);
    }
    // lifesteal from mods
    if (P.stats.lifesteal > 0 && !opt.dot) {
      const h = d * P.stats.lifesteal;
      P.hp = Math.min(P.stats.maxHp, P.hp + h);
    }
    if (e.hp <= 0) this.killEnemy(e);
    return d;
  },

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true; e.deathT = 0;
    const P = this.player;
    P.kills++; this.totalKills++;
    Audio3D.SFX.hitFlesh();
    const gore = e.def.gore || 1;
    this.fx.burst(e.x, 1.1, e.z, Math.round(14 * gore), {
      r: .55, g: .05, b: .05, speed: 6, life: .8, size: .18, grav: -12, add: false, bounce: .3,
    });
    for (let i = 0; i < Math.round(3 * gore); i++) {
      this.fx.decal(e.x + (Math.random() - .5) * 2, e.z + (Math.random() - .5) * 2,
        1 + Math.random() * 1.4, .16, .015, .015, .7, 40);
    }
    if (e.def.explode) this.enemyExplode(e, true);
    if (P.stats.healOnKill) {
      P.hp = Math.min(P.stats.maxHp, P.hp + P.stats.healOnKill);
    }
    // xp
    P.xp += e.def.xp || 6;
    while (P.xp >= P.xpNext) {
      P.xp -= P.xpNext;
      P.level++;
      P.xpNext = Math.round(P.xpNext * 1.35 + 25);
      this.levelUp();
    }
    // drops
    const dropChance = e.elite ? 1 : (e.isBoss ? 1 : .17);
    if (Math.random() < dropChance) {
      const diff = this.level.diff;
      if (e.elite) {
        this.rollLoot(this.rng.weighted([{ v: 'mod', w: 3 }, { v: 'weapon', w: 3 }, { v: 'med', w: 2 }, { v: 'ammo', w: 3 }]).v, e.x, e.z, diff + 1);
        this.rollLoot('ammo', e.x, e.z, diff);
      } else {
        this.rollLoot(this.rng.weighted([{ v: 'ammo', w: 6 }, { v: 'med', w: 2 }, { v: 'mana', w: 2 }]).v, e.x, e.z, diff);
      }
    }
    if (e.isBoss) this.onBossKilled(e);
  },

  levelUp() {
    const P = this.player;
    const pool = lootModPool(this.level.diff + 1);
    const m = this.rng.weighted(pool.map(x => ({ v: x, w: Math.max(1, 5 - x.tier) }))).v;
    P.addMod(m.id);
    Audio3D.SFX.levelUp();
    this.toast('LEVEL ' + P.level, m.name + ' — ' + m.desc, m.color, 3.4);
    this.R.post.flashColor = hexLin(m.color);
    this.R.post.flashAmt = .4;
    this.fx.ring(P.x, .1, P.z, .5, 5, .7, 1, .9, .5, 1);
  },

  onBossKilled(b) {
    const def = b.bdef;
    const st = this.levelState(this.levelId);
    st.bossDead = true;
    this.bossesKilled.add(b.key);
    this.boss = null;
    Audio3D.SFX.bossRoar();
    this.shake = 1.8;
    this.R.post.flashColor = [1, 1, 1]; this.R.post.flashAmt = .8;
    this.explode(b.x, 1.5, b.z, 9, 0, def.accent, { enemyOnly: true });
    this.toast(def.name, 'DESTROYED', 0xffe08a, 4);
    if (def.dropKey) this.spawnPickup('key', b.x + 1.4, b.z, { id: def.dropKey });
    if (def.dropMod) this.spawnPickup('mod', b.x - 1.4, b.z, { id: def.dropMod });
    if (def.dropWeapon) {
      const w = WEAPON_BY_ID[def.dropWeapon];
      this.spawnPickup('weapon', b.x, b.z + 1.6, { id: def.dropWeapon, color: w.color || 0xd9a441 });
    }
    for (let i = 0; i < 4; i++) this.rollLoot(i < 2 ? 'ammo' : 'med', b.x + (Math.random() - .5) * 4, b.z + (Math.random() - .5) * 4, this.level.diff);
    if (def.final) { this.state = 'win'; this.onWin && this.onWin(); }
  },

  /* --------------------------- player damage -------------------------- */
  hurtPlayer(dmg, src) {
    const P = this.player;
    if (P.dead || P.iframes > 0 || this.state !== 'playing') return;
    const s = P.stats;
    // guardian ward
    if (s.ward > 0 && Math.random() < s.ward) {
      P.iframes = .8;
      Audio3D.SFX.shield();
      this.fx.ring(P.x, .1, P.z, .5, 6.5, .4, .5, .85, 1, 1);
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - P.x, e.z - P.z);
        if (d > 6.5) continue;
        this.damageEnemy(e, 40 * P.damageMul(), null, { knock: 12, color: [.5, .85, 1] });
      }
      this.toast('GUARDIAN WARD', 'shockwave', 0x7fd4ff, 1.2);
      return;
    }
    let d = dmg * (1 - s.resist);
    if (P.shield > 0) {
      const a = Math.min(P.shield, d);
      P.shield -= a; d -= a;
      Audio3D.SFX.shield();
    }
    P.shieldT = 4;
    if (P.armor > 0 && d > 0) {
      const a = Math.min(P.armor, d * .65);
      P.armor -= a; d -= a;
    }
    P.hp -= d;
    P.hitT = .35;
    P.iframes = Math.max(P.iframes, .18);
    this.R.post.damage = Math.min(1, this.R.post.damage + clamp(d / 30, .25, 1));
    this.shake = Math.max(this.shake, clamp(d / 45, .18, .8));
    Audio3D.SFX.hurt();
    if (navigator.vibrate) { try { navigator.vibrate(Math.min(90, 18 + d)); } catch (e) { } }
    this.fx.text(P.x, 2.2, P.z, '-' + Math.round(d), '#ff6a6a', 1.1, 2.2);
    if (P.hp <= 0) this.killPlayer();
  },

  /* --------------------------- enemy attacks -------------------------- */
  enemyRanged(e, P) {
    const kind = e.def.ranged;
    const dx = P.x - e.x, dz = P.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    const speed = kind === 'void' ? 20 : 13;
    // simple lead
    const t = d / speed;
    const tx = P.x + P.vx * t * .6, tz = P.z + P.vz * t * .6;
    const ax = tx - e.x, az = tz - e.z;
    const ad = Math.hypot(ax, az) || 1;
    const col = kind === 'void' ? [.5, 1, .8] : [.6, .9, .25];
    this.projectiles.push(new Projectile({
      kind: 'enemy', enemyShot: true, x: e.x, y: 1.3, z: e.z,
      vx: ax / ad * speed, vy: kind === 'void' ? 0 : 2.2, vz: az / ad * speed,
      dmg: e.dmg, life: 3.4, color: col, size: .28,
      gravity: kind === 'void' ? 0 : 7, aoe: kind === 'acid' ? 1.8 : 0,
    }));
    this.fx.burst(e.x, 1.3, e.z, 5, { r: col[0], g: col[1], b: col[2], speed: 3, life: .3, size: .15 });
    Audio3D.SFX.magic(kind === 'void' ? 280 : 180, 'triangle');
  },

  enemyExplode(e, onDeath) {
    const col = [.6, .95, .3];
    this.explode(e.x, 1, e.z, e.def.explode || 4.5, e.dmg * 1.4, col, {
      hurtPlayer: e.dmg * 1.6, cloud: { time: 4, dps: 12, radius: 2.6 }, enemyOnly: false,
    });
    if (!onDeath) { e.hp = 0; this.killEnemy(e); }
  },

  screamerCall(e) {
    Audio3D.SFX.bossRoar();
    this.fx.ring(e.x, .1, e.z, 1, 18, .8, 1, .4, .3, .8);
    for (const o of this.enemies) {
      if (o.dead || o === e) continue;
      if (dist2(o.x, o.z, e.x, e.z) < 26 * 26) o.alerted = true;
    }
    for (let i = 0; i < 3; i++) this.spawnEnemy(false);
    this.toast('SCREAMER', 'the block heard that', 0xb03a2e, 1.6);
  },

  /* --------------------------- boss abilities ------------------------- */
  bossCast(b, name) {
    const P = this.player;
    const acc = b.bdef.accent;
    switch (name) {
      case 'slam': this.bossSlam(b, 7.5); break;
      case 'summon': {
        const n = 3 + b.phaseIdx;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU, r = 3 + Math.random() * 4;
          const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
          const res = this.world.resolve(x, z, .5);
          const type = b.bdef.minions[Math.floor(Math.random() * b.bdef.minions.length)];
          const m = new Enemy(type, res[0], res[1], this.level.diff, false);
          m.alerted = true;
          this.enemies.push(m);
          this.fx.ring(res[0], .1, res[1], .3, 2.4, .5, acc[0], acc[1], acc[2], 1);
        }
        break;
      }
      case 'bile': {
        for (let i = 0; i < 7; i++) {
          const a = Math.atan2(P.x - b.x, P.z - b.z) + (i - 3) * .18;
          this.projectiles.push(new Projectile({
            kind: 'enemy', enemyShot: true, x: b.x, y: 2.2, z: b.z,
            vx: Math.sin(a) * 14, vy: 5.5, vz: Math.cos(a) * 14,
            dmg: b.dmg * .55, life: 3, color: [.55, .95, .25], size: .38,
            gravity: 12, aoe: 2.6, cloudOnHit: { time: 5, dps: 16, radius: 2.6 },
          }));
        }
        break;
      }
      case 'pools': {
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * TAU, r = Math.random() * 9;
          this.hazards.push({
            type: 'cloud', x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r, r: 3.0,
            t: 0, life: 9, dps: 15, col: [.5, .95, .25], tick: 0, hurtPlayer: true,
          });
        }
        break;
      }
      case 'blink': {
        const a = Math.random() * TAU;
        const nx = P.x + Math.cos(a) * 5.5, nz = P.z + Math.sin(a) * 5.5;
        const res = this.world.resolve(nx, nz, b.r);
        this.fx.burst(b.x, 1.4, b.z, 24, { r: acc[0], g: acc[1], b: acc[2], speed: 8, life: .5, size: .3 });
        b.x = res[0]; b.z = res[1];
        this.fx.burst(b.x, 1.4, b.z, 24, { r: acc[0], g: acc[1], b: acc[2], speed: 8, life: .5, size: .3 });
        b.abilityCd = 1.1;
        break;
      }
      case 'laser': {
        const a0 = Math.atan2(P.x - b.x, P.z - b.z) - .8;
        this.hazards.push({
          type: 'beam', src: b, a: a0, sweep: 1.6, t: 0, life: 1.9, dmg: b.dmg * .9,
          col: acc, len: 30, tick: 0,
        });
        break;
      }
      case 'shield': {
        b.shield = b.maxHp * .12;
        this.toast(b.bdef.name, 'SHIELDED', 0x66ccff, 1.6);
        this.fx.ring(b.x, .1, b.z, 1, 5, .6, .4, .8, 1, 1);
        break;
      }
      case 'clones': {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * TAU;
          const res = this.world.resolve(b.x + Math.cos(a) * 5, b.z + Math.sin(a) * 5, .5);
          const m = new Enemy('stalker', res[0], res[1], this.level.diff + 2, true);
          m.alerted = true;
          this.enemies.push(m);
        }
        break;
      }
      case 'pillars': {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * TAU, r = 3 + Math.random() * 11;
          this.hazards.push({
            type: 'pillar', x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r, r: 2.2,
            t: 0, life: 1.1, dmg: b.dmg * 1.1, col: acc,
          });
        }
        break;
      }
      case 'ring': {
        this.hazards.push({
          type: 'ring', x: b.x, z: b.z, r: 1, maxR: 20, t: 0, life: 1.5,
          dmg: b.dmg * 1.2, col: acc, hitPlayer: false,
        });
        break;
      }
      case 'inferno': {
        for (let i = 0; i < 9; i++) {
          const a = Math.random() * TAU, r = Math.random() * 15;
          this.addMeteor(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 4.5, b.dmg * 1.2, acc, .9 + i * .12, 12, true);
        }
        break;
      }
      case 'meteors': {
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * TAU, r = Math.random() * 7;
          this.addMeteor(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r, 4.2, b.dmg * 1.3, acc, 1.0 + i * .22, 10, true);
        }
        break;
      }
      case 'frenzy': {
        b.rageMul = Math.min(2.4, b.rageMul + .5);
        b.speed *= 1.25;
        this.toast(b.bdef.name, 'FRENZY', 0xff3b30, 1.6);
        this.fx.ring(b.x, .1, b.z, 1, 7, .5, 1, .2, .1, 1);
        break;
      }
      case 'burst': {
        this.explode(b.x, 1.5, b.z, 8, b.dmg * 1.4, acc, {
          hurtPlayer: b.dmg * 1.4, cloud: { time: 7, dps: 18, radius: 4 },
        });
        break;
      }
    }
  },

  bossSlam(b, radius, dmgMul) {
    const acc = b.bdef.accent;
    const P = this.player;
    this.fx.ring(b.x, .1, b.z, .5, radius, .35, acc[0], acc[1], acc[2], 1);
    this.fx.burst(b.x, .4, b.z, 26, {
      r: .5, g: .45, b: .4, speed: radius * 2, life: .7, size: .35, add: false, grav: -8, a: .7,
    });
    this.shake = Math.max(this.shake, .7);
    Audio3D.SFX.boom(radius / 5);
    const d = Math.hypot(P.x - b.x, P.z - b.z);
    if (d < radius + P.r) this.hurtPlayer(b.dmg * (dmgMul || 1) * clamp(1 - d / (radius * 1.4), .4, 1), b);
  },

  /* ----------------------------- hazards ------------------------------ */
  updateHazards(dt) {
    const P = this.player;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t += dt;
      if (h.type === 'meteor') {
        if (h.t >= h.life) {
          this.explode(h.x, .6, h.z, h.r, h.dmg, h.col, {
            burn: h.burn, hurtPlayer: h.byBoss ? h.dmg : 0, enemyOnly: h.byBoss ? true : false,
          });
          this.hazards.splice(i, 1); continue;
        }
      } else if (h.type === 'pillar') {
        if (h.t >= h.life && !h.fired) {
          h.fired = true;
          this.explode(h.x, 1.6, h.z, h.r, h.dmg, h.col, { hurtPlayer: h.dmg, enemyOnly: true });
        }
        if (h.t >= h.life + .5) { this.hazards.splice(i, 1); continue; }
      } else if (h.type === 'ring') {
        const t = h.t / h.life;
        h.r = lerp(1, h.maxR, t);
        const d = Math.hypot(P.x - h.x, P.z - h.z);
        if (!h.hitPlayer && Math.abs(d - h.r) < 1.6) { h.hitPlayer = true; this.hurtPlayer(h.dmg, null); }
        if (h.t >= h.life) { this.hazards.splice(i, 1); continue; }
      } else if (h.type === 'beam') {
        const b = h.src;
        if (!b || b.dead) { this.hazards.splice(i, 1); continue; }
        h.a += h.sweep * dt / h.life;
        h.tick -= dt;
        const dx = Math.sin(h.a), dz = Math.cos(h.a);
        if (h.tick <= 0) {
          h.tick = .16;
          const px = P.x - b.x, pz = P.z - b.z;
          const along = px * dx + pz * dz;
          const perp = Math.abs(px * dz - pz * dx);
          if (along > 0 && along < h.len && perp < 1.5) this.hurtPlayer(h.dmg * .35, b);
          for (const e of this.enemies) {
            if (e.dead || e === b || e.isBoss) continue;
            const ex = e.x - b.x, ez = e.z - b.z;
            const al = ex * dx + ez * dz, pp = Math.abs(ex * dz - ez * dx);
            if (al > 0 && al < h.len && pp < 1.5) this.damageEnemy(e, h.dmg * .3, null, { color: h.col });
          }
        }
        if (h.t >= h.life) { this.hazards.splice(i, 1); continue; }
      } else {
        // cloud / fire
        h.tick -= dt;
        if (h.tick <= 0) {
          h.tick = .5;
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (dist2(e.x, e.z, h.x, h.z) > h.r * h.r) continue;
            if (!h.hurtPlayer) this.damageEnemy(e, h.dps * .5, null, { silent: true, color: h.col, dot: 'poison' });
          }
          if (h.hurtPlayer && dist2(P.x, P.z, h.x, h.z) < h.r * h.r) this.hurtPlayer(h.dps * .5, null);
        }
        if (h.t >= h.life) { this.hazards.splice(i, 1); continue; }
      }
    }
  },

  renderHazards(R) {
    const t = this.time;
    for (const h of this.hazards) {
      const col = h.col || [1, .5, .2];
      if (h.type === 'meteor') {
        const f = h.t / h.life;
        // ground marker
        R.particle(true, h.x, .06, h.z, h.r * 2, col[0] * .5, col[1] * .3, col[2] * .1, .35 + f * .5, 0, 2, 0, 0);
        // incoming rock
        const y = lerp(40, 1, f * f);
        R.particle(true, h.x, y, h.z, 1.6, col[0], col[1] * .7, col[2] * .3, 1, 0, 0, 0, 0);
        R.light(h.x, y, h.z, 14, col[0], col[1] * .6, col[2] * .3, 3 * f + 1);
        if (Math.random() < .6) {
          this.fx.spawn(h.x + (Math.random() - .5), y, h.z + (Math.random() - .5), 0, -4, 0, .4, .5,
            col[0], col[1] * .5, col[2] * .2, .9, { grav: 0, drag: 1 });
        }
      } else if (h.type === 'pillar') {
        const f = clamp(h.t / h.life, 0, 1);
        R.particle(true, h.x, .06, h.z, h.r * 2, col[0] * .6, col[1] * .3, col[2] * .1, .3 + f * .6, 0, 2, 0, 0);
        if (h.fired) {
          for (let i = 0; i < 6; i++) {
            R.particle(true, h.x + (Math.random() - .5) * h.r, i * .9 + Math.random(), h.z + (Math.random() - .5) * h.r,
              1.4, col[0], col[1], col[2], .7, 0, 0, 0, 0);
          }
          R.light(h.x, 3, h.z, 16, col[0], col[1], col[2], 5);
        }
      } else if (h.type === 'ring') {
        R.particle(true, h.x, .1, h.z, h.r * 2, col[0], col[1], col[2], .8 * (1 - h.t / h.life), 0, 2, 0, 0);
      } else if (h.type === 'beam') {
        const b = h.src;
        if (!b) continue;
        const dx = Math.sin(h.a), dz = Math.cos(h.a);
        const steps = 26;
        for (let i = 1; i < steps; i++) {
          const d = i / steps * h.len;
          R.particle(true, b.x + dx * d, 1.5, b.z + dz * d, .85, col[0], col[1], col[2], .8, 0, 0, 0, 0);
        }
        R.light(b.x + dx * 6, 1.6, b.z + dz * 6, 18, col[0], col[1], col[2], 3);
      } else {
        const f = 1 - h.t / h.life;
        const n = Math.round(h.r * 2.4);
        for (let i = 0; i < n; i++) {
          const a = t * .4 + i / n * TAU;
          const rr = h.r * (.35 + .6 * ((i * 7 % 10) / 10));
          R.particle(true, h.x + Math.cos(a) * rr, .3 + Math.sin(t * 1.6 + i) * .3, h.z + Math.sin(a) * rr,
            1.5, col[0] * .5, col[1] * .5, col[2] * .5, .3 * f, 0, 0, 0, 0);
        }
        R.particle(true, h.x, .06, h.z, h.r * 2, col[0] * .4, col[1] * .4, col[2] * .4, .35 * f, 0, 2, 0, 0);
        R.light(h.x, .8, h.z, h.r * 3, col[0], col[1], col[2], 1.4 * f);
      }
    }
  },

  renderProjectiles(R) {
    for (const p of this.projectiles) {
      const c = p.color;
      if (p.kind === 'bullet') {
        R.particle(true, p.x, p.y, p.z, p.size * 2.6, c[0], c[1] * .8, c[2] * .5, .9, 0, 3, p.vx, p.vz);
        if (p.w && p.w.tier >= 5) R.light(p.x, p.y, p.z, 6, 1, .8, .4, 1.2);
      } else {
        R.particle(true, p.x, p.y, p.z, p.size * 3.4, c[0], c[1], c[2], .95, 0, 0, 0, 0);
        R.particle(true, p.x, p.y, p.z, p.size * 6.5, c[0] * .3, c[1] * .3, c[2] * .3, .5, 0, 0, 0, 0);
        R.light(p.x, p.y + .2, p.z, 9, c[0], c[1], c[2], 2.2);
        this.fx.spawn(p.x, p.y, p.z, (Math.random() - .5) * .6, (Math.random() - .5) * .6, (Math.random() - .5) * .6,
          .3, p.size * 1.4, c[0], c[1], c[2], .6, { grav: 0, drag: 3 });
      }
    }
  },
});

/* enemy projectiles need their own step: they damage the player, not enemies */
const _origUpdateProjectiles = Game.prototype.updateProjectiles;
Game.prototype.updateProjectiles = function (dt) {
  const P = this.player;
  // move enemy shots first
  for (let i = this.projectiles.length - 1; i >= 0; i--) {
    const p = this.projectiles[i];
    if (!p.enemyShot) continue;
    p.life -= dt;
    p.vy -= (p.gravity || 0) * dt;
    const steps = 3, sdt = dt / steps;
    let done = false;
    for (let s = 0; s < steps && !done; s++) {
      p.x += p.vx * sdt; p.y += p.vy * sdt; p.z += p.vz * sdt;
      if (this.world.isSolid(p.x, p.z) || p.y < .12) done = true;
      else if (dist2(p.x, p.z, P.x, P.z) < (P.r + p.size + .3) ** 2 && Math.abs(p.y - 1) < 1.5) {
        this.hurtPlayer(p.dmg, null);
        done = true;
      }
    }
    if (done || p.life <= 0) {
      if (p.aoe) {
        this.explode(p.x, Math.max(.4, p.y), p.z, p.aoe, 0, p.color, {
          enemyOnly: true, hurtPlayer: p.dmg * .5, cloud: p.cloudOnHit,
        });
      } else {
        this.fx.burst(p.x, p.y, p.z, 6, { r: p.color[0], g: p.color[1], b: p.color[2], speed: 3, life: .3, size: .14 });
      }
      this.projectiles.splice(i, 1);
    }
  }
  _origUpdateProjectiles.call(this, dt);
};
