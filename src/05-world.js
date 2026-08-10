/* ==========================================================================
   Procedural world generation + baked irradiance (GI) grid
   Grid is 1 cell = 1 world unit. Cell (i,j) -> world (i - w/2 + .5, j - h/2 + .5)
   ========================================================================== */

const WALL_H = 3.4;
const TORCH_COL = [1.0, 0.52, 0.18];

class World {
  constructor(level, seed) {
    this.level = level;
    this.biome = BIOMES[level.biome];
    this.rng = new RNG(seed);
    this.noise = makeNoise(seed ^ 0x9e37);
    const s = level.size | 0;
    this.w = s; this.h = s;
    this.solid = new Uint8Array(s * s);
    this.occl = new Uint8Array(s * s);     // blocks light propagation
    this.roof = new Uint8Array(s * s);     // 1 = indoors (no sky)
    this.water = new Uint8Array(s * s);
    this.floorT = new Uint8Array(s * s);   // 0 ground, 1 road, 2 interior, 3 special
    this.visited = new Uint8Array(s * s);  // explored, for the minimap
    this.lights = [];                      // {x,y,z,r,g,b,i,rad,flicker}
    this.containers = [];
    this.exits = [];
    this.spawnPoints = [];
    this.bossArena = null;
    this.spawn = { x: 0, z: 0 };
    this.decorLights = [];
  }

  idx(i, j) { return j * this.w + i; }
  inB(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  cellOf(x, z) { return [Math.floor(x + this.w / 2), Math.floor(z + this.h / 2)]; }
  worldOf(i, j) { return [i - this.w / 2 + .5, j - this.h / 2 + .5]; }

  isSolid(x, z) {
    const i = Math.floor(x + this.w / 2), j = Math.floor(z + this.h / 2);
    if (!this.inB(i, j)) return true;
    return this.solid[this.idx(i, j)] === 1;
  }
  isWater(x, z) {
    const i = Math.floor(x + this.w / 2), j = Math.floor(z + this.h / 2);
    if (!this.inB(i, j)) return false;
    return this.water[this.idx(i, j)] === 1;
  }
  floorY(x, z) { return this.isWater(x, z) ? -0.42 : 0; }

  markVisited(x, z, r) {
    const [ci, cj] = this.cellOf(x, z);
    const rr = r | 0;
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
      if (this.inB(i, j)) this.visited[this.idx(i, j)] = 1;
    }
  }

  /** circle-vs-grid collision resolve; returns corrected position */
  resolve(x, z, r) {
    const half = this.w / 2;
    for (let pass = 0; pass < 2; pass++) {
      const ci = Math.floor(x + half), cj = Math.floor(z + half);
      for (let j = cj - 1; j <= cj + 1; j++) {
        for (let i = ci - 1; i <= ci + 1; i++) {
          if (!this.inB(i, j)) {
            // outside the map acts as a wall
            continue;
          }
          if (this.solid[this.idx(i, j)] !== 1) continue;
          const minX = i - half, maxX = i - half + 1;
          const minZ = j - half, maxZ = j - half + 1;
          const nx = clamp(x, minX, maxX), nz = clamp(z, minZ, maxZ);
          const dx = x - nx, dz = z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            x += dx / d * (r - d); z += dz / d * (r - d);
          } else {
            // centre inside the cell: push out along the shallowest axis
            const cx = i - half + .5, cz = j - half + .5;
            if (Math.abs(x - cx) > Math.abs(z - cz)) x += sign(x - cx || 1) * (r + .5 - Math.abs(x - cx));
            else z += sign(z - cz || 1) * (r + .5 - Math.abs(z - cz));
          }
        }
      }
    }
    const lim = half - 1.2;
    x = clamp(x, -lim, lim); z = clamp(z, -lim, lim);
    return [x, z];
  }

  /** cheap line-of-sight over the grid (DDA) */
  los(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const n = Math.ceil(Math.hypot(dx, dz) * 1.4);
    if (n === 0) return true;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this.isSolid(x0 + dx * t, z0 + dz * t)) return false;
    }
    return true;
  }

  randomOpenCell(minDistFrom, minD) {
    for (let tries = 0; tries < 400; tries++) {
      const i = this.rng.int(2, this.w - 3), j = this.rng.int(2, this.h - 3);
      if (this.solid[this.idx(i, j)]) continue;
      const [x, z] = this.worldOf(i, j);
      if (minDistFrom && dist2(x, z, minDistFrom.x, minDistFrom.z) < minD * minD) continue;
      return { x, z, i, j };
    }
    return { x: 0, z: 0, i: this.w >> 1, j: this.h >> 1 };
  }

  /* ------------------------------------------------------------------
     Baked irradiance grid.
     rgb = bounced/ambient light, a = sky visibility (gates direct sun).
     ------------------------------------------------------------------ */
  bakeGI() {
    const w = this.w, h = this.h, n = w * h;
    const env = this.biome.env;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    const S = new Float32Array(n);

    const skyR = env.ambient[0], skyG = env.ambient[1], skyB = env.ambient[2];
    for (let k = 0; k < n; k++) {
      if (this.solid[k]) continue;
      if (!this.roof[k]) {
        R[k] = skyR; G[k] = skyG; B[k] = skyB;
        S[k] = 1;
      }
    }
    // inject point light sources
    for (const L of this.lights) {
      const [i, j] = this.cellOf(L.x, L.z);
      if (!this.inB(i, j)) continue;
      const k = this.idx(i, j);
      const p = L.i * 0.42;
      R[k] = Math.max(R[k], L.r * p); G[k] = Math.max(G[k], L.g * p); B[k] = Math.max(B[k], L.b * p);
    }

    // flood-propagate with attenuation; walls block
    const att = 0.855;
    const tmpR = new Float32Array(n), tmpG = new Float32Array(n), tmpB = new Float32Array(n), tmpS = new Float32Array(n);
    const ITER = 22;
    for (let it = 0; it < ITER; it++) {
      tmpR.set(R); tmpG.set(G); tmpB.set(B); tmpS.set(S);
      for (let j = 1; j < h - 1; j++) {
        for (let i = 1; i < w - 1; i++) {
          const k = j * w + i;
          if (this.occl[k]) continue;
          let mr = R[k], mg = G[k], mb = B[k], ms = S[k];
          for (let d = 0; d < 4; d++) {
            const kk = d === 0 ? k - 1 : d === 1 ? k + 1 : d === 2 ? k - w : k + w;
            if (this.occl[kk]) continue;
            if (R[kk] * att > mr) mr = R[kk] * att;
            if (G[kk] * att > mg) mg = G[kk] * att;
            if (B[kk] * att > mb) mb = B[kk] * att;
            if (S[kk] * 0.72 > ms) ms = S[kk] * 0.72;
          }
          tmpR[k] = mr; tmpG[k] = mg; tmpB[k] = mb; tmpS[k] = ms;
        }
      }
      R.set(tmpR); G.set(tmpG); B.set(tmpB); S.set(tmpS);
    }

    // two box blurs to soften banding
    const blur = (arr) => {
      const o = new Float32Array(n);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        let s = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          s += arr[jj * w + ii]; c++;
        }
        o[j * w + i] = s / c;
      }
      return o;
    };
    let rr = blur(blur(R)), gg = blur(blur(G)), bb = blur(blur(B)), ss = blur(blur(S));

    const data = new Float32Array(n * 4);
    // outdoors the grid mostly repeats the hemisphere ambient, so keep its
    // contribution small; indoors it is the only light reaching most corners
    const bounceBoost = this.biome.indoor ? 1.0 : 0.3;
    for (let k = 0; k < n; k++) {
      data[k * 4] = rr[k] * bounceBoost;
      data[k * 4 + 1] = gg[k] * bounceBoost;
      data[k * 4 + 2] = bb[k] * bounceBoost;
      data[k * 4 + 3] = clamp(ss[k], 0, 1);
    }
    this.giData = data;
  }

  applyGI(R) {
    R.setGI(this.giData, this.w, this.h, -this.w / 2, -this.h / 2, this.w, this.h);
  }
}

/* ==========================================================================
   Generation helpers
   ========================================================================== */
const _M = m4.create();

