/* ==========================================================================
   GLSL ES 3.00 shader sources
   Pipeline: shadow -> prepass(normal/depth) -> SSAO -> sky -> forward opaque
             -> transparent -> particles -> bloom -> composite
   ========================================================================== */

const GLSL = {};

/* shared chunk: instance attributes + vertex transform ------------------ */
const CHUNK_INSTANCE = `
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 iM0;
layout(location=4) in vec4 iM1;
layout(location=5) in vec4 iM2;
layout(location=6) in vec4 iM3;
layout(location=7) in vec4 iColor;    // rgb + roughness
layout(location=8) in vec4 iEmiss;    // rgb + metalness
layout(location=9) in vec4 iParams;   // matType, anim, aoMul, alpha
layout(location=10) in vec4 iTex;     // texId, texScale, texStrength, texOffset

mat4 instMat(){ return mat4(iM0,iM1,iM2,iM3); }

// exact normal matrix for rotation*non-uniform-scale
mat3 instNormalMat(mat4 m){
  vec3 c0=m[0].xyz, c1=m[1].xyz, c2=m[2].xyz;
  return mat3(c0/max(dot(c0,c0),1e-6), c1/max(dot(c1,c1),1e-6), c2/max(dot(c2,c2),1e-6));
}

// foliage sway + water bob applied in world space
vec3 applyMotion(vec3 wp, vec3 localPos, float matType, float anim, float time){
  if(matType > 1.5 && matType < 2.5){            // foliage
    float h = max(localPos.y + 0.5, 0.0);
    float w = sin(time*1.7 + wp.x*0.35 + wp.z*0.27) * 0.5
            + sin(time*2.9 + wp.x*0.9  - wp.z*0.6 ) * 0.22;
    wp.xz += w * h * h * 0.09 * (0.4 + anim);
  } else if(matType > 0.5 && matType < 1.5){     // water surface
    wp.y += sin(time*1.3 + wp.x*0.8) * 0.035 + sin(time*1.9 - wp.z*1.1) * 0.028;
  }
  return wp;
}
`;

/* ----------------------------- shadow pass ---------------------------- */
GLSL.shadowVS = `#version 300 es
precision highp float;
${CHUNK_INSTANCE}
uniform mat4 uLightVP;
uniform float uTime;
void main(){
  mat4 M = instMat();
  vec3 wp = (M * vec4(aPos,1.0)).xyz;
  wp = applyMotion(wp, aPos, iParams.x, iParams.y, uTime);
  gl_Position = uLightVP * vec4(wp,1.0);
}`;

GLSL.shadowFS = `#version 300 es
precision highp float;
void main(){}`;

/* ------------------------- normal/depth prepass ----------------------- */
GLSL.prepassVS = `#version 300 es
precision highp float;
${CHUNK_INSTANCE}
uniform mat4 uVP, uView;
uniform float uTime;
out vec3 vViewNormal;
out float vViewZ;
void main(){
  mat4 M = instMat();
  vec3 wp = (M * vec4(aPos,1.0)).xyz;
  wp = applyMotion(wp, aPos, iParams.x, iParams.y, uTime);
  vec3 wn = normalize(instNormalMat(M) * aNormal);
  vViewNormal = normalize(mat3(uView) * wn);
  vec4 vp = uView * vec4(wp,1.0);
  vViewZ = -vp.z;
  gl_Position = uVP * vec4(wp,1.0);
}`;

GLSL.prepassFS = `#version 300 es
precision highp float;
in vec3 vViewNormal;
in float vViewZ;
layout(location=0) out vec4 oNormalDepth;
void main(){ oNormalDepth = vec4(normalize(vViewNormal), vViewZ); }`;

