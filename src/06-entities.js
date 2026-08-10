/* ==========================================================================
   Entities — animated blocky characters, AI, projectiles, VFX
   ========================================================================== */

const _E = m4.create();

/* ------------------------------------------------------------------------
   Blocky humanoid renderer.
   Everything is built from unit boxes transformed into place, so the same
   routine draws the player, every zombie variant and every boss.
   ------------------------------------------------------------------------ */
function drawLimb(R, bx, by, bz, yaw, lx, ly, lz, swing, roll, sx, sy, sz, m) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const wx = bx + (lx * c + lz * s);
  const wz = bz + (-lx * s + lz * c);
  m4.compose(_E, wx, by + ly, wz, swing, yaw, roll || 0, sx, sy, sz);
  R.push('box', _E, m);
}

function drawHumanoid(R, o) {
  const yaw = o.yaw, x = o.x, y = o.y, z = o.z;
  const sc = o.scale || 1;
  const skin = o.skin, cloth = o.cloth;
  const flash = o.flash || 0;
  const em = o.emissive;
  const eBase = em ? [em[0], em[1], em[2]] : [0, 0, 0];
  const bodyM = mat(cloth, .92, flash > 0 ? [flash * 2.2, flash * .5, flash * .4] : (em ? eBase : null), 0, 0, 0, 1, o.alpha == null ? 1 : o.alpha);
  const skinM = mat(skin, .82, flash > 0 ? [flash * 2.4, flash * .6, flash * .5] : (em ? eBase : null), o.metal || 0, 0, 0, 1, o.alpha == null ? 1 : o.alpha);

  const ph = o.phase || 0;
  const moving = o.moveAmt || 0;
  const swing = Math.sin(ph) * 0.95 * moving;
  const swing2 = Math.sin(ph + Math.PI) * 0.95 * moving;
  const bob = Math.abs(Math.sin(ph)) * 0.055 * moving;
  const lean = o.lean || 0;
  const armA = o.armA == null ? swing2 * 0.7 : o.armA;
  const armB = o.armB == null ? swing * 0.7 : o.armB;

  const H = sc;                       // overall height multiplier
  const legLen = .78 * H, torsoH = .74 * H, headS = .40 * H;
  const hipY = y + legLen + .04 * H + bob;
  const shoulderY = hipY + torsoH * .82;

  if (o.quad) {
    // four-legged: flatter body, head forward
    const bodyLen = 1.35 * H;
    m4.compose(_E, x, y + .52 * H + bob, z, lean, yaw, 0, .62 * H, .55 * H, bodyLen);
    R.push('box', _E, bodyM);
    drawLimb(R, x, y + .62 * H + bob, z, yaw, 0, 0, bodyLen * .52, .25, 0, .42 * H, .42 * H, .5 * H, skinM);
    for (const [sx2, sz2, sw] of [[-.28, .45, swing], [.28, .45, swing2], [-.28, -.45, swing2], [.28, -.45, swing]]) {
      drawLimb(R, x, y + .3 * H + bob, z, yaw, sx2 * H, -.12 * H - Math.cos(sw) * .16 * H, sz2 * H - Math.sin(sw) * .16 * H,
        sw, 0, .18 * H, .5 * H, .18 * H, skinM);
    }
    return;
  }

  // legs
  const legOff = .17 * H;
  for (const [side, sw] of [[-1, swing], [1, swing2]]) {
    const cx2 = 0, cy2 = -legLen / 2 * Math.cos(sw), cz2 = -legLen / 2 * Math.sin(sw);
    drawLimb(R, x, hipY, z, yaw, side * legOff, cy2, cz2, sw, 0, .21 * H, legLen, .23 * H, bodyM);
  }
  // torso
  m4.compose(_E, x, hipY + torsoH / 2, z, lean, yaw, 0, .56 * H, torsoH, .34 * H);
  R.push('box', _E, bodyM);
  // shoulders slab
  m4.compose(_E, x, shoulderY, z, lean, yaw, 0, .68 * H, .17 * H, .36 * H);
  R.push('box', _E, bodyM);
  // head
  const headY = shoulderY + headS * .62;
  const hc = Math.cos(yaw), hs = Math.sin(yaw);
  m4.compose(_E, x + hs * .02, headY, z + hc * .02, (o.headPitch || 0) + lean, yaw, 0, headS, headS, headS * .92);
  R.push('box', _E, skinM);
  // eyes
  if (o.eyes) {
    const ec = o.eyes;
    const eM = mat([ec[0] * .1, ec[1] * .1, ec[2] * .1], .3, [ec[0] * 3.2, ec[1] * 3.2, ec[2] * 3.2], 0, 3);
    for (const side of [-1, 1]) {
      const ox = side * headS * .24, oz = headS * .48;
      m4.compose(_E, x + (ox * hc + oz * hs), headY + headS * .1, z + (-ox * hs + oz * hc), 0, yaw, 0,
        headS * .17, headS * .13, headS * .06);
      R.push('box', _E, eM);
    }
  }
  // arms
  const armLen = .68 * H, armOff = .38 * H;
  for (const [side, sw] of [[-1, armA], [1, armB]]) {
    const cy2 = -armLen / 2 * Math.cos(sw), cz2 = -armLen / 2 * Math.sin(sw);
    drawLimb(R, x, shoulderY - .04 * H, z, yaw, side * armOff, cy2, cz2, sw, side * (o.armRoll || 0),
      .19 * H, armLen, .19 * H, skinM);
  }
  return { shoulderY, headY, armLen, armOff, H };
}