function pushBox(R, x, y, z, sx, sy, sz, ry, m) {
  m4.composeY(_M, x, y, z, ry || 0, sx, sy, sz);
  R.pushStatic('box', _M, m);
}
function pushMesh(R, id, x, y, z, sx, sy, sz, ry, m, transparent) {
  m4.composeY(_M, x, y, z, ry || 0, sx, sy, sz);
  R.pushStatic(id, _M, m, transparent);
}
function pushTilt(R, id, x, y, z, sx, sy, sz, rx, ry, rz, m) {
  m4.compose(_M, x, y, z, rx, ry, rz, sx, sy, sz);
  R.pushStatic(id, _M, m);
}

function shade(hex, f, rng) {
  const c = hexLin(hex);
  const j = rng ? (rng.range(-.07, .07)) : 0;
  return [clamp(c[0] * f + j, 0, 4), clamp(c[1] * f + j, 0, 4), clamp(c[2] * f + j, 0, 4)];
}

/** fill a rectangle of cells */
function fillRect(wld, i0, j0, i1, j1, fn) {
  for (let j = Math.max(0, j0); j <= Math.min(wld.h - 1, j1); j++)
    for (let i = Math.max(0, i0); i <= Math.min(wld.w - 1, i1); i++)
      fn(wld.idx(i, j), i, j);
}

function setSolid(wld, i, j, occl) {
  if (!wld.inB(i, j)) return;
  const k = wld.idx(i, j);
  wld.solid[k] = 1;
  wld.occl[k] = occl === false ? 0 : 1;
}

/* --------------------------- shared decoration ------------------------- */
function addTorch(wld, R, x, z, y, col, scale) {
  const B = wld.biome;
  const c = col || TORCH_COL;
  const s = scale || 1;
  pushBox(R, x, y - .35 * s, z, .12 * s, .7 * s, .12 * s, 0, mat(shade(0x33291c, 1, wld.rng), .9));
  pushMesh(R, 'sphere', x, y + .1 * s, z, .3 * s, .38 * s, .3 * s, 0,
    mat([c[0] * .3, c[1] * .2, c[2] * .1], .5, [c[0] * 3.4, c[1] * 2.0, c[2] * .9], 0, 3));
  wld.lights.push({ x, y: y + .2 * s, z, r: c[0], g: c[1], b: c[2], i: 2.4 * s, rad: 11 * s, flicker: 1 });
}

function addLamp(wld, R, x, z) {
  const rng = wld.rng;
  pushBox(R, x, 2.4, z, .16, 4.8, .16, 0, mat(shade(0x2a2c30, 1, rng), .6, null, .5));
  pushBox(R, x, 4.72, z, .9, .16, .3, 0, mat(shade(0x2a2c30, 1, rng), .6, null, .5));
  pushMesh(R, 'sphere', x + .35, 4.5, z, .42, .3, .42, 0,
    mat([.9, .85, .6], .2, [3.2, 2.6, 1.5], 0, 3));
  wld.lights.push({ x: x + .35, y: 4.4, z, r: 1, g: .88, b: .62, i: 3.0, rad: 15, flicker: .12 });
}

function addRubble(wld, R, x, z, n, col) {
  const rng = wld.rng;
  for (let i = 0; i < n; i++) {
    const rx = x + rng.range(-1.1, 1.1), rz = z + rng.range(-1.1, 1.1);
    const s = rng.range(.22, .6);
    pushTilt(R, 'prism', rx, s * .35, rz, s * 1.6, s, s * 1.6,
      rng.range(-.2, .2), rng.range(0, TAU), rng.range(-.2, .2),
      mat(shade(col, rng.range(.7, 1.1), rng), .95));
  }
}

function addTree(wld, R, x, z, scale, biome) {
  const rng = wld.rng;
  // kept deliberately short: a top-down camera looks past a 4-5 unit canopy,
  // but a tall one would hide the player and everything fighting them
  const s = scale || rng.range(.8, 1.15);
  const trunkH = 2.3 * s;
  pushMesh(R, 'cyl', x, trunkH / 2, z, .4 * s, trunkH, .4 * s, 0,
    mat(shade(biome.propWood, rng.range(.7, 1.0), rng), .95));
  const fol = biome.foliage;
  const layers = 3;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = trunkH * .8 + t * 1.7 * s;
    const r = (1.9 - t * 1.15) * s;
    pushMesh(R, 'cone', x + rng.range(-.15, .15), y, z + rng.range(-.15, .15), r * 2, 1.5 * s, r * 2, rng.range(0, TAU),
      mat(shade(fol, rng.range(.7, 1.15), rng), .96, null, 0, 2, .6));
  }
  // trunk blocks movement
  const [i, j] = wld.cellOf(x, z);
  setSolid(wld, i, j, false);
}

function addDeadTree(wld, R, x, z, scale, biome) {
  const rng = wld.rng;
  const s = scale || rng.range(.85, 1.2);
  const h = 3.3 * s;
  pushMesh(R, 'cyl', x, h / 2, z, .38 * s, h, .38 * s, 0,
    mat(shade(biome.propWood, rng.range(.5, .85), rng), .97));
  for (let i = 0; i < 4; i++) {
    const a = rng.range(0, TAU), len = rng.range(1.2, 2.4) * s;
    const y = h * rng.range(.5, .95);
    pushTilt(R, 'cyl', x + Math.cos(a) * len * .4, y, z + Math.sin(a) * len * .4,
      .16 * s, len, .16 * s, rng.range(.7, 1.3), a, 0,
      mat(shade(biome.propWood, rng.range(.4, .7), rng), .97));
  }
  const [ci, cj] = wld.cellOf(x, z);
  setSolid(wld, ci, cj, false);
}

function addCar(wld, R, x, z, ry, biome) {
  const rng = wld.rng;
  const cols = [0x7a2c28, 0x2c3a52, 0x4a4a48, 0x5a5230, 0x30402c, 0x6a6a70];
  const body = shade(rng.pick(cols), rng.range(.6, 1.0), rng);
  const c = Math.cos(ry), s = Math.sin(ry);
  pushBox(R, x, .62, z, 2.0, .78, 4.4, ry, mat(body, .55, null, .45));
  pushBox(R, x - s * .3, 1.32, z - c * .3, 1.72, .78, 2.0, ry, mat(shade(0x14181c, 1, rng), .28, null, .3));
  pushBox(R, x, .28, z, 2.12, .32, 4.2, ry, mat(shade(0x1c1c1e, 1, rng), .9));
  for (const [ox, oz] of [[-1, 1.4], [1, 1.4], [-1, -1.4], [1, -1.4]]) {
    pushMesh(R, 'cyl', x + (ox * c - oz * s), .34, z + (ox * s + oz * c), .68, .4, .68, ry + Math.PI / 2,
      mat(shade(0x141416, 1, rng), .95));
  }
  // occupy cells
  for (let dj = -2; dj <= 2; dj++) for (let di = -1; di <= 1; di++) {
    const wx = x + (di * c - dj * s), wz = z + (di * s + dj * c);
    const [ci, cj] = wld.cellOf(wx, wz);
    setSolid(wld, ci, cj, false);
  }
}

function addContainer(wld, type, x, z, ry) {
  wld.containers.push({ type, x, z, ry: ry || 0, opened: false, id: wld.containers.length });
}

/* ==========================================================================
   Ground rendering — 4-unit tiles, colour from terrain type
   ========================================================================== */
