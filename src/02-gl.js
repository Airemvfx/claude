/* ==========================================================================
   WebGL2 helpers: program compilation, render targets, procedural meshes
   ========================================================================== */

function compileShader(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error(`[${name}] shader compile failed:\n${log}\n${lines}`);
  }
  return s;
}

class Program {
  constructor(gl, vsSrc, fsSrc, name) {
    this.gl = gl; this.name = name;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, name + '.vs');
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.fs');
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[${name}] link failed: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.p = p;
    this.loc = Object.create(null);
    this.texUnit = 0;
  }
  use() { this.gl.useProgram(this.p); this.texUnit = 0; return this; }
  u(n) {
    let l = this.loc[n];
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, n); this.loc[n] = l; }
    return l;
  }
  f(n, v) { const l = this.u(n); if (l) this.gl.uniform1f(l, v); return this; }
  i(n, v) { const l = this.u(n); if (l) this.gl.uniform1i(l, v); return this; }
  v2(n, x, y) { const l = this.u(n); if (l) this.gl.uniform2f(l, x, y); return this; }
  v3(n, x, y, z) { const l = this.u(n); if (l) this.gl.uniform3f(l, x, y, z); return this; }
  v3a(n, a) { const l = this.u(n); if (l) this.gl.uniform3f(l, a[0], a[1], a[2]); return this; }
  v4(n, x, y, z, w) { const l = this.u(n); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  mat(n, m) { const l = this.u(n); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  v3arr(n, arr) { const l = this.u(n); if (l) this.gl.uniform3fv(l, arr); return this; }
  v4arr(n, arr) { const l = this.u(n); if (l) this.gl.uniform4fv(l, arr); return this; }
  tex(n, texture, target) {
    const gl = this.gl, l = this.u(n);
    if (!l) return this;
    const unit = this.texUnit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target || gl.TEXTURE_2D, texture);
    gl.uniform1i(l, unit);
    return this;
  }
}

/* ------------------------- render targets ----------------------------- */
function createRT(gl, w, h, opt = {}) {
  const rt = { w, h, fbo: gl.createFramebuffer(), tex: null, depth: null, opt };
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
  if (opt.color !== false) {
    rt.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rt.tex);
    const internal = opt.float ? gl.RGBA16F : gl.RGBA8;
    const type = opt.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null);
    const filt = opt.nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.tex, 0);
  } else {
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
  }
  if (opt.depth) {
    if (opt.depthTexture) {
      rt.depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rt.depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (opt.compare) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      }
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, rt.depth, 0);
    } else {
      rt.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rt.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rt.rb);
    }
  }
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('FBO incomplete', st.toString(16), opt);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return rt;
}

function destroyRT(gl, rt) {
  if (!rt) return;
  if (rt.tex) gl.deleteTexture(rt.tex);
  if (rt.depth) gl.deleteTexture(rt.depth);
  if (rt.rb) gl.deleteRenderbuffer(rt.rb);
  gl.deleteFramebuffer(rt.fbo);
}

/* ============================ geometry ================================= */
/* Every mesh: interleaved [px,py,pz, nx,ny,nz, u,v] + uint16 indices.
   Local space is normalised so instances scale it to any size.          */

function geoBox() {
  const v = [], idx = [];
  const faces = [
    { n: [0, 0, 1], p: [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]] },
    { n: [0, 0, -1], p: [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]] },
    { n: [1, 0, 0], p: [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]] },
    { n: [-1, 0, 0], p: [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]] },
    { n: [0, 1, 0], p: [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]] },
    { n: [0, -1, 0], p: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]] },
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  faces.forEach((f, fi) => {
    f.p.forEach((p, i) => v.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], uvs[i][0], uvs[i][1]));
    const b = fi * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

function geoCylinder(seg = 12, capped = true, taper = 1) {
  const v = [], idx = [];
  const push = (p, n, uv) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]);
  // side
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, a = t * TAU;
    const c = Math.cos(a), s = Math.sin(a);
    push([c * .5, -.5, s * .5], [c, 0, s], [t, 0]);
    push([c * .5 * taper, .5, s * .5 * taper], [c, 0, s], [t, 1]);
  }
  for (let i = 0; i < seg; i++) {
    const b = i * 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  if (capped) {
    for (const [y, ny, rad] of [[.5, 1, .5 * taper], [-.5, -1, .5]]) {
      const base = v.length / 8;
      push([0, y, 0], [0, ny, 0], [.5, .5]);
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * TAU, c = Math.cos(a), s = Math.sin(a);
        push([c * rad, y, s * rad], [0, ny, 0], [c * .5 + .5, s * .5 + .5]);
      }
      for (let i = 0; i < seg; i++) {
        if (ny > 0) idx.push(base, base + 1 + i, base + 2 + i);
        else idx.push(base, base + 2 + i, base + 1 + i);
      }
    }
  }
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