/* ------------------------------- SSAO --------------------------------- */
GLSL.fullscreenVS = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vUV = p;
  gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`;

GLSL.ssaoFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uNormalDepth;
uniform mat4 uProj, uInvProj;
uniform vec2 uNoiseScale;
uniform float uRadius, uBias, uIntensity;
uniform vec3 uKernel[24];
uniform float uTime;
out vec4 oColor;

vec3 viewPosFromUV(vec2 uv, float z){
  vec4 ndc = vec4(uv*2.0-1.0, 1.0, 1.0);
  vec4 v = uInvProj * ndc;
  vec3 dir = v.xyz / v.w;
  dir /= max(-dir.z, 1e-4);
  return dir * z;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

void main(){
  vec4 nd = texture(uNormalDepth, vUV);
  float z = nd.w;
  if(z <= 0.0001 || z > 400.0){ oColor = vec4(1.0); return; }
  vec3 P = viewPosFromUV(vUV, z);
  vec3 N = normalize(nd.xyz);

  float ang = hash(gl_FragCoord.xy) * 6.2831853;
  vec3 rvec = vec3(cos(ang), sin(ang), 0.0);
  vec3 T = normalize(rvec - N * dot(rvec, N));
  vec3 B = cross(N, T);
  mat3 TBN = mat3(T, B, N);

  float occ = 0.0;
  const int SAMPLES = 16;
  for(int i=0;i<SAMPLES;i++){
    vec3 sp = TBN * uKernel[i];
    sp = P + sp * uRadius;
    vec4 off = uProj * vec4(sp,1.0);
    off.xyz /= off.w;
    vec2 suv = off.xy*0.5+0.5;
    if(suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0) continue;
    float sampleZ = texture(uNormalDepth, suv).w;
    if(sampleZ <= 0.0001) continue;
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(abs(z - sampleZ), 1e-4));
    occ += (sampleZ <= -sp.z - uBias ? 1.0 : 0.0) * rangeCheck;
  }
  float ao = 1.0 - (occ / float(SAMPLES)) * uIntensity;
  oColor = vec4(clamp(ao, 0.0, 1.0));
}`;