function buildGround(wld, R) {
  const B = wld.biome, rng = wld.rng, N = wld.noise;
  const T = 4;
  const groundM = mat([0, 0, 0], B.groundRough || .92);
  for (let tj = 0; tj < wld.h; tj += T) {
    for (let ti = 0; ti < wld.w; ti += T) {
      // dominant terrain in this tile
      let road = 0, inter = 0, water = 0, tot = 0, spec = 0;
      for (let j = tj; j < Math.min(tj + T, wld.h); j++) for (let i = ti; i < Math.min(ti + T, wld.w); i++) {
        const k = wld.idx(i, j); tot++;
        if (wld.floorT[k] === 1) road++;
        else if (wld.floorT[k] === 2) inter++;
        else if (wld.floorT[k] === 3) spec++;
        if (wld.water[k]) water++;
      }
      const [wx, wz] = wld.worldOf(ti + T / 2 - .5, tj + T / 2 - .5);
      let base;
      if (road / tot > .45) base = B.road;
      else if (inter / tot > .45) base = B.wall2;
      else if (spec / tot > .45) base = B.floorSpecial != null ? B.floorSpecial : B.road;
      else base = B.ground;
      // no per-tile jitter: the fragment shader adds continuous grain, and
      // random per-tile tint reads as an obvious checkerboard
      const nz = N.fbm(wx * .035, wz * .035, 3) * .5 + .5;
      const f = .88 + nz * .22;
      groundM.c = shade(base, f, null);
      groundM.rough = clamp((B.groundRough || .92) * (0.94 + nz * .12), .1, 1);
      const isWater = water / tot > .5;
      const y = isWater ? -.5 : 0;
      pushMesh(R, 'quad', wx, y, wz, T + .04, 1, T + .04, 0, groundM);
    }
  }
  // water surface
  if (B.water) {
    const wm = mat(hexLin(B.water.color), .06, hexLin(B.water.emissive || 0), .2, 1, 0, 1, .78);
    for (let tj = 0; tj < wld.h; tj += T) for (let ti = 0; ti < wld.w; ti += T) {
      let water = 0, tot = 0;
      for (let j = tj; j < Math.min(tj + T, wld.h); j++) for (let i = ti; i < Math.min(ti + T, wld.w); i++) {
        tot++; if (wld.water[wld.idx(i, j)]) water++;
      }
      if (water / tot < .35) continue;
      const [wx, wz] = wld.worldOf(ti + T / 2 - .5, tj + T / 2 - .5);
      pushMesh(R, 'plane', wx, B.water.level + .18, wz, T + .04, 1, T + .04, 0, wm, true);
    }
  }
}

/** render every solid cell that is a wall as a box; merges runs horizontally */
function buildWalls(wld, R, height, colA, colB) {
  const rng = wld.rng;
  const done = new Uint8Array(wld.w * wld.h);
  const m = mat([0, 0, 0], .88);
  for (let j = 0; j < wld.h; j++) {
    for (let i = 0; i < wld.w; i++) {
      const k = wld.idx(i, j);
      if (!wld.solid[k] || done[k] || wld.noWall && wld.noWall[k]) continue;
      let len = 1;
      while (i + len < wld.w && wld.solid[wld.idx(i + len, j)] && !done[wld.idx(i + len, j)]
        && !(wld.noWall && wld.noWall[wld.idx(i + len, j)]) && len < 12) len++;
      for (let d = 0; d < len; d++) done[wld.idx(i + d, j)] = 1;
      const [x0] = wld.worldOf(i, j);
      const [, z0] = wld.worldOf(i, j);
      const cx = x0 + (len - 1) / 2, cz = z0;
      const hh = height * rng.range(.94, 1.06);
      m.c = shade(rng.chance(.5) ? colA : colB, rng.range(.8, 1.15), rng);
      m.rough = rng.range(.78, .98);
      pushBox(R, cx, hh / 2, cz, len, hh, 1.0, 0, m);
      i += len - 1;
    }
  }
}

/* ==========================================================================
   GENERATORS
   ========================================================================== */

/* --------------------------- 1. STREET --------------------------------- */
function genStreet(wld, R) {
  const rng = wld.rng, B = wld.biome, W = wld.w, H = wld.h;
  for (let k = 0; k < W * H; k++) wld.floorT[k] = 0;

  // road grid
  const roadEvery = 22, roadW = 7;
  const roadsI = [], roadsJ = [];
  for (let i = 10; i < W - 8; i += roadEvery) roadsI.push(i);
  for (let j = 10; j < H - 8; j += roadEvery) roadsJ.push(j);
  const onRoad = (i, j) => {
    for (const r of roadsI) if (Math.abs(i - r) < roadW / 2) return true;
    for (const r of roadsJ) if (Math.abs(j - r) < roadW / 2) return true;
    return false;
  };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (onRoad(i, j)) wld.floorT[wld.idx(i, j)] = 1;
  }
  // border wall
  for (let i = 0; i < W; i++) { setSolid(wld, i, 0); setSolid(wld, i, 1); setSolid(wld, i, H - 1); setSolid(wld, i, H - 2); }
  for (let j = 0; j < H; j++) { setSolid(wld, 0, j); setSolid(wld, 1, j); setSolid(wld, W - 1, j); setSolid(wld, W - 2, j); }

  // buildings on the blocks between roads
  const buildings = [];
  for (let bj = 0; bj < roadsJ.length + 1; bj++) {
    for (let bi = 0; bi < roadsI.length + 1; bi++) {
      const i0 = (bi === 0 ? 3 : roadsI[bi - 1] + roadW / 2 + 1);
      const i1 = (bi === roadsI.length ? W - 4 : roadsI[bi] - roadW / 2 - 1);
      const j0 = (bj === 0 ? 3 : roadsJ[bj - 1] + roadW / 2 + 1);
      const j1 = (bj === roadsJ.length ? H - 4 : roadsJ[bj] - roadW / 2 - 1);
      if (i1 - i0 < 8 || j1 - j0 < 8) continue;
      // subdivide the block into 1-2 buildings with yards
      const nb = rng.int(1, 2);
      for (let b = 0; b < nb; b++) {
        const pad = rng.int(0, 2);
        let x0 = i0 + pad, x1 = i1 - pad, z0 = j0 + pad, z1 = j1 - pad;
        if (nb === 2) { if (b === 0) x1 = Math.floor((x0 + x1) / 2) - 1; else x0 = Math.floor((x0 + x1) / 2) + 1; }
        if (x1 - x0 < 6 || z1 - z0 < 6) continue;
        if (rng.chance(.12)) continue;                 // empty lot
        buildings.push({ x0, x1, z0, z1 });
      }
    }
  }

  const wallM = mat([0, 0, 0], .9);
  for (const b of buildings) {
    const ruined = rng.chance(.4);
    // walls with door gaps
    const doors = [];
    const sides = ['n', 's', 'e', 'w'];
    rng.shuffle(sides);
    const doorSides = sides.slice(0, rng.int(1, 2));
    for (let i = b.x0; i <= b.x1; i++) {
      for (const [j, side] of [[b.z0, 'n'], [b.z1, 's']]) {
        const mid = (b.x0 + b.x1) / 2;
        if (doorSides.includes(side) && Math.abs(i - mid) < 1.5) { doors.push([i, j]); continue; }
        if (ruined && rng.chance(.1)) continue;
        setSolid(wld, i, j);
      }
    }
    for (let j = b.z0; j <= b.z1; j++) {
      for (const [i, side] of [[b.x0, 'w'], [b.x1, 'e']]) {
        const mid = (b.z0 + b.z1) / 2;
        if (doorSides.includes(side) && Math.abs(j - mid) < 1.5) { doors.push([i, j]); continue; }
        if (ruined && rng.chance(.1)) continue;
        setSolid(wld, i, j);
      }
    }
    // interior floor + roof mask
    fillRect(wld, b.x0 + 1, b.z0 + 1, b.x1 - 1, b.z1 - 1, (k) => {
      wld.floorT[k] = 2;
      wld.roof[k] = ruined ? (rng.chance(.55) ? 1 : 0) : 1;
    });
    // internal partitions
    if (b.x1 - b.x0 > 10 && b.z1 - b.z0 > 8 && rng.chance(.7)) {
      const px = rng.int(b.x0 + 4, b.x1 - 4);
      const gap = rng.int(b.z0 + 2, b.z1 - 2);
      for (let j = b.z0 + 1; j <= b.z1 - 1; j++) if (Math.abs(j - gap) > 1) setSolid(wld, px, j);
    }
    // contents
    const area = (b.x1 - b.x0) * (b.z1 - b.z0);
    const nCont = clamp(Math.round(area / 34), 1, 5);
    for (let c = 0; c < nCont; c++) {
      const i = rng.int(b.x0 + 1, b.x1 - 1), j = rng.int(b.z0 + 1, b.z1 - 1);
      if (wld.solid[wld.idx(i, j)]) continue;
      const [x, z] = wld.worldOf(i, j);
      addContainer(wld, rng.weighted([
        { v: 'crate', w: 5 }, { v: 'locker', w: 3 }, { v: 'medbox', w: 2 }, { v: 'cache', w: 1 },
      ]).v, x, z, rng.range(0, TAU));
    }
    // furniture
    for (let c = 0; c < rng.int(2, 6); c++) {
      const i = rng.int(b.x0 + 1, b.x1 - 1), j = rng.int(b.z0 + 1, b.z1 - 1);
      if (wld.solid[wld.idx(i, j)]) continue;
      const [x, z] = wld.worldOf(i, j);
      const kind = rng.next();
      if (kind < .4) {
        pushBox(R, x, .38, z, rng.range(1.0, 1.8), .76, rng.range(.7, 1.2), rng.range(0, TAU),
          mat(shade(B.propWood, rng.range(.7, 1.1), rng), .85));
        setSolid(wld, i, j, false);
      } else if (kind < .7) {
        pushBox(R, x, .55, z, .8, 1.1, .8, rng.range(0, TAU), mat(shade(B.propWood, .8, rng), .9));
        setSolid(wld, i, j, false);
      } else {
        addRubble(wld, R, x, z, rng.int(3, 6), B.wall2);
      }
    }
    if (ruined) {
      for (let c = 0; c < rng.int(2, 5); c++) {
        const i = rng.int(b.x0, b.x1), j = rng.int(b.z0, b.z1);
        const [x, z] = wld.worldOf(i, j);
        addRubble(wld, R, x, z, rng.int(2, 5), B.wall);
      }
    }
    // interior light for night streets
    if (B.torches || B.lamps) {
      if (rng.chance(.45)) {
        const i = rng.int(b.x0 + 1, b.x1 - 1), j = rng.int(b.z0 + 1, b.z1 - 1);
        if (!wld.solid[wld.idx(i, j)]) {
          const [x, z] = wld.worldOf(i, j);
          wld.lights.push({ x, y: 2.6, z, r: 1, g: .72, b: .38, i: 1.8, rad: 9, flicker: .5 });
          pushMesh(R, 'sphere', x, 2.8, z, .3, .3, .3, 0, mat([.4, .3, .2], .4, [2.6, 1.7, .8], 0, 3));
        }
      }
    }
  }

  // street props: cars, lamps, barricades, bins
  for (const rI of roadsI) {
    for (let j = 6; j < H - 6; j += rng.int(9, 18)) {
      const [x, z] = wld.worldOf(rI + rng.int(-1, 1), j);
      if (rng.chance(.55)) addCar(wld, R, x, z, rng.chance(.5) ? 0 : Math.PI, B);
      if (B.lamps && rng.chance(.5)) {
        const [lx, lz] = wld.worldOf(rI + (rng.chance(.5) ? -4 : 4), j + 3);
        addLamp(wld, R, lx, lz);
      }
    }
  }
  for (const rJ of roadsJ) {
    for (let i = 6; i < W - 6; i += rng.int(9, 18)) {
      const [x, z] = wld.worldOf(i, rJ + rng.int(-1, 1));
      if (rng.chance(.5)) addCar(wld, R, x, z, Math.PI / 2 + (rng.chance(.5) ? 0 : Math.PI), B);
      if (B.lamps && rng.chance(.45)) {
        const [lx, lz] = wld.worldOf(i + 3, rJ + (rng.chance(.5) ? -4 : 4));
        addLamp(wld, R, lx, lz);
      }
    }
  }
  // scattered outdoor loot & debris
  for (let n = 0; n < 26; n++) {
    const c = wld.randomOpenCell();
    if (wld.floorT[wld.idx(c.i, c.j)] === 2) continue;
    if (rng.chance(.4)) addContainer(wld, rng.pick(['crate', 'medbox']), c.x, c.z, rng.range(0, TAU));
    else addRubble(wld, R, c.x, c.z, rng.int(2, 5), B.wall2);
  }
  for (let n = 0; n < 18; n++) {
    const c = wld.randomOpenCell();
    if (wld.floorT[wld.idx(c.i, c.j)] === 1) continue;
    addTree(wld, R, c.x, c.z, rng.range(.7, 1.2), B);
  }
  buildWalls(wld, R, WALL_H, B.wall, B.wall2);
}

