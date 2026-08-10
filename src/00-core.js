/* ==========================================================================
   DEADGRID 3D — core: math, rng, audio, input
   ========================================================================== */
'use strict';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);
const sign = Math.sign;
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a + d * t; };
const approach = (a, b, r) => a < b ? Math.min(a + r, b) : Math.max(a - r, b);

/* ------------------------------- rng -------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
class RNG {
  constructor(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + this.f() * (b - a); }
  int(a, b) { return Math.floor(a + this.f() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /** weighted pick: entries [{w:number,...}] */
  weighted(arr) {
    let total = 0;
    for (const e of arr) total += (e.w || 1);
    let r = this.f() * total;
    for (const e of arr) { r -= (e.w || 1); if (r <= 0) return e; }
    return arr[arr.length - 1];
  }
}

/* value noise, 2D, smooth --------------------------------------------- */
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const P = new Uint8Array(512);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function n2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const A = P[X] + Y, B = P[X + 1] + Y;
    return lerp(
      lerp(grad(P[A], x, y), grad(P[B], x - 1, y), u),
      lerp(grad(P[A + 1], x, y - 1), grad(P[B + 1], x - 1, y - 1), u), v);
  }
  function fbm(x, y, oct = 4, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n2(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return s / norm;
  }
  return { n2, fbm };
}

/* ------------------------------- vec3 ------------------------------- */
const v3 = {
  create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (o, a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; },
  cross: (o, a, b) => {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by; o[1] = az * bx - ax * bz; o[2] = ax * by - ay * bx; return o;
  },
};

/* ------------------------------- mat4 -------------------------------
   column-major, WebGL-ready                                            */
const m4 = {
  create() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  copy(o, a) { o.set(a); return o; },

  mul(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    o.fill(0);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[15] = 1;
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n);
    return o;
  },

  lookAt(o, eye, center, up) {
    const z = v3.create(), x = v3.create(), y = v3.create();
    v3.norm(z, v3.sub(z, eye, center));
    if (v3.len(z) < 1e-6) z[2] = 1;
    v3.norm(x, v3.cross(x, up, z));
    if (v3.len(x) < 1e-6) { x[0] = 1; x[1] = 0; x[2] = 0; }
    v3.cross(y, z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3.dot(x, eye); o[13] = -v3.dot(y, eye); o[14] = -v3.dot(z, eye); o[15] = 1;
    return o;
  },

  invert(o, a) {
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4],
      b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5],
      b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6],
      b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12],
      b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13],
      b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return o;
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
    o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
    o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
    o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
    o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
    o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
    o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
    o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
    o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },

  /** TRS with a single Y rotation — the common case for this game */
  composeY(o, px, py, pz, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    o[0] = c * sx; o[1] = 0; o[2] = -s * sx; o[3] = 0;
    o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
    o[8] = s * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },

  /** full euler TRS (order: Y then X then Z, applied to a unit box) */
  compose(o, px, py, pz, rx, ry, rz, sx, sy, sz) {
    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    // R = Ry * Rx * Rz
    const m00 = cy * cz + syr * sxr * szr, m01 = cx * szr, m02 = -syr * cz + cy * sxr * szr;
    const m10 = -cy * szr + syr * sxr * cz, m11 = cx * cz, m12 = syr * szr + cy * sxr * cz;
    const m20 = syr * cx, m21 = -sxr, m22 = cy * cx;
    o[0] = m00 * sx; o[1] = m01 * sx; o[2] = m02 * sx; o[3] = 0;
    o[4] = m10 * sy; o[5] = m11 * sy; o[6] = m12 * sy; o[7] = 0;
    o[8] = m20 * sz; o[9] = m21 * sz; o[10] = m22 * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },
};