GLSL.blurFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 oColor;
void main(){
  float s = 0.0;
  for(int x=-2;x<=2;x++) for(int y=-2;y<=2;y++)
    s += texture(uTex, vUV + vec2(float(x),float(y))*uTexel).r;
  oColor = vec4(s/25.0);
}`;

/* -------------------------------- sky --------------------------------- */
GLSL.skyFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform mat4 uInvVP;
uniform vec3 uCamPos, uSunDir, uSunColor, uSkyTop, uSkyHorizon, uGroundCol;
uniform float uTime, uStars, uCloud, uFogAmt;
out vec4 oColor;

float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float s=0.0, a=0.5;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p*=2.03; a*=0.5; }
  return s;
}

void main(){
  vec4 far = uInvVP * vec4(vUV*2.0-1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz/far.w - uCamPos);
  float up = dir.y;

  vec3 col = mix(uSkyHorizon, uSkyTop, pow(clamp(up,0.0,1.0), 0.55));
  col = mix(col, uGroundCol, smoothstep(0.02, -0.25, up));

  // sun disc + halo
  float sd = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 900.0) * 6.0;
  col += uSunColor * pow(sd, 12.0) * 0.28;
  col += uSunColor * pow(sd, 3.0) * 0.06;

  // stars
  if(uStars > 0.001 && up > -0.02){
    vec2 sp = dir.xz / max(abs(up)+0.12, 0.02) * 34.0;
    float st = hash21(floor(sp));
    float tw = 0.6 + 0.4*sin(uTime*2.4 + st*30.0);
    col += vec3(0.85,0.9,1.0) * smoothstep(0.9955, 1.0, st) * uStars * tw * clamp(up*3.0,0.0,1.0);
  }

  // clouds
  if(uCloud > 0.001 && up > 0.005){
    vec2 cp = dir.xz / max(up, 0.04) * 0.55 + vec2(uTime*0.006, uTime*0.003);
    float c = fbm(cp*1.4);
    c = smoothstep(0.45, 0.95, c) * smoothstep(0.0, 0.22, up);
    vec3 cc = mix(uSkyHorizon*1.1, uSkyTop + uSunColor*0.35, 0.5);
    col = mix(col, cc, c * uCloud);
  }

  col = mix(col, uSkyHorizon, uFogAmt * smoothstep(0.35, -0.05, up) * 0.85);
  oColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

/* ------------------------- main forward pass -------------------------- */
GLSL.sceneVS = `#version 300 es
precision highp float;
${CHUNK_INSTANCE}
uniform mat4 uVP;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec4 vColor;
out vec4 vEmiss;
out vec4 vParams;
out vec4 vTex;
out vec3 vLocal;
void main(){
  mat4 M = instMat();
  vec3 wp = (M * vec4(aPos,1.0)).xyz;
  wp = applyMotion(wp, aPos, iParams.x, iParams.y, uTime);
  vWorld = wp;
  vLocal = aPos;
  vNormal = normalize(instNormalMat(M) * aNormal);
  vUV = aUV;
  vColor = iColor; vEmiss = iEmiss; vParams = iParams; vTex = iTex;
  gl_Position = uVP * vec4(wp,1.0);
}`;

GLSL.sceneFS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec4 vColor;
in vec4 vEmiss;
in vec4 vParams;
in vec4 vTex;
in vec3 vLocal;

uniform vec3 uCamPos;
uniform vec3 uSunDir, uSunColor;
uniform vec3 uSkyColor, uBounceColor;
uniform mat4 uLightVP;
uniform sampler2DShadow uShadowMap;
uniform sampler2D uGI;         // rgb = bounced irradiance, a = sky visibility
uniform sampler2D uAO;
uniform vec4 uGIRect;          // originX, originZ, 1/sizeX, 1/sizeZ
uniform float uGIStrength, uShadowTexel, uTime, uAOEnabled, uDetail;
uniform vec2 uScreenSize;
uniform vec3 uFogColor;
uniform vec2 uFog;             // density, heightFalloff
uniform vec2 uFocus;           // camera look-at in XZ; fog radiates from here
uniform int uNumLights;
uniform vec4 uLightPos[16];    // xyz + radius
uniform vec4 uLightColor[16];  // rgb + intensity

layout(location=0) out vec4 oColor;

const float PI = 3.14159265;

float hash31(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n000=hash31(i), n100=hash31(i+vec3(1,0,0)), n010=hash31(i+vec3(0,1,0)), n110=hash31(i+vec3(1,1,0));
  float n001=hash31(i+vec3(0,0,1)), n101=hash31(i+vec3(1,0,1)), n011=hash31(i+vec3(0,1,1)), n111=hash31(i+vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}

/* ======================================================================
   Procedural surface detail.
   Patterns are evaluated in world space and projected on the dominant
   axis, so the same brick or plank size holds no matter how an instance
   is scaled, and neighbouring instances line up into continuous walls.
   Each pattern gives a height (differenced into a normal perturbation)
   and a brightness/roughness multiplier layered over the biome colour.
   ====================================================================== */
float th21(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p,p+19.19); return fract(p.x*p.y); }
vec2 th22(vec2 p){ return vec2(th21(p), th21(p+19.73)); }
float tvn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(th21(i), th21(i+vec2(1,0)), f.x),
             mix(th21(i+vec2(0,1)), th21(i+vec2(1,1)), f.x), f.y);
}
float tfbm(vec2 p){
  float s=0.0, a=0.5;
  for(int i=0;i<3;i++){ s += a*tvn(p); p*=2.07; a*=0.5; }
  return s;
}
// running-bond cell: bricks are twice as long as they are tall
vec2 brickCell(vec2 uv, out vec2 f){
  vec2 b = vec2(uv.x*0.5, uv.y);
  b.x += mod(floor(b.y), 2.0)*0.5;
  f = fract(b);
  return floor(b);
}

float dTexH(int id, vec2 uv){
  if(id==1){                                    // brick
    vec2 f; brickCell(uv, f);
    float m = smoothstep(0.0,0.07,f.x)*smoothstep(1.0,0.93,f.x)
            * smoothstep(0.0,0.13,f.y)*smoothstep(1.0,0.87,f.y);
    return m*0.8 + tvn(uv*9.0)*0.2;
  }
  if(id==2){                                    // planks
    float f = fract(uv.y);
    float seam = smoothstep(0.0,0.08,f)*smoothstep(1.0,0.92,f);
    float grain = tvn(vec2(uv.x*2.5, floor(uv.y)*13.0 + uv.y*2.0));
    float knot = smoothstep(0.88,1.0, tvn(vec2(uv.x*0.7, floor(uv.y)*5.0)));
    return seam*0.72 + grain*0.28 - knot*0.4;
  }
  if(id==3){                                    // concrete: blotches + cracks
    float n = tfbm(uv*1.5);
    float cr = 1.0 - smoothstep(0.0,0.06, abs(tfbm(uv*0.85+11.3)-0.5));
    return n - cr*0.55;
  }
  if(id==4){                                    // metal panels + rivets
    vec2 f = fract(uv);
    float seam = smoothstep(0.0,0.05,f.x)*smoothstep(1.0,0.95,f.x)
               * smoothstep(0.0,0.05,f.y)*smoothstep(1.0,0.95,f.y);
    vec2 r = abs(f-0.5)*2.0;
    float rv = 1.0 - smoothstep(0.09,0.15, length(max(r-0.74, 0.0)));
    return seam*0.78 + rv*0.32 + tvn(vec2(uv.x*34.0, uv.y*2.0))*0.1;
  }
  if(id==5){                                    // tiles
    vec2 f = fract(uv);
    float g = smoothstep(0.0,0.055,f.x)*smoothstep(1.0,0.945,f.x)
            * smoothstep(0.0,0.055,f.y)*smoothstep(1.0,0.945,f.y);
    return g*0.84 + tvn(uv*13.0)*0.16;
  }
  if(id==6){                                    // grit / gravel ground
    return tfbm(uv*2.2)*0.62 + tvn(uv*7.0)*0.38;
  }
  if(id==7){                                    // foliage mottle
    return tvn(uv*6.0)*0.55 + tvn(uv*17.0)*0.45;
  }
  if(id==8){                                    // irregular stone blocks
    vec2 c = floor(uv), f = fract(uv);
    vec2 j = th22(c)*0.3 - 0.15;
    vec2 d = abs(f-0.5-j);
    return smoothstep(0.5,0.4, max(d.x,d.y))*0.8 + tvn(uv*8.0)*0.2;
  }
  return 0.0;
}

// brightness multiplier + roughness multiplier
float dTexTint(int id, vec2 uv, out float rmul){
  rmul = 1.0;
  if(id==1){
    vec2 f; vec2 c = brickCell(uv, f);
    float m = smoothstep(0.0,0.07,f.x)*smoothstep(1.0,0.93,f.x)
            * smoothstep(0.0,0.13,f.y)*smoothstep(1.0,0.87,f.y);
    float brick = 0.72 + th21(c)*0.55;
    rmul = mix(1.22, 0.92, m);
    return mix(1.18, brick, m);                 // mortar is paler and rougher
  }
  if(id==2){
    float p = floor(uv.y);
    float f = fract(uv.y);
    float seam = smoothstep(0.0,0.08,f)*smoothstep(1.0,0.92,f);
    float plank = 0.78 + th21(vec2(p,3.0))*0.42;
    float grain = 0.86 + tvn(vec2(uv.x*2.5, p*13.0))*0.28;
    rmul = mix(1.15, 0.95, seam);
    return mix(0.6, plank*grain, seam);
  }
  if(id==3){
    float n = tfbm(uv*1.5);
    float cr = 1.0 - smoothstep(0.0,0.06, abs(tfbm(uv*0.85+11.3)-0.5));
    rmul = 1.0 + cr*0.22;
    return (0.88 + n*0.24) * (1.0 - cr*0.30);
  }
  if(id==4){
    vec2 f = fract(uv);
    vec2 r = abs(f-0.5)*2.0;
    float rv = 1.0 - smoothstep(0.09,0.15, length(max(r-0.74, 0.0)));
    float seam = smoothstep(0.0,0.05,f.x)*smoothstep(1.0,0.95,f.x)
               * smoothstep(0.0,0.05,f.y)*smoothstep(1.0,0.95,f.y);
    float panel = 0.86 + th21(floor(uv))*0.26;
    float brush = 0.92 + tvn(vec2(uv.x*34.0, uv.y*2.0))*0.16;
    rmul = mix(1.1, 0.82, seam) * (1.0 - rv*0.25);
    return mix(0.55, panel*brush, seam) + rv*0.22;
  }
  if(id==5){
    vec2 f = fract(uv);
    float g = smoothstep(0.0,0.055,f.x)*smoothstep(1.0,0.945,f.x)
            * smoothstep(0.0,0.055,f.y)*smoothstep(1.0,0.945,f.y);
    float tile = 0.84 + th21(floor(uv))*0.34;
    rmul = mix(1.3, 0.78, g);
    return mix(0.72, tile, g);
  }
  if(id==6){
    float n = tfbm(uv*2.2);
    rmul = 1.04 + n*0.08;
    return 0.84 + n*0.32;
  }
  if(id==7){
    float n = tvn(uv*6.0)*0.6 + tvn(uv*17.0)*0.4;
    rmul = 1.0;
    return 0.7 + n*0.62;
  }
  if(id==8){
    vec2 c = floor(uv), f = fract(uv);
    vec2 j = th22(c)*0.3 - 0.15;
    vec2 d = abs(f-0.5-j);
    float m = smoothstep(0.5,0.4, max(d.x,d.y));
    rmul = mix(1.2, 0.95, m);
    return mix(1.1, 0.7 + th21(c)*0.6, m);
  }
  return 1.0;
}

float D_GGX(float NoH, float a){
  float a2 = a*a;
  float d = NoH*NoH*(a2-1.0)+1.0;
  return a2 / max(PI*d*d, 1e-5);
}
float V_Smith(float NoV, float NoL, float a){
  float k = a*0.5;
  float gv = NoV*(1.0-k)+k;
  float gl = NoL*(1.0-k)+k;
  return 0.25 / max(gv*gl, 1e-4);
}
vec3 F_Schlick(vec3 f0, float u){ return f0 + (1.0-f0)*pow(1.0-u, 5.0); }

float sampleShadow(vec3 wp, float NoL){
  vec4 lp = uLightVP * vec4(wp, 1.0);
  vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
  if(pc.x<0.0||pc.x>1.0||pc.y<0.0||pc.y>1.0||pc.z>0.999) return 1.0;
  float bias = mix(0.0016, 0.00035, NoL);
  pc.z -= bias;
  float s = 0.0;
  // 5-tap poisson PCF
  const vec2 P[5] = vec2[5](vec2(0.0,0.0), vec2(0.94,0.19), vec2(-0.72,0.61), vec2(-0.35,-0.87), vec2(0.51,-0.72));
  for(int i=0;i<5;i++) s += texture(uShadowMap, vec3(pc.xy + P[i]*uShadowTexel*1.4, pc.z));
  s /= 5.0;
  // dissolve toward "lit" at the edge of the map, otherwise the boundary
  // draws a hard rectangle across the ground
  vec2 ec = abs(pc.xy - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.80, 0.99, max(ec.x, ec.y));
  return mix(1.0, s, edge);
}

void main(){
  float matType = vParams.x;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);

  vec3 albedo = vColor.rgb;
  float rough = clamp(vColor.a, 0.045, 1.0);
  float metal = clamp(vEmiss.a, 0.0, 1.0);
  vec3 emissive = vEmiss.rgb;
  float alpha = vParams.w;

  // ---- procedural surface detail ----
  float grain = vnoise3(vWorld * 3.1) * 0.5 + vnoise3(vWorld * 13.0) * 0.5;
  albedo *= 0.9 + grain * 0.2;
  rough = clamp(rough * (0.92 + grain * 0.16), 0.045, 1.0);

  int texId = int(vTex.x + 0.5);
  if(texId > 0 && uDetail > 0.5){
    // project on the dominant axis so scale is world-consistent
    vec3 an = abs(N);
    vec2 uv; vec3 Tt, Bt;
    if(an.y >= an.x && an.y >= an.z){ uv = vWorld.xz; Tt = vec3(1,0,0); Bt = vec3(0,0,1); }
    else if(an.x >= an.z){ uv = vWorld.zy; Tt = vec3(0,0,1); Bt = vec3(0,1,0); }
    else { uv = vWorld.xy; Tt = vec3(1,0,0); Bt = vec3(0,1,0); }
    uv = uv * vTex.y + vTex.w;

    // Procedural patterns have no mip chain, so they alias hard once a cell
    // shrinks below a pixel. Measure the on-screen cell size and dissolve the
    // pattern back to flat before it can shimmer.
    float cellPx = max(fwidth(uv.x), fwidth(uv.y));
    float fade = 1.0 - smoothstep(0.30, 0.85, cellPx);

    if(fade > 0.01){
      float rmul;
      float tint = dTexTint(texId, uv, rmul);
      albedo *= mix(1.0, tint, fade);
      rough = clamp(rough * mix(1.0, rmul, fade), 0.045, 1.0);

      // finite-difference the height field into a normal perturbation
      float e = 0.45;
      float h0 = dTexH(texId, uv);
      float hx = dTexH(texId, uv + vec2(e, 0.0));
      float hy = dTexH(texId, uv + vec2(0.0, e));
      vec2 g2 = vec2(hx - h0, hy - h0) / e;
      N = normalize(N - (Tt*g2.x + Bt*g2.y) * vTex.z * fade);
    }
  }

  if(matType > 0.5 && matType < 1.5){          // water: animated ripple normal
    float w1 = sin(vWorld.x*2.2 + uTime*1.6) * cos(vWorld.z*1.9 - uTime*1.1);
    float w2 = sin((vWorld.x+vWorld.z)*3.7 - uTime*2.3);
    N = normalize(N + vec3(w1*0.16 + w2*0.07, 0.0, w2*0.15 - w1*0.06));
    rough = 0.07; metal = 0.15;
  } else if(matType > 2.5 && matType < 3.5){   // emissive panel / glass: fresnel glow
    float fr = pow(1.0 - max(dot(N,V),0.0), 3.0);
    emissive += vEmiss.rgb * fr * 1.6;
    rough = 0.12;
  } else if(matType > 3.5 && matType < 4.5){   // decal: flat, unlit-ish, soft edge
    float r = length(vLocal.xz) * 2.0;
    alpha *= smoothstep(1.0, 0.35, r);
    rough = 0.9;
  }

  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 diffAlb = albedo * (1.0 - metal);

  // ---------- indirect: baked irradiance grid + hemisphere ----------
  vec2 gi_uv = (vWorld.xz - uGIRect.xy) * uGIRect.zw;
  vec4 gi = texture(uGI, clamp(gi_uv, vec2(0.002), vec2(0.998)));
  float skyVis = gi.a;

  float ao = 1.0;
  if(uAOEnabled > 0.5){
    ao = texture(uAO, gl_FragCoord.xy / uScreenSize).r;
  }
  ao = clamp(ao * vParams.z, 0.0, 1.0);

  // hemisphere split: up gets sky, down gets ground bounce
  float hemi = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uBounceColor, uSkyColor, hemi) * mix(0.35, 1.0, skyVis);
  ambient += gi.rgb * uGIStrength;
  vec3 indirect = ambient * diffAlb * ao;

  // cheap ambient specular (horizon-occluded)
  float NoV = max(dot(N,V), 1e-4);
  vec3 R = reflect(-V, N);
  vec3 specIBL = mix(uBounceColor, uSkyColor, R.y*0.5+0.5) * mix(0.35, 1.0, skyVis);
  vec3 fEnv = F_Schlick(f0, NoV) * (1.0 - rough * 0.85);
  indirect += specIBL * fEnv * ao * (0.5 + 0.5 * skyVis);

  // ---------------------- direct sun ----------------------
  vec3 L = normalize(uSunDir);
  float NoL = max(dot(N, L), 0.0);
  vec3 direct = vec3(0.0);
  if(NoL > 0.0 && skyVis > 0.02){
    float sh = sampleShadow(vWorld, NoL);
    vec3 H = normalize(L + V);
    float NoH = max(dot(N,H), 0.0);
    float VoH = max(dot(V,H), 0.0);
    float a = rough*rough;
    vec3 spec = min(F_Schlick(f0, VoH) * D_GGX(NoH, a) * V_Smith(NoV, NoL, a), vec3(12.0));
    direct += (diffAlb/PI + spec) * uSunColor * NoL * sh * skyVis;
  }

  // ---------------------- dynamic point lights ----------------------
  for(int i=0;i<16;i++){
    if(i >= uNumLights) break;
    vec3 dv = uLightPos[i].xyz - vWorld;
    float d2 = dot(dv,dv);
    float rad = uLightPos[i].w;
    if(d2 > rad*rad) continue;
    float d = sqrt(max(d2, 1e-6));
    vec3 Lp = dv / d;
    float nl = max(dot(N, Lp), 0.0);
    if(nl <= 0.0) continue;
    float att = clamp(1.0 - d/rad, 0.0, 1.0);
    att = att*att;
    vec3 H = normalize(Lp + V);
    float NoH = max(dot(N,H),0.0);
    float VoH = max(dot(V,H),0.0);
    float a = rough*rough;
    vec3 spec = min(F_Schlick(f0, VoH) * D_GGX(NoH, a) * V_Smith(NoV, nl, a), vec3(12.0));
    direct += (diffAlb/PI + spec) * uLightColor[i].rgb * uLightColor[i].a * nl * att;
  }

  vec3 color = indirect + direct + emissive;

  // ---------------------- fog ----------------------
  // A top-down camera sits the same distance from everything, so camera-range
  // fog just veils the whole frame. Fog from the *focus point* outward instead:
  // it keeps the fight readable and hazes the edges of the screen.
  float dist = max(length(vWorld.xz - uFocus) - 20.0, 0.0);
  float heightFactor = exp(-max(vWorld.y, 0.0) * uFog.y);
  float fogAmt = 1.0 - exp(-dist * uFog.x * heightFactor);
  vec3 fogCol = uFogColor * mix(0.55, 1.0, skyVis);
  // never fully swallow the edges of the screen — the player still has
  // to read what is walking in from off-camera
  color = mix(color, fogCol, clamp(fogAmt, 0.0, 0.72));

  oColor = vec4(color, alpha);
}`;