/* --------------------- 2. ROOMS (dungeon/crypt/lab/vault/cathedral) ----- */
function genRooms(wld, R, opts) {
  const rng = wld.rng, B = wld.biome, W = wld.w, H = wld.h;
  opts = opts || {};
  const minRoom = opts.minRoom || 8, maxRoom = opts.maxRoom || 18;
  // everything solid, carve rooms out
  wld.solid.fill(1); wld.occl.fill(1); wld.roof.fill(1);
  for (let k = 0; k < W * H; k++) wld.floorT[k] = 2;

  const rooms = [];
  const tries = opts.tries || 90;
  for (let t = 0; t < tries; t++) {
    const rw = rng.int(minRoom, maxRoom), rh = rng.int(minRoom, maxRoom);
    const i0 = rng.int(3, W - rw - 4), j0 = rng.int(3, H - rh - 4);
    const r = { i0, j0, i1: i0 + rw, j1: j0 + rh, cx: i0 + rw / 2, cy: j0 + rh / 2 };
    let ok = true;
    for (const o of rooms) {
      if (r.i0 < o.i1 + 3 && r.i1 + 3 > o.i0 && r.j0 < o.j1 + 3 && r.j1 + 3 > o.j0) { ok = false; break; }
    }
    if (!ok) continue;
    rooms.push(r);
    if (rooms.length >= (opts.maxRooms || 16)) break;
  }
  if (!rooms.length) rooms.push({ i0: 6, j0: 6, i1: W - 7, j1: H - 7, cx: W / 2, cy: H / 2 });

  const carve = (i0, j0, i1, j1) => fillRect(wld, i0, j0, i1, j1, (k) => { wld.solid[k] = 0; wld.occl[k] = 0; });
  for (const r of rooms) carve(r.i0, r.j0, r.i1, r.j1);

  // corridors: connect each room to the next (sorted by x) + a few extra loops
  rooms.sort((a, b) => a.cx - b.cx);
  const corrW = opts.corrW || 3;
  const connect = (a, b) => {
    const ax = Math.round(a.cx), ay = Math.round(a.cy), bx = Math.round(b.cx), by = Math.round(b.cy);
    const half = Math.floor(corrW / 2);
    if (rng.chance(.5)) {
      carve(Math.min(ax, bx), ay - half, Math.max(ax, bx), ay + half);
      carve(bx - half, Math.min(ay, by), bx + half, Math.max(ay, by));
    } else {
      carve(ax - half, Math.min(ay, by), ax + half, Math.max(ay, by));
      carve(Math.min(ax, bx), by - half, Math.max(ax, bx), by + half);
    }
  };
  for (let i = 1; i < rooms.length; i++) connect(rooms[i - 1], rooms[i]);
  for (let n = 0; n < Math.floor(rooms.length / 3); n++) {
    connect(rng.pick(rooms), rng.pick(rooms));
  }
  // seal the border
  for (let i = 0; i < W; i++) { setSolid(wld, i, 0); setSolid(wld, i, 1); setSolid(wld, i, H - 1); setSolid(wld, i, H - 2); }
  for (let j = 0; j < H; j++) { setSolid(wld, 0, j); setSolid(wld, 1, j); setSolid(wld, W - 1, j); setSolid(wld, W - 2, j); }

  // pick the biggest room as boss arena / last room
  rooms.sort((a, b) => (b.i1 - b.i0) * (b.j1 - b.j0) - (a.i1 - a.i0) * (a.j1 - a.j0));
  const arena = rooms[0];
  const [ax, az] = wld.worldOf(arena.cx, arena.cy);
  wld.bossArena = { x: ax, z: az, r: Math.min(arena.i1 - arena.i0, arena.j1 - arena.j0) / 2 - 1 };
  wld.rooms = rooms;

  // decorate rooms
  for (let ri = 0; ri < rooms.length; ri++) {
    const r = rooms[ri];
    const isArena = r === arena;
    const [cx, cz] = wld.worldOf(r.cx, r.cy);
    const rw = r.i1 - r.i0, rh = r.j1 - r.j0;

    // pillars
    if (opts.pillars && rw > 10 && rh > 10) {
      const step = opts.pillarStep || 5;
      for (let j = r.j0 + 2; j <= r.j1 - 2; j += step) {
        for (let i = r.i0 + 2; i <= r.i1 - 2; i += step) {
          if (i > r.i0 + 2 && i < r.i1 - 2 && j > r.j0 + 2 && j < r.j1 - 2 && !isArena) continue;
          if (rng.chance(.45)) continue;
          const [x, z] = wld.worldOf(i, j);
          pushMesh(R, opts.roundPillar ? 'cyl' : 'box', x, WALL_H / 2, z, 1.0, WALL_H, 1.0, 0,
            mat(shade(B.wall, rng.range(.85, 1.05), rng), .82));
          setSolid(wld, i, j);
        }
      }
    }
    // torches on room walls
    if (B.torches) {
      const spots = [
        [r.i0 + 1, r.j0 + 1], [r.i1 - 1, r.j0 + 1], [r.i0 + 1, r.j1 - 1], [r.i1 - 1, r.j1 - 1],
        [Math.round(r.cx), r.j0 + 1], [Math.round(r.cx), r.j1 - 1],
      ];
      for (const [i, j] of spots) {
        if (!wld.inB(i, j) || wld.solid[wld.idx(i, j)]) continue;
        if (rng.chance(.42)) continue;
        const [x, z] = wld.worldOf(i, j);
        addTorch(wld, R, x, z, 2.5, opts.torchColor || TORCH_COL, opts.torchScale || 1);
      }
    }
    // glowing panels for the lab
    if (opts.panels) {
      for (let n = 0; n < 3; n++) {
        const i = rng.int(r.i0 + 1, r.i1 - 1), j = rng.chance(.5) ? r.j0 : r.j1;
        if (!wld.inB(i, j)) continue;
        const [x, z] = wld.worldOf(i, j);
        const col = hexLin(B.accent);
        pushBox(R, x, 2.3, z, 1.6, .5, .12, 0, mat([.1, .12, .14], .2, [col[0] * 3, col[1] * 3, col[2] * 3.4], 0, 3));
        wld.lights.push({ x, y: 2.3, z, r: col[0], g: col[1], b: col[2], i: 2.2, rad: 12, flicker: .06 });
      }
      // ceiling strips
      for (let n = 0; n < 2; n++) {
        const [x, z] = wld.worldOf(rng.int(r.i0 + 2, r.i1 - 2), rng.int(r.j0 + 2, r.j1 - 2));
        wld.lights.push({ x, y: 3.1, z, r: .8, g: .95, b: 1, i: 2.6, rad: 14, flicker: .04 });
      }
    }

    // props
    const propCount = Math.round(rw * rh / (opts.propDensity || 26));
    for (let n = 0; n < propCount; n++) {
      const i = rng.int(r.i0 + 1, r.i1 - 1), j = rng.int(r.j0 + 1, r.j1 - 1);
      if (wld.solid[wld.idx(i, j)]) continue;
      const [x, z] = wld.worldOf(i, j);
      (opts.prop || defaultProp)(wld, R, x, z, i, j, isArena);
    }

    // containers
    const nc = clamp(Math.round(rw * rh / 60), 1, 4) + (isArena ? 2 : 0);
    for (let n = 0; n < nc; n++) {
      const i = rng.int(r.i0 + 1, r.i1 - 1), j = rng.int(r.j0 + 1, r.j1 - 1);
      if (wld.solid[wld.idx(i, j)]) continue;
      const [x, z] = wld.worldOf(i, j);
      addContainer(wld, rng.weighted(opts.containers || [
        { v: 'crate', w: 4 }, { v: 'locker', w: 3 }, { v: 'medbox', w: 2 }, { v: 'cache', w: 2 }, { v: 'reliquary', w: 1 },
      ]).v, x, z, rng.range(0, TAU));
    }
  }

  buildWalls(wld, R, opts.wallH || WALL_H, B.wall, B.wall2);
  return rooms;
}

