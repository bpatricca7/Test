// The Visitor: GLSL. Output is linear HDR (the composer's OutputPass tone-maps).
// The skin and eyes use premultiplied blending (rgb is light added, alpha is
// how much of the room it blocks) after a depth pre-pass, so the hologram is
// see-through but never shows its own far side.

export const COMMON = /* glsl */`
uniform float uTime;
uniform float uFlicker;
uniform float uFlick;        // per-frame brightness jitter (CPU, deterministic)
uniform float uPresence;
uniform float uBuildY;       // materialize: height of the assembly front (object space)
uniform float uBuildBand;
uniform float uVoxAmt;       // global voxel look 0..1
uniform float uVoxQ;         // vertex snapping amount
uniform float uDissT;        // dissolve front along uDissD (object space)
uniform float uDissBand;
uniform vec3 uDissO;
uniform vec3 uDissD;
#define VOX 0.017

float hash13(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

uniform float uRevealOn;     // 0 when fully formed and not dissolving: skip the voxel logic
// x: keep (>= 0 visible), y: voxel amount
vec2 reveal(vec3 obj) {
  if (uRevealOn < 0.5) return vec2(1.0, 0.0);
  vec3 cell = floor(obj / VOX);
  float h = hash13(cell);
  vec3 cc = (cell + 0.5) * VOX;
  float bf = (uBuildY - cc.y) / uBuildBand;
  float keep = bf + (h - 0.5) * 0.9;
  float zone = 1.0 - clamp(bf, 0.0, 1.0);
  float o = dot(cc - uDissO, uDissD) + (h - 0.5) * 0.18;
  float dz = (o - uDissT) / uDissBand;
  keep = min(keep, dz);
  zone = max(zone, 1.0 - clamp(dz, 0.0, 1.0));
  return vec2(keep, max(zone, uVoxAmt));
}
vec3 glitch(vec3 p, vec3 obj) {
  float fr = floor(uTime * 11.0);
  float slice = floor(obj.y * 18.0);
  float r = hash11(slice * 7.13 + fr * 3.71);
  float on = step(1.0 - 0.22 * uFlicker, r);
  p.x += on * (hash11(slice + fr * 1.7) - 0.5) * 0.05 * uFlicker;
  // a slow rolling shear
  p.x += uFlicker * 0.004 * sin(obj.y * 9.0 - uTime * 3.1);
  return p;
}
`;