function geoSphere(subdiv = 2) {
  // icosahedron -> subdivide -> normalise
  const t = (1 + Math.sqrt(5)) / 2;
  let pts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(p => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  let tris = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map(), out = [];
    const mid = (a, b) => {
      const k = a < b ? a + ',' + b : b + ',' + a;
      if (cache.has(k)) return cache.get(k);
      const p = [(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2, (pts[a][2] + pts[b][2]) / 2];
      const l = Math.hypot(...p);
      pts.push([p[0] / l, p[1] / l, p[2] / l]);
      const i = pts.length - 1; cache.set(k, i); return i;
    };
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      out.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    tris = out;
  }
  const v = [];
  for (const p of pts) {
    const u = Math.atan2(p[2], p[0]) / TAU + .5, vv = Math.asin(clamp(p[1], -1, 1)) / Math.PI + .5;
    v.push(p[0] * .5, p[1] * .5, p[2] * .5, p[0], p[1], p[2], u, vv);
  }
  const idx = [];
  for (const t2 of tris) idx.push(t2[0], t2[1], t2[2]);
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

function geoPlane(seg = 1, flipUp = true) {
  const v = [], idx = [];
  for (let z = 0; z <= seg; z++) for (let x = 0; x <= seg; x++) {
    const u = x / seg, w = z / seg;
    v.push(u - .5, 0, w - .5, 0, flipUp ? 1 : -1, 0, u, w);
  }
  for (let z = 0; z < seg; z++) for (let x = 0; x < seg; x++) {
    const a = z * (seg + 1) + x, b = a + 1, c = a + seg + 1, d = c + 1;
    if (flipUp) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  }
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

/** wedge / triangular prism — rubble, roof shards, rocks */
function geoPrism() {
  const v = [], idx = [];
  const push = (p, n) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], p[0] + .5, p[2] + .5);
  const s = 1 / Math.SQRT2;
  // slope
  push([-.5, -.5, .5], [0, s, s]); push([.5, -.5, .5], [0, s, s]);
  push([.5, .5, -.5], [0, s, s]); push([-.5, .5, -.5], [0, s, s]);
  idx.push(0, 1, 2, 0, 2, 3);
  // back
  push([-.5, -.5, -.5], [0, 0, -1]); push([.5, -.5, -.5], [0, 0, -1]);
  push([.5, .5, -.5], [0, 0, -1]); push([-.5, .5, -.5], [0, 0, -1]);
  idx.push(5, 4, 7, 5, 7, 6);
  // bottom
  push([-.5, -.5, -.5], [0, -1, 0]); push([.5, -.5, -.5], [0, -1, 0]);
  push([.5, -.5, .5], [0, -1, 0]); push([-.5, -.5, .5], [0, -1, 0]);
  idx.push(8, 9, 10, 8, 10, 11);
  // sides
  push([.5, -.5, .5], [1, 0, 0]); push([.5, -.5, -.5], [1, 0, 0]); push([.5, .5, -.5], [1, 0, 0]);
  idx.push(12, 13, 14);
  push([-.5, -.5, -.5], [-1, 0, 0]); push([-.5, -.5, .5], [-1, 0, 0]); push([-.5, .5, -.5], [-1, 0, 0]);
  idx.push(15, 16, 17);
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

/** octahedron — crystals, gems, magic motes */
function geoOcta() {
  const p = [[0, .5, 0], [0, -.5, 0], [.5, 0, 0], [-.5, 0, 0], [0, 0, .5], [0, 0, -.5]];
  const tris = [[0, 4, 2], [0, 2, 5], [0, 5, 3], [0, 3, 4], [1, 2, 4], [1, 5, 2], [1, 3, 5], [1, 4, 3]];
  const v = [], idx = [];
  tris.forEach((t, i) => {
    const a = p[t[0]], b = p[t[1]], c = p[t[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    [a, b, c].forEach((q, k) => v.push(q[0], q[1], q[2], nx, ny, nz, k === 1 ? 1 : 0, k === 2 ? 1 : 0));
    idx.push(i * 3, i * 3 + 1, i * 3 + 2);
  });
  return { verts: new Float32Array(v), idx: new Uint16Array(idx) };
}

const INSTANCE_FLOATS = 32;   // mat4(16) + color4 + emiss4 + params4 + tex4

class Mesh {
  constructor(gl, geo, name) {
    this.gl = gl; this.name = name;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, geo.verts, gl.STATIC_DRAW);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    this.count = geo.idx.length;
    let r = 0;
    for (let i = 0; i < geo.verts.length; i += 8) {
      r = Math.max(r, Math.hypot(geo.verts[i], geo.verts[i + 1], geo.verts[i + 2]));
    }
    this.radius = r;
  }
  /** build a VAO that reads this mesh + a given instance buffer */
  makeVAO(instBuf) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const S = 8 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const IS = INSTANCE_FLOATS * 4;
    for (let i = 0; i < 8; i++) {
      const loc = 3 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, IS, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
    return vao;
  }
}

/** growable CPU-side instance list that mirrors into a GL buffer */
class InstanceList {
  constructor(gl, mesh, capacity = 256) {
    this.gl = gl; this.mesh = mesh;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.count = 0;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    this.gpuCapacity = capacity;
    this.vao = mesh.makeVAO(this.buf);
    this.dirty = false;
  }
  clear() { this.count = 0; }
  reserve(n) {
    const need = (this.count + n) * INSTANCE_FLOATS;
    if (need <= this.data.length) return;
    let cap = Math.max(this.data.length * 2, need);
    const nd = new Float32Array(cap);
    nd.set(this.data);
    this.data = nd;
  }
  /** returns the write offset; caller fills 28 floats */
  alloc() {
    this.reserve(1);
    const o = this.count * INSTANCE_FLOATS;
    this.count++;
    this.dirty = true;
    return o;
  }
  upload(usage) {
    const gl = this.gl;
    if (this.count === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const needed = this.count * INSTANCE_FLOATS;
    if (needed > this.gpuCapacity * INSTANCE_FLOATS) {
      this.gpuCapacity = Math.ceil(this.data.length / INSTANCE_FLOATS);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, usage || gl.DYNAMIC_DRAW);
      gl.deleteVertexArray(this.vao);
      this.vao = this.mesh.makeVAO(this.buf);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, needed);
    this.dirty = false;
  }
  draw() {
    if (this.count === 0) return 0;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.mesh.count, gl.UNSIGNED_SHORT, 0, this.count);
    return this.count;
  }
  destroy() {
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteVertexArray(this.vao);
  }
}
