// Materials and baked textures for the humans.
// Skin: MeshStandardMaterial patched with wrap ("subsurface") diffuse, per-vertex
// wetness (lips, lid rims, mouth) and a baked cavity/AO term, plus a soft fuzz rim.
// Everything noisy is baked into canvases here, never evaluated per pixel.

import * as THREE from 'three';

const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();

let _envTex = null;
/** a tiny procedural room environment for glossy things (eyes, glasses, lips) */
export function envTexture() {
  if (_envTex) return _envTex;
  const W = 256, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#3a3f4a'); gr.addColorStop(0.45, '#2a2a2e'); gr.addColorStop(0.55, '#1c1a19'); gr.addColorStop(1, '#0e0c0b');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // a cool window and a warm lamp, soft
  const blob = (x, y, rx, ry, col, a) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.globalAlpha = a; g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2); g.fill(); g.restore();
  };
  g.fillStyle = 'rgba(190,215,255,0.55)'; g.fillRect(150, 34, 34, 26);
  g.fillStyle = 'rgba(40,50,70,0.8)'; g.fillRect(166, 34, 2, 26); g.fillRect(150, 46, 34, 2);
  blob(70, 58, 26, 18, 'rgba(255,200,140,1)', 0.9);
  blob(120, 52, 40, 12, 'rgba(120,210,255,1)', 0.35);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _envTex = t;
  return t;
}

function patchLights(src, wrapExpr) {
  let s = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = 'vec3 irradiance = dotNL * directLight.color;';
  const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!s.includes(a) || !s.includes(b)) { console.warn('human: lights chunk changed, wrap lighting disabled'); return src; }
  s = s.replace(a, `${a}
	float dotNLraw = dot( geometryNormal, directLight.direction );
	vec3 wrapW = ${wrapExpr};
	vec3 irradianceWrap = clamp( ( vec3( dotNLraw ) + wrapW ) / ( 1.0 + wrapW ), 0.0, 1.0 );
	irradianceWrap *= irradianceWrap * ( 3.0 - 2.0 * irradianceWrap ) * 0.35 + 0.65;
	irradianceWrap *= directLight.color * SKIN_DIRECT_AO;`);
  s = s.replace(b, `reflectedLight.directDiffuse += irradianceWrap * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	reflectedLight.directDiffuse += directLight.color * SKIN_FUZZ * pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 ) * saturate( dotNLraw + 0.35 );`);
  return src.replace('#include <lights_physical_pars_fragment>', s);
}

/**
 * Skin: vertex colours are the albedo; attributes `wet` (0..1) and `ao` (0..1).
 * opts.wrap: [r,g,b] wrap amounts (red scatters furthest)
 */
export function makeSkinMaterial(opts = {}) {
  const wrap = opts.wrap || [0.55, 0.24, 0.15];
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: opts.roughness ?? 0.6, metalness: 0,
    map: opts.map || null, normalMap: opts.normalMap || null,
  });
  if (opts.normalMap) mat.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
  mat.userData.uniforms = {
    uFuzz: { value: new THREE.Color(opts.fuzz || 0x3a2a24) },
    uWetRough: { value: opts.wetRough ?? 0.22 },
    uAOStrength: { value: opts.ao ?? 1.0 },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float wet;
attribute float ao;
varying float vWet;
varying float vAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWet = wet; vAO = ao;`);
    let fs = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWet;
varying float vAO;
uniform vec3 uFuzz;
uniform float uWetRough;
uniform float uAOStrength;
#define SKIN_DIRECT_AO mix( 1.0, vAO, 0.55 * uAOStrength )
#define SKIN_FUZZ uFuzz`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef USE_MAP
  roughnessFactor = mix( 0.28, 0.9, sampledDiffuseColor.a );
  diffuseColor.a = opacity;
#endif
roughnessFactor = mix( roughnessFactor, uWetRough, vWet );`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
{
  float skinAO = mix( 1.0, vAO, uAOStrength );
  reflectedLight.indirectDiffuse *= skinAO;
  reflectedLight.indirectSpecular *= skinAO * skinAO;
}`);
    fs = patchLights(fs, `vec3( ${wrap[0].toFixed(3)}, ${wrap[1].toFixed(3)}, ${wrap[2].toFixed(3)} )`);
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'human-skin-' + wrap.join(',');
  return mat;
}

