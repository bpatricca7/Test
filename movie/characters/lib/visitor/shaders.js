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

// x: keep (>= 0 visible), y: voxel amount
vec2 reveal(vec3 obj) {
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
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTex;
varying vec4 vInfo;
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
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SKIN_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uDetail;
uniform float uGlow;
uniform float uPulse;       // slow breathing light 0..1
uniform vec3 uCore;         // chest light (object space)
uniform vec3 uThroat;       // throat point (object space)
uniform mat3 uHeadRot;      // head rotation (object space), for triplanar weights
varying vec3 vW;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vTex;
varying vec4 vInfo;

vec3 perturb(vec3 N, vec3 pos, float h, float scale) {
  vec3 dpx = dFdx(pos), dpy = dFdy(pos);
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
#ifdef DEPTH_ONLY
  gl_FragColor = vec4(0.0);
#else
  float vox = rv.y;
  float part = vInfo.x;
  float crease = vInfo.y;
  float ao = vInfo.z;
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  vec3 Nf = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(Nf, V) < 0.0) Nf = -Nf;
  N = normalize(mix(N, Nf, vox * 0.85));

  // baked detail
  vec4 d;
  if (part > 5.5) {
    vec3 nh = abs(normalize(vN) * uHeadRot);
    vec3 w = nh * nh; w *= w; w /= (w.x + w.y + w.z);
    vec3 q = vTex * 7.5;
    d = texture2D(uDetail, q.yz) * w.x + texture2D(uDetail, q.xz) * w.y + texture2D(uDetail, q.xy) * w.z;
  } else {
    d = texture2D(uDetail, vTex.xy);
  }
  float hgt = d.r * 0.55 + d.a * 0.45;
  float bumpS = part > 5.5 ? 0.0011 : 0.0016;
  N = perturb(N, vW, hgt, bumpS * (1.0 - vox));

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 Lk = normalize(up * 0.9 + V * 0.55 + cross(V, up) * 0.25);
  float lamb = clamp(dot(N, Lk) * 0.6 + 0.4, 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-V, N), Lk), 0.0, 1.0), 28.0);

  // inner light: chest core and the throat channel, pulsing with voice and breath
  float glow = uGlow;
  float dc = length(vObj - uCore);
  float dt = segDist(vObj, uCore, uThroat);
  float inner = exp(-dc * dc / 0.012) * (0.35 + 0.25 * uPulse + 1.1 * glow) + exp(-dt * dt / 0.0009) * (0.08 + 0.9 * glow);

  vec3 deep = vec3(0.035, 0.24, 0.38);
  vec3 cyan = vec3(0.28, 0.82, 1.0);
  vec3 white = vec3(0.72, 0.95, 1.0);
  float cells = 0.72 + 0.4 * d.r + 0.12 * d.a;
  vec3 col = deep * (0.3 + 0.8 * lamb) * cells * mix(1.0, ao, 0.85);
  col += white * fres * (1.25 + 0.4 * glow) * mix(0.55, 1.0, ao);
  col += white * spec * 0.22 * ao;
  float veinA = d.g * (0.05 + 0.28 * uPulse + 0.9 * glow) * (1.0 - fres * 0.5);
  col += cyan * veinA * (part > 5.5 ? 0.6 : 1.0);
  col += cyan * d.b * 0.1 * (0.6 + 0.4 * sin(uTime * 1.3 + vObj.y * 6.0));
  col += cyan * inner;

  float alpha = 0.5 + 0.4 * fres + 0.1 * lamb;
  // parts
  if (part > 1.5 && part < 2.5) {           // mouth interior
    float depth = vInfo.w;
    col = vec3(0.004, 0.02, 0.03) + vec3(0.25, 0.85, 1.0) * depth * depth * (0.06 + 1.6 * glow);
    alpha = 0.92;
  }
  if (part > 6.5) {                          // lips: a touch denser and cooler
    col *= vec3(0.92, 1.0, 1.06);
    alpha = min(1.0, alpha + 0.08);
  }
  if (part > 0.5 && part < 1.5) {            // crest: bright edge along the blade
    col += white * pow(vInfo.w, 3.0) * 0.5;
  }
  // creases: lip line and lash line read dark
  col *= 1.0 - 0.8 * crease;
  alpha = min(1.0, alpha + 0.35 * crease);

  // hologram: fine scanlines (fading out when too fine to resolve), a travelling scan band
  float sy = vW.y * 360.0 - uTime * 1.7;
  float fw = fwidth(sy);
  float scan = mix(0.5 + 0.5 * cos(sy * 6.2831853), 0.5, smoothstep(0.3, 0.7, fw));
  col *= 0.8 + 0.3 * scan;
  float band = fract(vW.y * 0.42 - uTime * 0.21);
  col += white * 0.18 * exp(-pow((band - 0.5) * 30.0, 2.0));
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
varying vec3 vObj;
varying vec3 vW;
uniform mat4 uRootInv;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 obj = (uRootInv * w).xyz;
  vObj = obj;
  vec3 wp = glitch(w.xyz, obj);
  vW = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vNv = normalize(normalMatrix * normal);
  vVv = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const EYE_FRAG = /* glsl */`
${COMMON}
uniform vec3 uGaze;         // iris centre direction in the eye's unit-sphere space
uniform float uGlow;
uniform float uPulse;
uniform float uIris;        // iris angular radius
uniform float uPupil;
varying vec3 vLocal;
varying vec3 vNv;
varying vec3 vVv;
varying vec3 vObj;
varying vec3 vW;
void main() {
  vec2 rv = reveal(vObj);
  if (rv.x < 0.0) discard;
#ifdef DEPTH_ONLY
  gl_FragColor = vec4(0.0);
#else
  vec3 p = normalize(vLocal);
  vec3 N = normalize(vNv);
  vec3 V = normalize(vVv);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float c = dot(p, uGaze);
  float ang = acos(clamp(c, -1.0, 1.0));
  // polar angle around the gaze axis for iris striations
  vec3 t1 = normalize(cross(uGaze, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 t2 = cross(uGaze, t1);
  float phi = atan(dot(p, t2), dot(p, t1));
  float stri = 0.55 + 0.25 * sin(phi * 23.0) + 0.2 * sin(phi * 37.0 + 1.3);
  float ir = uIris;
  float iris = smoothstep(ir + 0.04, ir - 0.03, ang);
  float pupil = smoothstep(uPupil + 0.03, uPupil - 0.02, ang);
  float limbal = exp(-pow((ang - ir * 0.93) / 0.035, 2.0));
  float ringIn = exp(-pow((ang - uPupil * 1.25) / 0.04, 2.0));
  vec3 base = vec3(0.004, 0.012, 0.022);
  vec3 irisCol = vec3(0.09, 0.5, 0.72) * iris * (1.0 - pupil) * stri * (0.55 + 0.35 * uPulse + 0.8 * uGlow);
  irisCol += vec3(0.3, 0.9, 1.0) * ringIn * 0.35 * (1.0 + uGlow);
  irisCol -= vec3(0.05, 0.25, 0.35) * limbal * 0.6;
  // deep inner glow: a soft light sitting behind the surface (parallax along the view ray)
  vec3 Vl = normalize(vLocal - (vLocal - vec3(0.0)) * 0.0);
  float deepA = acos(clamp(dot(normalize(p - V * 0.35), uGaze), -1.0, 1.0));
  vec3 inner = vec3(0.15, 0.6, 0.85) * exp(-deepA * deepA / 0.09) * (0.25 + 0.2 * uPulse + 0.6 * uGlow);
  // wet reflections: catchlights (view space) + a soft sky strip
  vec3 R = reflect(-V, N);
  float key = pow(clamp(dot(R, normalize(vec3(-0.35, 0.55, 0.76))), 0.0, 1.0), 380.0);
  float key2 = pow(clamp(dot(R, normalize(vec3(0.45, 0.25, 0.86))), 0.0, 1.0), 900.0);
  float sky = smoothstep(0.15, 0.6, R.y) * 0.06;
  float fres = pow(1.0 - ndv, 4.0);
  vec3 col = base + max(irisCol, vec3(0.0)) + inner;
  col += vec3(0.85, 0.97, 1.0) * (key * 5.0 + key2 * 2.5);
  col += vec3(0.3, 0.7, 0.85) * (sky + fres * 0.45);
  // hologram texture on the lens: faint scanlines
  float sy = vW.y * 360.0 - uTime * 1.7;
  float scan = mix(0.5 + 0.5 * cos(sy * 6.2831853), 0.5, smoothstep(0.3, 0.7, fwidth(sy)));
  col *= 0.88 + 0.2 * scan;
  col *= uFlick;
  float vox = rv.y;
  if (vox > 0.001) {
    float h = hash13(floor(vObj / VOX));
    col = mix(col, vec3(0.28, 0.82, 1.0) * (0.25 + 0.9 * h), vox * 0.85);
  }
  float alpha = (0.94) * uPresence;
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