/** returns world position of the weapon hand */
function handPos(o, side) {
  const H = o.scale || 1;
  const legLen = .78 * H, torsoH = .74 * H;
  const hipY = o.y + legLen + .04 * H;
  const shoulderY = hipY + torsoH * .82;
  const armLen = .68 * H, armOff = .38 * H;
  const a = side === 'l' ? (o.armA || 0) : (o.armB || 0);
  const lx = (side === 'l' ? -1 : 1) * armOff;
  const ly = -armLen * Math.cos(a), lz = -armLen * Math.sin(a);
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  return [o.x + (lx * c + lz * s), shoulderY - .04 * H + ly, o.z + (-lx * s + lz * c)];
}

function drawWeaponModel(R, parts, px, py, pz, yaw, pitch, scale) {
  if (!parts) return;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sc = scale || 1;
  for (const p of parts) {
    const lx = p.p[0] * sc, ly = p.p[1] * sc, lz = p.p[2] * sc;
    const wx = px + (lx * c + lz * s), wz = pz + (-lx * s + lz * c);
    m4.compose(_E, wx, py + ly, wz, pitch || 0, yaw, 0, p.s[0] * sc, p.s[1] * sc, p.s[2] * sc);
    const col = hexLin(p.c);
    const e = p.e ? hexLin(p.e) : null;
    R.push('box', _E, mat(col, .35, e ? [e[0] * 2.2, e[1] * 2.2, e[2] * 2.2] : null, .65, e ? 3 : 0));
  }
}

/* ==========================================================================
   Particles / decals / floating text
   ========================================================================== */