/* ------------------------- color helpers ----------------------------- */
function hex2rgb(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}
/** sRGB hex -> linear rgb (renderer works in linear space) */
function hexLin(h) {
  const c = hex2rgb(h);
  return c.map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
}
function mixRGB(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/* ------------------------------ audio -------------------------------- */
const Audio3D = (() => {
  let ac = null, master = null, muted = false, comp = null;
  function init() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 8;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(comp); comp.connect(ac.destination);
    return ac;
  }
  function resume() { if (ac && ac.state === 'suspended') ac.resume(); }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
  function isMuted() { return muted; }

  const noiseBuf = {};
  function noise(dur) {
    const key = Math.round(dur * 100);
    if (noiseBuf[key]) return noiseBuf[key];
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const b = ac.createBuffer(1, n, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf[key] = b;
    return b;
  }

  /** gain envelope helper */
  function env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  /** all sfx take an optional volume + detune so repeats don't sound identical */
  function tone(opts) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = opts.type || 'square';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + (opts.slide || opts.dur));
    let node = o;
    if (opts.filter) {
      const f = ac.createBiquadFilter();
      f.type = opts.filter; f.frequency.value = opts.fc || 1200; f.Q.value = opts.q || 1;
      o.connect(f); node = f;
    }
    env(g, t, opts.atk || 0.005, opts.dur || 0.12, opts.vol == null ? 0.25 : opts.vol);
    node.connect(g); g.connect(master);
    o.start(t); o.stop(t + (opts.dur || 0.12) + (opts.atk || 0.005) + 0.02);
  }

  function burst(opts) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noise(opts.dur || 0.2);
    src.playbackRate.value = opts.rate || 1;
    const f = ac.createBiquadFilter();
    f.type = opts.filter || 'lowpass';
    f.frequency.setValueAtTime(opts.fc || 2000, t);
    if (opts.fc1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.fc1), t + (opts.dur || 0.2));
    f.Q.value = opts.q || 1;
    const g = ac.createGain();
    env(g, t, opts.atk || 0.004, opts.dur || 0.2, opts.vol == null ? 0.25 : opts.vol);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + (opts.dur || 0.2) + 0.05);
  }

  const R = () => Math.random();
  const SFX = {
    shootLight() { burst({ dur: .1, fc: 3500, fc1: 400, vol: .22, filter: 'bandpass', q: .8, rate: 1 + R() * .2 }); tone({ type: 'square', f0: 240 + R() * 40, f1: 60, dur: .07, vol: .1 }); },
    shootHeavy() { burst({ dur: .22, fc: 2600, fc1: 180, vol: .34, q: .7, rate: .8 + R() * .15 }); tone({ type: 'sawtooth', f0: 150, f1: 40, dur: .16, vol: .16 }); },
    shootSniper() { burst({ dur: .5, fc: 4200, fc1: 120, vol: .4, q: .6, rate: .7 }); tone({ type: 'sawtooth', f0: 110, f1: 30, dur: .4, vol: .2 }); },
    shootShell() { burst({ dur: .3, fc: 1800, fc1: 150, vol: .38, q: .5, rate: .75 }); },
    magic(f, type) { tone({ type: type || 'sine', f0: f, f1: f * 2.4, dur: .28, vol: .2, atk: .01, filter: 'lowpass', fc: 3000 }); tone({ type: 'triangle', f0: f * 1.5, f1: f * .6, dur: .2, vol: .12 }); },
    zap() { burst({ dur: .18, fc: 6000, fc1: 900, vol: .24, filter: 'highpass', q: 3, rate: 1.4 }); tone({ type: 'sawtooth', f0: 900, f1: 180, dur: .14, vol: .12 }); },
    frost() { burst({ dur: .4, fc: 5200, fc1: 2200, vol: .2, filter: 'highpass', q: 2 }); tone({ type: 'sine', f0: 1400, f1: 500, dur: .35, vol: .12 }); },
    boom(size) { burst({ dur: .55 * (size || 1), fc: 1200, fc1: 60, vol: .42, q: .4, rate: .55 }); tone({ type: 'sine', f0: 90, f1: 28, dur: .5, vol: .3 }); },
    swing() { burst({ dur: .16, fc: 1100, fc1: 320, vol: .17, filter: 'bandpass', q: 1.2, rate: 1.3 }); },
    hitFlesh() { burst({ dur: .12, fc: 700, fc1: 120, vol: .24, q: .8, rate: .9 }); tone({ type: 'triangle', f0: 130, f1: 55, dur: .1, vol: .16 }); },
    crit() { tone({ type: 'square', f0: 1500, f1: 2600, dur: .09, vol: .16 }); burst({ dur: .1, fc: 5000, vol: .18, filter: 'highpass' }); },
    hurt() { tone({ type: 'sawtooth', f0: 300, f1: 70, dur: .3, vol: .26 }); burst({ dur: .2, fc: 900, fc1: 150, vol: .2 }); },
    shield() { tone({ type: 'sine', f0: 700, f1: 1500, dur: .2, vol: .18 }); tone({ type: 'triangle', f0: 1400, f1: 900, dur: .16, vol: .1 }); },
    pickup() { tone({ type: 'square', f0: 620, f1: 980, dur: .1, vol: .16 }); setTimeout(() => tone({ type: 'square', f0: 980, f1: 1320, dur: .1, vol: .13 }), 70); },
    key() { tone({ type: 'triangle', f0: 700, f1: 1400, dur: .2, vol: .2 }); setTimeout(() => tone({ type: 'triangle', f0: 1050, f1: 2100, dur: .3, vol: .18 }), 110); },
    unlock() { [440, 587, 740, 880].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, f1: f * 1.02, dur: .28, vol: .16 }), i * 90)); },
    loot() { burst({ dur: .25, fc: 2400, fc1: 500, vol: .18, q: 1.5, rate: 1.1 }); },
    reload() { burst({ dur: .07, fc: 2600, vol: .16, filter: 'bandpass', q: 2 }); setTimeout(() => burst({ dur: .09, fc: 1500, vol: .18, filter: 'bandpass', q: 2 }), 130); },
    empty() { burst({ dur: .05, fc: 3000, vol: .12, filter: 'bandpass', q: 3 }); },
    dash() { burst({ dur: .26, fc: 900, fc1: 2800, vol: .16, filter: 'bandpass', q: 1 }); },
    zombie() { tone({ type: 'sawtooth', f0: 90 + R() * 50, f1: 55, dur: .5 + R() * .35, vol: .1, filter: 'lowpass', fc: 620, q: 2 }); },
    bossRoar() {
      tone({ type: 'sawtooth', f0: 70, f1: 40, dur: 1.4, vol: .38, filter: 'lowpass', fc: 500, q: 3 });
      tone({ type: 'square', f0: 105, f1: 52, dur: 1.2, vol: .22, filter: 'lowpass', fc: 800 });
      burst({ dur: 1.2, fc: 800, fc1: 100, vol: .22, rate: .5 });
    },
    bossHurt() { tone({ type: 'sawtooth', f0: 180, f1: 60, dur: .35, vol: .24, filter: 'lowpass', fc: 900 }); },
    telegraph() { tone({ type: 'square', f0: 300, f1: 900, dur: .5, vol: .12 }); },
    levelUp() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', f0: f, f1: f, dur: .35, vol: .17 }), i * 110)); },
    death() { tone({ type: 'sawtooth', f0: 220, f1: 30, dur: 1.6, vol: .32, filter: 'lowpass', fc: 700 }); burst({ dur: 1.4, fc: 700, fc1: 80, vol: .2, rate: .5 }); },
    ui() { tone({ type: 'square', f0: 880, f1: 880, dur: .05, vol: .09 }); },
  };
  return { init, resume, setMuted, isMuted, SFX, get ctx() { return ac; } };
})();

/* ------------------------------ input -------------------------------- */
const Input = {
  keys: Object.create(null),
  move: { x: 0, y: 0 },        // -1..1 desired movement
  aim: { x: 0, y: 1 },         // normalized aim direction (world XZ)
  firing: false,
  aimActive: false,            // right stick engaged (mobile) / mouse present
  mouse: { x: 0, y: 0, has: false },
  pressed: Object.create(null),
  down(k) { return !!this.keys[k]; },
  /** consume a one-shot press */
  tap(k) { if (this.pressed[k]) { this.pressed[k] = false; return true; } return false; },
  clearTaps() { this.pressed = Object.create(null); },
};
