// Day & night: gradient sky dome with sun and moon, twinkling stars, a drifting blocky cloud
// layer, fog and light levels driven by game.time.dayTime (0.25 sunrise, 0.5 noon, 0.75
// sunset). Emits 'time:morning' / 'time:night' when the clock crosses them.
// The Environment team expands this (weather tie-ins, richer sky, settings for freezing time).

import * as THREE from 'three';
import { smoothstep, clamp, hexToRgb } from '../core/util.js';

const NIGHT_TOP = '#141A4A';
const NIGHT_HORIZON = '#3E3F8E';
const DUSK_TOP = '#7C79E8';
const DUSK_HORIZON = '#FFC4A6';
const MORNING_AT = 0.25;
const NIGHT_AT = 0.78;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // pinned to the far plane
}`;

const skyFrag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.6, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (smoothstep(0.9985, 0.9992, s) * 0.9 + pow(s, 16.0) * 0.22) * (1.0 - uNight);
  float m = max(dot(d, -uSunDir), 0.0);
  col = mix(col, vec3(0.98, 0.97, 1.0), smoothstep(0.9990, 0.9994, m) * uNight);
  col += vec3(0.5, 0.55, 0.9) * pow(m, 60.0) * 0.18 * uNight;
  gl_FragColor = vec4(col, 1.0);
}`;

const starVert = /* glsl */ `
attribute float phase;
uniform float uTime;
uniform float uPixel;
varying float vTw;
void main() {
  vTw = 0.55 + 0.45 * sin(uTime * (1.5 + phase * 2.0) + phase * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (1.6 + phase * 2.2) * uPixel;
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999;
}`;

const starFrag = /* glsl */ `
uniform float uNight;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), a * vTw * uNight);
}`;

function rgbUnit(hex) {
  const [r, g, b] = hexToRgb(hex);
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
}