class FX {
  constructor() {
    this.parts = [];
    this.decals = [];
    this.texts = [];
    this.rings = [];
    this.pool = [];
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, opt) {
    const p = this.pool.pop() || {};
    p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life; p.max = life; p.size = size;
    p.r = r; p.g = g; p.b = b; p.a = a;
    p.grav = opt && opt.grav != null ? opt.grav : -9;
    p.drag = opt && opt.drag != null ? opt.drag : 1.6;
    p.add = opt && opt.add != null ? opt.add : true;
    p.kind = opt && opt.kind || 0;
    p.grow = opt && opt.grow || 0;
    p.rot = opt && opt.rot || 0;
    p.spin = opt && opt.spin || 0;
    p.fade = opt && opt.fade || 1;
    p.bounce = opt && opt.bounce || 0;
    this.parts.push(p);
    if (this.parts.length > 2400) this.pool.push(this.parts.shift());
    return p;
  }
  burst(x, y, z, n, opt) {
    const o = opt || {};
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = Math.random() * (o.cone || 1.2);
      const sp = (o.speed || 4) * (0.35 + Math.random() * 0.9);
      const vy = Math.cos(e) * sp * (o.up == null ? 1 : o.up) + (o.vy || 0);
      const s = Math.sin(e) * sp;
      this.spawn(x, y, z, Math.cos(a) * s + (o.vx || 0), vy, Math.sin(a) * s + (o.vz || 0),
        (o.life || .6) * (.6 + Math.random() * .8), (o.size || .18) * (.6 + Math.random() * .9),
        o.r, o.g, o.b, o.a == null ? 1 : o.a, o);
    }
  }
  decal(x, z, size, r, g, b, a, life) {
    this.decals.push({ x, z, size, r, g, b, a, life: life || 999, max: life || 999, rot: Math.random() * TAU });
    if (this.decals.length > 170) this.decals.shift();
  }
  ring(x, y, z, r0, r1, time, cr, cg, cb, a) {
    this.rings.push({ x, y, z, r0, r1, t: 0, time, r: cr, g: cg, b: cb, a });
  }
  text(x, y, z, str, col, size, vy) {
    this.texts.push({ x, y, z, str, col, size: size || 1, t: 0, life: 1.05, vy: vy == null ? 1.6 : vy });
    if (this.texts.length > 60) this.texts.shift();
  }
  update(dt, world) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.push(p); ps.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vz *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      if (p.grow) p.size += p.grow * dt;
      if (p.y < 0.03) {
        if (p.bounce > 0) { p.y = 0.03; p.vy = -p.vy * p.bounce; p.vx *= .7; p.vz *= .7; }
        else { p.y = 0.03; p.vy = 0; p.vx *= .82; p.vz *= .82; }
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.time) this.rings.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      if (d.life < 900) { d.life -= dt; if (d.life <= 0) this.decals.splice(i, 1); }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.t += dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.4 * dt);
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
  }
  render(R) {
    for (const p of this.parts) {
      const f = clamp(p.life / p.max, 0, 1);
      const a = p.a * Math.pow(f, p.fade);
      R.particle(p.add, p.x, p.y, p.z, p.size, p.r * a, p.g * a, p.b * a, a, p.rot, p.kind, p.vx, p.vz);
    }
    for (const r of this.rings) {
      const t = r.t / r.time;
      const rad = lerp(r.r0, r.r1, smoothstep(clamp(t, 0, 1)));
      const a = r.a * (1 - t);
      R.particle(true, r.x, r.y + .05, r.z, rad * 2, r.r * a, r.g * a, r.b * a, a, 0, 2, 0, 0);
    }
    const dm = mat([0, 0, 0], .95, null, 0, 4, 0, 1, 1);
    for (const d of this.decals) {
      const a = d.life < 900 ? clamp(d.life / d.max, 0, 1) * d.a : d.a;
      dm.c = [d.r, d.g, d.b];
      dm.alpha = a;
      m4.composeY(_E, d.x, 0.035, d.z, d.rot, d.size, 1, d.size);
      R.pushT('quad', _E, dm);
    }
  }
  clear() { this.parts.length = 0; this.decals.length = 0; this.texts.length = 0; this.rings.length = 0; }
}

/* ==========================================================================
   Flow field pathing — BFS out from the player, enemies follow the gradient
   ========================================================================== */
const FLOW_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function computeFlow(world, tx, tz, radius) {
  const w = world.w, h = world.h;
  if (!world.flowDist || world.flowDist.length !== w * h) {
    world.flowDist = new Uint16Array(w * h);
    world.flowQueue = new Int32Array(w * h);
  }
  const dist = world.flowDist, q = world.flowQueue;
  dist.fill(65535);
  const [si, sj] = world.cellOf(tx, tz);
  if (!world.inB(si, sj)) return;
  let head = 0, tail = 0;
  const start = world.idx(si, sj);
  dist[start] = 0; q[tail++] = start;
  const maxD = radius || 70;
  while (head < tail) {
    const k = q[head++];
    const d = dist[k];
    if (d >= maxD) continue;
    const i = k % w, j = (k - i) / w;
    for (let n = 0; n < 4; n++) {
      const di = FLOW_DIRS[n][0], dj = FLOW_DIRS[n][1];
      const ni = i + di, nj = j + dj;
      if (ni < 1 || nj < 1 || ni >= w - 1 || nj >= h - 1) continue;
      const nk = nj * w + ni;
      if (world.solid[nk]) continue;
      if (dist[nk] <= d + 1) continue;
      dist[nk] = d + 1;
      q[tail++] = nk;
    }
  }
  world.flowValid = true;
}

