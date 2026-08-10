/* ==========================================================================
   Boot — input binding, DOM wiring, main loop
   ========================================================================== */

(function () {
  // When embedded (e.g. published as an artifact) the host supplies its own
  // viewport meta, which drops viewport-fit/user-scalable. Re-assert ours so
  // safe-area insets resolve and a stray pinch can't zoom mid-fight.
  (function fixViewport() {
    const want = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    let m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    if (m.content !== want) m.content = want;
  })();

  const canvas = document.getElementById('gl');
  const overlay = document.getElementById('ov');
  const app = document.getElementById('app');

  let game = null;

  /* ---------------------------- DOM refs ---------------------------- */
  const D = {
    hpFill: document.getElementById('hpFill'), hpText: document.getElementById('hpText'),
    shRow: document.getElementById('shRow'), shFill: document.getElementById('shFill'),
    arRow: document.getElementById('arRow'), arFill: document.getElementById('arFill'),
    mnRow: document.getElementById('mnRow'), mnFill: document.getElementById('mnFill'),
    wpnName: document.getElementById('wpnName'), wpnClass: document.getElementById('wpnClass'),
    ammo: document.getElementById('ammo'), reload: document.getElementById('reload'),
    reloadBar: document.getElementById('reloadBar'),
    med: document.getElementById('medCount'), kills: document.getElementById('kills'),
    lvl: document.getElementById('lvl'), xpFill: document.getElementById('xpFill'),
    levelName: document.getElementById('levelName'),
    wbar: document.getElementById('wbar'), mods: document.getElementById('mods'),
    keys: document.getElementById('keys'),
    useBtn: document.getElementById('useBtn'), medBtn: document.getElementById('medBtn'),
    dashBtn: document.getElementById('dashBtn'), mapBtn: document.getElementById('mapBtn'),
    reloadBtn: document.getElementById('reloadBtn'), swapBtn: document.getElementById('swapBtn'),
    stickL: document.getElementById('stickL'), knobL: document.getElementById('knobL'),
    stickR: document.getElementById('stickR'), knobR: document.getElementById('knobR'),
  };

  /* ---------------------------- resize ------------------------------ */
  function readSafeTop() {
    const probe = document.getElementById('safeProbe');
    return probe ? probe.getBoundingClientRect().height : 0;
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!game) return;
    game.R.resize(w, h, dpr);
    overlay.width = Math.round(w * dpr);
    overlay.height = Math.round(h * dpr);
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    game.ovW = w; game.ovH = h; game.ovDpr = dpr;
    game.safeTop = readSafeTop();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 260));

  /* ------------------------- pointer input -------------------------- */
  const pointers = new Map();
  let moveId = null, aimId = null;
  const STICK_R = 52;

  function setStick(el, knob, x, y, dx, dy, show) {
    if (!show) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = (x - STICK_R) + 'px';
    el.style.top = (y - STICK_R) + 'px';
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  }

  function onDown(e) {
    if (!game || game.state === 'title') return;
    if (e.target.closest('.btn') || e.target.closest('#wbar')) return;
    const x = e.clientX, y = e.clientY;
    pointers.set(e.pointerId, { x0: x, y0: y, x, y });
    if (game.state === 'map') { closeMap(); return; }
    if (x < window.innerWidth * 0.5 && moveId === null) {
      moveId = e.pointerId;
      setStick(D.stickL, D.knobL, x, y, 0, 0, true);
    } else if (aimId === null) {
      aimId = e.pointerId;
      Input.aimActive = true;
      Input.firing = true;
      setStick(D.stickR, D.knobR, x, y, 0, 0, true);
    }
    if (e.target === canvas || e.target === overlay || e.target === app) e.preventDefault();
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    let dx = p.x - p.x0, dy = p.y - p.y0;
    const len = Math.hypot(dx, dy);
    const cl = Math.min(len, STICK_R);
    const nx = len > 0 ? dx / len : 0, ny = len > 0 ? dy / len : 0;
    if (e.pointerId === moveId) {
      const mag = clamp(len / STICK_R, 0, 1);
      Input.move.x = nx * mag; Input.move.y = -ny * mag;   // screen up = world -z
      setStick(D.stickL, D.knobL, p.x0, p.y0, nx * cl, ny * cl, true);
    } else if (e.pointerId === aimId) {
      if (len > 8) { Input.aim.x = nx; Input.aim.y = -ny; }
      setStick(D.stickR, D.knobR, p.x0, p.y0, nx * cl, ny * cl, true);
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (e.pointerId === moveId) {
      moveId = null;
      Input.move.x = 0; Input.move.y = 0;
      setStick(D.stickL, D.knobL, 0, 0, 0, 0, false);
    } else if (e.pointerId === aimId) {
      aimId = null;
      Input.aimActive = false; Input.firing = false;
      setStick(D.stickR, D.knobR, 0, 0, 0, 0, false);
    }
  }

  app.addEventListener('pointerdown', onDown, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  /* --------------------------- mouse aim ---------------------------- */
  let mouseX = 0, mouseY = 0, hasMouse = false;
  window.addEventListener('mousemove', (e) => {
    if (e.pointerType === 'touch') return;
    mouseX = e.clientX; mouseY = e.clientY; hasMouse = true;
  });
  window.addEventListener('mousedown', (e) => {
    if (!game || game.state !== 'playing') return;
    if (e.target.closest('.btn') || e.target.closest('#wbar')) return;
    if (e.button === 0 && hasMouse && pointers.size === 0) { Input.firing = true; Input.aimActive = true; }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && pointers.size === 0) { Input.firing = false; }
  });
  window.addEventListener('wheel', (e) => {
    if (!game || game.state !== 'playing') return;
    game.player.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  /** project the mouse onto the ground plane to get an aim direction */
  function updateMouseAim() {
    if (!hasMouse || !game || !game.world || pointers.size > 0) return;
    const R = game.R;
    const ndcX = (mouseX / window.innerWidth) * 2 - 1;
    const ndcY = 1 - (mouseY / window.innerHeight) * 2;
    const m = R.invVP;
    const px = m[0] * ndcX + m[4] * ndcY + m[8] * 1 + m[12];
    const py = m[1] * ndcX + m[5] * ndcY + m[9] * 1 + m[13];
    const pz = m[2] * ndcX + m[6] * ndcY + m[10] * 1 + m[14];
    const pw = m[3] * ndcX + m[7] * ndcY + m[11] * 1 + m[15];
    if (Math.abs(pw) < 1e-6) return;
    const wx = px / pw, wy = py / pw, wz = pz / pw;
    const o = R.camPos;
    const dy = wy - o[1];
    if (Math.abs(dy) < 1e-5) return;
    const targetY = game.player.y + 1.0;
    const t = (targetY - o[1]) / dy;
    if (t <= 0) return;
    const hx = o[0] + (wx - o[0]) * t, hz = o[2] + (wz - o[2]) * t;
    const ax = hx - game.player.x, az = hz - game.player.z;
    const l = Math.hypot(ax, az);
    if (l > 0.4) { Input.aim.x = ax / l; Input.aim.y = az / l; Input.aimActive = true; }
  }

  /* --------------------------- keyboard ----------------------------- */
  const KEYMAP = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyE: 'interact', KeyR: 'reload', KeyH: 'heal', KeyQ: 'swap',
    Space: 'dash', KeyM: 'map', Escape: 'pause', KeyF: 'fire',
  };
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (/^Digit[1-9]$/.test(e.code) && game && game.player) {
      game.player.selectSlot(parseInt(e.code.slice(5), 10) - 1);
      return;
    }
    if (!k) return;
    if (!Input.keys[k]) Input.pressed[k] = true;
    Input.keys[k] = true;
    if (k === 'fire') Input.firing = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    Input.keys[k] = false;
    if (k === 'fire') Input.firing = false;
  });

  function keyboardMove() {
    let x = 0, y = 0;
    if (Input.down('left')) x -= 1;
    if (Input.down('right')) x += 1;
    if (Input.down('up')) y += 1;
    if (Input.down('down')) y -= 1;
    if (x || y) {
      const l = Math.hypot(x, y);
      Input.move.x = x / l; Input.move.y = y / l;
    } else if (moveId === null) { Input.move.x = 0; Input.move.y = 0; }
  }

  /* ---------------------------- buttons ----------------------------- */
  function bindBtn(el, fn, repeat) {
    if (!el) return;
    let iv = null;
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      Audio3D.resume();
      fn();
      if (repeat) iv = setInterval(fn, 260);
    });
    const stop = (e) => { if (iv) { clearInterval(iv); iv = null; } };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
  }

  bindBtn(D.useBtn, () => game && game.doInteract());
  bindBtn(D.medBtn, () => game && game.useMedkit());
  bindBtn(D.dashBtn, () => game && game.dash());
  bindBtn(D.reloadBtn, () => game && game.player.startReload());
  bindBtn(D.swapBtn, () => game && game.player.cycleWeapon(1));
  bindBtn(D.mapBtn, () => toggleMap());

  D.wbar.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const s = e.target.closest('.wslot');
    if (s && game) game.player.selectSlot(parseInt(s.dataset.slot, 10));
  });

  function toggleMap() {
    if (!game) return;
    if (game.state === 'playing') { game.state = 'map'; document.body.classList.add('mapopen'); Audio3D.SFX.ui(); }
    else if (game.state === 'map') closeMap();
  }
  function closeMap() {
    if (game.state === 'map') { game.state = 'playing'; document.body.classList.remove('mapopen'); }
  }

  /* ---------------------------- overlays ---------------------------- */
  const titleEl = document.getElementById('titleOverlay');
  const deadEl = document.getElementById('deadOverlay');
  const winEl = document.getElementById('winOverlay');
  const deadStats = document.getElementById('deadStats');
  const winStats = document.getElementById('winStats');

  function fmtTime(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function startGame() {
    Audio3D.init(); Audio3D.resume();
    titleEl.style.display = 'none';
    deadEl.style.display = 'none';
    winEl.style.display = 'none';
    document.body.classList.add('playing');
    game.newRun();
    resize();
  }

  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('restartBtn').addEventListener('click', startGame);
  document.getElementById('winRestartBtn').addEventListener('click', startGame);

  const muteBtn = document.getElementById('muteBtn');
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    Audio3D.init();
    Audio3D.setMuted(!Audio3D.isMuted());
    muteBtn.textContent = Audio3D.isMuted() ? '♪̸' : '♪';
  });

  /* ----------------------------- loop ------------------------------- */
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt <= 0) dt = 1 / 60;

    if (!game) return;

    if (game.state === 'playing') {
      keyboardMove();
      updateMouseAim();
      if (Input.tap('heal')) game.useMedkit();
      if (Input.tap('dash')) game.dash();
      if (Input.tap('reload')) game.player.startReload();
      if (Input.tap('swap')) game.player.cycleWeapon(1);
      if (Input.tap('map')) toggleMap();
      game.tryFire(dt);
    } else {
      if (Input.tap('map')) toggleMap();
      Input.clearTaps();
    }

    game.frame(dt);
    game.updateHUD();
  }

  /* ----------------------------- init ------------------------------- */
  try {
    game = new Game(canvas, overlay);
    game.ovW = window.innerWidth; game.ovH = window.innerHeight; game.ovDpr = 1;
    game.safeTop = readSafeTop();
    game.dom = D;
    game.onDead = () => {
      deadStats.innerHTML =
        `you fell in <b>${game.level.name}</b><br><br>` +
        `kills <b>${game.totalKills}</b> &middot; level <b>${game.player.level}</b><br>` +
        `areas reached <b>${game.visitedLevels.size}</b> / ${LEVELS.length}<br>` +
        `bosses destroyed <b>${game.bossesKilled.size}</b><br>` +
        `survived <b>${fmtTime(game.runTime)}</b>`;
      setTimeout(() => { deadEl.style.display = 'flex'; }, 900);
    };
    game.onWin = () => {
      winStats.innerHTML =
        `the grey sovereign is ash.<br><br>` +
        `kills <b>${game.totalKills}</b> &middot; level <b>${game.player.level}</b><br>` +
        `areas cleared <b>${game.visitedLevels.size}</b> / ${LEVELS.length}<br>` +
        `bosses destroyed <b>${game.bossesKilled.size}</b> / 6<br>` +
        `time <b>${fmtTime(game.runTime)}</b>`;
      setTimeout(() => { winEl.style.display = 'flex'; }, 1400);
    };
    game.onResize = resize;
    // debug handle: lets tooling (and curious players) poke at the systems
    window.__game = game;
    window.__DG = {
      Input, WEAPONS, WEAPON_BY_ID, MODS, MOD_BY_ID, KEYS, LEVELS, LEVEL_BY_ID,
      BOSSES, ENEMIES, BIOMES, CONTAINERS, Enemy, Boss, Player, applyStatus,
    };
    resize();
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    const msg = document.createElement('div');
    msg.className = 'overlay';
    msg.style.display = 'flex';
    msg.innerHTML = `<div class="title" style="font-size:28px">NO WEBGL2</div>
      <div class="rules">this build needs webgl2.<br>try a recent chrome, safari or firefox.<br><br>
      <span style="opacity:.6;font-size:10px">${String(err.message || err).slice(0, 200)}</span></div>`;
    document.body.appendChild(msg);
  }
})();