function defaultProp(wld, R, x, z, i, j) {
  const rng = wld.rng, B = wld.biome;
  const t = rng.next();
  if (t < .35) addRubble(wld, R, x, z, rng.int(2, 5), B.wall2);
  else if (t < .6) {
    pushBox(R, x, .4, z, rng.range(.8, 1.6), .8, rng.range(.8, 1.4), rng.range(0, TAU),
      mat(shade(B.propWood, rng.range(.7, 1.05), rng), .88));
    setSolid(wld, i, j, false);
  } else if (t < .78) {
    pushMesh(R, 'cyl', x, .5, z, .7, 1.0, .7, 0, mat(shade(B.propWood, .8, rng), .9));
    setSolid(wld, i, j, false);
  } else {
    pushMesh(R, 'prism', x, .3, z, rng.range(.8, 1.6), .6, rng.range(.8, 1.6), rng.range(0, TAU),
      mat(shade(B.wall2, rng.range(.7, 1.1), rng), .95));
  }
}

function cryptProp(wld, R, x, z, i, j) {
  const rng = wld.rng, B = wld.biome;
  const t = rng.next();
  if (t < .45) {
    // sarcophagus
    pushBox(R, x, .45, z, 1.1, .9, 2.3, rng.chance(.5) ? 0 : Math.PI / 2,
      mat(shade(B.wall, rng.range(.9, 1.1), rng), .78));
    pushBox(R, x, .95, z, 1.2, .16, 2.4, rng.chance(.5) ? 0 : Math.PI / 2,
      mat(shade(B.wall2, 1.05, rng), .7));
    setSolid(wld, i, j, false);
  } else if (t < .68) {
    // bone pile
    for (let n = 0; n < rng.int(5, 10); n++) {
      pushTilt(R, 'cyl', x + rng.range(-.8, .8), rng.range(.06, .3), z + rng.range(-.8, .8),
        .1, rng.range(.4, .9), .1, rng.range(0, 1.2), rng.range(0, TAU), rng.range(0, 1.2),
        mat(shade(0xd8d2c0, rng.range(.65, .95), rng), .8));
    }
  } else if (t < .85) {
    pushMesh(R, 'cyl', x, .9, z, .5, 1.8, .5, 0, mat(shade(B.wall, .95, rng), .8));
    pushMesh(R, 'sphere', x, 1.95, z, .45, .45, .45, 0, mat(shade(0xd8d2c0, .9, rng), .75));
    setSolid(wld, i, j, false);
  } else addRubble(wld, R, x, z, rng.int(3, 6), B.wall2);
}

function labProp(wld, R, x, z, i, j) {
  const rng = wld.rng, B = wld.biome;
  const t = rng.next();
  const acc = hexLin(B.accent);
  if (t < .3) {
    // console
    pushBox(R, x, .5, z, 1.5, 1.0, .8, rng.chance(.5) ? 0 : Math.PI / 2, mat(shade(0x7a828a, 1, rng), .35, null, .6));
    pushBox(R, x, 1.06, z, 1.2, .1, .6, 0, mat([.05, .08, .1], .2, [acc[0] * 2.4, acc[1] * 2.4, acc[2] * 2.8], 0, 3));
    wld.lights.push({ x, y: 1.4, z, r: acc[0], g: acc[1], b: acc[2], i: 1.1, rad: 7, flicker: .1 });
    setSolid(wld, i, j, false);
  } else if (t < .58) {
    // containment pod
    pushMesh(R, 'cyl', x, 1.3, z, 1.2, 2.6, 1.2, 0,
      mat([.35, .55, .62], .08, [acc[0] * .6, acc[1] * .8, acc[2] * 1.0], .2, 3, 0, 1, .45), true);
    pushMesh(R, 'cyl', x, .16, z, 1.5, .32, 1.5, 0, mat(shade(0x60686e, 1, rng), .4, null, .7));
    wld.lights.push({ x, y: 1.6, z, r: acc[0] * .7, g: acc[1], b: acc[2], i: 1.6, rad: 8, flicker: .18 });
    setSolid(wld, i, j, false);
  } else if (t < .8) {
    pushBox(R, x, .45, z, 2.0, .9, .9, rng.chance(.5) ? 0 : Math.PI / 2, mat(shade(0x9aa2aa, 1, rng), .3, null, .55));
    setSolid(wld, i, j, false);
  } else addRubble(wld, R, x, z, rng.int(2, 4), B.wall2);
}

function iceProp(wld, R, x, z, i, j) {
  const rng = wld.rng, B = wld.biome;
  const t = rng.next();
  const acc = hexLin(B.accent);
  if (t < .5) {
    const n = rng.int(2, 5);
    for (let k = 0; k < n; k++) {
      const s = rng.range(.5, 1.5);
      pushTilt(R, 'octa', x + rng.range(-.9, .9), s * .9, z + rng.range(-.9, .9),
        s * .8, s * 2.6, s * .8, rng.range(-.25, .25), rng.range(0, TAU), rng.range(-.25, .25),
        mat([.55, .75, .88], .06, [acc[0] * .35, acc[1] * .45, acc[2] * .6], .1, 3, 0, 1, .72));
    }
    wld.lights.push({ x, y: 1.2, z, r: .4, g: .7, b: 1, i: .9, rad: 8, flicker: .05 });
    setSolid(wld, i, j, false);
  } else if (t < .75) {
    pushMesh(R, 'prism', x, .5, z, rng.range(1.2, 2.4), 1.0, rng.range(1.2, 2.4), rng.range(0, TAU),
      mat([.6, .75, .85], .15, null, .1));
    setSolid(wld, i, j, false);
  } else addRubble(wld, R, x, z, rng.int(2, 5), B.wall2);
}