export const SKIN_VERT = /* glsl */`
${COMMON}
attribute vec4 aInfo;
attribute vec3 aTex;
attribute vec4 aSpot;
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTex;
varying vec4 vInfo;
varying vec4 vSpot;
void main() {
  vec3 p = position;
  vec2 r = reveal(p);
  vec3 cc = (floor(p / VOX) + 0.5) * VOX;
  p = mix(p, cc, clamp(r.y * uVoxQ, 0.0, 1.0) * 0.8);
  p = glitch(p, position);
  vObj = position;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vTex = aTex;
  vInfo = aInfo;
  vSpot = aSpot;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SKIN_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDetail;
uniform sampler2D uGlyph;
uniform float uGlow;
uniform float uPulse;       // slow breathing light 0..1
uniform vec3 uCore;         // chest light (object space)
uniform vec3 uThroat;       // throat point (object space)
uniform vec2 uAxis;         // body axis (object space x, z)
uniform vec3 uHeadC;        // head centre (object space)
uniform mat3 uHeadRot;      // head rotation (world), for triplanar weights
uniform mat3 uHeadInv;      // object -> head space (rotation^T / scale)
uniform mat3 uEyeM[2];      // head -> lid-ellipsoid unit space
uniform vec3 uEyeC[2];
uniform vec4 uLid[2];       // upper adjust, lower adjust, blink, side
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTex;
varying vec4 vInfo;
varying vec4 vSpot;

#define PHIC 1.02
#define CORNER -0.05
#define OPENU 1.05
#define OPENL -0.72
// x: > 0 inside the almond opening; y: elevation above the upper edge; z: above the lower edge; w: radius (unit)
vec4 eyeOpen(vec3 hp, mat3 M, vec3 C, vec4 L) {
  vec3 l = M * (hp - C);
  float rl = length(l);
  if (rl > 1.45) return vec4(-1.0, 1.0, -1.0, rl);
  vec3 n = l / max(rl, 1e-5);
  float phi = atan(n.x, n.z);
  float eps = asin(clamp(n.y, -1.0, 1.0));
  float s = phi / PHIC;
  float q = max(0.0, 1.0 - s * s);
  float lat = s * L.w;
  // teardrop almond: full and high on the inner side, tapering to a lifted outer point
  float inner = max(0.0, -lat), outer = max(0.0, lat);
  float cornerE = CORNER + 0.16 * outer * outer;
  float up = cornerE + (OPENU + L.x - cornerE) * pow(q, 0.72) * (1.0 + 0.3 * inner - 0.12 * outer);
  float lo = cornerE - (cornerE - (OPENL + L.y)) * pow(q, 0.8) * (1.0 + 0.18 * inner - 0.25 * outer);
  float bl = L.z * L.z * (3.0 - 2.0 * L.z);
  float closed = mix(lo, cornerE, 0.3) - 0.012;
  up = max(up - bl * (OPENU + 0.9) * pow(q, 0.35), closed);
  up = mix(up, closed, smoothstep(0.85, 1.0, L.z));
  float inside = min(up - eps, eps - lo);
  if (n.z < 0.0 || abs(s) > 1.0) inside = -1.0;
  return vec4(inside, eps - up, eps - lo, rl);
}

vec3 perturb(vec3 N, vec3 dpx, vec3 dpy, float h, float scale) {
  float dhx = dFdx(h) * scale, dhy = dFdy(h) * scale;
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * N - grad);
}
float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 rv = reveal(vObj);
  if (rv.x < 0.0) discard;
  float part = vInfo.x;
  // eyelids: cut the almond opening out of the lid bulge; keep margin info for shading
  float lash = 0.0, fold = 0.0, rim = 0.0;
  if (part > 5.5 && part < 6.5) {
    vec3 hp = uHeadInv * (vObj - uHeadC);
    for (int i = 0; i < 2; i++) {
      vec4 e = eyeOpen(hp, uEyeM[i], uEyeC[i], uLid[i]);
      if (e.w < 1.45) {
        if (e.x > 0.0 && e.w < 1.1) discard;
        float nearE = 1.0 - smoothstep(1.12, 1.3, e.w);
        float front = e.x > -0.5 ? 1.0 : 0.0;
        // upper margin: dark lash line, a bright rolled rim above it, a soft fold higher up
        float onLid = 1.0 - smoothstep(1.08, 1.14, e.w);
        lash = max(lash, onLid * front * (1.0 - smoothstep(0.0, 0.045, e.y)) * step(-0.01, e.y));
        lash = max(lash, onLid * front * (1.0 - smoothstep(0.0, 0.035, -e.z)) * step(-0.01, -e.z) * 0.6);
        rim = max(rim, nearE * front * exp(-pow((e.y - 0.1) / 0.035, 2.0)));
        rim = max(rim, nearE * front * exp(-pow((-e.z - 0.08) / 0.03, 2.0)) * 0.6);
        fold = max(fold, nearE * front * exp(-pow((e.y - 0.34) / 0.05, 2.0)));
        fold = max(fold, nearE * front * exp(-pow((-e.z - 0.3) / 0.06, 2.0)) * 0.5);
      }
    }
  }
#ifdef DEPTH_ONLY
  gl_FragColor = vec4(0.0);
#else
  float vox = rv.y;
  float crease = max(vInfo.y, lash * 0.9 + fold * 0.25);
  float ao = vInfo.z;
  bool isHead = part > 5.5;
  vec3 N0 = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 dpx = dFdx(vW), dpy = dFdy(vW);
  vec3 Nf = normalize(cross(dpx, dpy));
  if (dot(Nf, V) < 0.0) Nf = -Nf;
  N0 = normalize(mix(N0, Nf, vox * 0.85));
  float ndv0 = clamp(dot(N0, V), 0.0, 1.0);

  // baked detail
  vec4 d;
  if (isHead) {
    vec3 nh = abs(normalize(vN) * uHeadRot);
    vec3 w = nh * nh; w *= w;
    vec3 q = vTex * 6.5;
    // two strongest projections only
    vec2 qa, qb; float wa, wb;
    if (w.x < w.y && w.x < w.z) { qa = q.xz; wa = w.y; qb = q.xy; wb = w.z; }
    else if (w.y < w.z) { qa = q.yz; wa = w.x; qb = q.xy; wb = w.z; }
    else { qa = q.yz; wa = w.x; qb = q.xz; wb = w.y; }
    d = (texture2D(uDetail, qa) * wa + texture2D(uDetail, qb) * wb) / (wa + wb);
  } else {
    d = texture2D(uDetail, vTex.xy);
  }
  bool isLid = part > 2.5 && part < 3.5;
  if (isLid) d.g = 0.0;
  float hgt = d.r * 0.55 + d.a * 0.45;
  float bumpS = (isHead ? 0.0009 : 0.0017) * (1.0 - vox) * smoothstep(0.08, 0.45, ndv0) * (part > 6.5 || (part > 1.5 && part < 2.5) ? 0.0 : 1.0) * mix(0.3, 1.0, ao);
  vec3 N = bumpS > 0.0 ? perturb(N0, dpx, dpy, hgt, bumpS) : N0;

  float ndv = clamp(mix(ndv0, dot(N, V), 0.45), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 Lk = normalize(up * 0.9 + V * 0.55 + cross(V, up) * 0.3);
  float lamb = clamp(dot(N, Lk) * 0.6 + 0.4, 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-V, N), Lk), 0.0, 1.0), 30.0);

  // inner light: chest core and the throat channel, pulsing with voice and breath
  float glow = uGlow;
  float dc = length(vObj - uCore);
  float dt = segDist(vObj, uCore, uThroat);
  float inner = exp(-dc * dc / 0.01) * (0.24 + 0.2 * uPulse + 1.0 * glow) + exp(-dt * dt / 0.0022) * (0.15 * glow);

  vec3 deep = vec3(0.02, 0.165, 0.29);
  vec3 cyan = vec3(0.24, 0.8, 1.0);
  vec3 white = vec3(0.6, 0.92, 1.0);
  vec3 rimC = vec3(0.36, 0.84, 1.0);
  float cells = 0.66 + 0.46 * d.r + 0.14 * d.a;
  vec3 col = deep * (0.28 + 0.85 * lamb) * cells * mix(1.0, ao, 0.9);
  col += rimC * fres * (0.95 + 0.35 * glow) * mix(0.5, 1.0, ao);
  col += white * spec * 0.2 * ao;
  float veinA = pow(d.g, 1.6) * (0.03 + 0.12 * uPulse + 0.75 * glow) * (1.0 - fres * 0.6);
  col += cyan * veinA * (isHead ? 0.12 : 0.5);
  col += cyan * d.b * (isHead ? 0.03 : 0.08) * (0.6 + 0.4 * sin(uTime * 1.3 + vObj.y * 6.0));
  col += cyan * inner;

  // bioluminescent dot lines
  float along = vSpot.y, sp = vSpot.w;
  float ao2 = (fract(along / sp + 0.5) - 0.5) * sp;
  float sd = length(vec2(vSpot.x, ao2));
  float spot = 1.0 - smoothstep(vSpot.z * 0.55, vSpot.z, sd);
  float sparkle = 0.6 + 0.4 * sin(uTime * 1.7 + floor(along / sp + 0.5) * 2.1);
  col += vec3(0.45, 0.95, 1.0) * spot * (0.35 + 0.25 * uPulse + 0.9 * glow) * sparkle;

  // flowing data glyphs (Arecibo-like pixel symbols), fading out when too small to read
  if (!isHead) {
    // glyph columns wrap round the body at a fixed physical size (11 mm cells)
    vec2 gp = vObj.xz - uAxis;
    float ang = atan(gp.x, gp.y);
    float rad = max(length(gp), 0.02);
    vec2 gq = vec2(ang * rad / 0.011, vObj.y / 0.011 + uTime * 1.1);
    vec2 gfw2 = fwidth(gq);
    float gfw = max(gfw2.x, gfw2.y);
    float band = smoothstep(0.2, 0.8, sin(ang * 5.0 + uTime * 0.15) * sin(vObj.y * 3.0 - uTime * 0.37));
    float gfade = (1.0 - smoothstep(0.25, 0.6, gfw)) * band * (1.0 - fres);
    if (gfade > 0.001) {
      float gly = texture2D(uGlyph, gq / 32.0).r;
      col += cyan * gly * gfade * 0.14;
    }
  }

  float alpha = 0.52 + 0.4 * fres + 0.08 * lamb;
  // parts
  if (part > 1.5 && part < 2.5) {           // mouth interior
    float depth = vInfo.w;
    col = vec3(0.002, 0.008, 0.013) + vec3(0.25, 0.85, 1.0) * pow(depth, 5.0) * (0.02 + 0.45 * glow);
    alpha = 0.95;
  }
  if (part > 6.5) {                          // lips: a touch denser and cooler, fine vertical lines
    col = deep * (0.3 + 0.9 * lamb) * mix(1.0, ao, 0.9) * vec3(0.95, 1.0, 1.08) + white * fres * 0.9 + white * spec * 0.35;
    alpha = min(1.0, alpha + 0.12);
  }
  if (part > 0.5 && part < 1.5) {            // crest: bright edge along the blade
    col += white * pow(vInfo.w, 3.0) * 0.45;
  }
  if (part > 3.5 && part < 4.5) {            // hands: glowing finger pads (vInfo.w)
    col += vec3(0.4, 0.95, 1.0) * vInfo.w * (0.4 + 0.3 * uPulse + 0.8 * glow);
  }
  col += white * rim * 0.22;
  // creases: lip line and lash line read dark
  col *= 1.0 - 0.8 * crease;
  alpha = min(1.0, alpha + 0.35 * crease);

  // hologram: fine scanlines (fading out when too fine to resolve), a travelling scan band
  float sy = vW.y * 360.0 - uTime * 1.7;
  float fw = fwidth(sy);
  float scan = mix(0.5 + 0.5 * cos(sy * 6.2831853), 0.5, smoothstep(0.3, 0.7, fw));
  col *= 0.82 + 0.26 * scan;
  float bnd = fract(vW.y * 0.42 - uTime * 0.21);
  col += cyan * 0.1 * exp(-pow((bnd - 0.5) * 30.0, 2.0));
  // interference
  float intf = 0.5 + 0.5 * cos(vW.y * 43.0 - uTime * 8.3) * cos(vW.y * 6.1 + uTime * 2.1);
  col *= (1.0 - uFlicker * 0.45 * intf * intf) * uFlick;

  // voxels: quantised cells with bright edges while assembling / dissolving
  if (vox > 0.001) {
    vec3 cp = vObj / VOX;
    float h = hash13(floor(cp));
    vec3 f = abs(fract(cp) - 0.5);
    float e = max(f.x, max(f.y, f.z));
    float edge = smoothstep(0.38, 0.48, e);
    vec3 vc = cyan * (0.25 + 0.9 * h) + white * edge * 0.9;
    col = mix(col, vc, vox * 0.85);
    alpha = mix(alpha, 0.55 + 0.35 * h, vox);
  }

  alpha *= uPresence;
  gl_FragColor = vec4(col * uPresence, alpha);
#endif
}
`;

