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

  /* ---------------------------- map screen ---------------------------- */
  drawMapScreen(g, W, H) {
    g.fillStyle = 'rgba(8,10,8,.94)';
    g.fillRect(0, 0, W, H);

    g.textAlign = 'center';
    g.font = 'bold 20px "Courier New", monospace';
    g.fillStyle = HUDCOL.bone;
    g.fillText('THE DEADGRID', W / 2, 34 + this.safeTop);
    g.font = '10px "Courier New", monospace';
    g.fillStyle = HUDCOL.dim;
    g.fillText('AREAS DISCOVERED — ' + this.discovered.size + ' / ' + LEVELS.length, W / 2, 52 + this.safeTop);

    // ---- graph ----
    const gx = 22, gy = 68 + this.safeTop;
    const gw = W - 44, gh = Math.min(H * .46, 330);
    const nodePos = (l) => [gx + l.mapPos[0] * gw, gy + l.mapPos[1] * gh];

    // links
    g.lineWidth = 2;
    for (const l of LEVELS) {
      if (!this.discovered.has(l.id)) continue;
      const [ax, ay] = nodePos(l);
      for (const ex of l.exits) {
        const t = LEVEL_BY_ID[ex.to];
        if (!this.discovered.has(t.id)) continue;
        const [bx, by] = nodePos(t);
        const locked = ex.key && !this.player.keys.has(ex.key) && !this.visitedLevels.has(t.id);
        g.strokeStyle = locked ? 'rgba(217,72,59,.5)' : 'rgba(143,167,99,.55)';
        g.setLineDash(locked ? [4, 4] : []);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
    }
    g.setLineDash([]);

    // nodes
    for (const l of LEVELS) {
      const known = this.discovered.has(l.id);
      const [x, y] = nodePos(l);
      const cur = l.id === this.levelId;
      const visited = this.visitedLevels.has(l.id);
      const bossDown = l.boss && this.runState[l.id] && this.runState[l.id].bossDead;
      const r = cur ? 13 : 10;

      g.beginPath(); g.arc(x, y, r + 3, 0, TAU);
      g.fillStyle = 'rgba(8,10,8,.9)'; g.fill();

      if (!known) {
        g.strokeStyle = 'rgba(90,90,80,.5)'; g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(90,90,80,.7)';
        g.font = 'bold 12px "Courier New", monospace';
        g.fillText('?', x, y + 4);
        continue;
      }
      const bc = BIOMES[l.biome];
      const base = bc && bc.accent ? hexCss(bc.accent) : HUDCOL.amber;
      g.beginPath(); g.arc(x, y, r, 0, TAU);
      g.fillStyle = visited ? 'rgba(40,48,36,.95)' : 'rgba(24,28,22,.95)';
      g.fill();
      g.lineWidth = cur ? 3 : 2;
      g.strokeStyle = cur ? HUDCOL.bone : (visited ? base : 'rgba(143,138,116,.7)');
      g.stroke();

      if (l.boss) {
        g.fillStyle = bossDown ? HUDCOL.green : HUDCOL.blood;
        g.font = 'bold 11px "Courier New", monospace';
        g.fillText(bossDown ? '✓' : '☠', x, y + 4);
      } else if (cur) {
        g.fillStyle = HUDCOL.bone;
        g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill();
      }
      g.font = (cur ? 'bold ' : '') + '9px "Courier New", monospace';
      g.fillStyle = cur ? HUDCOL.bone : HUDCOL.dim;
      g.fillText(l.short, x, y + r + 12);
      if (l.optional) {
        g.fillStyle = 'rgba(159,232,255,.7)';
        g.font = '8px "Courier New", monospace';
        g.fillText('OPTIONAL', x, y + r + 22);
      }
    }

    // ---- current level map ----
    const my = gy + gh + 22;
    const ms = Math.min(W - 60, H - my - 120);
    if (ms > 60 && this.mapCanvas) {
      const mx = (W - ms) / 2;
      g.fillStyle = 'rgba(6,8,6,.9)';
      g.fillRect(mx, my, ms, ms);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.mapCanvas, 0, 0, this.world.w, this.world.h, mx, my, ms, ms);
      const sc = ms / this.world.w;
      // exits + player
      for (const ex of this.world.exits) {
        const ux = mx + (ex.x + this.world.w / 2) * sc, uy = my + (ex.z + this.world.h / 2) * sc;
        const locked = ex.key && !this.player.keys.has(ex.key);
        g.fillStyle = locked ? HUDCOL.blood : '#7fe89a';
        g.fillRect(ux - 3, uy - 3, 6, 6);
        g.font = '8px "Courier New", monospace';
        g.fillText(ex.label, ux, uy - 6);
      }
      // key containers, but only where the player has actually been
      for (const c of this.world.containers) {
        if (c.opened || !c.key) continue;
        const [ci, cj] = this.world.cellOf(c.x, c.z);
        if (!this.world.inB(ci, cj) || !this.world.visited[this.world.idx(ci, cj)]) continue;
        const kx = mx + (c.x + this.world.w / 2) * sc, ky2 = my + (c.z + this.world.h / 2) * sc;
        g.fillStyle = hexCss(KEYS[c.key].color);
        g.beginPath();
        g.moveTo(kx, ky2 - 4); g.lineTo(kx + 4, ky2); g.lineTo(kx, ky2 + 4); g.lineTo(kx - 4, ky2);
        g.closePath(); g.fill();
      }
      const ux = mx + (this.player.x + this.world.w / 2) * sc, uy = my + (this.player.z + this.world.h / 2) * sc;
      g.fillStyle = HUDCOL.bone;
      g.beginPath(); g.arc(ux, uy, 3.5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(143,138,116,.6)'; g.lineWidth = 1;
      g.strokeRect(mx, my, ms, ms);
      g.font = 'bold 10px "Courier New", monospace';
      g.fillStyle = HUDCOL.amber;
      g.fillText(this.level.name, W / 2, my - 6);
    }

    // ---- keys held ----
    const keys = [...this.player.keys];
    g.font = '10px "Courier New", monospace';
    g.textAlign = 'left';
    let ky = H - 74;
    g.fillStyle = HUDCOL.dim;
    g.fillText('KEYS HELD', 22, ky);
    ky += 14;
    if (!keys.length) { g.fillStyle = 'rgba(120,116,100,.7)'; g.fillText('— none —', 22, ky); }
    else {
      let kx = 22;
      for (const k of keys) {
        const kd = KEYS[k];
        g.fillStyle = hexCss(kd.color);
        g.fillText('◆ ' + kd.name, kx, ky);
        ky += 13;
        if (ky > H - 26) break;
      }
    }
    g.textAlign = 'center';
    g.fillStyle = HUDCOL.dim;
    g.font = '10px "Courier New", monospace';
    g.fillText('TAP ANYWHERE OR PRESS M TO CLOSE', W / 2, H - 16);
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

    if (w.kind === 'gun') {
      D.ammo.style.display = '';
      const mag = P.mags[w.id] || 0;
      D.ammo.innerHTML = `<b>${mag}</b> / ${P.ammo[w.ammo]}`;
      D.ammo.style.color = mag === 0 ? HUDCOL.blood : (mag <= w.mag * .25 ? HUDCOL.amber : HUDCOL.bone);
    } else if (isMagic) {
      D.ammo.style.display = '';
      D.ammo.innerHTML = `<b>${Math.floor(P.mana)}</b> MANA · ${w.mana}/CAST`;
      D.ammo.style.color = P.mana < w.mana ? HUDCOL.blood : hexCss(w.color);
    } else {
      D.ammo.style.display = 'none';
    }

    D.reload.style.display = P.reloadT > 0 ? '' : 'none';
    if (P.reloadT > 0) D.reloadBar.style.width = ((1 - P.reloadT / P.reloadTotal) * 100) + '%';

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