/* ---------------------------- particles ------------------------------- */
GLSL.particleVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;      // -0.5..0.5 quad
layout(location=1) in vec4 iPosSize;     // xyz + size
layout(location=2) in vec4 iColor;       // rgb + alpha
layout(location=3) in vec4 iExtra;       // rot, kind, stretchX, stretchZ
uniform mat4 uVP, uView;
uniform vec3 uCamRight, uCamUp;
out vec4 vColor;
out vec2 vUV;
out float vKind;
out float vViewZ;
void main(){
  vec2 c = aCorner;
  float rot = iExtra.x;
  float cs = cos(rot), sn = sin(rot);
  vec2 rc = vec2(c.x*cs - c.y*sn, c.x*sn + c.y*cs);
  vec3 right = uCamRight, up = uCamUp;
  vec3 wp;
  if(iExtra.y > 1.5 && iExtra.y < 2.5){
    // ground-aligned quad (decals, shockwave rings, magic circles)
    wp = iPosSize.xyz + vec3(rc.x, 0.0, rc.y) * iPosSize.w;
  } else if(iExtra.y > 2.5){
    // world-space stretched tracer along a direction
    vec3 dir = normalize(vec3(iExtra.z, 0.0, iExtra.w) + vec3(1e-5));
    vec3 side = normalize(cross(dir, vec3(0.0,1.0,0.0)));
    wp = iPosSize.xyz + dir * (c.y * iPosSize.w * 6.0) + side * (c.x * iPosSize.w);
  } else {
    wp = iPosSize.xyz + (right * rc.x + up * rc.y) * iPosSize.w;
  }
  vColor = iColor; vUV = aCorner + 0.5; vKind = iExtra.y;
  vec4 vp = uView * vec4(wp,1.0);
  vViewZ = -vp.z;
  gl_Position = uVP * vec4(wp,1.0);
}`;

GLSL.particleFS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUV;
in float vKind;
in float vViewZ;
uniform sampler2D uSceneDepth;   // normal+depth rt, .w = viewZ
uniform vec2 uScreenSize;
uniform float uSoft;
layout(location=0) out vec4 oColor;
void main(){
  vec2 d = vUV - 0.5;
  float r = length(d) * 2.0;
  float a = vColor.a;
  if(vKind > 1.5 && vKind < 2.5){
    // ring / magic circle: bright rim
    float ring = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.86, r);
    float core = smoothstep(1.0, 0.0, r) * 0.35;
    a *= max(ring, core);
  } else {
    a *= smoothstep(1.0, 0.06, r);
  }
  if(a <= 0.003) discard;
  // soft particles: fade where they intersect geometry
  if(uSoft > 0.5){
    float sceneZ = texture(uSceneDepth, gl_FragCoord.xy/uScreenSize).w;
    if(sceneZ > 0.0001) a *= clamp((sceneZ - vViewZ) * 1.6, 0.0, 1.0);
  }
  oColor = vec4(vColor.rgb * a, a);
}`;