function mixColor(out, a, b, t) {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(rand() * 32), y = Math.floor(rand() * 32);
    const w = 3 + Math.floor(rand() * 7), h = 2 + Math.floor(rand() * 4);
    g.fillStyle = '#FFFFFF';
    for (const [ox, oy] of [[0, 0], [32, 0], [0, 32], [32, 32], [-32, 0], [0, -32]]) {
      g.fillRect(x + ox, y + oy, w, h);
      g.fillRect(x + ox + 1, y + oy - 1, Math.max(1, w - 2), h + 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function install(game) {
  const scene = game.scene;
  const u = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.8) },
    uNight: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({ uniforms: u, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false }),
  );
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.name = 'sky';
  scene.add(dome);

  // stars on the upper sky
  const N = 700;
  const pos = new Float32Array(N * 3), phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = Math.random() * 0.95 + 0.05;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 450;
    pos[i * 3 + 1] = y * 450;
    pos[i * 3 + 2] = Math.sin(a) * r * 450;
    phase[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const starU = { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 } };
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    uniforms: starU, vertexShader: starVert, fragmentShader: starFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  stars.renderOrder = -999;
  stars.frustumCulled = false;
  scene.add(stars);

  // blocky clouds drifting above the build height
  const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.renderOrder = -10;
  clouds.visible = false;
  scene.add(clouds);

  scene.fog = new THREE.Fog(0xcdefff, 40, 140);

  const dayTop = new THREE.Color(), dayHorizon = new THREE.Color();
  const nightTop = rgbUnit(NIGHT_TOP), nightHorizon = rgbUnit(NIGHT_HORIZON);
  const duskTop = rgbUnit(DUSK_TOP), duskHorizon = rgbUnit(DUSK_HORIZON);
  const top = new THREE.Color(), horizon = new THREE.Color(), tmp = new THREE.Color();
  const moonTint = new THREE.Color(0.7, 0.72, 1.0), white = new THREE.Color(1, 1, 1), warm = new THREE.Color(1, 0.86, 0.76);
  let lastAbs = null;

  const setBiomeSky = () => {
    const biome = game.world ? game.registry.biomes.get(game.world.meta.biome) : null;
    const sky = (biome && biome.sky) || { top: '#5FB8FF', horizon: '#CDEFFF' };
    dayTop.copy(rgbUnit(sky.top));
    dayHorizon.copy(rgbUnit(sky.horizon));
    lastAbs = null;
    if (game.world) {
      clouds.position.set(game.world.sx / 2, game.world.sy + 8, game.world.sz / 2);
      clouds.visible = true;
    }
  };
  setBiomeSky();
  game.events.on('world:load', setBiomeSky);
  game.events.on('world:unload', () => { clouds.visible = false; });

  game.addSystem({
    name: 'daynight',
    update(dt) {
      const cam = game.camera.position;
      dome.position.copy(cam);
      stars.position.copy(cam);
      const tm = game.time;
      const d = tm.dayTime;
      const ang = (d - 0.25) * Math.PI * 2;
      const elev = Math.sin(ang);
      u.uSunDir.value.set(Math.cos(ang) * 0.9, elev, 0.42).normalize();
      const dayF = smoothstep(-0.14, 0.22, elev);
      const dusk = clamp(1 - Math.abs(elev) / 0.32, 0, 1) * 0.75;
      mixColor(top, nightTop, dayTop, dayF);
      mixColor(horizon, nightHorizon, dayHorizon, dayF);
      mixColor(top, top, duskTop, dusk * 0.5);
      mixColor(horizon, horizon, duskHorizon, dusk);
      u.uTop.value.copy(top);
      u.uHorizon.value.copy(horizon);
      u.uNight.value = 1 - dayF;
      starU.uNight.value = clamp(1 - dayF * 1.4, 0, 1);
      starU.uTime.value = tm.t;
      starU.uPixel.value = game.renderer.getPixelRatio();

      // block shader + scene fog share the horizon color (raw sRGB in the block shader)
      const bu = game.blockUniforms;
      const worldR = game.world ? Math.max(game.world.sx, game.world.sz) : 144;
      // flying high: push the fog out so the island below stays clear
      const ground = game.world ? Math.max(game.world.waterLevel || 0, 16) : 20;
      const lift = Math.max(0, cam.y - ground - 14);
      const far = clamp(worldR * 0.95, 120, 200) + lift * 1.6;
      const near = far * 0.3 + lift * 0.6;
      if (bu) {
        // nights stay a gentle, readable indigo (no scary darkness); rooms stay cheerful by day
        bu.uDaylight.value = 0.4 + 0.6 * dayF;
        bu.uAmbient.value = 0.22 + 0.38 * dayF;
        mixColor(tmp, moonTint, white, dayF);
        bu.uSkyColor.value.copy(mixColor(tmp, tmp, warm, dusk * 0.6));
        bu.uFogColor.value.copy(horizon);
        bu.uFogNear.value = near;
        bu.uFogFar.value = far;
      }
      // horizon is raw sRGB; convert for three's color-managed fog/background
      game.scene.fog.color.setRGB(horizon.r, horizon.g, horizon.b, THREE.SRGBColorSpace);
      game.scene.fog.near = near;
      game.scene.fog.far = far;
      if (game.scene.background && game.scene.background.isColor) game.scene.background.copy(game.scene.fog.color);

      const L = game.lights;
      L.hemi.intensity = 0.6 + 1.35 * dayF;
      L.sun.intensity = 1.7 * dayF;
      L.sun.position.copy(u.uSunDir.value);
      L.hemi.color.setRGB(0.75 + 0.25 * dayF, 0.78 + 0.22 * dayF, 1, THREE.SRGBColorSpace);

      cloudMat.color.setRGB(0.55 + 0.45 * dayF, 0.55 + 0.45 * dayF, 0.7 + 0.3 * dayF, THREE.SRGBColorSpace);
      cloudMat.map.offset.x += dt * 0.0015;
      game.audio.setNight(dayF < 0.4);

      // morning / night events when the clock crosses them (a night slept through with
      // skipToMorning() is quiet: no time:night, so no "saw the stars" without stars)
      if (game.mode === 'play') {
        const abs = tm.day + d;
        if (lastAbs !== null && abs > lastAbs) {
          if (Math.floor(abs - MORNING_AT) > Math.floor(lastAbs - MORNING_AT)) game.events.emit('time:morning', { day: tm.day });
          if (Math.floor(abs - NIGHT_AT) > Math.floor(lastAbs - NIGHT_AT) && !tm.quietNight) game.events.emit('time:night', {});
        }
        tm.quietNight = false;
        lastAbs = abs;
      }
    },
  });
}