/** best step direction toward the player from a world position */
function flowDir(world, x, z, out) {
  const [i, j] = world.cellOf(x, z);
  if (!world.inB(i, j) || !world.flowDist) { out[0] = 0; out[1] = 0; return false; }
  const here = world.flowDist[world.idx(i, j)];
  if (here === 65535) { out[0] = 0; out[1] = 0; return false; }
  let bd = here, bi = 0, bj = 0;
  for (const [di, dj] of FLOW_DIRS) {
    const ni = i + di, nj = j + dj;
    if (!world.inB(ni, nj)) continue;
    if (world.solid[world.idx(ni, nj)]) continue;
    if (di && dj) {
      if (world.solid[world.idx(i + di, j)] || world.solid[world.idx(i, j + dj)]) continue;
    }
    const d = world.flowDist[world.idx(ni, nj)];
    if (d < bd) { bd = d; bi = di; bj = dj; }
  }
  if (!bi && !bj) { out[0] = 0; out[1] = 0; return false; }
  const l = Math.hypot(bi, bj);
  out[0] = bi / l; out[1] = bj / l;
  return true;
}

/* ==========================================================================
   Status effects
   ========================================================================== */
function applyStatus(e, type, dur, power) {
  const s = e.status || (e.status = {});
  const cur = s[type];
  if (!cur || cur.t < dur) s[type] = { t: dur, p: power };
  else cur.p = Math.max(cur.p, power);
}
function tickStatus(e, dt, game) {
  const s = e.status;
  if (!s) return;
  for (const k in s) {
    const st = s[k];
    st.t -= dt;
    if (st.t <= 0) { delete s[k]; continue; }
    if (k === 'burn' || k === 'poison' || k === 'bleed') {
      e._dotAcc = (e._dotAcc || 0) + st.p * dt;
      if (e._dotAcc >= 1) {
        const d = Math.floor(e._dotAcc);
        e._dotAcc -= d;
        game.damageEnemy(e, d, null, { silent: true, dot: k });
      }
    }
  }
}
function statusSpeedMul(e) {
  const s = e.status;
  if (!s) return 1;
  let m = 1;
  if (s.slow) m *= (1 - s.slow.p);
  if (s.freeze) m = 0;
  if (s.stun) m = 0;
  return m;
}

/* ==========================================================================
   Enemy
   ========================================================================== */
let ENEMY_UID = 1;
class Enemy {
  constructor(type, x, z, diff, isElite) {
    const d = ENEMIES[type];
    this.uid = ENEMY_UID++;
    this.type = type; this.def = d;
    this.x = x; this.z = z; this.y = 0;
    this.elite = !!isElite;
    const scale = 1 + (diff - 1) * 0.11;
    this.maxHp = Math.round(d.hp * scale * (isElite ? 3.4 : 1));
    this.hp = this.maxHp;
    this.dmg = d.dmg * (1 + (diff - 1) * 0.1) * (isElite ? 1.6 : 1);
    this.speed = d.speed * (isElite ? 1.12 : 1);
    this.r = d.w * 0.86;
    this.yaw = Math.random() * TAU;
    this.phase = Math.random() * TAU;
    this.state = 'idle';
    this.atkCd = Math.random() * 1.5;
    this.flash = 0;
    this.moveAmt = 0;
    this.vx = 0; this.vz = 0;
    this.wanderT = 0; this.wx = 0; this.wz = 0;
    this.groanT = Math.random() * 6;
    this.dead = false;
    this.deathT = 0;
    this.scale = (d.h / 1.72) * (isElite ? 1.28 : 1);
    this.armA = 0; this.armB = 0;
    this.lungeT = 0;
    this.alerted = false;
  }

  get alive() { return !this.dead; }

