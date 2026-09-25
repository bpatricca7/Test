// Procedural sky dome: gradient, sun, moon, clouds, stars and a faint milky way.
// Lighting "moods" (presets) drive the sky, fog, sun light and exposure together.
import * as THREE from 'three';
import { lerp } from '../lib/anim.js';

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudCol, uCloudShade, uMoonDir;
uniform float uSunSize, uSunGlow, uNight, uCloud, uTime, uHaze, uMoon, uCloudSpeed;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), u.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  col += uHorizon * 0.22 * exp(-abs(h) * 10.0) * uHaze;
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));

  // Stars + milky way
  if (uNight > 0.001) {
    float above = smoothstep(-0.02, 0.2, h);
    vec3 bandN = normalize(vec3(0.35, 0.6, 0.72));
    float band = exp(-pow(dot(d, bandN) * 4.5, 2.0));
    float mw = band * (0.55 * vnoise3(d * 9.0) + 0.45 * vnoise3(d * 23.0));
    col += vec3(0.32, 0.30, 0.55) * mw * 0.35 * uNight * above;
    for (int layer = 0; layer < 2; layer++) {
      float sc = layer == 0 ? 180.0 : 380.0;
      vec3 p = d * sc;
      vec3 cell = floor(p);
      float r = hash(cell + float(layer) * 17.0);
      float thr = layer == 0 ? 0.965 : 0.93 - band * 0.12;
      if (r > thr) {
        vec3 jit = vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5;
        float dist = length(fract(p) - 0.5 - jit * 0.6);
        float size = layer == 0 ? 0.15 : 0.09;
        float s = smoothstep(size, 0.0, dist);
        float tw = 0.65 + 0.35 * sin(uTime * (2.0 + r * 5.0) + r * 60.0);
        vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash(cell + 9.0));
        col += tint * s * tw * uNight * above * (layer == 0 ? 3.5 : 1.4);
      }
    }
  }

  // Sun
  float sd = dot(d, uSunDir);
  float disk = smoothstep(cos(uSunSize), cos(uSunSize * 0.82), sd);
  col += uSunColor * disk * 14.0;
  col += uSunColor * (pow(max(sd, 0.0), 5.0) * 0.28 + pow(max(sd, 0.0), 48.0) * 0.9) * uSunGlow;

  // Moon
  if (uMoon > 0.001) {
    float md = dot(d, uMoonDir);
    float m = smoothstep(0.99955, 0.99965, md);
    float crat = 0.75 + 0.25 * vnoise3(d * 400.0);
    col += vec3(1.0, 0.97, 0.9) * m * crat * 1.5 * uMoon;
    col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 600.0) * 0.25 * uMoon;
  }

  // Clouds (flat layer projected onto the dome)
  if (uCloud > 0.001 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.08) * 1.6 + vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.3);
    float n = fbm(uv * 0.9);
    float dens = smoothstep(0.52 - uCloud * 0.25, 0.85, n) * smoothstep(0.0, 0.25, h);
    float lit = clamp(0.5 + 0.8 * (fbm(uv * 0.9 + uSunDir.xz * 0.15) - n) * -4.0, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudCol, lit);
    cc += uSunColor * pow(max(sd, 0.0), 12.0) * 0.6;
    col = mix(col, cc, dens * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
      uSunColor: { value: new THREE.Color() },
      uCloudCol: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0.3, 0.5, -1).normalize() },
      uSunSize: { value: 0.03 },
      uSunGlow: { value: 1 },
      uNight: { value: 0 },
      uCloud: { value: 0 },
      uCloudSpeed: { value: 0.01 },
      uTime: { value: 0 },
      uHaze: { value: 1 },
      uMoon: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }
  follow(camera) {
    this.mesh.position.copy(camera.position);
  }
}

