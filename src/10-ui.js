/* ==========================================================================
   UI — HUD, minimap, world map screen, floating text
   ========================================================================== */

const HUDCOL = {
  bone: '#e4dcc4', dim: '#8f8a74', blood: '#d9483b', amber: '#d9a441',
  green: '#8fa763', blue: '#7fd4ff', purple: '#b060ff', panel: 'rgba(16,18,14,.72)',
};

function hexCss(h) { return '#' + (h >>> 0).toString(16).padStart(6, '0'); }

Object.assign(Game.prototype, {

  /* ------------------------ level map canvas ------------------------- */
  buildMapCanvas() {
    const wld = this.world;
    const c = document.createElement('canvas');
    c.width = wld.w; c.height = wld.h;
    const g = c.getContext('2d');
    const img = g.createImageData(wld.w, wld.h);
    const B = wld.biome;
    const colOf = (hex, f) => {
      const r = ((hex >> 16) & 255) * f, gg = ((hex >> 8) & 255) * f, b = (hex & 255) * f;
      return [r, gg, b];
    };
    for (let j = 0; j < wld.h; j++) {
      for (let i = 0; i < wld.w; i++) {
        const k = wld.idx(i, j);
        let c3;
        if (wld.solid[k]) c3 = colOf(B.wall, .30);
        else if (wld.water[k]) c3 = colOf(B.water ? B.water.color : 0x2a3a4a, .55);
        else if (wld.floorT[k] === 1) c3 = colOf(B.road, .42);
        else if (wld.floorT[k] === 2) c3 = colOf(B.wall2, .40);
        else c3 = colOf(B.ground, .40);
        const o = k * 4;
        img.data[o] = c3[0] * .28; img.data[o + 1] = c3[1] * .28; img.data[o + 2] = c3[2] * .28;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.mapCanvas = c;
    this.mapCtx = g;
    this.mapRevealed = new Uint8Array(wld.w * wld.h);
    this.mapFullCols = null;
  },

  updateMapReveal() {
    const wld = this.world;
    if (!this.mapCanvas || this.mapCanvas.width !== wld.w) this.buildMapCanvas();
    const g = this.mapCtx, B = wld.biome;
    let painted = 0;
    for (let j = 0; j < wld.h && painted < 4000; j++) {
      for (let i = 0; i < wld.w; i++) {
        const k = wld.idx(i, j);
        if (!wld.visited[k] || this.mapRevealed[k]) continue;
        this.mapRevealed[k] = 1; painted++;
        let hex, f;
        if (wld.solid[k]) { hex = B.wall; f = .62; }
        else if (wld.water[k]) { hex = B.water ? B.water.color : 0x2a3a4a; f = 1.1; }
        else if (wld.floorT[k] === 1) { hex = B.road; f = .95; }
        else if (wld.floorT[k] === 2) { hex = B.wall2; f = .85; }
        else { hex = B.ground; f = .9; }
        const r = clamp(((hex >> 16) & 255) * f, 0, 255) | 0;
        const gg = clamp(((hex >> 8) & 255) * f, 0, 255) | 0;
        const b = clamp((hex & 255) * f, 0, 255) | 0;
        g.fillStyle = `rgb(${r},${gg},${b})`;
        g.fillRect(i, j, 1, 1);
      }
    }
  },

  /* --------------------------- projection ---------------------------- */
  project(x, y, z, out) {
    const m = this.R.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.001) { out[2] = -1; return out; }
    out[0] = (cx / cw * .5 + .5) * this.ovW;
    out[1] = (1 - (cy / cw * .5 + .5)) * this.ovH;
    out[2] = cw;
    return out;
  },

  /* --------------------------- overlay draw --------------------------- */
  renderOverlay() {
    const g = this.octx;
    const W = this.ovW, H = this.ovH;
    g.setTransform(this.ovDpr, 0, 0, this.ovDpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.state === 'map') { this.drawMapScreen(g, W, H); return; }
    if (!this.world) return;

    this.updateMapReveal();

    // floating combat text
    const p = this._proj || (this._proj = [0, 0, 0]);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of this.fx.texts) {
      this.project(t.x, t.y, t.z, p);
      if (p[2] <= 0) continue;
      const a = clamp(1 - t.t / t.life, 0, 1);
      const size = (13 * t.size) * clamp(26 / p[2], .5, 1.6);
      g.globalAlpha = a;
      g.font = `bold ${size.toFixed(1)}px "Courier New", monospace`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.8)';
      g.strokeText(t.str, p[0], p[1]);
      g.fillStyle = t.col;
      g.fillText(t.str, p[0], p[1]);
    }
    g.globalAlpha = 1;

    // enemy health pips for elites / damaged enemies
    for (const e of this.enemies) {
      if (e.dead || e.isBoss) continue;
      if (e.hp >= e.maxHp && !e.elite) continue;
      this.project(e.x, (e.def.h || 1.7) * e.scale + .55, e.z, p);
      if (p[2] <= 0 || p[0] < -40 || p[0] > W + 40) continue;
      const bw = e.elite ? 42 : 28, bh = e.elite ? 5 : 3.5;
      const f = clamp(e.hp / e.maxHp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,.7)';
      g.fillRect(p[0] - bw / 2 - 1, p[1] - 1, bw + 2, bh + 2);
      g.fillStyle = e.elite ? '#ff8a3c' : '#c4443a';
      g.fillRect(p[0] - bw / 2, p[1], bw * f, bh);
      if (e.elite) {
        g.fillStyle = '#ff8a3c';
        g.font = 'bold 8px "Courier New", monospace';
        g.fillText(e.def.name, p[0], p[1] - 8);
      }
    }

    // interaction prompt
    if (this.interact && this.state === 'playing') {
      const o = this.interact.obj;
      this.project(o.x, 1.9, o.z, p);
      if (p[2] > 0) {
        let label, col = HUDCOL.amber;
        if (this.interact.kind === 'container') {
          label = CONTAINERS[o.type].name;
          if (o.key) { label += ' ◆'; col = hexCss(KEYS[o.key].color); }
        } else {
          const locked = o.key && !this.player.keys.has(o.key);
          label = o.label + (locked ? ' — LOCKED' : '');
          col = locked ? HUDCOL.blood : HUDCOL.green;
        }
        g.font = 'bold 12px "Courier New", monospace';
        const tw = g.measureText(label).width + 18;
        g.fillStyle = 'rgba(10,12,9,.82)';
        g.fillRect(p[0] - tw / 2, p[1] - 12, tw, 22);
        g.strokeStyle = col; g.lineWidth = 1.5;
        g.strokeRect(p[0] - tw / 2, p[1] - 12, tw, 22);
        g.fillStyle = col;
        g.fillText(label, p[0], p[1] - 1);
      }
    }

    // boss health bar
    if (this.boss && !this.boss.dead) {
      const b = this.boss;
      const bw = Math.min(W - 40, 420), bx = (W - bw) / 2, by = this.safeTop + 214;
      g.fillStyle = 'rgba(10,12,9,.8)';
      g.fillRect(bx - 3, by - 3, bw + 6, 20);
      const f = clamp(b.hp / b.maxHp, 0, 1);
      const grad = g.createLinearGradient(bx, 0, bx + bw, 0);
      grad.addColorStop(0, '#6a0e0a'); grad.addColorStop(1, '#d9483b');
      g.fillStyle = grad;
      g.fillRect(bx, by, bw * f, 14);
      if (b.shield > 0) {
        g.fillStyle = 'rgba(102,204,255,.75)';
        g.fillRect(bx, by, bw * clamp(b.shield / b.maxHp, 0, 1), 5);
      }
      g.strokeStyle = '#e4dcc4'; g.lineWidth = 1;
      g.strokeRect(bx, by, bw, 14);
      // phase ticks
      for (const ph of b.bdef.phases) {
        if (ph.at >= 1) continue;
        g.fillStyle = 'rgba(0,0,0,.6)';
        g.fillRect(bx + bw * ph.at, by, 2, 14);
      }
      g.font = 'bold 13px "Courier New", monospace';
      g.fillStyle = '#e4dcc4';
      g.fillText(b.bdef.name, W / 2, by - 10);
    }

    // toasts
    let ty = H - 210;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      const a = t.t < .2 ? t.t / .2 : clamp((t.life - t.t) / .5, 0, 1);
      g.globalAlpha = a;
      g.textAlign = 'center';
      g.font = 'bold 15px "Courier New", monospace';
      g.fillStyle = 'rgba(10,12,9,.75)';
      const tw = Math.min(W - 28,
        Math.max(g.measureText(t.title).width, g.measureText(t.sub || '').width * .82) + 28);
      g.fillRect(W / 2 - tw / 2, ty - 15, tw, t.sub ? 40 : 24);
      g.fillStyle = hexCss(t.color);
      g.fillText(t.title, W / 2, ty);
      if (t.sub) {
        g.font = '11px "Courier New", monospace';
        g.fillStyle = HUDCOL.dim;
        g.fillText(t.sub, W / 2, ty + 16);
      }
      ty -= t.sub ? 48 : 32;
    }
    g.globalAlpha = 1;

    // minimap
    this.drawMinimap(g, W, H);
  },

  drawMinimap(g, W, H) {
    const wld = this.world;
    if (!this.mapCanvas) return;
    const size = Math.min(112, W * .3);
    const x0 = W - size - 10, y0 = 10 + this.safeTop;
    const span = 46;                       // world units shown
    const px = this.player.x + wld.w / 2, pz = this.player.z + wld.h / 2;

    g.save();
    g.beginPath();
    g.rect(x0, y0, size, size);
    g.clip();
    g.fillStyle = 'rgba(6,8,6,.9)';
    g.fillRect(x0, y0, size, size);
    g.imageSmoothingEnabled = false;
    const scale = size / span;
    g.drawImage(this.mapCanvas,
      px - span / 2, pz - span / 2, span, span,
      x0, y0, size, size);
    // exits
    for (const ex of wld.exits) {
      const ux = x0 + (ex.x + wld.w / 2 - (px - span / 2)) * scale;
      const uy = y0 + (ex.z + wld.h / 2 - (pz - span / 2)) * scale;
      const locked = ex.key && !this.player.keys.has(ex.key);
      g.fillStyle = locked ? '#d9483b' : '#7fe89a';
      g.fillRect(ux - 2.5, uy - 2.5, 5, 5);
    }
    // unopened containers with keys
    for (const c of wld.containers) {
      if (c.opened || !c.key) continue;
      const ux = x0 + (c.x + wld.w / 2 - (px - span / 2)) * scale;
      const uy = y0 + (c.z + wld.h / 2 - (pz - span / 2)) * scale;
      g.fillStyle = hexCss(KEYS[c.key].color);
      g.fillRect(ux - 2, uy - 2, 4, 4);
    }
    // enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ux = x0 + (e.x + wld.w / 2 - (px - span / 2)) * scale;
      const uy = y0 + (e.z + wld.h / 2 - (pz - span / 2)) * scale;
      g.fillStyle = e.isBoss ? '#ff3b30' : e.elite ? '#ff8a3c' : 'rgba(200,70,60,.85)';
      const s = e.isBoss ? 5 : e.elite ? 3.5 : 2.2;
      g.fillRect(ux - s / 2, uy - s / 2, s, s);
    }
    // player
    const cxp = x0 + size / 2, cyp = y0 + size / 2;
    g.fillStyle = '#e4dcc4';
    g.beginPath();
    g.moveTo(cxp + Math.sin(this.player.yaw) * 5, cyp + Math.cos(this.player.yaw) * 5);
    g.lineTo(cxp + Math.sin(this.player.yaw + 2.4) * 4, cyp + Math.cos(this.player.yaw + 2.4) * 4);
    g.lineTo(cxp + Math.sin(this.player.yaw - 2.4) * 4, cyp + Math.cos(this.player.yaw - 2.4) * 4);
    g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(143,138,116,.8)'; g.lineWidth = 1.5;
    g.strokeRect(x0, y0, size, size);
    g.font = 'bold 9px "Courier New", monospace';
    g.textAlign = 'right';
    g.fillStyle = HUDCOL.dim;
    g.fillText(this.level.short, x0 + size - 3, y0 + size + 11);
    g.textAlign = 'center';
  },

  /* ---------------------------- map screen ----------------------------
     Two maps in one: the level graph (where can I go, what is locked) and
     the local floor plan (where have I been). Everything is drawn from the
     same palette as the HUD so it reads as part of the same machine.      */
  mapNodePos(l, gx, gy, gw, gh) {
    return [gx + l.mapPos[0] * gw, gy + l.mapPos[1] * gh];
  },

  drawMapScreen(g, W, H) {
    const t = this.time;
    // ---- backdrop ----
    g.fillStyle = '#07090a';
    g.fillRect(0, 0, W, H);
    const bg = g.createRadialGradient(W * .5, H * .38, 20, W * .5, H * .38, Math.max(W, H) * .8);
    bg.addColorStop(0, 'rgba(38,46,40,.55)');
    bg.addColorStop(1, 'rgba(4,6,5,0)');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,140,110,.05)';
    g.lineWidth = 1;
    for (let x = 0; x < W; x += 26) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
    for (let y = 0; y < H; y += 26) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }

    // ---- header ----
    const top = this.safeTop;
    g.textAlign = 'center';
    g.font = 'bold 21px "Courier New", monospace';
    g.fillStyle = 'rgba(0,0,0,.85)';
    g.fillText('THE DEADGRID', W / 2 + 2, top + 36);
    g.fillStyle = HUDCOL.bone;
    g.fillText('THE DEADGRID', W / 2, top + 34);

    const done = this.visitedLevels.size, total = LEVELS.length;
    g.font = '9px "Courier New", monospace';
    g.fillStyle = HUDCOL.dim;
    g.fillText(`${done} / ${total} AREAS REACHED  ·  ${this.bossesKilled.size} / 6 BOSSES DOWN`, W / 2, top + 51);
    // progress rule
    const pw = Math.min(W - 60, 300), px0 = (W - pw) / 2, py0 = top + 58;
    g.fillStyle = 'rgba(255,255,255,.09)';
    g.fillRect(px0, py0, pw, 2);
    g.fillStyle = HUDCOL.amber;
    g.fillRect(px0, py0, pw * (done / total), 2);

    // ---- level graph ----
    const gx = 26, gy = top + 76;
    const gh = Math.min(H * .40, 300), gw = W - 52;
    const pos = (l) => this.mapNodePos(l, gx, gy, gw, gh);

    // links first, so nodes sit on top
    for (const l of LEVELS) {
      if (!this.discovered.has(l.id)) continue;
      const [ax, ay] = pos(l);
      for (const ex of l.exits) {
        const tgt = LEVEL_BY_ID[ex.to];
        if (!this.discovered.has(tgt.id)) continue;
        if (tgt.idx < l.idx) continue;                 // draw each pair once
        const [bx, by] = pos(tgt);
        const held = !ex.key || this.player.keys.has(ex.key);
        const walked = this.visitedLevels.has(l.id) && this.visitedLevels.has(tgt.id);
        // gentle arc so parallel links don't overlap
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const nx = -(by - ay), ny = (bx - ax);
        const nl = Math.hypot(nx, ny) || 1;
        const cx = mx + nx / nl * 14, cy = my + ny / nl * 14;
        g.lineWidth = walked ? 2.5 : 2;
        g.setLineDash(held ? [] : [5, 5]);
        g.strokeStyle = !held ? 'rgba(217,72,59,.65)'
          : walked ? 'rgba(143,167,99,.8)' : 'rgba(143,167,99,.35)';
        g.beginPath();
        g.moveTo(ax, ay); g.quadraticCurveTo(cx, cy, bx, by);
        g.stroke();
        g.setLineDash([]);
        if (ex.key) {
          // key marker at the arc midpoint
          const qx = .25 * ax + .5 * cx + .25 * bx, qy = .25 * ay + .5 * cy + .25 * by;
          g.fillStyle = '#0a0c0a';
          g.beginPath(); g.arc(qx, qy, 7, 0, TAU); g.fill();
          g.strokeStyle = held ? HUDCOL.green : hexCss(KEYS[ex.key].color);
          g.lineWidth = 1.4;
          g.beginPath(); g.arc(qx, qy, 7, 0, TAU); g.stroke();
          g.fillStyle = held ? HUDCOL.green : hexCss(KEYS[ex.key].color);
          g.font = 'bold 9px "Courier New", monospace';
          g.fillText(held ? '✓' : '◆', qx, qy + 3.5);
        }
      }
    }

    // nodes
    for (const l of LEVELS) {
      const known = this.discovered.has(l.id);
      const [x, y] = pos(l);
      const cur = l.id === this.levelId;
      const visited = this.visitedLevels.has(l.id);
      const bossDown = l.boss && this.runState[l.id] && this.runState[l.id].bossDead;
      const r = cur ? 13 : 10.5;
      const biome = BIOMES[l.biome];
      const tint = biome && biome.accent != null ? hexCss(biome.accent) : HUDCOL.amber;

      if (!known) {
        g.setLineDash([3, 3]);
        g.strokeStyle = 'rgba(110,110,98,.45)'; g.lineWidth = 1.4;
        g.beginPath(); g.arc(x, y, 9.5, 0, TAU); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(110,110,98,.6)';
        g.font = 'bold 11px "Courier New", monospace';
        g.fillText('?', x, y + 4);
        continue;
      }

      if (cur) {                                        // pulsing halo on "you are here"
        const pr = r + 6 + Math.sin(t * 3) * 3;
        g.strokeStyle = `rgba(228,220,196,${.35 + Math.sin(t * 3) * .18})`;
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, pr, 0, TAU); g.stroke();
      }
      // disc
      const grad = g.createRadialGradient(x - r * .3, y - r * .4, 1, x, y, r);
      grad.addColorStop(0, visited ? 'rgba(62,72,54,.98)' : 'rgba(26,30,24,.98)');
      grad.addColorStop(1, 'rgba(10,13,10,.98)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      // ring
      g.lineWidth = cur ? 2.6 : 1.8;
      g.strokeStyle = cur ? HUDCOL.bone : (visited ? tint : 'rgba(143,138,116,.55)');
      if (l.optional) g.setLineDash([4, 3]);
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
      g.setLineDash([]);
      // badge
      g.font = 'bold 11px "Courier New", monospace';
      if (l.boss) {
        g.fillStyle = bossDown ? HUDCOL.green : HUDCOL.blood;
        g.fillText(bossDown ? '✓' : '☠', x, y + 4);
      } else if (visited) {
        g.fillStyle = 'rgba(228,220,196,.75)';
        g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill();
      }
      // label
      g.font = (cur ? 'bold ' : '') + '8.5px "Courier New", monospace';
      const lw2 = g.measureText(l.short).width + 8;
      g.fillStyle = 'rgba(7,9,10,.88)';
      g.fillRect(x - lw2 / 2, y + r + 4, lw2, 11);
      g.fillStyle = cur ? HUDCOL.bone : (visited ? HUDCOL.dim : 'rgba(143,138,116,.65)');
      g.fillText(l.short, x, y + r + 12);
    }

    // legend
    const ly = gy + gh + 20;
    g.font = '8px "Courier New", monospace';
    g.textAlign = 'left';
    const legend = [['☠', HUDCOL.blood, 'BOSS'], ['◆', HUDCOL.amber, 'NEEDS KEY'], ['?', 'rgba(110,110,98,.8)', 'UNKNOWN']];
    let lx = gx;
    for (const [icon, col, label] of legend) {
      g.fillStyle = col; g.fillText(icon, lx, ly);
      g.fillStyle = HUDCOL.dim; g.fillText(label, lx + 10, ly);
      lx += 16 + g.measureText(label).width;
    }
    g.textAlign = 'center';

    // ---- local floor plan ----
    const my = ly + 16;
    const ms = Math.min(W - 56, H - my - 118);
    if (ms > 60 && this.mapCanvas) {
      const mx = (W - ms) / 2;
      g.font = 'bold 10px "Courier New", monospace';
      g.fillStyle = HUDCOL.amber;
      g.fillText(this.level.name, W / 2, my - 7);

      g.fillStyle = 'rgba(4,6,5,.92)';
      g.fillRect(mx, my, ms, ms);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = .95;
      g.drawImage(this.mapCanvas, 0, 0, this.world.w, this.world.h, mx, my, ms, ms);
      g.globalAlpha = 1;

      const sc = ms / this.world.w;
      const px = (wx) => mx + (wx + this.world.w / 2) * sc;
      const pz = (wz) => my + (wz + this.world.h / 2) * sc;

      // key containers, but only where the player has actually been
      for (const c of this.world.containers) {
        if (c.opened || !c.key) continue;
        const [ci, cj] = this.world.cellOf(c.x, c.z);
        if (!this.world.inB(ci, cj) || !this.world.visited[this.world.idx(ci, cj)]) continue;
        const kx = px(c.x), ky2 = pz(c.z);
        const pulse = .6 + .4 * Math.sin(t * 4 + c.id);
        g.fillStyle = hexCss(KEYS[c.key].color);
        g.globalAlpha = pulse;
        g.beginPath();
        g.moveTo(kx, ky2 - 5); g.lineTo(kx + 5, ky2); g.lineTo(kx, ky2 + 5); g.lineTo(kx - 5, ky2);
        g.closePath(); g.fill();
        g.globalAlpha = 1;
      }

      // exits
      g.font = '7.5px "Courier New", monospace';
      for (const ex of this.world.exits) {
        const ux = px(ex.x), uy = pz(ex.z);
        const locked = ex.key && !this.player.keys.has(ex.key);
        const col = locked ? HUDCOL.blood : '#7fe89a';
        g.fillStyle = col;
        g.fillRect(ux - 3.5, uy - 3.5, 7, 7);
        const lw = g.measureText(ex.label).width + 6;
        const lxc = clamp(ux, mx + lw / 2 + 2, mx + ms - lw / 2 - 2);
        const lyc = uy - 16 < my + 2 ? uy + 8 : uy - 16;
        g.fillStyle = 'rgba(4,6,5,.85)';
        g.fillRect(lxc - lw / 2, lyc, lw, 10);
        g.fillStyle = col;
        g.fillText(ex.label, lxc, lyc + 7.5);
      }

      // player
      const ux = px(this.player.x), uy = pz(this.player.z);
      g.strokeStyle = `rgba(228,220,196,${.3 + Math.sin(t * 3) * .2})`;
      g.lineWidth = 1;
      g.beginPath(); g.arc(ux, uy, 7 + Math.sin(t * 3) * 2, 0, TAU); g.stroke();
      g.fillStyle = HUDCOL.bone;
      g.beginPath();
      g.moveTo(ux + Math.sin(this.player.yaw) * 6, uy + Math.cos(this.player.yaw) * 6);
      g.lineTo(ux + Math.sin(this.player.yaw + 2.5) * 4.5, uy + Math.cos(this.player.yaw + 2.5) * 4.5);
      g.lineTo(ux + Math.sin(this.player.yaw - 2.5) * 4.5, uy + Math.cos(this.player.yaw - 2.5) * 4.5);
      g.closePath(); g.fill();

      // frame with corner brackets
      g.strokeStyle = 'rgba(143,138,116,.5)'; g.lineWidth = 1;
      g.strokeRect(mx + .5, my + .5, ms - 1, ms - 1);
      g.strokeStyle = HUDCOL.amber; g.lineWidth = 2;
      const cb = 12;
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const ax2 = mx + sx * ms, ay2 = my + sy * ms;
        const dx = sx ? -cb : cb, dy = sy ? -cb : cb;
        g.beginPath();
        g.moveTo(ax2 + dx, ay2); g.lineTo(ax2, ay2); g.lineTo(ax2, ay2 + dy);
        g.stroke();
      }
    }

    // ---- keys held ----
    g.textAlign = 'left';
    const keys = [...this.player.keys];
    let ky = H - 86;
    g.font = '9px "Courier New", monospace';
    g.fillStyle = HUDCOL.dim;
    g.fillText('KEYS HELD', 26, ky);
    ky += 14;
    if (!keys.length) {
      g.fillStyle = 'rgba(120,116,100,.6)';
      g.fillText('— none —', 26, ky);
    } else {
      let kx = 26;
      for (const k of keys) {
        const kd = KEYS[k];
        g.font = '8.5px "Courier New", monospace';
        const cw = g.measureText(kd.name).width + 18;
        if (kx + cw > W - 26) { kx = 26; ky += 16; }
        if (ky > H - 26) break;
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(kx, ky - 9, cw, 13);
        g.fillStyle = hexCss(kd.color);
        g.fillText('◆', kx + 5, ky + 1);
        g.fillStyle = HUDCOL.bone;
        g.fillText(kd.name, kx + 14, ky + 1);
        kx += cw + 5;
      }
    }

    g.textAlign = 'center';
    g.fillStyle = 'rgba(143,138,116,.75)';
    g.font = '9px "Courier New", monospace';
    g.fillText('TAP ANYWHERE  ·  M TO CLOSE', W / 2, H - 16);
  },


  /* --------------------------- ammo / mana bar ------------------------
     A bar reads "how long until I have to stop shooting" far faster than a
     number does. Rounds are drawn as segments; a ghost trail lags behind the
     drain, the leading edge flashes per shot, and a reload sweeps the bar.  */
  updateAmmoBar(P, w, isMagic, D) {
    const wrap = D.ammoWrap;
    if (!wrap) return;
    if (w.kind === 'melee') { wrap.style.display = 'none'; return; }
    wrap.style.display = '';

    let cur, max, segs, reserveTxt, lowAt, critAt;
    if (isMagic) {
      cur = P.mana; max = Math.max(1, P.stats.maxMana);
      segs = Math.max(1, Math.round(max / w.mana));
      reserveTxt = '\u2212' + w.mana;
      lowAt = w.mana * 2.5 / max; critAt = w.mana / max;
      const c = hexCss(w.color);
      const rgb = [(w.color >> 16) & 255, (w.color >> 8) & 255, w.color & 255];
      const mixc = (t) => `rgb(${rgb.map(v => Math.round(lerp(v, t > 0 ? 255 : 0, Math.abs(t)))).join(',')})`;
      wrap.style.setProperty('--ac1', mixc(.55));
      wrap.style.setProperty('--ac2', c);
      wrap.style.setProperty('--ac3', mixc(-.55));
      wrap.style.setProperty('--acg', rgb.join(','));
    } else {
      cur = P.mags[w.id] || 0; max = w.mag;
      segs = max;
      reserveTxt = String(P.ammo[w.ammo]);
      lowAt = .35; critAt = .16;
      wrap.style.removeProperty('--ac1'); wrap.style.removeProperty('--ac2');
      wrap.style.removeProperty('--ac3'); wrap.style.removeProperty('--acg');
    }

    const frac = clamp(cur / max, 0, 1);
    const reloading = P.reloadT > 0;
    let pct;
    if (reloading) {
      pct = (1 - P.reloadT / Math.max(.001, P.reloadTotal)) * 100;
      wrap.classList.add('reloading');
    } else {
      pct = frac * 100;
      wrap.classList.remove('reloading');
    }
    wrap.classList.toggle('low', !reloading && frac <= lowAt && frac > critAt);
    wrap.classList.toggle('crit', !reloading && frac <= critAt);

    D.ammoFill.style.width = pct.toFixed(2) + '%';

    // ghost: snaps up on gain, drains slowly on spend
    const prev = this._ammoPct == null ? pct : this._ammoPct;
    if (pct > prev + 0.01) {
      D.ammoGhost.style.transition = 'none';
      D.ammoGhost.style.width = pct.toFixed(2) + '%';
      void D.ammoGhost.offsetWidth;
      D.ammoGhost.style.transition = '';
    } else {
      D.ammoGhost.style.width = pct.toFixed(2) + '%';
    }

    // leading-edge muzzle flash on spend
    if (pct < prev - 0.01 && !reloading) {
      D.ammoEdge.style.left = pct.toFixed(2) + '%';
      D.ammoEdge.classList.remove('flash');
      void D.ammoEdge.offsetWidth;
      D.ammoEdge.classList.add('flash');
    }
    this._ammoPct = pct;

    if (this._ammoSegs !== segs) {
      this._ammoSegs = segs;
      D.ammoTicks.style.display = segs <= 40 ? '' : 'none';
      D.ammoTicks.style.setProperty('--seg', (100 / segs).toFixed(3) + '%');
    }
    const magTxt = isMagic ? String(Math.floor(cur)) : String(cur);
    if (D.ammoMag.textContent !== magTxt) D.ammoMag.textContent = magTxt;
    if (D.ammoRes.textContent !== reserveTxt) D.ammoRes.textContent = reserveTxt;
  },

  /* ------------------------------- HUD -------------------------------- */
  updateHUD() {
    const P = this.player, D = this.dom;
    if (!D || !P || !this.world) return;
    const s = P.stats;
    const hpF = clamp(P.hp / s.maxHp, 0, 1);
    D.hpFill.style.width = (hpF * 100) + '%';
    D.hpText.textContent = Math.max(0, Math.ceil(P.hp)) + '/' + Math.round(s.maxHp);
    D.hpFill.style.background = hpF < .3 ? '#ff3b30' : hpF < .6 ? '#d9a441' : '#d9483b';

    if (s.maxShield > 0) {
      D.shRow.style.display = '';
      D.shFill.style.width = (clamp(P.shield / s.maxShield, 0, 1) * 100) + '%';
    } else D.shRow.style.display = 'none';

    if (s.maxArmor > 0) {
      D.arRow.style.display = '';
      D.arFill.style.width = (clamp(P.armor / s.maxArmor, 0, 1) * 100) + '%';
    } else D.arRow.style.display = 'none';

    const w = P.weapon;
    const isMagic = w.kind === 'magic';
    const hasMagic = P.weapons.some(id => WEAPON_BY_ID[id].kind === 'magic');
    D.mnRow.style.display = hasMagic ? '' : 'none';
    D.mnFill.style.width = (clamp(P.mana / s.maxMana, 0, 1) * 100) + '%';

    D.wpnName.textContent = w.name;
    D.wpnName.style.color = isMagic ? hexCss(w.color) : (w.kind === 'melee' ? HUDCOL.bone : HUDCOL.amber);
    D.wpnClass.textContent = w.cls || (w.kind === 'melee' ? 'MELEE' : '');

    this.updateAmmoBar(P, w, isMagic, D);

    D.med.textContent = P.medkits;
    D.medBtn.classList.toggle('empty', P.medkits <= 0);
    D.dashBtn.classList.toggle('empty', P.dashCd > 0);
    D.dashBtn.style.setProperty('--cd', (1 - P.dashCd / 1.25));

    D.kills.textContent = this.totalKills;
    D.lvl.textContent = P.level;
    D.xpFill.style.width = (clamp(P.xp / P.xpNext, 0, 1) * 100) + '%';
    D.levelName.textContent = this.level ? this.level.name : '';

    // weapon bar
    if (this._wbHash !== P.weapons.join(',') + '|' + P.slot) {
      this._wbHash = P.weapons.join(',') + '|' + P.slot;
      let html = '';
      P.weapons.forEach((id, i) => {
        const ww = WEAPON_BY_ID[id];
        const cls = i === P.slot ? 'wslot active' : 'wslot';
        const col = ww.kind === 'magic' ? hexCss(ww.color) : ww.kind === 'melee' ? '#e4dcc4' : '#d9a441';
        html += `<div class="${cls}" data-slot="${i}" style="--c:${col}">${(i + 1)}</div>`;
      });
      D.wbar.innerHTML = html;
    }

    // mods
    const modHash = P.modOrder.map(m => m + P.mods[m]).join(',');
    if (this._modHash !== modHash) {
      this._modHash = modHash;
      let html = '';
      for (const id of P.modOrder) {
        const m = MOD_BY_ID[id];
        html += `<span class="mod" style="color:${hexCss(m.color)}" title="${m.name}">${m.icon}${P.mods[id] > 1 ? '<sub>' + P.mods[id] + '</sub>' : ''}</span>`;
      }
      D.mods.innerHTML = html;
    }

    // keys
    const keyHash = [...P.keys].join(',');
    if (this._keyHash !== keyHash) {
      this._keyHash = keyHash;
      let html = '';
      for (const k of P.keys) html += `<span class="keychip" style="color:${hexCss(KEYS[k].color)}">◆</span>`;
      D.keys.innerHTML = html;
    }

    // interaction button
    const showInteract = !!this.interact;
    D.useBtn.style.display = showInteract ? '' : 'none';
    if (showInteract) {
      const isExit = this.interact.kind === 'exit';
      D.useBtn.textContent = isExit ? 'ENTER' : 'LOOT';
      const locked = isExit && this.interact.obj.key && !P.keys.has(this.interact.obj.key);
      D.useBtn.style.borderColor = locked ? '#7a2a24' : (isExit ? '#3d7330' : '#6e5522');
      D.useBtn.style.color = locked ? HUDCOL.blood : (isExit ? '#7fe89a' : HUDCOL.amber);
    }
    D.reloadBtn.style.display = (w.kind === 'gun') ? '' : 'none';
  },
});