  update(dt, game) {
    const P = game.player;
    if (this.dead) {
      this.deathT += dt;
      return;
    }
    tickStatus(this, dt, game);
    this.flash = Math.max(0, this.flash - dt * 5);
    const sm = statusSpeedMul(this);
    const dx = P.x - this.x, dz = P.z - this.z;
    const d = Math.hypot(dx, dz);
    const aggro = this.def.aggro * (game.player.noise > 0 ? 1.5 : 1);

    if (!this.alerted && (d < aggro || this.hp < this.maxHp)) {
      this.alerted = true;
      if (Math.random() < .35) Audio3D.SFX.zombie();
    }

    let mx = 0, mz = 0;
    if (this.alerted && !P.dead) {
      this.state = 'chase';
      const dir = game._tmpDir;
      const useFlow = d > 3.5 && !game.world.los(this.x, this.z, P.x, P.z);
      if (useFlow && flowDir(game.world, this.x, this.z, dir)) {
        mx = dir[0]; mz = dir[1];
      } else if (d > 0.01) {
        mx = dx / d; mz = dz / d;
      }
      // attack
      const reach = this.def.range + this.r + P.r;
      this.atkCd -= dt;
      if (this.def.ranged) {
        if (d < this.def.range && this.atkCd <= 0 && game.world.los(this.x, this.z, P.x, P.z)) {
          this.atkCd = this.def.atkCd;
          this.attackAnim = .35;
          game.enemyRanged(this, P);
        }
        if (d < 7) { mx = -mx * .5; mz = -mz * .5; }     // kite
      } else if (d < reach) {
        mx *= .2; mz *= .2;
        if (this.atkCd <= 0) {
          this.atkCd = this.def.atkCd;
          this.attackAnim = .3;
          if (this.def.explode) game.enemyExplode(this);
          else {
            game.hurtPlayer(this.dmg, this);
            game.fx.burst(P.x, 1.1, P.z, 6, { r: .7, g: .1, b: .1, speed: 3, life: .35, size: .12, add: false, grav: -6 });
          }
        }
      }
      // lunge
      if (this.def.lunge && d < 6 && d > 2.2 && this.lungeT <= 0) {
        this.lungeT = 2.2;
        this.vx += mx * 9; this.vz += mz * 9;
      }
      if (this.def.scream && d < 14 && this.atkCd <= 0.05 && !this.screamed) {
        this.screamed = true;
        game.screamerCall(this);
      }
    } else {
      this.state = 'wander';
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.6 + Math.random() * 3;
        const a = Math.random() * TAU;
        this.wx = Math.cos(a); this.wz = Math.sin(a);
        if (Math.random() < .4) { this.wx = 0; this.wz = 0; }
      }
      mx = this.wx * .32; mz = this.wz * .32;
    }
    this.lungeT -= dt;

    // separation from neighbours
    const sep = game.separation(this);
    mx += sep[0]; mz += sep[1];

    const sp = this.speed * sm * (this.state === 'chase' ? 1 : .55);
    const ml = Math.hypot(mx, mz);
    if (ml > 0.001) { mx /= ml; mz /= ml; }
    this.vx += mx * sp * 12 * dt;
    this.vz += mz * sp * 12 * dt;
    const damp = Math.exp(-7 * dt);
    this.vx *= damp; this.vz *= damp;
    const vlen = Math.hypot(this.vx, this.vz);
    const maxV = sp * (this.lungeT > 1.9 ? 3 : 1.15);
    if (vlen > maxV) { this.vx = this.vx / vlen * maxV; this.vz = this.vz / vlen * maxV; }

    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const res = game.world.resolve(nx, nz, this.r);
    if (res[0] !== nx) this.vx *= .3;
    if (res[1] !== nz) this.vz *= .3;
    this.x = res[0]; this.z = res[1];