export const EYE_VERT = /* glsl */`
${COMMON}
varying vec3 vLocal;
varying vec3 vNv;
varying vec3 vVv;
varying vec3 vVl;
varying vec3 vObj;
varying vec3 vW;
uniform mat4 uRootInv;
uniform mat4 uRoot;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 obj = (uRootInv * w).xyz;
  vObj = obj;
  vec3 wp = (uRoot * vec4(glitch(obj, obj), 1.0)).xyz;
  vW = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vNv = normalize(normalMatrix * normal);
  vVv = -mv.xyz;
  mat3 M = mat3(modelMatrix);
  mat3 Rw = mat3(normalize(M[0]), normalize(M[1]), normalize(M[2]));
  vVl = transpose(Rw) * (cameraPosition - w.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const EYE_FRAG = /* glsl */`
${COMMON}
uniform vec3 uGaze;         // iris centre direction in the eye's unit-sphere space
uniform vec3 uEyeS;         // normalised radii of the almond
uniform float uGlow;
uniform float uPulse;
uniform float uIris;        // iris angular radius (physical)
uniform float uPupil;
varying vec3 vLocal;
varying vec3 vNv;
varying vec3 vVv;
varying vec3 vVl;
varying vec3 vObj;
varying vec3 vW;
void main() {
  vec2 rv = reveal(vObj);
  if (rv.x < 0.0) discard;
#ifdef DEPTH_ONLY
  gl_FragColor = vec4(0.0);
#else
  vec3 p = normalize(vLocal);
  vec3 P = p * uEyeS;                         // physical point on the lens
  vec3 Nl = normalize(p / uEyeS);             // lens normal (local)
  vec3 Vl = normalize(vVl);
  vec3 N = normalize(vNv);
  vec3 V = normalize(vVv);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 G = normalize(uGaze * uEyeS);          // gaze centre direction (physical)
  // refract into the lens: the iris sits deeper than the surface
  vec3 T = refract(-Vl, Nl, 0.75);
  vec3 D = P + T * 0.42 * uEyeS.z;
  vec3 dirI = normalize(D);
  float ang = acos(clamp(dot(dirI, G), -1.0, 1.0));
  vec3 t1 = normalize(cross(G, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 t2 = cross(G, t1);
  float phi = atan(dot(dirI, t2), dot(dirI, t1));
  float r = ang / uIris;                       // 0 centre .. 1 limbus
  // iris fibres: fine radial strands, crypts and a wavy collarette
  float fib = 0.5 + 0.28 * sin(phi * 47.0 + 2.0 * sin(phi * 9.0 + r * 6.0)) + 0.22 * sin(phi * 83.0 - r * 11.0);
  float crypt = smoothstep(0.55, 0.9, 0.5 + 0.5 * sin(phi * 13.0 + 3.0 * r) * sin(r * 17.0 + phi * 3.0));
  float pr = uPupil / uIris;
  float coll = exp(-pow((r - pr * 1.55 - 0.03 * sin(phi * 11.0)) / 0.05, 2.0));
  float iris = 1.0 - smoothstep(0.93, 1.02, r);
  float pupil = 1.0 - smoothstep(pr - 0.03, pr + 0.02, r);
  float limbal = exp(-pow((r - 0.96) / 0.07, 2.0));
  vec3 base = vec3(0.003, 0.008, 0.014);
  float lum = 0.55 + 0.25 * uPulse + 0.9 * uGlow;
  // a large, dark iris: faint luminous fibres, a glowing collarette, soft limbus
  vec3 irisCol = mix(vec3(0.004, 0.02, 0.032), vec3(0.02, 0.1, 0.15), fib * (0.35 + 0.65 * r)) * (1.0 - 0.5 * crypt);
  irisCol *= lum;
  irisCol += vec3(0.2, 0.75, 0.95) * coll * 0.22 * lum;
  irisCol *= iris * (1.0 - pupil);
  irisCol *= 1.0 - 0.7 * limbal;
  vec3 halo = vec3(0.06, 0.35, 0.5) * exp(-pow((r - 1.02) / 0.05, 2.0)) * 0.3 * lum;
  // deep glow behind the pupil
  vec3 Dd = P + T * 0.95 * uEyeS.z;
  float angD = acos(clamp(dot(normalize(Dd), G), -1.0, 1.0));
  vec3 deep = vec3(0.15, 0.62, 0.9) * exp(-angD * angD / (uPupil * uPupil * 0.5)) * (0.14 + 0.1 * uPulse + 0.5 * uGlow);
  // wet lens reflections: two catchlights and a soft sky
  vec3 R = reflect(-V, N);
  float key = pow(clamp(dot(R, normalize(vec3(-0.35, 0.55, 0.76))), 0.0, 1.0), 420.0);
  float key2 = pow(clamp(dot(R, normalize(vec3(0.45, 0.28, 0.85))), 0.0, 1.0), 1400.0);
  float soft = pow(clamp(dot(R, normalize(vec3(-0.2, 0.7, 0.6))), 0.0, 1.0), 12.0);
  float fres = pow(1.0 - ndv, 4.0);
  vec3 col = base + irisCol + halo + deep;
  col += vec3(0.85, 0.97, 1.0) * (key * 6.0 + key2 * 3.0);
  col += vec3(0.25, 0.55, 0.7) * (soft * 0.12 + fres * 0.5);
  float sy = vW.y * 360.0 - uTime * 1.7;
  float scan = mix(0.5 + 0.5 * cos(sy * 6.2831853), 0.5, smoothstep(0.3, 0.7, fwidth(sy)));
  col *= 0.9 + 0.16 * scan;
  col *= uFlick;
  float vox = rv.y;
  if (vox > 0.001) {
    float h = hash13(floor(vObj / VOX));
    col = mix(col, vec3(0.28, 0.82, 1.0) * (0.25 + 0.9 * h), vox * 0.85);
  }
  float alpha = 0.95 * uPresence;
  gl_FragColor = vec4(col * uPresence, alpha);
#endif
}
`;

// faint internal skeleton, drawn before the skin (additive)
export const BONE_VERT = /* glsl */`
${COMMON}
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vec3 p = glitch(position, position);
  vObj = position;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const BONE_FRAG = /* glsl */`
${COMMON}
uniform float uGlow;
uniform float uPulse;
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vec2 rv = reveal(vObj);
  if (rv.x < 0.0) discard;
  vec3 V = normalize(cameraPosition - vW);
  float ndv = abs(dot(normalize(vN), V));
  float core = pow(ndv, 1.5);
  float travel = 0.5 + 0.5 * sin(vObj.y * 14.0 - uTime * 2.4);
  vec3 col = vec3(0.3, 0.85, 1.0) * (0.05 + 0.1 * core + 0.05 * travel * (0.3 + uPulse) + 0.25 * uGlow * travel);
  gl_FragColor = vec4(col * uPresence * uFlick * (1.0 - 0.6 * rv.y), 0.0);
}
`;

export const PART_VERT = /* glsl */`
attribute vec2 aData;     // size (m), brightness
varying float vB;
varying float vS;
uniform float uPx;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aData.x * uPx / max(0.05, -mv.z);
  float cs = clamp(s, 1.5, 22.0);
  gl_PointSize = cs;
  // keep total light constant when the sprite is clamped up
  vB = aData.y * min(1.0, (s * s) / (cs * cs) * 1.0 + 0.25);
  vS = cs;
  if (aData.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
export const PART_FRAG = /* glsl */`
varying float vB;
varying float vS;
uniform float uFlick;
void main() {
  vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
  float m = max(q.x, q.y);
  float body = 1.0 - smoothstep(0.72, 1.0, m);
  float edge = smoothstep(0.45, 0.8, m) * body;
  float core = 1.0 - smoothstep(0.0, 0.6, length(q));
  vec3 cyan = vec3(0.3, 0.85, 1.0), white = vec3(0.8, 0.97, 1.0);
  vec3 col = cyan * body * 0.55 + white * (edge * 0.6 + core * 0.7);
  gl_FragColor = vec4(col * vB * uFlick, 0.0);
}
`;