function cathedralProp(wld, R, x, z, i, j) {
  const rng = wld.rng, B = wld.biome;
  const t = rng.next();
  if (t < .35) {
    // pew
    pushBox(R, x, .3, z, 3.2, .2, .7, rng.chance(.5) ? 0 : Math.PI / 2, mat(shade(B.propWood, .9, rng), .85));
    pushBox(R, x, .62, z, 3.2, .8, .18, rng.chance(.5) ? 0 : Math.PI / 2, mat(shade(B.propWood, .8, rng), .85));
    setSolid(wld, i, j, false);
  } else if (t < .6) {
    // brazier
    pushMesh(R, 'cyl', x, .55, z, .7, 1.1, .7, 0, mat(shade(0x3a3028, 1, rng), .6, null, .5));
    pushMesh(R, 'sphere', x, 1.25, z, .6, .5, .6, 0, mat([.5, .2, .05], .5, [3.4, 1.5, .35], 0, 3));
    wld.lights.push({ x, y: 1.5, z, r: 1, g: .5, b: .16, i: 3.2, rad: 14, flicker: 1 });
    setSolid(wld, i, j, false);
  } else if (t < .8) {
    // statue
    pushMesh(R, 'cyl', x, .4, z, 1.0, .8, 1.0, 0, mat(shade(B.wall, 1.05, rng), .8));
    pushBox(R, x, 1.5, z, .6, 1.6, .5, rng.range(0, TAU), mat(shade(B.wall, .95, rng), .82));
    pushMesh(R, 'sphere', x, 2.5, z, .45, .5, .45, 0, mat(shade(B.wall, 1.0, rng), .8));
    setSolid(wld, i, j, false);
  } else addRubble(wld, R, x, z, rng.int(3, 6), B.wall2);
}

/* -------------------- 3. ORGANIC (forest / swamp / waste) -------------- */
function genOrganic(wld, R, opts) {
  const rng = wld.rng, B = wld.biome, W = wld.w, H = wld.h, N = wld.noise;
  opts = opts || {};
  for (let k = 0; k < W * H; k++) { wld.floorT[k] = 0; wld.roof[k] = 0; }

  // rocky/impassable regions from noise
  const thresh = opts.blockThresh == null ? .42 : opts.blockThresh;
  for (let j = 2; j < H - 2; j++) for (let i = 2; i < W - 2; i++) {
    const n = N.fbm(i * .045, j * .045, 4) * .5 + .5;
    if (n > thresh + .28) setSolid(wld, i, j);
  }
  // water pools
  if (opts.water) {
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const n = N.fbm(i * .035 + 100, j * .035 + 100, 3) * .5 + .5;
      if (n < opts.waterThresh) {
        const k = wld.idx(i, j);
        if (!wld.solid[k]) { wld.water[k] = 1; wld.floorT[k] = 3; }
      }
    }
  }
  // clearings so the level is never fully choked
  for (let n = 0; n < 14; n++) {
    const ci = rng.int(8, W - 9), cj = rng.int(8, H - 9), r = rng.int(5, 11);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (!wld.inB(i, j)) continue;
      if ((i - ci) ** 2 + (j - cj) ** 2 > r * r) continue;
      const k = wld.idx(i, j);
      wld.solid[k] = 0; wld.occl[k] = 0;
    }
  }
  // border
  for (let i = 0; i < W; i++) { setSolid(wld, i, 0); setSolid(wld, i, 1); setSolid(wld, i, H - 1); setSolid(wld, i, H - 2); }
  for (let j = 0; j < H; j++) { setSolid(wld, 0, j); setSolid(wld, 1, j); setSolid(wld, W - 1, j); setSolid(wld, W - 2, j); }

  // rock walls where solid (short cliffs, not tall walls)
  const done = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = wld.idx(i, j);
    if (!wld.solid[k] || done[k]) continue;
    done[k] = 1;
    const [x, z] = wld.worldOf(i, j);
    const border = i < 2 || j < 2 || i >= W - 2 || j >= H - 2;
    const hgt = border ? WALL_H + 2 : rng.range(1.6, 3.2);
    pushTilt(R, 'box', x, hgt / 2 - .2, z, rng.range(1.0, 1.5), hgt, rng.range(1.0, 1.5),
      rng.range(-.08, .08), rng.range(0, TAU), rng.range(-.08, .08),
      mat(shade(opts.rockCol || B.wall, rng.range(.7, 1.1), rng), .95));
  }

  // vegetation / scatter
  const treeFn = opts.tree || addTree;
  const density = opts.density == null ? .055 : opts.density;
  for (let j = 3; j < H - 3; j++) for (let i = 3; i < W - 3; i++) {
    const k = wld.idx(i, j);
    if (wld.solid[k] || wld.water[k]) continue;
    const n = N.fbm(i * .07 + 50, j * .07 + 50, 3) * .5 + .5;
    if (rng.next() > density * (0.4 + n * 1.6)) continue;
    const [x, z] = wld.worldOf(i, j);
    treeFn(wld, R, x + rng.range(-.3, .3), z + rng.range(-.3, .3), null, B);
  }
  // ground scatter
  const scatterN = opts.scatter == null ? 90 : opts.scatter;
  for (let n = 0; n < scatterN; n++) {
    const c = wld.randomOpenCell();
    const t = rng.next();
    if (t < .5) addRubble(wld, R, c.x, c.z, rng.int(2, 5), opts.rockCol || B.wall2);
    else if (t < .75 && opts.grass !== false) {
      for (let g = 0; g < rng.int(3, 7); g++) {
        pushBox(R, c.x + rng.range(-1, 1), rng.range(.2, .45), c.z + rng.range(-1, 1),
          .1, rng.range(.4, .9), .1, rng.range(0, TAU),
          mat(shade(B.foliage, rng.range(.6, 1.2), rng), .95, null, 0, 2, 1));
      }
    } else {
      // fallen log
      pushTilt(R, 'cyl', c.x, .35, c.z, .55, rng.range(2.5, 5), .55, 0, rng.range(0, TAU), Math.PI / 2,
        mat(shade(B.propWood, rng.range(.6, .9), rng), .95));
      setSolid(wld, c.i, c.j, false);
    }
  }
  // structures: ruins / wrecks / huts
  const nStruct = opts.structs == null ? 7 : opts.structs;
  for (let s = 0; s < nStruct; s++) {
    const c = wld.randomOpenCell();
    (opts.struct || ruinStruct)(wld, R, c.i, c.j);
  }
  // containers
  for (let n = 0; n < 22; n++) {
    const c = wld.randomOpenCell();
    if (wld.water[wld.idx(c.i, c.j)]) continue;
    addContainer(wld, rng.weighted([
      { v: 'crate', w: 5 }, { v: 'medbox', w: 3 }, { v: 'locker', w: 2 }, { v: 'cache', w: 2 },
    ]).v, c.x, c.z, rng.range(0, TAU));
  }
  if (B.torches) {
    for (let n = 0; n < 10; n++) {
      const c = wld.randomOpenCell();
      addTorch(wld, R, c.x, c.z, 2.2);
    }
  }
}

function ruinStruct(wld, R, ci, cj) {
  const rng = wld.rng, B = wld.biome;
  const w = rng.int(5, 10), h = rng.int(5, 9);
  for (let j = cj; j < cj + h; j++) for (let i = ci; i < ci + w; i++) {
    if (!wld.inB(i, j)) continue;
    const edge = (i === ci || i === ci + w - 1 || j === cj || j === cj + h - 1);
    if (edge && rng.chance(.72)) setSolid(wld, i, j);
    else if (!edge) { wld.floorT[wld.idx(i, j)] = 2; if (rng.chance(.5)) wld.roof[wld.idx(i, j)] = 1; }
  }
  for (let n = 0; n < rng.int(1, 3); n++) {
    const [x, z] = wld.worldOf(ci + rng.int(1, w - 2), cj + rng.int(1, h - 2));
    addContainer(wld, rng.pick(['crate', 'locker', 'cache']), x, z, rng.range(0, TAU));
  }
  const done = [];
  for (let j = cj; j < cj + h; j++) for (let i = ci; i < ci + w; i++) {
    if (!wld.inB(i, j) || !wld.solid[wld.idx(i, j)]) continue;
    const [x, z] = wld.worldOf(i, j);
    const hh = rng.range(1.4, WALL_H);
    pushBox(R, x, hh / 2, z, 1.0, hh, 1.0, 0, mat(shade(B.wall, rng.range(.75, 1.1), rng), .92));
  }
}