    const spd = Math.hypot(this.vx, this.vz);
    this.moveAmt = clamp(spd / Math.max(.4, this.speed), 0, 1.4);
    this.phase += dt * (4.5 + spd * 1.6);
    if (spd > .12) this.yaw = angleLerp(this.yaw, Math.atan2(this.vx, this.vz), clamp(dt * 8, 0, 1));
    else if (this.alerted && d > .01) this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), clamp(dt * 5, 0, 1));

    this.y = game.world.isWater(this.x, this.z) ? -0.3 : 0;
    if (this.def.float) this.y = 0.55 + Math.sin(game.time * 1.6 + this.phase) * 0.14;

    this.attackAnim = Math.max(0, (this.attackAnim || 0) - dt * 3);
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 4 + Math.random() * 9;
      if (dist2(this.x, this.z, P.x, P.z) < 900 && Math.random() < .35) Audio3D.SFX.zombie();
    }
  }

  render(R, game) {
    const d = this.def;
    const skin = hexLin(d.skin), cloth = hexLin(d.cloth);
    let alpha = 1;
    if (this.dead) {
      const t = clamp(this.deathT / 1.1, 0, 1);
      alpha = 1 - t * t;
      if (alpha <= 0.02) return;
    }
    if (d.fade) {
      const dd = Math.hypot(this.x - game.player.x, this.z - game.player.z);
      alpha *= clamp((14 - dd) / 8, .28, 1);
    }
    const atk = this.attackAnim || 0;
    const armSwing = atk > 0 ? -1.5 * Math.sin(atk / .3 * Math.PI) : null;
    const eliteGlow = this.elite ? [.9, .2, .15] : (d.emissive || null);
    const opts = {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, scale: this.scale,
      skin, cloth, phase: this.phase, moveAmt: this.moveAmt,
      flash: this.flash, alpha,
      eyes: this.alerted ? (this.elite ? [1, .3, .1] : (d.emissive || [.9, .15, .1])) : [.3, .25, .1],
      emissive: eliteGlow ? [eliteGlow[0] * .18, eliteGlow[1] * .18, eliteGlow[2] * .18] : null,
      metal: d.metal || 0,
      quad: d.quad,
      lean: this.dead ? clamp(this.deathT * 2.2, 0, 1.35) : (this.state === 'chase' ? .14 : .05),
      armA: armSwing != null ? armSwing : (this.state === 'chase' && !d.quad ? -1.15 + Math.sin(this.phase) * .18 : undefined),
      armB: armSwing != null ? armSwing * .8 : (this.state === 'chase' && !d.quad ? -1.05 + Math.sin(this.phase + 1) * .18 : undefined),
    };
    drawHumanoid(R, opts);
    if (this.elite && !this.dead) {
      R.particle(true, this.x, this.y + this.scale * 2.1, this.z, .8, .9, .2, .1, .5,
        game.time * 2, 0, 0, 0);
      R.light(this.x, this.y + 1.4, this.z, 7, 1, .25, .12, 1.2);
    }
    if (d.emissive && !this.dead) {
      R.light(this.x, this.y + 1.3, this.z, 8, d.emissive[0], d.emissive[1], d.emissive[2], 1.4);
    }
  }
}

/* ==========================================================================
   Boss
   ========================================================================== */
class Boss extends Enemy {
  constructor(key, x, z, diff) {
    const def = BOSSES[key];
    super('walker', x, z, 1, false);
    this.isBoss = true;
    this.key = key; this.bdef = def;
    this.def = {
      name: def.name, hp: def.hp, speed: def.speed, dmg: def.contact, range: 2.6, atkCd: 1.1,
      skin: def.skin, cloth: def.cloth, h: def.h, w: def.w, aggro: 999, gore: 3,
      knockRes: 1, float: def.float, emissive: def.accent,
    };
    this.maxHp = Math.round(def.hp * (1 + (diff - 1) * 0.06));
    this.hp = this.maxHp;
    this.dmg = def.contact;
    this.speed = def.speed;
    this.r = def.w * .9;
    this.scale = def.h / 1.72;
    this.phaseIdx = 0;
    this.abilityCd = 2.5;
    this.castT = 0;
    this.castName = null;
    this.rageMul = 1;
    this.alerted = true;
    this.shield = 0;
    this.blinkT = 0;
    this.chargeT = 0; this.chargeDir = [0, 0];
    this.spawned = [];
    this.introT = 2.2;
  }

  phaseDef() { return this.bdef.phases[this.phaseIdx]; }

