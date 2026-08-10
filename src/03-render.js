/* ==========================================================================
   Renderer — instanced forward+ pipeline with shadows, SSAO, baked GI,
   bloom and filmic composite.
   ========================================================================== */

const MESH_IDS = ['box', 'cyl', 'cone', 'sphere', 'plane', 'prism', 'octa', 'quad'];
const CHUNK_SIZE = 26;

/** default material — game code passes partial overrides */
function mat(c, rough, e, metal, mt, anim, ao, alpha) {
  return {
    c: c || [1, 1, 1], rough: rough == null ? 0.8 : rough,
    e: e || null, metal: metal || 0, mt: mt || 0,
    anim: anim || 0, ao: ao == null ? 1 : ao, alpha: alpha == null ? 1 : alpha,
  };
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.extFloat = gl.getExtension('EXT_color_buffer_float');
    this.extLinear = gl.getExtension('OES_texture_float_linear');
    this.hasFloatRT = !!this.extFloat;

    this.quality = {
      shadowSize: 1536, ssao: true, bloom: true, renderScale: 1,
      maxParticles: 3000, soft: true,
    };

    this.progs = {};
    this._initPrograms();
    this._initMeshes();
    this._initParticles();
    this._initEmptyVAO();

    this.shadowRT = null;
    this._makeShadow(this.quality.shadowSize);

    this.W = 1; this.H = 1;
    this.rts = {};

    // state
    this.camPos = v3.create(0, 20, 20);
    this.camTarget = v3.create(0, 0, 0);
    this.fov = 0.72;
    this.view = m4.create(); this.proj = m4.create(); this.vp = m4.create();
    this.invVP = m4.create(); this.invProj = m4.create();
    this.lightVP = m4.create();
    this.frustum = new Float32Array(24);

    this.staticChunks = new Map();     // key -> {cx,cz, opaque:Map, trans:Map, bounds}
    this.pendingStatic = null;
    this.dynOpaque = new Map();
    this.dynTrans = new Map();

    this.lights = [];
    this.lightPosArr = new Float32Array(64);
    this.lightColArr = new Float32Array(64);

    this.giTex = null; this.giRect = [0, 0, 1, 1]; this.giStrength = 1;
    this._makeDefaultGI();

    this.env = Renderer.prepEnv(this.defaultEnv());
    this.post = {
      exposure: 1.05, bloom: 0.55, vignette: 0.75, grain: 0.035,
      chroma: 0, damage: 0, heal: 0, desat: 0, flashAmt: 0,
      contrast: 1.14, saturation: 1.09,
      flashColor: [1, 1, 1], lift: [0, 0, 0], gain: [1, 1, 1],
    };

    this.stats = { draws: 0, instances: 0, particles: 0 };
    this.time = 0;
    this._ssaoKernel = this._makeKernel(24);
    this._tmpM = m4.create();
    this._tmpV = v3.create();
  }

  defaultEnv() {
    return {
      sunDir: [0.45, 0.78, 0.42], sunColor: [1.5, 1.32, 1.02],
      skyTop: [0.16, 0.24, 0.4], skyHorizon: [0.42, 0.38, 0.34], groundCol: [0.1, 0.1, 0.09],
      ambient: [0.28, 0.33, 0.42], bounce: [0.14, 0.12, 0.1],
      fogColor: [0.36, 0.36, 0.36], fogDensity: 0.014, fogHeight: 0.055,
      stars: 0, cloud: 0.5, giStrength: 1, exposure: 1.05,
      lift: [0, 0, 0], gain: [1, 1, 1], bloom: 0.55, desat: 0,
    };
  }

  _initPrograms() {
    const gl = this.gl;
    const P = (n, vs, fs) => { this.progs[n] = new Program(gl, vs, fs, n); };
    P('shadow', GLSL.shadowVS, GLSL.shadowFS);
    P('prepass', GLSL.prepassVS, GLSL.prepassFS);
    P('ssao', GLSL.fullscreenVS, GLSL.ssaoFS);
    P('blur', GLSL.fullscreenVS, GLSL.blurFS);
    P('sky', GLSL.fullscreenVS, GLSL.skyFS);
    P('scene', GLSL.sceneVS, GLSL.sceneFS);
    P('particle', GLSL.particleVS, GLSL.particleFS);
    P('bright', GLSL.fullscreenVS, GLSL.brightFS);
    P('down', GLSL.fullscreenVS, GLSL.downFS);
    P('up', GLSL.fullscreenVS, GLSL.upFS);
    P('composite', GLSL.fullscreenVS, GLSL.compositeFS);
  }

  _initMeshes() {
    const gl = this.gl;
    this.meshes = {
      box: new Mesh(gl, geoBox(), 'box'),
      cyl: new Mesh(gl, geoCylinder(14, true, 1), 'cyl'),
      cone: new Mesh(gl, geoCylinder(12, true, 0.02), 'cone'),
      sphere: new Mesh(gl, geoSphere(2), 'sphere'),
      plane: new Mesh(gl, geoPlane(6, true), 'plane'),
      prism: new Mesh(gl, geoPrism(), 'prism'),
      octa: new Mesh(gl, geoOcta(), 'octa'),
      quad: new Mesh(gl, geoPlane(1, true), 'quad'),
    };
  }

  _initEmptyVAO() {
    this.emptyVAO = this.gl.createVertexArray();
  }

  _initParticles() {
    const gl = this.gl;
    const verts = new Float32Array([-.5, -.5, .5, -.5, .5, .5, -.5, .5]);
    const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    this.pVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    this.pIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    const cap = 4000;
    this.pCap = cap;
    this.pAdd = { data: new Float32Array(cap * 12), n: 0 };
    this.pAlpha = { data: new Float32Array(cap * 12), n: 0 };
    this.pInstBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pInstBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cap * 12 * 4, gl.DYNAMIC_DRAW);

    this.pVAO = gl.createVertexArray();
    gl.bindVertexArray(this.pVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pInstBuf);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pIBO);
    gl.bindVertexArray(null);
  }

  _makeKernel(n) {
    const k = new Float32Array(n * 3);
    const rnd = mulberry32(1337);
    for (let i = 0; i < n; i++) {
      let x, y, z, l;
      do {
        x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd();
        l = Math.hypot(x, y, z);
      } while (l > 1 || l < 1e-3);
      let scale = i / n; scale = 0.1 + 0.9 * scale * scale;
      k[i * 3] = x / l * scale; k[i * 3 + 1] = y / l * scale; k[i * 3 + 2] = z / l * scale;
    }
    return k;
  }

  _makeShadow(size) {
    const gl = this.gl;
    if (this.shadowRT) destroyRT(gl, this.shadowRT);
    this.shadowRT = createRT(gl, size, size, { color: false, depth: true, depthTexture: true, compare: true });
    this.shadowSize = size;
  }

  _makeDefaultGI() {
    const gl = this.gl;
    this.giTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.giTex);
    const d = new Float32Array([0.05, 0.05, 0.06, 1]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** upload a baked irradiance grid: Float32Array RGBA, a = sky visibility */
  setGI(data, w, h, originX, originZ, sizeX, sizeZ) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.giTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.giRect = [originX, originZ, 1 / sizeX, 1 / sizeZ];
  }

  resize(cssW, cssH, dpr) {
    const scale = this.quality.renderScale;
    const w = Math.max(2, Math.round(cssW * dpr * scale));
    const h = Math.max(2, Math.round(cssH * dpr * scale));
    this.canvas.width = Math.max(2, Math.round(cssW * dpr));
    this.canvas.height = Math.max(2, Math.round(cssH * dpr));
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    this._rebuildRTs();
  }

  _rebuildRTs() {
    const gl = this.gl, W = this.W, H = this.H;
    for (const k in this.rts) destroyRT(gl, this.rts[k]);
    this.rts = {};
    const f = this.hasFloatRT;
    this.rts.scene = createRT(gl, W, H, { float: f, depth: true });
    this.rts.nd = createRT(gl, W, H, { float: f, depth: true });
    const aw = Math.max(2, W >> 1), ah = Math.max(2, H >> 1);
    this.rts.ssao = createRT(gl, aw, ah, {});
    this.rts.ssaoBlur = createRT(gl, aw, ah, {});
    this.bloomChain = [];
    let bw = W >> 1, bh = H >> 1;
    for (let i = 0; i < 5 && bw > 8 && bh > 8; i++) {
      this.bloomChain.push(createRT(gl, bw, bh, { float: f }));
      bw = Math.max(4, bw >> 1); bh = Math.max(4, bh >> 1);
    }
    this.bloomUp = this.bloomChain.map(rt => createRT(gl, rt.w, rt.h, { float: f }));
  }

  /* ------------------------- static geometry ------------------------- */
  beginStatic() {
    const gl = this.gl;
    for (const c of this.staticChunks.values()) {
      for (const l of c.opaque.values()) l.destroy();
      for (const l of c.trans.values()) l.destroy();
    }
    this.staticChunks.clear();
    this.pendingStatic = new Map();
  }

  pushStatic(meshId, m, material, transparent) {
    const cx = Math.floor(m[12] / CHUNK_SIZE), cz = Math.floor(m[14] / CHUNK_SIZE);
    const key = cx + ':' + cz;
    let ch = this.pendingStatic.get(key);
    if (!ch) {
      ch = { cx, cz, opaque: new Map(), trans: new Map(), minY: 1e9, maxY: -1e9 };
      this.pendingStatic.set(key, ch);
    }
    const bucket = transparent ? ch.trans : ch.opaque;
    let arr = bucket.get(meshId);
    if (!arr) { arr = []; bucket.set(meshId, arr); }
    const o = arr.length;
    arr.length = o + INSTANCE_FLOATS;
    this._writeInstance(arr, o, m, material);
    const sy = Math.abs(m[5]) * this.meshes[meshId].radius;
    ch.minY = Math.min(ch.minY, m[13] - sy);
    ch.maxY = Math.max(ch.maxY, m[13] + sy);
  }

  endStatic() {
    const gl = this.gl;
    let total = 0;
    for (const [key, ch] of this.pendingStatic) {
      const out = { cx: ch.cx, cz: ch.cz, opaque: new Map(), trans: new Map() };
      const cxw = (ch.cx + .5) * CHUNK_SIZE, czw = (ch.cz + .5) * CHUNK_SIZE;
      const cy = (ch.minY + ch.maxY) / 2;
      out.center = [cxw, isFinite(cy) ? cy : 0, czw];
      const halfY = isFinite(ch.maxY) ? (ch.maxY - ch.minY) / 2 : 4;
      out.radius = Math.hypot(CHUNK_SIZE * 0.75, halfY + 2, CHUNK_SIZE * 0.75);
      for (const [which, src] of [['opaque', ch.opaque], ['trans', ch.trans]]) {
        for (const [meshId, arr] of src) {
          const n = arr.length / INSTANCE_FLOATS;
          if (!n) continue;
          const list = new InstanceList(gl, this.meshes[meshId], n);
          list.data.set(arr);
          list.count = n;
          list.upload(gl.STATIC_DRAW);
          out[which].set(meshId, list);
          total += n;
        }
      }
      this.staticChunks.set(key, out);
    }
    this.pendingStatic = null;
    this.staticInstanceCount = total;
    return total;
  }

  _writeInstance(dst, o, m, mt) {
    for (let i = 0; i < 16; i++) dst[o + i] = m[i];
    const c = mt.c;
    dst[o + 16] = c[0]; dst[o + 17] = c[1]; dst[o + 18] = c[2]; dst[o + 19] = mt.rough;
    const e = mt.e;
    if (e) { dst[o + 20] = e[0]; dst[o + 21] = e[1]; dst[o + 22] = e[2]; }
    else { dst[o + 20] = 0; dst[o + 21] = 0; dst[o + 22] = 0; }
    dst[o + 23] = mt.metal;
    dst[o + 24] = mt.mt; dst[o + 25] = mt.anim; dst[o + 26] = mt.ao; dst[o + 27] = mt.alpha;
  }

  /* -------------------------- dynamic pushes ------------------------- */
  _list(map, meshId) {
    let l = map.get(meshId);
    if (!l) { l = new InstanceList(this.gl, this.meshes[meshId], 128); map.set(meshId, l); }
    return l;
  }

  push(meshId, m, material) {
    const l = this._list(this.dynOpaque, meshId);
    const o = l.alloc();
    this._writeInstance(l.data, o, m, material);
  }

  pushT(meshId, m, material) {
    const l = this._list(this.dynTrans, meshId);
    const o = l.alloc();
    this._writeInstance(l.data, o, m, material);
  }

  /** kind: 0 billboard, 2 ground-aligned ring, 3 stretched tracer */
  particle(additive, x, y, z, size, r, g, b, a, rot, kind, dx, dz) {
    const p = additive ? this.pAdd : this.pAlpha;
    if (p.n >= this.pCap) return;
    const o = p.n * 12;
    const d = p.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    d[o + 8] = rot || 0; d[o + 9] = kind || 0; d[o + 10] = dx || 0; d[o + 11] = dz || 0;
    p.n++;
  }

  light(x, y, z, radius, r, g, b, intensity) {
    if (this.lights.length >= 16) {
      // keep the brightest / nearest: replace the weakest contributor
      let worst = -1, worstScore = Infinity;
      const cd = (l) => (l.i * l.rad) / (1 + dist2(l.x, l.z, this.camTarget[0], this.camTarget[2]));
      const mine = (intensity * radius) / (1 + dist2(x, z, this.camTarget[0], this.camTarget[2]));
      for (let i = 0; i < this.lights.length; i++) {
        const s = cd(this.lights[i]);
        if (s < worstScore) { worstScore = s; worst = i; }
      }
      if (mine > worstScore && worst >= 0) this.lights[worst] = { x, y, z, rad: radius, r, g, b, i: intensity };
      return;
    }
    this.lights.push({ x, y, z, rad: radius, r, g, b, i: intensity });
  }

  /* ------------------------------ frame ------------------------------ */
  begin(dt) {
    this.time += dt;
    for (const l of this.dynOpaque.values()) l.clear();
    for (const l of this.dynTrans.values()) l.clear();
    this.pAdd.n = 0; this.pAlpha.n = 0;
    this.lights.length = 0;
    this.stats.draws = 0; this.stats.instances = 0;
  }

  setCamera(pos, target, fov) {
    v3.copy(this.camPos, pos); v3.copy(this.camTarget, target);
    this.fov = fov || this.fov;
  }

  _updateMatrices() {
    const aspect = this.W / this.H;
    m4.perspective(this.proj, this.fov, aspect, 0.35, 320);
    m4.lookAt(this.view, this.camPos, this.camTarget, [0, 1, 0]);
    m4.mul(this.vp, this.proj, this.view);
    m4.invert(this.invVP, this.vp);
    m4.invert(this.invProj, this.proj);
    this._extractFrustum(this.vp, this.frustum);
  }

  _extractFrustum(m, out) {
    const p = [];
    for (let i = 0; i < 3; i++) {
      p.push([m[3] + m[i], m[7] + m[4 + i], m[11] + m[8 + i], m[15] + m[12 + i]]);
      p.push([m[3] - m[i], m[7] - m[4 + i], m[11] - m[8 + i], m[15] - m[12 + i]]);
    }
    for (let i = 0; i < 6; i++) {
      const q = p[i], l = Math.hypot(q[0], q[1], q[2]) || 1;
      out[i * 4] = q[0] / l; out[i * 4 + 1] = q[1] / l; out[i * 4 + 2] = q[2] / l; out[i * 4 + 3] = q[3] / l;
    }
  }

  _sphereVisible(c, r) {
    const f = this.frustum;
    for (let i = 0; i < 6; i++) {
      if (f[i * 4] * c[0] + f[i * 4 + 1] * c[1] + f[i * 4 + 2] * c[2] + f[i * 4 + 3] < -r) return false;
    }
    return true;
  }

  _computeLightVP() {
    const env = this.env;
    const d = v3.norm(v3.create(), v3.create(env.sunDir[0], env.sunDir[1], env.sunDir[2]));
    // focus a little ahead of the camera target so more of the view is covered
    const fx = this.camTarget[0], fy = 0, fz = this.camTarget[2];
    const E = this.shadowExtent || 34;
    const up = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const eye = v3.create(fx + d[0] * 90, fy + d[1] * 90, fz + d[2] * 90);
    const lv = m4.lookAt(m4.create(), eye, [fx, fy, fz], up);
    // snap to shadow texels — kills crawling edges as the camera moves
    const texel = (E * 2) / this.shadowSize;
    const o = v3.create(fx, fy, fz);
    const lx = lv[0] * o[0] + lv[4] * o[1] + lv[8] * o[2] + lv[12];
    const ly = lv[1] * o[0] + lv[5] * o[1] + lv[9] * o[2] + lv[13];
    const sx = Math.round(lx / texel) * texel - lx;
    const sy = Math.round(ly / texel) * texel - ly;
    const lp = m4.ortho(m4.create(), -E, E, -E, E, 1, 220);
    lp[12] += sx * (2 / (E * 2));
    lp[13] += sy * (2 / (E * 2));
    m4.mul(this.lightVP, lp, lv);
  }

  _drawStatic(which, prog) {
    const gl = this.gl;
    for (const ch of this.staticChunks.values()) {
      if (!this._sphereVisible(ch.center, ch.radius)) continue;
      for (const l of ch[which].values()) {
        this.stats.instances += l.draw();
        this.stats.draws++;
      }
    }
  }

  _drawStaticAll(which) {
    for (const ch of this.staticChunks.values()) {
      for (const l of ch[which].values()) { l.draw(); this.stats.draws++; }
    }
  }

  _drawDyn(map) {
    for (const l of map.values()) {
      if (!l.count) continue;
      l.upload();
      this.stats.instances += l.draw();
      this.stats.draws++;
    }
  }

  _fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _bindRT(rt) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt ? rt.fbo : null);
    if (rt) gl.viewport(0, 0, rt.w, rt.h);
    else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render() {
    const gl = this.gl, env = this.env, q = this.quality;
    this._updateMatrices();
    this._computeLightVP();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);          // must be writable or clear(DEPTH) is a no-op
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // upload dynamic instance data once up front (used by 3 passes)
    for (const l of this.dynOpaque.values()) if (l.count) l.upload();

    /* ---------- 1. shadow map ---------- */
    this._bindRT(this.shadowRT);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 2.0);
    {
      const p = this.progs.shadow.use();
      p.mat('uLightVP', this.lightVP).f('uTime', this.time);
      this._drawStaticAll('opaque');
      for (const l of this.dynOpaque.values()) if (l.count) { l.draw(); }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    /* ---------- 2. normal + linear depth prepass ---------- */
    this._bindRT(this.rts.nd);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    {
      const p = this.progs.prepass.use();
      p.mat('uVP', this.vp).mat('uView', this.view).f('uTime', this.time);
      this._drawStatic('opaque');
      this._drawDyn(this.dynOpaque);
    }

    /* ---------- 3. SSAO ---------- */
    if (q.ssao) {
      gl.disable(gl.DEPTH_TEST);
      this._bindRT(this.rts.ssao);
      {
        const p = this.progs.ssao.use();
        p.tex('uNormalDepth', this.rts.nd.tex)
          .mat('uProj', this.proj).mat('uInvProj', this.invProj)
          .f('uRadius', 0.85).f('uBias', 0.035).f('uIntensity', 0.95)
          .f('uTime', this.time);
        const l = p.u('uKernel[0]');
        if (l) gl.uniform3fv(l, this._ssaoKernel);
        this._fullscreen();
      }
      this._bindRT(this.rts.ssaoBlur);
      {
        const p = this.progs.blur.use();
        p.tex('uTex', this.rts.ssao.tex).v2('uTexel', 1 / this.rts.ssao.w, 1 / this.rts.ssao.h);
        this._fullscreen();
      }
      gl.enable(gl.DEPTH_TEST);
    }

    /* ---------- 4. sky ---------- */
    this._bindRT(this.rts.scene);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    {
      const p = this.progs.sky.use();
      p.mat('uInvVP', this.invVP).v3a('uCamPos', this.camPos)
        .v3a('uSunDir', env.sunDir).v3a('uSunColor', env.sunColor)
        .v3a('uSkyTop', env.skyTop).v3a('uSkyHorizon', env.skyHorizon).v3a('uGroundCol', env.groundCol)
        .f('uTime', this.time).f('uStars', env.stars).f('uCloud', env.cloud)
        .f('uFogAmt', clamp(env.fogDensity * 30, 0, 1));
      this._fullscreen();
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    /* ---------- 5. forward opaque ---------- */
    {
      const p = this.progs.scene.use();
      this._bindSceneUniforms(p);
      this._drawStatic('opaque');
      this._drawDyn(this.dynOpaque);
    }

    /* ---------- 6. transparent ---------- */
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    {
      const p = this.progs.scene.use();
      this._bindSceneUniforms(p);
      this._drawStatic('trans');
      this._drawDyn(this.dynTrans);
    }

    /* ---------- 7. particles ---------- */
    this._renderParticles();
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* ---------- 8. bloom ---------- */
    gl.disable(gl.DEPTH_TEST);
    let bloomTex = null;
    if (q.bloom && this.bloomChain.length) {
      this._bindRT(this.bloomChain[0]);
      {
        const p = this.progs.bright.use();
        p.tex('uTex', this.rts.scene.tex).f('uThreshold', 0.85).f('uSoftKnee', 0.6);
        this._fullscreen();
      }
      for (let i = 1; i < this.bloomChain.length; i++) {
        this._bindRT(this.bloomChain[i]);
        const p = this.progs.down.use();
        p.tex('uTex', this.bloomChain[i - 1].tex)
          .v2('uTexel', 1 / this.bloomChain[i - 1].w, 1 / this.bloomChain[i - 1].h);
        this._fullscreen();
      }
      const n = this.bloomChain.length;
      // seed the top of the up-chain with the smallest mip
      this._bindRT(this.bloomUp[n - 1]);
      {
        const p = this.progs.down.use();
        p.tex('uTex', this.bloomChain[n - 1].tex)
          .v2('uTexel', 1 / this.bloomChain[n - 1].w, 1 / this.bloomChain[n - 1].h);
        this._fullscreen();
      }
      for (let i = n - 2; i >= 0; i--) {
        this._bindRT(this.bloomUp[i]);
        const p = this.progs.up.use();
        p.tex('uTex', this.bloomUp[i + 1].tex).tex('uPrev', this.bloomChain[i].tex)
          .v2('uTexel', 1 / this.bloomUp[i + 1].w, 1 / this.bloomUp[i + 1].h)
          .f('uScale', 1.0);
        this._fullscreen();
      }
      bloomTex = this.bloomUp[0].tex;
    }

    /* ---------- 9. composite ---------- */
    this._bindRT(null);
    {
      const po = this.post;
      const p = this.progs.composite.use();
      p.tex('uScene', this.rts.scene.tex)
        .tex('uBloom', bloomTex || this.rts.scene.tex)
        .f('uExposure', po.exposure).f('uBloomAmt', bloomTex ? po.bloom : 0)
        .f('uVignette', po.vignette).f('uGrain', po.grain).f('uTime', this.time)
        .f('uChroma', po.chroma).f('uDamage', po.damage).f('uHeal', po.heal)
        .f('uDesat', po.desat).f('uFlashAmt', po.flashAmt)
        .f('uContrast', po.contrast).f('uSaturation', po.saturation)
        .v3a('uLift', po.lift).v3a('uGain', po.gain).v3a('uFlashColor', po.flashColor);
      this._fullscreen();
    }
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  _bindSceneUniforms(p) {
    const env = this.env;
    p.mat('uVP', this.vp).v3a('uCamPos', this.camPos)
      .v3a('uSunDir', env.sunDir).v3a('uSunColor', env.sunColor)
      .v3a('uSkyColor', env.ambient).v3a('uBounceColor', env.bounce)
      .mat('uLightVP', this.lightVP)
      .v4('uGIRect', this.giRect[0], this.giRect[1], this.giRect[2], this.giRect[3])
      .f('uGIStrength', env.giStrength == null ? 1 : env.giStrength)
      .f('uShadowTexel', 1 / this.shadowSize)
      .f('uTime', this.time)
      .f('uAOEnabled', this.quality.ssao ? 1 : 0)
      .v2('uScreenSize', this.W, this.H)
      .v3a('uFogColor', env.fogColor)
      .v2('uFog', env.fogDensity, env.fogHeight)
      .v2('uFocus', this.camTarget[0], this.camTarget[2]);
    // lights
    const n = Math.min(this.lights.length, 16);
    for (let i = 0; i < n; i++) {
      const L = this.lights[i];
      this.lightPosArr[i * 4] = L.x; this.lightPosArr[i * 4 + 1] = L.y;
      this.lightPosArr[i * 4 + 2] = L.z; this.lightPosArr[i * 4 + 3] = L.rad;
      this.lightColArr[i * 4] = L.r; this.lightColArr[i * 4 + 1] = L.g;
      this.lightColArr[i * 4 + 2] = L.b; this.lightColArr[i * 4 + 3] = L.i;
    }
    p.i('uNumLights', n);
    const gl = this.gl;
    const lp = p.u('uLightPos[0]'), lc = p.u('uLightColor[0]');
    if (lp) gl.uniform4fv(lp, this.lightPosArr);
    if (lc) gl.uniform4fv(lc, this.lightColArr);
    p.tex('uShadowMap', this.shadowRT.depth);
    p.tex('uGI', this.giTex);
    p.tex('uAO', this.quality.ssao ? this.rts.ssaoBlur.tex : this.giTex);
  }

  _renderParticles() {
    const gl = this.gl;
    const total = this.pAdd.n + this.pAlpha.n;
    if (!total) return;
    this.stats.particles = total;
    // camera basis for billboards
    const right = [this.view[0], this.view[4], this.view[8]];
    const up = [this.view[1], this.view[5], this.view[9]];
    const p = this.progs.particle.use();
    p.mat('uVP', this.vp).mat('uView', this.view)
      .v3a('uCamRight', right).v3a('uCamUp', up)
      .v2('uScreenSize', this.W, this.H)
      .f('uSoft', this.quality.soft ? 1 : 0)
      .tex('uSceneDepth', this.rts.nd.tex);
    gl.bindVertexArray(this.pVAO);
    gl.depthMask(false);
    gl.enable(gl.BLEND);

    if (this.pAlpha.n) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // premultiplied
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pInstBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pAlpha.data, 0, this.pAlpha.n * 12);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.pAlpha.n);
    }
    if (this.pAdd.n) {
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pInstBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pAdd.data, 0, this.pAdd.n * 12);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, this.pAdd.n);
    }
    gl.bindVertexArray(null);
  }

  /** Biome colours are authored as display values; the shader works in linear
      radiance. Convert once and cache on the biome env object. */
  static prepEnv(e) {
    if (e.__prepped) return e.__prepped;
    const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const o = Object.assign({}, e);
    // sunColor is irradiance E; the diffuse lobe divides by PI, so scale up
    o.sunColor = scale(e.sunColor, 3.4);
    // sky / fog are radiance shown straight through the tonemapper
    o.skyTop = scale(e.skyTop, .58);
    o.skyHorizon = scale(e.skyHorizon, .58);
    o.groundCol = scale(e.groundCol, .58);
    o.fogColor = scale(e.fogColor, .5);
    o.ambient = scale(e.ambient, .62);
    o.bounce = scale(e.bounce, .62);
    o.fogDensity = e.fogDensity * 0.62;
    e.__prepped = o;
    return o;
  }

  applyEnv(raw) {
    const e = Renderer.prepEnv(raw);
    Object.assign(this.env, e);
    this.post.exposure = e.exposure == null ? this.post.exposure : e.exposure;
    this.post.bloom = e.bloom == null ? this.post.bloom : e.bloom;
    if (e.lift) this.post.lift = e.lift;
    if (e.gain) this.post.gain = e.gain;
    if (e.desat != null) this.post.desat = e.desat;
  }
}