function wreckStruct(wld, R, ci, cj) {
  const rng = wld.rng, B = wld.biome;
  const [x, z] = wld.worldOf(ci, cj);
  const ry = rng.range(0, TAU);
  const len = rng.range(5, 11), wid = rng.range(2.6, 4);
  pushBox(R, x, 1.1, z, wid, 2.2, len, ry, mat(shade(0x6a5a48, rng.range(.6, .9), rng), .8, null, .6));
  pushBox(R, x, 2.4, z, wid * .82, .6, len * .5, ry, mat(shade(0x54463a, .8, rng), .85, null, .5));
  const c = Math.cos(ry), s = Math.sin(ry);
  for (let dj = -Math.round(len / 2); dj <= Math.round(len / 2); dj++) {
    for (let di = -1; di <= 1; di++) {
      const wx = x + (di * c - dj * s), wz = z + (di * s + dj * c);
      const [i2, j2] = wld.cellOf(wx, wz);
      setSolid(wld, i2, j2, false);
    }
  }
  for (let n = 0; n < rng.int(2, 5); n++) {
    addRubble(wld, R, x + rng.range(-4, 4), z + rng.range(-4, 4), rng.int(2, 5), B.wall2);
  }
  if (rng.chance(.7)) addContainer(wld, rng.pick(['cache', 'crate', 'locker']), x + rng.range(-3, 3), z + rng.range(-3, 3), rng.range(0, TAU));
}

function hutStruct(wld, R, ci, cj) {
  const rng = wld.rng, B = wld.biome;
  const [x, z] = wld.worldOf(ci, cj);
  // stilts + platform
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    pushMesh(R, 'cyl', x + dx, .8, z + dz, .3, 1.6, .3, 0, mat(shade(B.propWood, .7, rng), .95));
  }
  pushBox(R, x, 1.7, z, 5.4, .3, 5.4, 0, mat(shade(B.propWood, .9, rng), .92));
  // walls
  for (const [dx, dz, sx, sz] of [[0, -2.6, 5.4, .3], [0, 2.6, 5.4, .3], [-2.6, 0, .3, 5.4]]) {
    pushBox(R, x + dx, 2.7, z + dz, sx, 1.8, sz, 0, mat(shade(B.propWood, rng.range(.7, 1), rng), .93));
  }
  pushTilt(R, 'prism', x, 3.9, z, 6, 1.4, 6, 0, 0, 0, mat(shade(B.propWood, .6, rng), .95));
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    if (Math.abs(di) < 2 && Math.abs(dj) < 2) continue;
    setSolid(wld, ci + di, cj + dj, false);
  }
  addContainer(wld, rng.pick(['crate', 'medbox', 'cache']), x + rng.range(-1, 1), z + rng.range(-1, 1), rng.range(0, TAU));
  wld.lights.push({ x, y: 2.6, z, r: 1, g: .7, b: .35, i: 1.6, rad: 8, flicker: .6 });
}

/* --------------------------- 4. SEWER TUNNELS -------------------------- */
function genSewer(wld, R) {
  const rng = wld.rng, B = wld.biome, W = wld.w, H = wld.h;
  wld.solid.fill(1); wld.occl.fill(1); wld.roof.fill(1);
  for (let k = 0; k < W * H; k++) wld.floorT[k] = 2;

  const carve = (i0, j0, i1, j1) => fillRect(wld, i0, j0, i1, j1, (k) => { wld.solid[k] = 0; wld.occl[k] = 0; });
  // main trunk tunnels
  const trunkJ = [], trunkI = [];
  for (let j = 12; j < H - 10; j += rng.int(16, 24)) trunkJ.push(j);
  for (let i = 12; i < W - 10; i += rng.int(16, 24)) trunkI.push(i);
  for (const j of trunkJ) carve(4, j - 3, W - 5, j + 3);
  for (const i of trunkI) carve(i - 3, 4, i + 3, H - 5);
  // side chambers
  const rooms = [];
  for (let n = 0; n < 10; n++) {
    const rw = rng.int(8, 15), rh = rng.int(8, 15);
    const i0 = rng.int(4, W - rw - 5), j0 = rng.int(4, H - rh - 5);
    carve(i0, j0, i0 + rw, j0 + rh);
    rooms.push({ i0, j0, i1: i0 + rw, j1: j0 + rh, cx: i0 + rw / 2, cy: j0 + rh / 2 });
  }
  for (let i = 0; i < W; i++) { setSolid(wld, i, 0); setSolid(wld, i, 1); setSolid(wld, i, H - 1); setSolid(wld, i, H - 2); }
  for (let j = 0; j < H; j++) { setSolid(wld, 0, j); setSolid(wld, 1, j); setSolid(wld, W - 1, j); setSolid(wld, W - 2, j); }

  // water channels down the middle of trunks
  for (const j of trunkJ) for (let i = 3; i < W - 3; i++) {
    for (let d = -1; d <= 1; d++) {
      const k = wld.idx(i, j + d);
      if (!wld.solid[k]) { wld.water[k] = 1; wld.floorT[k] = 3; }
    }
  }
  for (const i of trunkI) for (let j = 3; j < H - 3; j++) {
    for (let d = -1; d <= 1; d++) {
      const k = wld.idx(i + d, j);
      if (!wld.solid[k]) { wld.water[k] = 1; wld.floorT[k] = 3; }
    }
  }

  rooms.sort((a, b) => (b.i1 - b.i0) * (b.j1 - b.j0) - (a.i1 - a.i0) * (a.j1 - a.j0));
  const arena = rooms[0];
  const [ax, az] = wld.worldOf(arena.cx, arena.cy);
  wld.bossArena = { x: ax, z: az, r: 8 };
  wld.rooms = rooms;

  // pipes along walls + dripping lights
  for (let n = 0; n < 90; n++) {
    const c = wld.randomOpenCell();
    const t = rng.next();
    if (t < .3) {
      pushTilt(R, 'cyl', c.x, rng.range(2.2, 3.0), c.z, .34, rng.range(3, 7), .34,
        0, rng.chance(.5) ? 0 : Math.PI / 2, Math.PI / 2,
        mat(shade(0x4a5040, rng.range(.7, 1), rng), .6, null, .5));
    } else if (t < .55) {
      addRubble(wld, R, c.x, c.z, rng.int(2, 5), B.wall2);
    } else if (t < .7) {
      pushMesh(R, 'cyl', c.x, .5, c.z, .9, 1.0, .9, 0, mat(shade(0x3a4238, 1, rng), .7, null, .4));
      setSolid(wld, c.i, c.j, false);
    }
  }
  for (let n = 0; n < 22; n++) {
    const c = wld.randomOpenCell();
    addTorch(wld, R, c.x, c.z, 2.6, [.55, 1, .45], .9);
  }
  for (let n = 0; n < 20; n++) {
    const c = wld.randomOpenCell();
    if (wld.water[wld.idx(c.i, c.j)]) continue;
    addContainer(wld, rng.weighted([{ v: 'crate', w: 4 }, { v: 'medbox', w: 3 }, { v: 'locker', w: 3 }, { v: 'cache', w: 2 }]).v,
      c.x, c.z, rng.range(0, TAU));
  }
  buildWalls(wld, R, WALL_H + .6, B.wall, B.wall2);
}