/* ------------------------------ bloom --------------------------------- */
GLSL.brightFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uThreshold, uSoftKnee;
out vec4 oColor;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uSoftKnee + 1e-5;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0*knee);
  soft = soft*soft/(4.0*knee);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  oColor = vec4(c * contrib, 1.0);
}`;

GLSL.downFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 oColor;
void main(){
  vec3 a = texture(uTex, vUV + uTexel*vec2(-1,-1)).rgb;
  vec3 b = texture(uTex, vUV + uTexel*vec2( 1,-1)).rgb;
  vec3 c = texture(uTex, vUV + uTexel*vec2(-1, 1)).rgb;
  vec3 d = texture(uTex, vUV + uTexel*vec2( 1, 1)).rgb;
  vec3 e = texture(uTex, vUV).rgb;
  oColor = vec4((a+b+c+d)*0.2 + e*0.2, 1.0);
}`;

GLSL.upFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex, uPrev;
uniform vec2 uTexel;
uniform float uScale;
out vec4 oColor;
void main(){
  // 3x3 tent filter upsample, additive
  vec3 s = vec3(0.0);
  s += texture(uTex, vUV + uTexel*vec2(-1,-1)).rgb * 1.0;
  s += texture(uTex, vUV + uTexel*vec2( 0,-1)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel*vec2( 1,-1)).rgb * 1.0;
  s += texture(uTex, vUV + uTexel*vec2(-1, 0)).rgb * 2.0;
  s += texture(uTex, vUV).rgb * 4.0;
  s += texture(uTex, vUV + uTexel*vec2( 1, 0)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel*vec2(-1, 1)).rgb * 1.0;
  s += texture(uTex, vUV + uTexel*vec2( 0, 1)).rgb * 2.0;
  s += texture(uTex, vUV + uTexel*vec2( 1, 1)).rgb * 1.0;
  s /= 16.0;
  oColor = vec4(texture(uPrev, vUV).rgb + s*uScale, 1.0);
}`;

/* ---------------------------- composite ------------------------------- */
GLSL.compositeFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uExposure, uBloomAmt, uVignette, uGrain, uTime;
uniform float uChroma, uDamage, uHeal, uDesat, uFlashAmt;
uniform float uContrast, uSaturation;
uniform vec3 uLift, uGain, uFlashColor;
out vec4 oColor;

// ACES filmic approximation (Narkowicz)
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
float hash12(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p+19.19); return fract(p.x*p.y); }

void main(){
  vec2 uv = vUV;
  vec2 fromCenter = uv - 0.5;
  float r2 = dot(fromCenter, fromCenter);

  // barrel-ish chromatic aberration, stronger at edges & when hurt
  float ca = (0.0007 + uChroma * 0.012) * (0.25 + r2*3.0);
  vec3 col;
  col.r = texture(uScene, uv - fromCenter*ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv + fromCenter*ca).b;

  col += texture(uBloom, uv).rgb * uBloomAmt;
  col *= uExposure;
  col = aces(col);
  // linear -> sRGB for display
  col = pow(max(col, vec3(0.0)), vec3(1.0/2.2));

  // grade: contrast about mid-grey, then saturation, then biome lift/gain
  col = (col - 0.5) * uContrast + 0.5;
  float lum0 = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(lum0), col, uSaturation);
  col = clamp(col * uGain + uLift, 0.0, 1.4);
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(col, vec3(lum), uDesat);

  // damage / heal / pickup screen tints
  col = mix(col, vec3(lum*0.55 + 0.45, lum*0.06, lum*0.05), uDamage*0.72);
  col = mix(col, vec3(lum*0.15, lum*0.6+0.35, lum*0.28), uHeal*0.45);
  col = mix(col, uFlashColor, uFlashAmt);

  // vignette
  float vig = smoothstep(0.95, 0.28, r2*1.9);
  col *= mix(1.0, vig, uVignette);

  // film grain
  float g = hash12(gl_FragCoord.xy + fract(uTime)*vec2(37.0,17.0));
  col += (g - 0.5) * uGrain;

  oColor = vec4(max(col, vec3(0.0)), 1.0);
}`;