/** mouth interior: teeth, gums, tongue, mouth bag. `depth` attribute darkens the inside */
export function makeInteriorMaterial(color, rough, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, vertexColors: !!opts.vertexColors,
    envMap: envTexture(), envMapIntensity: opts.env ?? 0.25 });
  mat.userData.uniforms = { uOpen: { value: 0 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float depth;
varying float vDepth;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vDepth = depth;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vDepth;
uniform float uOpen;`)
      .replace('#include <opaque_fragment>', `
  float occ = mix( 0.22, 1.0, smoothstep( 0.0, 0.6, uOpen ) );
  occ *= mix( 1.0, 0.08, smoothstep( 0.0, 1.0, vDepth ) );
  outgoingLight *= occ;
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'human-interior';
  return mat;
}

// ------------------------------------------------------------------ eyes ---

export function bakeIrisTexture(opts) {
  const S = 1024;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = opts.rnd;
  const cx = S / 2, cy = S / 2;
  // sclera: warm off-white, pinker toward the edges, faint veins
  const sg = g.createRadialGradient(cx, cy, S * 0.1, cx, cy, S * 0.5);
  sg.addColorStop(0, '#f2ece4'); sg.addColorStop(0.6, '#ece2d8'); sg.addColorStop(0.85, '#e0cbc0'); sg.addColorStop(1, '#c9a79c');
  g.fillStyle = sg; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    // veins mostly at the corners (left/right), fading toward the iris
    const horiz = Math.abs(Math.cos(a));
    if (rnd() > 0.25 + 0.75 * horiz) continue;
    let r = S * 0.5, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    g.beginPath(); g.moveTo(x, y);
    let ang = a + Math.PI + (rnd() - 0.5) * 0.4;
    const len = S * (0.12 + rnd() * 0.16);
    for (let t = 0; t < len; t += 6) {
      ang += (rnd() - 0.5) * 0.5;
      x += Math.cos(ang) * 6; y += Math.sin(ang) * 6;
      g.lineTo(x, y);
    }
    g.strokeStyle = `rgba(${170 + rnd() * 40 | 0},${60 + rnd() * 30 | 0},${60 + rnd() * 20 | 0},${0.12 + rnd() * 0.18})`;
    g.lineWidth = 0.8 + rnd() * 1.6;
    g.stroke();
  }
  // iris
  const RI = S / 2 * opts.irisR, RP = RI * opts.pupil;
  const base = opts.base, inner = opts.inner, outer = opts.outer;
  let ig = g.createRadialGradient(cx, cy, RP, cx, cy, RI);
  ig.addColorStop(0, inner); ig.addColorStop(0.35, inner); ig.addColorStop(0.55, base); ig.addColorStop(1, outer);
  g.fillStyle = ig; g.beginPath(); g.arc(cx, cy, RI, 0, Math.PI * 2); g.fill();
  // radial fibres
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = RP * (1 + rnd() * 0.3), r1 = RI * (0.55 + rnd() * 0.45);
    const bright = rnd();
    const col = bright > 0.55 ? opts.fibreLight : opts.fibreDark;
    g.strokeStyle = col.replace('A', (0.10 + rnd() * 0.25).toFixed(2));
    g.lineWidth = 0.6 + rnd() * 1.8;
    g.beginPath();
    const wob = (rnd() - 0.5) * 0.12;
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.quadraticCurveTo(cx + Math.cos(a + wob) * (r0 + r1) / 2, cy + Math.sin(a + wob) * (r0 + r1) / 2, cx + Math.cos(a + wob * 0.5) * r1, cy + Math.sin(a + wob * 0.5) * r1);
    g.stroke();
  }
  // crypts
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, r = RP * 1.4 + rnd() * (RI * 0.85 - RP * 1.4);
    g.fillStyle = `rgba(20,8,2,${0.1 + rnd() * 0.18})`;
    g.beginPath(); g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rnd() * 7, 1.5 + rnd() * 3, a, 0, Math.PI * 2); g.fill();
  }
  // collarette: a jagged lighter ring
  g.beginPath();
  for (let i = 0; i <= 120; i++) {
    const a = i / 120 * Math.PI * 2;
    const r = RP * 1.75 + Math.sin(a * 9) * RP * 0.08 + (rnd() - 0.5) * RP * 0.12;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.strokeStyle = opts.collar; g.lineWidth = RP * 0.18; g.stroke();
  // limbal ring
  const lg = g.createRadialGradient(cx, cy, RI * 0.78, cx, cy, RI * 1.04);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.55, opts.limbal); lg.addColorStop(0.85, opts.limbal); lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg; g.beginPath(); g.arc(cx, cy, RI * 1.05, 0, Math.PI * 2); g.fill();
  // pupil with a soft edge
  const pg = g.createRadialGradient(cx, cy, RP * 0.85, cx, cy, RP * 1.12);
  pg.addColorStop(0, '#050303'); pg.addColorStop(1, 'rgba(5,3,3,0)');
  g.fillStyle = pg; g.beginPath(); g.arc(cx, cy, RP * 1.12, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** eyeball: iris texture + soft lid shadow + corner darkening (socket space) */
export function makeEyeballMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0, envMap: envTexture(), envMapIntensity: 0.2 });
  mat.userData.uniforms = {
    uGaze: { value: new THREE.Matrix3() },
    uLidU: { value: new Float32Array(8) }, uLidL: { value: new Float32Array(8) },
    uSide: { value: 1 }, uR: { value: 0.0145 },
    uIrisGlow: { value: 0.35 },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform mat3 uGaze;
varying vec3 vSock;
varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSock = uGaze * position; vLocal = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSock;
varying vec3 vLocal;
uniform float uLidU[8];
uniform float uLidL[8];
uniform float uSide;
uniform float uR;
uniform float uIrisGlow;
float lidAt(float arr[8], float xn) {
  float f = clamp((xn * 0.5 + 0.5) * 7.0, 0.0, 6.999);
  int i = int(floor(f));
  float a = arr[0], b = arr[1];
  for (int k = 0; k < 7; k++) { if (k == i) { a = arr[k]; b = arr[k + 1]; } }
  return mix(a, b, fract(f));
}`)
      .replace('#include <opaque_fragment>', `
{
  float xn = clamp(vSock.x * uSide / uR, -1.0, 1.0);
  float psi = atan(vSock.y, vSock.z);
  float pu = lidAt(uLidU, xn), pl = lidAt(uLidL, xn);
  float shU = smoothstep(pu - 0.30, pu + 0.02, psi);
  float shL = smoothstep(pl + 0.14, pl - 0.02, psi);
  float corner = smoothstep(0.55, 1.0, abs(xn));
  float occ = 1.0 - 0.62 * shU - 0.3 * shL;
  occ *= 1.0 - 0.35 * corner;
  // iris lit through the cornea from the far side reads brighter
  float ir = length(vLocal.xy) / uR;
  float irisM = (1.0 - smoothstep(0.50, 0.56, ir)) * step(0.0, vLocal.z);
  outgoingLight *= max(occ, 0.18);
  outgoingLight += irisM * diffuseColor.rgb * uIrisGlow * (0.4 + 0.6 * occ) * ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) ;
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'human-eyeball';
  return mat;
}