/* ----------------------------- 5. SPIRE -------------------------------- */
function genSpire(wld, R) {
  const rng = wld.rng, B = wld.biome, W = wld.w, H = wld.h;
  wld.solid.fill(1); wld.occl.fill(1);
  for (let k = 0; k < W * H; k++) { wld.floorT[k] = 2; wld.roof[k] = 0; }
  const cx = W / 2, cy = H / 2;
  // concentric platform with radial spokes
  const rMain = W / 2 - 8;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const d = Math.hypot(i - cx, j - cy);
    const k = wld.idx(i, j);
    if (d < rMain) { wld.solid[k] = 0; wld.occl[k] = 0; }
  }
  // ring walls with gates
  for (const rr of [rMain * .42, rMain * .72]) {
    for (let a = 0; a < 360; a += 2) {
      const rad = a * Math.PI / 180;
      if ((a % 90) < 16) continue;                     // gateway
      const i = Math.round(cx + Math.cos(rad) * rr), j = Math.round(cy + Math.sin(rad) * rr);
      setSolid(wld, i, j);
    }
  }
  // outer parapet
  for (let a = 0; a < 360; a += 1) {
    const rad = a * Math.PI / 180;
    for (let d = 0; d < 2; d++) {
      const i = Math.round(cx + Math.cos(rad) * (rMain + d)), j = Math.round(cy + Math.sin(rad) * (rMain + d));
      setSolid(wld, i, j);
    }
  }
  const [ax, az] = wld.worldOf(cx, cy);
  wld.bossArena = { x: ax, z: az, r: rMain * .38 };

  // pillars around the rings
  for (let a = 0; a < 360; a += 30) {
    const rad = a * Math.PI / 180;
    for (const rr of [rMain * .55, rMain * .88]) {
      const i = Math.round(cx + Math.cos(rad) * rr), j = Math.round(cy + Math.sin(rad) * rr);
      if (!wld.inB(i, j) || wld.solid[wld.idx(i, j)]) continue;
      const [x, z] = wld.worldOf(i, j);
      const hgt = rng.range(5, 8);
      pushMesh(R, 'cyl', x, hgt / 2, z, 1.4, hgt, 1.4, 0, mat(shade(B.wall, rng.range(.85, 1.05), rng), .6));
      pushMesh(R, 'octa', x, hgt + .8, z, 1.0, 1.6, 1.0, rng.range(0, TAU),
        mat([.3, .2, .5], .2, [1.2, .5, 2.4], 0, 3));
      wld.lights.push({ x, y: hgt + .8, z, r: .6, g: .3, b: 1, i: 2.2, rad: 13, flicker: .25 });
      setSolid(wld, i, j);
    }
  }
  for (let n = 0; n < 60; n++) {
    const c = wld.randomOpenCell();
    const t = rng.next();
    if (t < .5) addRubble(wld, R, c.x, c.z, rng.int(2, 5), B.wall2);
    else if (t < .7) {
      pushMesh(R, 'octa', c.x, .8, c.z, .8, 1.8, .8, rng.range(0, TAU),
        mat([.25, .2, .4], .2, [.9, .4, 2.0], 0, 3, 0, 1, .8));
      setSolid(wld, c.i, c.j, false);
    }
  }
  for (let n = 0; n < 18; n++) {
    const c = wld.randomOpenCell();
    addContainer(wld, rng.weighted([{ v: 'reliquary', w: 4 }, { v: 'cache', w: 4 }, { v: 'locker', w: 2 }, { v: 'medbox', w: 3 }]).v,
      c.x, c.z, rng.range(0, TAU));
  }
  for (let n = 0; n < 14; n++) {
    const c = wld.randomOpenCell();
    addTorch(wld, R, c.x, c.z, 2.4, [.6, .35, 1], 1.1);
  }
  buildWalls(wld, R, 5.0, B.wall, B.wall2);
}

/* ==========================================================================
   Entry point
   ========================================================================== */
function generateWorld(level, seed, R) {
  const wld = new World(level, seed);
  const B = wld.biome;
  R.beginStatic();

  switch (level.gen) {
    case 'street': genStreet(wld, R); break;
    case 'dungeon':
      genRooms(wld, R, { minRoom: 8, maxRoom: 17, maxRooms: 14, pillars: true, pillarStep: 4, propDensity: 22 });
      break;
    case 'crypt':
      genRooms(wld, R, {
        minRoom: 9, maxRoom: 18, maxRooms: 15, pillars: true, roundPillar: true, pillarStep: 5,
        prop: cryptProp, propDensity: 20, torchColor: [.6, .8, 1],
        containers: [{ v: 'reliquary', w: 4 }, { v: 'crate', w: 3 }, { v: 'locker', w: 3 }, { v: 'medbox', w: 2 }, { v: 'cache', w: 2 }],
      });
      break;
    case 'lab':
      genRooms(wld, R, {
        minRoom: 9, maxRoom: 16, maxRooms: 16, corrW: 3, panels: true, prop: labProp,
        propDensity: 18, pillars: false,
        containers: [{ v: 'locker', w: 5 }, { v: 'cache', w: 4 }, { v: 'medbox', w: 3 }, { v: 'crate', w: 2 }],
      });
      break;
    case 'cathedral':
      genRooms(wld, R, {
        minRoom: 12, maxRoom: 26, maxRooms: 9, corrW: 5, pillars: true, roundPillar: true, pillarStep: 6,
        prop: cathedralProp, propDensity: 24, wallH: 6.5, torchColor: [1, .55, .18], torchScale: 1.3,
        containers: [{ v: 'reliquary', w: 5 }, { v: 'cache', w: 3 }, { v: 'medbox', w: 3 }, { v: 'locker', w: 2 }],
      });
      break;
    case 'vault':
      genRooms(wld, R, {
        minRoom: 9, maxRoom: 18, maxRooms: 13, pillars: true, prop: iceProp, propDensity: 19,
        torchColor: [.5, .8, 1], containers: [{ v: 'cache', w: 5 }, { v: 'reliquary', w: 4 }, { v: 'locker', w: 3 }, { v: 'medbox', w: 2 }],
      });
      break;
    case 'forest':
      genOrganic(wld, R, { blockThresh: .44, density: .034, scatter: 110, structs: 8, struct: ruinStruct });
      break;
    case 'swamp':
      genOrganic(wld, R, {
        blockThresh: .5, density: .028, water: true, waterThresh: .46, scatter: 90,
        structs: 7, struct: hutStruct, tree: addDeadTree,
      });
      break;
    case 'waste':
      genOrganic(wld, R, {
        blockThresh: .52, density: .012, scatter: 120, structs: 9, struct: wreckStruct,
        tree: addDeadTree, grass: false, rockCol: BIOMES.waste.wall,
      });
      break;
    case 'sewer': genSewer(wld, R); break;
    case 'spire': genSpire(wld, R); break;
    default: genStreet(wld, R); break;
  }

  buildGround(wld, R);

  // player spawn: an open cell, preferring the map edge for outdoor levels
  let sp = null;
  for (let t = 0; t < 300; t++) {
    const c = wld.randomOpenCell();
    if (wld.water[wld.idx(c.i, c.j)]) continue;
    if (wld.bossArena && dist2(c.x, c.z, wld.bossArena.x, wld.bossArena.z) < (wld.bossArena.r + 14) ** 2) continue;
    sp = c; break;
  }
  if (!sp) sp = wld.randomOpenCell();
  wld.spawn = { x: sp.x, z: sp.z };

  // place level exits at open cells far from spawn
  const usedExit = [];
  for (const ex of level.exits) {
    let best = null, bestD = -1;
    for (let t = 0; t < 260; t++) {
      const c = wld.randomOpenCell();
      if (wld.water[wld.idx(c.i, c.j)]) continue;
      let d = dist2(c.x, c.z, wld.spawn.x, wld.spawn.z);
      for (const u of usedExit) d = Math.min(d, dist2(c.x, c.z, u.x, u.z) * 2.2);
      if (wld.bossArena) {
        const bd = dist2(c.x, c.z, wld.bossArena.x, wld.bossArena.z);
        if (bd < (wld.bossArena.r + 6) ** 2) continue;
      }
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best) best = wld.randomOpenCell();
    usedExit.push(best);
    // clear a small pad
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = best.i + di, j = best.j + dj;
      if (wld.inB(i, j)) { wld.solid[wld.idx(i, j)] = 0; wld.occl[wld.idx(i, j)] = 0; }
    }
    wld.exits.push({ ...ex, x: best.x, z: best.z, ry: wld.rng.range(0, TAU) });
  }

  // enemy spawn points
  for (let n = 0; n < 300; n++) {
    const c = wld.randomOpenCell(wld.spawn, 14);
    if (wld.water[wld.idx(c.i, c.j)]) continue;
    wld.spawnPoints.push({ x: c.x, z: c.z });
  }

  wld.bakeGI();
  const count = R.endStatic();
  wld.staticCount = count;
  wld.applyGI(R);
  return wld;
}
