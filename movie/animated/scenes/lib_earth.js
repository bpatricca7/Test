// Shared procedural Earth for journey.js and ending.js.
//
// The planet is baked once per renderer into an equirectangular half-float
// texture (height, clouds, city-light density, moisture) on the GPU; the
// surface shader then only samples it and adds fine per-pixel detail, so a
// full-frame Earth stays cheap on SwiftShader. A separate shell integrates a
// thin exponential atmosphere along each view ray for the limb glow, the day
// side haze and the reddened terminator.

let BAKED = null;

// the Caribbean-ish point the message leaves from (object space, see sph())
export const CARIB_UV = [0.315, 0.60];

// object-space point on the unit sphere for an equirect uv, matching
// THREE.SphereGeometry's uv layout
export function sph(u, v) {
  const phi = u * Math.PI * 2, th = (1 - v) * Math.PI;
  return [-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)];
}

const SPH_GLSL = /* glsl */`
vec3 sph(vec2 uv) {
  float phi = uv.x * 6.28318530718;
  float th = (1.0 - uv.y) * 3.14159265359;
  return vec3(-cos(phi) * sin(th), cos(th), sin(phi) * sin(th));
}`;

const BAKE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function bakeFrag(U) {
  return /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3 uCarib;
${U.GLSL_NOISE}
${SPH_GLSL}
float fbm4(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.9375;
}
void main() {
  vec3 p = sph(vUv);
  // continents: domain-warped fbm
  vec3 q = p * 1.35 + vec3(4.1, 1.3, 7.7);
  vec3 w = vec3(fbm4(q * 1.4), fbm4(q * 1.4 + vec3(5.2, 1.3, 2.8)), fbm4(q * 1.4 + vec3(9.1, 4.7, 3.3))) - 0.5;
  float h = fbm(q + w * 1.6);
  // a land bridge / island arc where the message leaves from
  float dc = distance(p, uCarib);
  h += 0.07 * exp(-dc * dc / 0.02) - 0.03 * exp(-dc * dc / 0.25);

  // clouds: stretched along latitude, swirled, banded by climate zone
  float lat = abs(p.y);
  vec3 cq = vec3(p.x * 2.4, p.y * 5.5, p.z * 2.4) + vec3(3.0, 8.0, 1.0);
  vec3 cw = vec3(fbm4(cq * 0.9 + 2.0), fbm4(cq * 0.9 + 7.0), fbm4(cq * 0.9 + 11.0)) - 0.5;
  float c = fbm(cq + cw * 2.6);
  float zone = 0.55 + 0.30 * exp(-lat * lat / 0.012) - 0.22 * exp(-pow(lat - 0.42, 2.0) / 0.02)
             + 0.22 * exp(-pow(lat - 0.78, 2.0) / 0.02);
  float cloud = smoothstep(0.42, 0.70, c * zone + 0.22);
  cloud *= 0.55 + 0.45 * smoothstep(0.35, 0.6, fbm4(p * 11.0 + 5.0));

  // city lights: populated regions, bright city cores and faint networks
  // between them (combined with land + coast in the surface shader)
  float rf = fbm4(p * 4.5 + vec3(2.0, 5.0, 9.0)) + 0.10 * exp(-dc * dc / 0.02);
  float reg = smoothstep(0.47, 0.72, rf);
  float city = smoothstep(0.68, 0.96, vnoise(p * 58.0) * 0.6 + vnoise(p * 140.0) * 0.4);
  float spread = smoothstep(0.58, 0.88, vnoise(p * 95.0 + 7.0)) * 0.14;
  float towns = smoothstep(0.38, 0.52, rf) * smoothstep(0.82, 0.97, vnoise(p * 125.0 + 2.0)) * 0.45;
  float lights = reg * (city * 1.5 + spread) + towns;

  float moist = fbm4(p * 3.1 + vec3(8.0, 2.0, 6.0));
  gl_FragColor = vec4(h, cloud, lights, moist);
}`;
}

/** bake (once) the Earth data texture; also returns a small CPU copy */
export function bakeEarth(env) {
  if (BAKED) return BAKED;
  const { THREE, renderer, U } = env;
  const W = 2048, H = 1024;
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const c = sph(CARIB_UV[0], CARIB_UV[1]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCarib: { value: new THREE.Vector3(...c) } },
    vertexShader: BAKE_VERT, fragmentShader: bakeFrag(U), depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene();
  sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(sc, cam);

  // low-res float copy for the CPU (sea level, picking spots on land)
  const cw = 256, ch = 128;
  const small = new THREE.WebGLRenderTarget(cw, ch, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  renderer.setRenderTarget(small);
  renderer.render(sc, cam);
  const data = new Float32Array(cw * ch * 4);
  renderer.readRenderTargetPixels(small, 0, 0, cw, ch, data);
  renderer.setRenderTarget(prev);
  small.dispose();

  // sea level so that ~31% of the (area-weighted) surface is land
  const hs = [];
  for (let y = 0; y < ch; y++) {
    const v = (y + 0.5) / ch, wgt = Math.sin((1 - v) * Math.PI);
    for (let x = 0; x < cw; x++) if (((x * 7 + y * 13) % 5) < wgt * 5) hs.push(data[(y * cw + x) * 4]);
  }
  hs.sort((a, b) => a - b);
  const sea = hs[Math.floor(hs.length * 0.69)];
  BAKED = { tex: rt.texture, rt, data, cw, ch, sea };
  return BAKED;
}

/** sample the CPU copy: returns [h, cloud, lights, moist] */
export function sampleEarth(b, u, v) {
  const x = Math.min(b.cw - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * b.cw)));
  const y = Math.min(b.ch - 1, Math.max(0, Math.floor(v * b.ch)));
  const i = (y * b.cw + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

// ---------------------------------------------------------------------------

const SURF_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
varying vec3 vO;
void main() {
  vUv = uv;
  vO = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

function surfFrag(U) {
  return /* glsl */`
precision highp float;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
varying vec3 vO;
uniform sampler2D uTex;
uniform vec3 uSun;
uniform float uSea;
uniform float uLights;
uniform float uNight;
uniform float uExposure;
uniform float uCloudShift;
uniform float uDetail;
${U.GLSL_NOISE}
void main() {
  vec4 e = texture2D(uTex, vUv);
  float cloud = texture2D(uTex, vUv + vec2(uCloudShift, 0.0)).g;
  float h = e.r, moist = e.a;
  // fine detail, faded out when a texel is smaller than a pixel
  float fw = length(fwidth(vO));
  float dk = uDetail * (1.0 - smoothstep(0.004, 0.02, fw));
  float det = 0.0;
  float lat = abs(vO.y);
  // only coastlines and ice edges need the extra octaves
  float need = max(smoothstep(0.045, 0.025, abs(h - uSea)), smoothstep(0.70, 0.76, lat));
  if (dk > 0.001 && need > 0.0)
    det = (vnoise(vO * 70.0) + 0.5 * vnoise(vO * 150.0) - 0.75) * dk * need;
  float hh = h + det * 0.014;
  float land = smoothstep(uSea - 0.0015, uSea + 0.003, hh);

  vec3 green = vec3(0.030, 0.060, 0.022);
  vec3 forest = vec3(0.012, 0.035, 0.014);
  vec3 desert = vec3(0.30, 0.20, 0.10);
  vec3 steppe = vec3(0.12, 0.10, 0.055);
  float arid = smoothstep(0.52, 0.40, moist) * exp(-pow(lat - 0.38, 2.0) / 0.03);
  vec3 lc = mix(green, forest, smoothstep(0.5, 0.64, moist));
  lc = mix(lc, steppe, smoothstep(0.52, 0.45, moist));
  lc = mix(lc, desert, arid);
  lc = mix(lc, vec3(0.09, 0.08, 0.07), smoothstep(uSea + 0.05, uSea + 0.11, h));
  float ice = smoothstep(0.82, 0.88, lat + det * 0.04 + (h - uSea) * 0.5);
  lc = mix(lc, vec3(0.70, 0.74, 0.80), ice);
  vec3 ocean = mix(vec3(0.003, 0.013, 0.036), vec3(0.008, 0.045, 0.065), smoothstep(uSea - 0.04, uSea, hh));
  ocean = mix(ocean, vec3(0.55, 0.60, 0.66), smoothstep(0.90, 0.95, lat + det * 0.03));
  vec3 alb = mix(ocean, lc, land);

  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  float mu = dot(N, uSun);
  float dayK = smoothstep(-0.10, 0.10, mu);
  vec3 sunCol = mix(vec3(1.0, 0.42, 0.16), vec3(1.0, 0.96, 0.90), smoothstep(0.0, 0.3, mu));
  vec3 col = alb * sunCol * max(mu, 0.0) * 2.6;
  // sun glint on water
  vec3 Hh = normalize(uSun + V);
  float spec = pow(max(dot(N, Hh), 0.0), 90.0) * (1.0 - land) * (1.0 - ice);
  col += sunCol * spec * 1.4 * smoothstep(0.0, 0.1, mu);

  // clouds
  float cl = cloud;
  vec3 cloudCol = vec3(0.95) * sunCol * (max(mu, 0.0) * 2.4 + smoothstep(-0.12, 0.05, mu) * 0.05);
  col = mix(col, cloudCol, cl * 0.92);

  // moonlight / earthshine so the night side is not flat black
  vec3 nc = mix(mix(vec3(0.006, 0.012, 0.028), vec3(0.020, 0.024, 0.032), land), vec3(0.05, 0.056, 0.07), cl * 0.9);
  col += nc * uNight * 10.0 * (1.0 - dayK);

  // city lights: clustered, hugging coasts, none on ice
  float coast = exp(-max(h - uSea, 0.0) / 0.035);
  float dens = e.b * land * (1.0 - ice) * (0.25 + 0.75 * coast) * (1.0 - smoothstep(0.6, 0.8, lat));
  float night = 1.0 - smoothstep(-0.15, 0.05, mu);
  float sp = 1.0;
  if (dk > 0.001 && dens * night > 0.002) sp = mix(1.0, 0.25 + 1.5 * smoothstep(0.35, 0.85, vnoise(vO * 480.0)) * (0.5 + 0.5 * vnoise(vO * 1300.0)), dk);
  vec3 lights = vec3(1.0, 0.60, 0.26) * dens * sp * night * (1.0 - cl * 0.85) * uLights;
  col += lights;

  gl_FragColor = vec4(col * uExposure, 1.0);
}`;
}

const ATM_VERT = /* glsl */`
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ATM_FRAG = /* glsl */`
precision highp float;
varying vec3 vP;
uniform vec3 uCenter;
uniform float uR;
uniform float uRa;
uniform float uH;
uniform vec3 uSun;
uniform float uI;
uniform float uGlow;
uniform float uExposure;
void main() {
  vec3 o = (cameraPosition - uCenter) / uR;
  vec3 dir = normalize(vP - cameraPosition);
  float b = dot(o, dir);
  float c = dot(o, o) - uRa * uRa;
  float disc = b * b - c;
  if (disc <= 0.0) discard;
  float sq = sqrt(disc);
  float t0 = max(-b - sq, 0.0), t1 = -b + sq;
  float de = b * b - (dot(o, o) - 1.0);
  if (de > 0.0) { float te = -b - sqrt(de); if (te > 0.0) t1 = min(t1, te); }
  float dt = (t1 - t0) / 6.0;
  vec3 sum = vec3(0.0);
  float glow = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 x = o + dir * (t0 + dt * (float(i) + 0.5));
    float r = length(x);
    float dens = exp(-(r - 1.0) / uH);
    float mus = dot(x / r, uSun);
    float lit = smoothstep(-0.22, 0.12, mus);
    // light reaching this point is reddened near the terminator
    vec3 tr = exp(-vec3(0.25, 0.9, 2.4) * clamp(0.35 - mus, 0.0, 1.0) * 2.2);
    sum += dens * lit * tr;
    glow += dens;
  }
  sum *= dt; glow *= dt;
  float cosT = dot(dir, uSun);
  float ray = 0.75 * (1.0 + cosT * cosT);
  float g = 0.72;
  float mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  vec3 col = sum * (vec3(0.16, 0.40, 1.0) * ray + vec3(1.0, 0.75, 0.5) * mie * 0.12) * uI;
  col += glow * vec3(0.03, 0.09, 0.22) * uGlow;
  gl_FragColor = vec4(col * uExposure, 1.0);
}`;

/**
 * Earth group: unit-radius planet + atmosphere shell. Scale the group to set
 * its radius in world units. Call earth.sync() after moving/scaling the group.
 */
export function createEarth(env, opts = {}) {
  const { THREE, U } = env;
  const baked = bakeEarth(env);
  const seg = opts.segments || [128, 64];
  const group = new THREE.Group();
  const surfU = {
    uTex: { value: baked.tex },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uSea: { value: baked.sea },
    uLights: { value: 2.4 },
    uNight: { value: 0.07 },
    uExposure: { value: 1 },
    uCloudShift: { value: 0 },
    uDetail: { value: 1 },
  };
  const surf = new THREE.Mesh(new THREE.SphereGeometry(1, seg[0], seg[1]),
    new THREE.ShaderMaterial({ uniforms: surfU, vertexShader: SURF_VERT, fragmentShader: surfFrag(U) }));
  // the planet (and its data texture) turns inside this pivot
  const spin = new THREE.Group();
  spin.add(surf);
  group.add(spin);

  const Ra = 1.07;
  const atmU = {
    uCenter: { value: new THREE.Vector3() },
    uR: { value: 1 },
    uRa: { value: Ra },
    uH: { value: 0.011 },
    uSun: surfU.uSun,
    uI: { value: 7.0 },
    uGlow: { value: 1.0 },
    uExposure: surfU.uExposure,
  };
  const atm = new THREE.Mesh(new THREE.SphereGeometry(Ra, seg[0], seg[1]), new THREE.ShaderMaterial({
    uniforms: atmU, vertexShader: ATM_VERT, fragmentShader: ATM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  atm.renderOrder = 5;
  group.add(atm);

  const tmp = new THREE.Vector3();
  return {
    group, spin, surf, atm, uniforms: surfU, atmUniforms: atmU, baked,
    /** after the group transform changes */
    sync() {
      group.updateMatrixWorld(true);
      atmU.uCenter.value.setFromMatrixPosition(group.matrixWorld);
      atmU.uR.value = tmp.setFromMatrixColumn(group.matrixWorld, 0).length();
    },
    setSun(dirWorld) { surfU.uSun.value.copy(dirWorld).normalize(); },
    /** world position of an object-space point on the surface */
    worldOf(local, out) {
      group.updateMatrixWorld(true);
      return out.set(local[0], local[1], local[2]).applyMatrix4(surf.matrixWorld);
    },
  };
}

// ---------------------------------------------------------------------------
// Moon: grey, cratered by noise, lit by the sun with a little earthshine

const MOON_FRAG = (U) => /* glsl */`
precision highp float;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vP;
varying vec3 vO;
uniform vec3 uSun;
uniform float uExposure;
${U.GLSL_NOISE}
void main() {
  float m = fbm(vO * 2.2 + 3.0);
  float cr = vnoise(vO * 9.0);
  float maria = smoothstep(0.50, 0.44, m);
  vec3 alb = mix(vec3(0.20, 0.195, 0.19), vec3(0.085, 0.085, 0.09), maria);
  alb *= 0.8 + 0.4 * smoothstep(0.3, 0.8, cr) * (0.7 + 0.3 * vnoise(vO * 30.0));
  vec3 N = normalize(vN);
  float mu = dot(N, uSun);
  vec3 col = alb * max(mu, 0.0) * 3.4 + alb * vec3(0.3, 0.4, 0.6) * 0.30;
  gl_FragColor = vec4(col * uExposure, 1.0);
}`;

export function createMoon(env) {
  const { THREE, U } = env;
  const u = { uSun: { value: new THREE.Vector3(1, 0, 0) }, uExposure: { value: 1 } };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32),
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: SURF_VERT, fragmentShader: MOON_FRAG(U) }));
  return { mesh, uniforms: u };
}