/** cornea: an additive, glassy layer with a camera-relative catchlight */
export function makeCorneaMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.05, metalness: 0.0, envMap: envTexture(), envMapIntensity: 0.9,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mat.userData.uniforms = { uCatch: { value: 0.55 }, uCatchDir: { value: new THREE.Vector3(-0.35, 0.45, 1).normalize() } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uCatch;
uniform vec3 uCatchDir;`)
      .replace('#include <opaque_fragment>', `
{
  vec3 Vv = normalize( vViewPosition );
  vec3 Rv = reflect( -Vv, normal );
  float c = pow( max( dot( Rv, uCatchDir ), 0.0 ), 900.0 ) * 3.0 + pow( max( dot( Rv, uCatchDir ), 0.0 ), 60.0 ) * 0.05;
  float fres = pow( 1.0 - saturate( dot( normal, Vv ) ), 4.0 );
  outgoingLight += vec3( c * uCatch ) + fres * 0.04;
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'human-cornea';
  return mat;
}

// ------------------------------------------------------------------ hair ---
/** hair: vertex-coloured, with a Kajiya-Kay style highlight along `tangent` */
export function makeHairMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: opts.roughness ?? 0.62, metalness: 0,
    map: opts.map || null, normalMap: opts.normalMap || null, side: opts.side ?? THREE.FrontSide,
  });
  if (opts.normalMap) mat.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
  mat.userData.uniforms = { uSpec: { value: new THREE.Color(opts.spec || 0x9a8a78) }, uShift: { value: opts.shift ?? 0.12 } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 hairTangent;
varying vec3 vHairT;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vHairT = normalize( normalMatrix * hairTangent );`);
    let s = THREE.ShaderChunk.lights_physical_pars_fragment;
    const b = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
    if (s.includes(b)) {
      s = s.replace(b, `${b}
	{
		vec3 T = normalize( vHairT - geometryNormal * dot( vHairT, geometryNormal ) );
		vec3 H = normalize( directLight.direction + geometryViewDir );
		vec3 T1 = normalize( T + geometryNormal * uShift );
		vec3 T2 = normalize( T - geometryNormal * uShift * 1.6 );
		float th1 = dot( T1, H ), th2 = dot( T2, H );
		float s1 = pow( sqrt( max( 0.0, 1.0 - th1 * th1 ) ), 90.0 );
		float s2 = pow( sqrt( max( 0.0, 1.0 - th2 * th2 ) ), 22.0 );
		float wrapD = saturate( dot( geometryNormal, directLight.direction ) * 0.5 + 0.5 );
		reflectedLight.directSpecular += directLight.color * wrapD * ( s1 * uSpec * 0.55 + s2 * uSpec * material.diffuseColor * 2.2 );
	}`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vHairT;
uniform vec3 uSpec;
uniform float uShift;`)
      .replace('#include <lights_physical_pars_fragment>', s);
    sh.uniforms.uSpec = mat.userData.uniforms.uSpec;
  };
  mat.customProgramCacheKey = () => 'human-hair';
  return mat;
}

export { srgb };