  update(dt, game) {
    if (this.dead) { this.deathT += dt; return; }
    tickStatus(this, dt, game);
    this.flash = Math.max(0, this.flash - dt * 5);
    const P = game.player;

    if (this.introT > 0) {
      this.introT -= dt;
      this.phase += dt * 2;
      this.yaw = angleLerp(this.yaw, Math.atan2(P.x - this.x, P.z - this.z), dt * 3);
      return;
    }

    // phase transitions
    const frac = this.hp / this.maxHp;
    while (this.phaseIdx < this.bdef.phases.length - 1 && frac <= this.bdef.phases[this.phaseIdx + 1].at) {
      this.phaseIdx++;
      const pd = this.phaseDef();
      this.rageMul = pd.rage || 1;
      this.speed = this.bdef.speed * (pd.speedMul || 1);
      game.onBossPhase(this);
    }

    const dx = P.x - this.x, dz = P.z - this.z;
    const d = Math.hypot(dx, dz) || .0001;

    // casting
    if (this.castT > 0) {
      this.castT -= dt;
      this.moveAmt = 0;
      this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), dt * 2.2);
      if (this.castT <= 0) { game.bossCast(this, this.castName); this.castName = null; }
      this.phase += dt * 3;
      return;
    }

    // charge
    if (this.chargeT > 0) {
      this.chargeT -= dt;
      const sp = this.speed * 4.2;
      this.vx = this.chargeDir[0] * sp; this.vz = this.chargeDir[1] * sp;
      const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
      const res = game.world.resolve(nx, nz, this.r);
      if (Math.abs(res[0] - nx) > .001 || Math.abs(res[1] - nz) > .001) {
        this.chargeT = 0;
        game.bossSlam(this, 5.5);
      }
      this.x = res[0]; this.z = res[1];
      this.moveAmt = 1.4;
      this.phase += dt * 14;
      this.yaw = Math.atan2(this.chargeDir[0], this.chargeDir[1]);
      if (d < this.r + P.r + 1.2) {
        game.hurtPlayer(this.dmg * 1.5, this);
        this.chargeT = 0;
        game.bossSlam(this, 4);
      }
      game.fx.burst(this.x, .3, this.z, 2, {
        r: .6, g: .5, b: .45, speed: 2, life: .5, size: .3, add: false, grav: -2, a: .5,
      });
      return;
    }

    // ability selection
    this.abilityCd -= dt * this.rageMul;
    if (this.abilityCd <= 0) {
      const abilities = this.phaseDef().abilities;
      const pick = abilities[Math.floor(Math.random() * abilities.length)];
      this.abilityCd = (3.4 + Math.random() * 2.4) / this.rageMul;
      this.startAbility(pick, game);
      return;
    }

    // default: walk at the player and swing
    let mx = dx / d, mz = dz / d;
    const useFlow = d > 4 && !game.world.los(this.x, this.z, P.x, P.z);
    if (useFlow) {
      const dir = game._tmpDir;
      if (flowDir(game.world, this.x, this.z, dir)) { mx = dir[0]; mz = dir[1]; }
    }
    const reach = this.r + P.r + 1.6;
    this.atkCd -= dt;
    if (d < reach) {
      mx *= .1; mz *= .1;
      if (this.atkCd <= 0) {
        this.atkCd = 1.2 / this.rageMul;
        this.attackAnim = .35;
        game.hurtPlayer(this.dmg, this);
        game.bossSlam(this, 3.2, .35);
      }
    }
    const sp = this.speed * statusSpeedMul(this);
    this.vx += mx * sp * 10 * dt; this.vz += mz * sp * 10 * dt;
    const damp = Math.exp(-6 * dt);
    this.vx *= damp; this.vz *= damp;
    const vl = Math.hypot(this.vx, this.vz);
    if (vl > sp) { this.vx = this.vx / vl * sp; this.vz = this.vz / vl * sp; }
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const res = game.world.resolve(nx, nz, this.r);
    this.x = res[0]; this.z = res[1];
    this.moveAmt = clamp(vl / Math.max(.4, sp), 0, 1.3);
    this.phase += dt * (3.4 + vl);
    this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), dt * 3.4);
    this.y = this.bdef.float ? .8 + Math.sin(game.time * 1.4) * .22 : 0;
    this.attackAnim = Math.max(0, (this.attackAnim || 0) - dt * 3);
  }

  startAbility(name, game) {
    const P = game.player;
    if (name === 'charge') {
      const dx = P.x - this.x, dz = P.z - this.z, d = Math.hypot(dx, dz) || 1;
      this.chargeDir = [dx / d, dz / d];
      this.chargeT = 1.1;
      Audio3D.SFX.telegraph();
      game.fx.ring(this.x, .1, this.z, 1, 4, .5, 1, .3, .1, .8);
      return;
    }
    this.castName = name;
    this.castT = name === 'blink' ? .25 : .85;
    Audio3D.SFX.telegraph();
    const a = this.bdef.accent;
    game.fx.ring(this.x, .1, this.z, .5, 4.5, this.castT, a[0], a[1], a[2], .9);
  }

  render(R, game) {
    const def = this.bdef;
    const skin = hexLin(def.skin), cloth = hexLin(def.cloth);
    let alpha = 1;
    if (this.dead) {
      const t = clamp(this.deathT / 2.2, 0, 1);
      alpha = 1 - t * t;
      if (alpha <= .02) return;
    }
    const acc = def.accent;
    const pulse = .5 + .5 * Math.sin(game.time * 3);
    const atk = this.attackAnim || 0;
    const castGlow = this.castT > 0 ? 1 : 0;
    const armSwing = atk > 0 ? -1.7 * Math.sin(atk / .35 * Math.PI) : (castGlow ? -1.9 : undefined);
    drawHumanoid(R, {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, scale: this.scale,
      skin, cloth, phase: this.phase, moveAmt: this.moveAmt, flash: this.flash, alpha,
      eyes: acc,
      emissive: [acc[0] * (.14 + castGlow * .5 + pulse * .06), acc[1] * (.14 + castGlow * .5 + pulse * .06), acc[2] * (.14 + castGlow * .5 + pulse * .06)],
      lean: this.dead ? clamp(this.deathT * 1.4, 0, 1.4) : .12,
      armA: armSwing, armB: armSwing != null ? armSwing * .85 : undefined,
    });
    // crown of motes
    if (!this.dead) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = game.time * 1.3 + i / n * TAU;
        const rr = this.r + 1.1;
        R.particle(true, this.x + Math.cos(a) * rr, this.y + this.scale * 2.6 + Math.sin(game.time * 2 + i) * .2,
          this.z + Math.sin(a) * rr, .55, acc[0], acc[1], acc[2], .75, 0, 0, 0, 0);
      }
      R.light(this.x, this.y + 2, this.z, 16, acc[0], acc[1], acc[2], 2.2 + castGlow * 3);
    }
  }
}