// ---------------------------------------------------------------------------
// Moods. Colors are sRGB hex; sun given as elevation/azimuth in degrees.
// Azimuth 0 = towards -Z (into the screen for our default layout), 90 = +X.
export const MOODS = {
  dustyMorning: {
    zenith: '#b89c83', horizon: '#f2c894', ground: '#b88a60', sunEl: 14, sunAz: -30, sunColor: '#ffd9a0', sunSize: 0.035, sunGlow: 1.3,
    lightColor: '#ffd6a3', light: 3.1, hemiSky: '#f3d2ac', hemiGround: '#7a5234', hemi: 1.25,
    fog: '#e6bb8c', fogDensity: 0.0125, night: 0, cloud: 0.25, cloudCol: '#f7dcc0', cloudShade: '#b08c74', haze: 1.2, exposure: 1.0, bloom: 0.55, moon: 0,
  },
  dustyDay: {
    zenith: '#9ea4aa', horizon: '#eac498', ground: '#b88a60', sunEl: 38, sunAz: -50, sunColor: '#fff0d0', sunSize: 0.03, sunGlow: 1.0,
    lightColor: '#ffe7c2', light: 3.3, hemiSky: '#efd6b8', hemiGround: '#7a5234', hemi: 1.3,
    fog: '#e3c49c', fogDensity: 0.011, night: 0, cloud: 0.2, cloudCol: '#f5e2c8', cloudShade: '#b59a82', haze: 1.1, exposure: 1.0, bloom: 0.5, moon: 0,
  },
  sunset: {
    zenith: '#433c72', horizon: '#ffa060', ground: '#8a5a40', sunEl: 3.5, sunAz: 180, sunColor: '#ff7a33', sunSize: 0.06, sunGlow: 2.2,
    lightColor: '#ffa860', light: 2.7, hemiSky: '#c89aa8', hemiGround: '#5a3a2a', hemi: 1.0,
    fog: '#eb9868', fogDensity: 0.011, night: 0.15, cloud: 0.45, cloudCol: '#ffb488', cloudShade: '#6c4a78', haze: 1.4, exposure: 1.05, bloom: 0.8, moon: 0,
  },
  dusk: {
    zenith: '#1d1f45', horizon: '#b0607a', ground: '#4a2e33', sunEl: -2, sunAz: 180, sunColor: '#ff6040', sunSize: 0.06, sunGlow: 1.2,
    lightColor: '#b59ad8', light: 0.7, hemiSky: '#7c6aa8', hemiGround: '#3a2530', hemi: 0.7,
    fog: '#7a4f6e', fogDensity: 0.012, night: 0.6, cloud: 0.35, cloudCol: '#c07a8a', cloudShade: '#3a2c55', haze: 1.1, exposure: 1.1, bloom: 0.8, moon: 0,
  },
  night: {
    zenith: '#050a1e', horizon: '#1f2d55', ground: '#161a2a', sunEl: -20, sunAz: 180, sunColor: '#000000', sunSize: 0.03, sunGlow: 0,
    lightColor: '#8fa8ff', light: 0.9, hemiSky: '#4a5b9a', hemiGround: '#1a1a2a', hemi: 0.75,
    fog: '#1c2748', fogDensity: 0.012, night: 1, cloud: 0.0, cloudCol: '#2b3560', cloudShade: '#0d1330', haze: 0.8, exposure: 1.25, bloom: 0.75, moon: 1,
    moonEl: 32, moonAz: -20,
  },
  dawn: {
    zenith: '#3e5d96', horizon: '#ffb07a', ground: '#8a5e46', sunEl: 2, sunAz: -10, sunColor: '#ffb070', sunSize: 0.05, sunGlow: 2.0,
    lightColor: '#ffbc88', light: 2.2, hemiSky: '#a9a8c8', hemiGround: '#5a3a2e', hemi: 0.95,
    fog: '#e4a888', fogDensity: 0.01, night: 0.25, cloud: 0.4, cloudCol: '#ffc8a8', cloudShade: '#6a6a9a', haze: 1.2, exposure: 1.05, bloom: 0.8, moon: 0,
  },
  bloomDay: {
    zenith: '#2f7fd6', horizon: '#c4e6f7', ground: '#6a8a4a', sunEl: 30, sunAz: -25, sunColor: '#fff4dd', sunSize: 0.03, sunGlow: 1.0,
    lightColor: '#fff1d6', light: 3.4, hemiSky: '#bfe0ff', hemiGround: '#4d6b30', hemi: 1.35,
    fog: '#c9e4f2', fogDensity: 0.0055, night: 0, cloud: 0.55, cloudCol: '#ffffff', cloudShade: '#a9bcd6', haze: 0.8, exposure: 1.0, bloom: 0.5, moon: 0,
  },
  goldenHour: {
    zenith: '#4f6fb8', horizon: '#ffc48a', ground: '#6a7040', sunEl: 7, sunAz: 160, sunColor: '#ffab5c', sunSize: 0.05, sunGlow: 1.9,
    lightColor: '#ffb772', light: 2.8, hemiSky: '#b7b6d6', hemiGround: '#4a5a2a', hemi: 1.0,
    fog: '#f0b88e', fogDensity: 0.0065, night: 0.05, cloud: 0.5, cloudCol: '#ffd0a0', cloudShade: '#7a6e9a', haze: 1.1, exposure: 1.05, bloom: 0.75, moon: 0,
  },
  twilightGarden: {
    zenith: '#141a45', horizon: '#c7708a', ground: '#2e3326', sunEl: -3, sunAz: 160, sunColor: '#ff7050', sunSize: 0.05, sunGlow: 1.0,
    lightColor: '#b8a0e0', light: 0.9, hemiSky: '#6e6aa8', hemiGround: '#23301e', hemi: 0.75,
    fog: '#5e4a72', fogDensity: 0.008, night: 0.75, cloud: 0.3, cloudCol: '#c07a9a', cloudShade: '#2c2a55', haze: 1.0, exposure: 1.15, bloom: 0.95, moon: 0.8,
    moonEl: 25, moonAz: -30,
  },
};

const colorKeys = ['zenith', 'horizon', 'ground', 'sunColor', 'lightColor', 'hemiSky', 'hemiGround', 'fog', 'cloudCol', 'cloudShade'];
const numKeys = ['sunEl', 'sunAz', 'sunSize', 'sunGlow', 'light', 'hemi', 'fogDensity', 'night', 'cloud', 'haze', 'exposure', 'bloom', 'moon', 'moonEl', 'moonAz'];

export function mood(name, overrides = {}) {
  const m = { moonEl: 30, moonAz: 0, ...MOODS[name], ...overrides };
  const out = { name };
  for (const k of colorKeys) out[k] = new THREE.Color(m[k]);
  for (const k of numKeys) out[k] = m[k];
  return out;
}

export function mixMood(a, b, k) {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const out = { name: k < 0.5 ? a.name : b.name };
  for (const key of colorKeys) out[key] = a[key].clone().lerp(b[key], k);
  for (const key of numKeys) out[key] = lerp(a[key], b[key], k);
  return out;
}

export function dirFromAngles(elDeg, azDeg) {
  const el = THREE.MathUtils.degToRad(elDeg), az = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