/* ==========================================================================
   Projectiles
   ========================================================================== */
class Projectile {
  constructor(o) { Object.assign(this, o); this.t = 0; this.dead = false; }
}

/* ==========================================================================
   Pickups
   ========================================================================== */
class Pickup {
  constructor(kind, x, z, data) {
    this.kind = kind;         // 'med' | 'ammo' | 'weapon' | 'mod' | 'mana' | 'key'
    this.x = x; this.z = z; this.y = .5;
    this.data = data;
    this.t = Math.random() * TAU;
    this.taken = false;
    this.age = 0;
  }
  render(R, game) {
    const t = game.time * 2 + this.t;
    const y = .55 + Math.sin(t) * .13;
    let col = [1, 1, 1], meshId = 'octa', s = .42;
    if (this.kind === 'med') { col = [1, .25, .25]; meshId = 'box'; s = .38; }
    else if (this.kind === 'ammo') { col = hexLin(AMMO[this.data.type].color); meshId = 'box'; s = .34; }
    else if (this.kind === 'weapon') { col = this.data.color ? hexLin(this.data.color) : [.8, .82, .9]; meshId = 'box'; s = .45; }
    else if (this.kind === 'mod') { col = hexLin(MOD_BY_ID[this.data.id].color); meshId = 'octa'; s = .5; }
    else if (this.kind === 'mana') { col = [.7, .35, 1]; meshId = 'octa'; s = .42; }
    else if (this.kind === 'key') { col = hexLin(KEYS[this.data.id].color); meshId = 'octa'; s = .58; }
    const e = [col[0] * 2.6, col[1] * 2.6, col[2] * 2.6];
    m4.composeY(_E, this.x, y, this.z, t * .9, s, s * (this.kind === 'key' ? 1.5 : 1), s);
    R.push(meshId, _E, mat([col[0] * .3, col[1] * .3, col[2] * .3], .25, e, .3, 3));
    R.light(this.x, y + .3, this.z, 6.5, col[0], col[1], col[2], 1.5);
    R.particle(true, this.x, y, this.z, 1.5, col[0] * .35, col[1] * .35, col[2] * .35, .4, 0, 0, 0, 0);
    if (this.kind === 'key' || this.kind === 'mod') {
      R.particle(true, this.x, .06, this.z, 3.2, col[0] * .3, col[1] * .3, col[2] * .3, .5, 0, 2, 0, 0);
    }
  }
}
