// ECHO (animated cut): "ending" (160.0 - 185.0 s)
//
//   160.0-171.0  night Earth from space, slowly turning, the camera drifting
//                on a slow orbit; one tiny light blinks on the dark land (the
//                old observatory). The left of frame stays dark for the text.
//   171.0-173.5  stars come loose and sparks rise from the city lights; they
//                swarm and spiral into the title "E C H O"
//   173.5-176.5  the title holds, glowing and shimmering; then it disperses
//   177.8-184.2  credits (2D overlay)
//
// Title particles are computed in screen space in the vertex shader from
// their world start points (a star, or a lit spot on the turning Earth), so
// every frame is a pure function of t.

import { createEarth, sph, sampleEarth } from './lib_earth.js';
import { createGalaxySky, createGlare, makeGlareTexture, SUN_LOCAL } from './lib_space.js';

const PART_VERT = /* glsl */`
attribute vec3 aStart;
attribute vec2 aTarget;
attribute vec4 aTime;      // depart, arrive, phase, random
attribute vec2 aKind;      // kind (0 star, 1 spark), halo (0/1)
uniform float uTime;
uniform mat4 uVP;
uniform mat4 uEarth;
uniform vec3 uEarthC;
uniform vec2 uRes;
uniform float uHold;
uniform float uOutDur;
uniform float uSweep;
varying vec3 vCol;
varying float vA;

vec2 toPx(vec3 w) {
  vec4 c = uVP * vec4(w, 1.0);
  vec2 n = c.xy / max(c.w, 1e-4);
  return vec2((n.x * 0.5 + 0.5) * uRes.x, (0.5 - n.y * 0.5) * uRes.y);
}
float ease(float x) { return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }

void main() {
  float t = uTime;
  float td = aTime.x, ta = aTime.y, ph = aTime.z, rnd = aTime.w;
  bool spark = aKind.x > 0.5;
  float halo = aKind.y;
  float u = clamp((t - td) / (ta - td), 0.0, 1.0);
  float e = ease(u);

  // where it starts from, right now
  vec3 sw;
  if (spark) {
    vec3 n = normalize(mat3(uEarth) * aStart);
    sw = uEarthC + n * (1.003 + 0.45 * smoothstep(0.0, 0.5, u));
  } else {
    sw = aStart;
  }
  vec2 p0 = toPx(sw);
  vec2 pT = aTarget;

  // spiral in: the offset turns while it shrinks
  vec2 d = p0 - pT;
  float spin = (0.9 + 0.9 * rnd) * (rnd > 0.12 ? 1.0 : -1.0);
  float a = spin * e;
  vec2 dr = vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a));
  vec2 pos = pT + dr * (1.0 - e);

  // hold: a slow shimmer; halo motes circle their letter point
  float hold = step(1.0, u);
  float w1 = 1.7 + 1.3 * rnd, w2 = 2.3 + 1.1 * fract(rnd * 7.3);
  vec2 jit = vec2(sin(t * w1 + ph), cos(t * w2 + ph * 1.7)) * (0.55 + halo * (6.0 + 10.0 * rnd));
  pos += jit * smoothstep(0.85, 1.0, u);

  // disperse: drift outward and up like embers, fading
  float v = clamp((t - uHold) / uOutDur, 0.0, 1.0);
  vec2 outDir = normalize(pT - vec2(uRes.x * 0.5, uRes.y * 0.52) + vec2(cos(ph), sin(ph)) * 90.0);
  pos += (outDir * (60.0 + 160.0 * rnd) + vec2(20.0 * sin(ph * 3.0), -70.0 - 50.0 * rnd)) * pow(v, 1.5);

  gl_Position = vec4(pos.x / uRes.x * 2.0 - 1.0, 1.0 - pos.y / uRes.y * 2.0, 0.0, 1.0);

  // colour: stars cool, sparks warm, the title a cool white
  vec3 cStart = spark ? vec3(1.0, 0.66, 0.34) : vec3(0.78, 0.86, 1.0);
  vec3 cTitle = mix(vec3(0.86, 0.92, 1.0), vec3(1.0, 0.93, 0.82), fract(rnd * 13.1) * 0.5);
  vCol = mix(cStart, cTitle, smoothstep(0.55, 1.0, u));

  float alpha;
  if (spark) alpha = smoothstep(td, td + 0.25, t);
  else alpha = 0.35 + 0.65 * fract(rnd * 5.7);             // as a star, before it leaves
  alpha = mix(alpha, 1.0, smoothstep(0.0, 0.3, u) * (spark ? 0.0 : 1.0));
  float tw = 0.78 + 0.22 * sin(t * (3.0 + 2.0 * rnd) + ph * 2.0);
  float sweep = exp(-pow((pT.x - uSweep) / 90.0, 2.0)) * 0.42;
  float inTitle = hold * (tw + sweep);
  float flying = (1.0 - hold) * (1.0 + 0.4 * sin(u * 3.14159));
  alpha *= mix(flying, inTitle, hold) * (1.0 - halo * 0.72);
  alpha *= 1.0 - smoothstep(0.25, 1.0, v);
  vA = alpha;
  float size = spark ? 2.6 : mix(1.7 + 1.3 * fract(rnd * 3.1), 2.8, smoothstep(0.0, 0.4, u));
  size = mix(size, 3.1, hold) * (1.0 - 0.3 * halo) + (1.0 - hold) * 1.2 * sin(u * 3.14159);
  gl_PointSize = size;
  if (alpha <= 0.001) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const PART_FRAG = /* glsl */`
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * vA * exp(-r2 * 2.6) * 1.35, 1.0);
}`;

export async function create(env) {
  const { THREE, TL, U, W, H, FONT } = env;
  const EN = TL.ending;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const T_PART = EN.title_particles.start, T_FORMED = EN.title_particles.end;
  const T_HOLD = EN.title_hold_until, T_OUT = EN.title_out;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 2000);

  // ---------------------------------------------------------------- sky ----
  const sky = createGalaxySky(env);
  sky.uniforms.uEye.value.set(...SUN_LOCAL);
  sky.uniforms.uRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.95, -0.55, 0.62, 'YXZ')));
  sky.uniforms.uGal.value = 3.2e7;
  sky.uniforms.uLocal.value = 170;
  scene.add(sky.points, sky.dust);

  // -------------------------------------------------------------- earth ----
  const earth = createEarth(env, { segments: [160, 80] });
  const sun = V(0.62, 0.40, -0.68).normalize();              // behind the planet, upper right
  earth.setSun(sun);
  const axis = V(0.18, 1, 0.22).normalize();
  earth.group.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
  earth.uniforms.uNight.value = 0.055;
  earth.atmUniforms.uI.value = 5.2;
  scene.add(earth.group);
  const spinAt = t => (t - 160) * 1.25 * Math.PI / 180 - 1.1;

  // camera: slow orbit about the planet, Earth kept on the right of frame;
  // it eases back while the title forms
  const camAt = (t, cam) => {
    const phi = (t - 166) * 0.32 * Math.PI / 180;
    const back = U.easeInOut(U.prog(t, 170.0, 179.0));
    const away = U.easeInOut(U.prog(t, 170.6, 174.2));      // the planet slides right, out from behind the title
    const dist = 3.55 + 1.05 * back;
    const rot = new THREE.Matrix4().makeRotationY(phi);
    const pos = V(0, 0.55, dist).applyMatrix4(rot);
    const tgt = V(-1.48 * dist / 3.55 - 1.55 * away, 0.08 - 0.42 * away, 0).applyMatrix4(rot);
    cam.position.copy(pos);
    cam.up.set(0.06, 1, 0).applyMatrix4(rot);
    cam.lookAt(tgt);
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    return cam;
  };
  const earthMatrixAt = (t, out) => {
    earth.spin.quaternion.setFromAxisAngle(V(0, 1, 0), spinAt(t));
    earth.group.updateMatrixWorld(true);
    return out.copy(earth.surf.matrixWorld);
  };

  // --------------------------------------------------- observatory light --
  const B = earth.baked;
  const probe = new THREE.PerspectiveCamera(40, W / H, 0.02, 2000);
  camAt(166, probe);
  const m166 = earthMatrixAt(166, new THREE.Matrix4());
  const want = [W * 0.735, H * 0.60];
  let obs = null, best = -1e9;
  for (let y = 8; y < B.ch - 8; y++) {
    for (let x = 0; x < B.cw; x++) {
      const u = (x + 0.5) / B.cw, v = (y + 0.5) / B.ch;
      const [h, , li] = sampleEarth(B, u, v);
      if (h < B.sea + 0.012 || li > 0.03) continue;
      const p = V(...sph(u, v));
      const wp = p.clone().applyMatrix4(m166);
      const n = wp.clone().normalize();
      if (n.dot(sun) > -0.25) continue;
      if (n.dot(probe.position.clone().sub(wp).normalize()) < 0.45) continue;
      const sc = wp.clone().project(probe);
      const sx = (sc.x + 1) / 2 * W, sy = (1 - sc.y) / 2 * H;
      // no city lights close by, so it reads as one light alone
      let near = 0;
      for (let k = -3; k <= 3; k++) for (let j = -2; j <= 2; j++) near += sampleEarth(B, u + k / B.cw, v + j / B.ch)[2];
      const score = -Math.hypot(sx - want[0], sy - want[1]) - near * 400;
      if (score > best) { best = score; obs = p; }
    }
  }
  const beaconTex = makeGlareTexture(THREE, 128, 0.18);
  const beacon = createGlare(env, beaconTex, [1.0, 0.84, 0.62], { order: 15, depthTest: true });
  const beaconHalo = createGlare(env, beaconTex, [1.0, 0.7, 0.45], { order: 15, depthTest: true });
  scene.add(beacon.sprite, beaconHalo.sprite);
  const beaconLevel = t => {
    const t0 = 162.7, per = 1.9;
    if (t < t0) return 0;
    const x = ((t - t0) / per) % 1;
    const pulse = U.smooth(0, 0.05, x) * (1 - U.smooth(0.22, 0.42, x));
    const first = U.smooth(t0, t0 + 0.08, t);
    return first * (0.12 + 0.88 * pulse) * (1 - U.smooth(171.0, 172.4, t));
  };

  // ------------------------------------------------------- title targets --
  const rnd = U.mulberry32(185);
  const targets = [];
  {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.font = `bold 232px ${FONT}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('E C H O', W / 2, H * 0.5 + 6);
    const img = x.getImageData(0, 0, W, H).data;
    const step = 3.4;
    for (let yy = 0; yy < H; yy += step) {
      for (let xx = 0; xx < W; xx += step) {
        const px = xx + (rnd() - 0.5) * step * 0.8, py = yy + (rnd() - 0.5) * step * 0.8;
        const i = (Math.round(py) * W + Math.round(px)) * 4;
        if (img[i + 3] > 140) targets.push([px, py]);
      }
    }
  }
  const NT = targets.length, NHALO = 900, N = NT + NHALO;

  // spark sources: lit spots on the night side facing the camera at 171
  const camP = camAt(T_PART, probe).position.clone();
  const m171 = earthMatrixAt(T_PART, new THREE.Matrix4());
  const sources = [];
  for (let y = 4; y < B.ch - 4; y++) {
    for (let x = 0; x < B.cw; x++) {
      const u = (x + 0.5) / B.cw, v = (y + 0.5) / B.ch;
      const [h, , li] = sampleEarth(B, u, v);
      if (h < B.sea || li < 0.08) continue;
      const p = V(...sph(u, v));
      const wp = p.clone().applyMatrix4(m171);
      const n = wp.clone().normalize();
      if (n.dot(sun) > -0.1) continue;
      if (n.dot(camP.clone().sub(wp).normalize()) < 0.3) continue;
      sources.push(p);
    }
  }

  const aStart = new Float32Array(N * 3), aTarget = new Float32Array(N * 2);
  const aTime = new Float32Array(N * 4), aKind = new Float32Array(N * 2);
  const earthScreen = (() => {
    const c = V(0, 0, 0).project(probe);
    return [(c.x + 1) / 2 * W, (1 - c.y) / 2 * H];
  })();
  for (let i = 0; i < N; i++) {
    const halo = i >= NT;
    let tx, ty;
    if (!halo) [tx, ty] = targets[i];
    else {
      const b = targets[Math.floor(rnd() * NT)];
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 34;
      tx = b[0] + Math.cos(a) * r; ty = b[1] + Math.sin(a) * r;
    }
    aTarget[i * 2] = tx; aTarget[i * 2 + 1] = ty;
    const spark = sources.length > 0 && rnd() < 0.58;
    if (spark) {
      const p = sources[Math.floor(rnd() * sources.length)];
      aStart.set([p.x, p.y, p.z], i * 3);
      const td = T_PART + rnd() * 1.1;
      aTime.set([td, Math.min(T_FORMED, td + 1.35 + rnd() * 0.9), rnd() * 6.283, rnd()], i * 4);
    } else {
      // a star somewhere in the dark part of the frame
      let sx, sy;
      for (let k = 0; k < 20; k++) {
        sx = rnd() * W; sy = rnd() * H;
        if (Math.hypot(sx - earthScreen[0], sy - earthScreen[1]) > 560) break;
      }
      const ndc = V(sx / W * 2 - 1, 1 - sy / H * 2, 0.5).unproject(probe);
      const dir = ndc.sub(probe.position).normalize();
      aStart.set(probe.position.clone().addScaledVector(dir, 400).toArray(), i * 3);
      const td = T_PART + rnd() * 0.9;
      aTime.set([td, Math.min(T_FORMED, td + 1.5 + rnd() * 0.9), rnd() * 6.283, rnd()], i * 4);
    }
    aKind[i * 2] = spark ? 1 : 0;
    aKind[i * 2 + 1] = halo ? 1 : 0;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  pgeo.setAttribute('aStart', new THREE.BufferAttribute(aStart, 3));
  pgeo.setAttribute('aTarget', new THREE.BufferAttribute(aTarget, 2));
  pgeo.setAttribute('aTime', new THREE.BufferAttribute(aTime, 4));
  pgeo.setAttribute('aKind', new THREE.BufferAttribute(aKind, 2));
  const pU = {
    uTime: { value: 0 },
    uVP: { value: new THREE.Matrix4() },
    uEarth: { value: new THREE.Matrix4() },
    uEarthC: { value: new THREE.Vector3() },
    uRes: { value: new THREE.Vector2(W, H) },
    uHold: { value: T_HOLD },
    uOutDur: { value: T_OUT },
    uSweep: { value: -1000 },
  };
  const parts = new THREE.Points(pgeo, new THREE.ShaderMaterial({
    uniforms: pU, vertexShader: PART_VERT, fragmentShader: PART_FRAG,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  parts.frustumCulled = false;
  parts.renderOrder = 30;
  scene.add(parts);

  // ------------------------------------------------------------- update ---
  const inst = { scene, camera };
  inst.update = function (t) {
    camAt(t, camera);
    camera.near = 0.02; camera.far = 2000;
    camera.updateProjectionMatrix();
    sky.fit(camera);

    earthMatrixAt(t, pU.uEarth.value);
    earth.uniforms.uCloudShift.value = (t - 160) * 0.00045;
    const dim = 1 - 0.62 * U.smooth(170.8, 173.2, t) - 0.12 * U.smooth(176.5, 178.5, t);
    earth.uniforms.uExposure.value = dim;
    earth.uniforms.uLights.value = 2.4 * (1 - 0.35 * U.smooth(171, 172.5, t));
    earth.sync();

    // the observatory's light
    const bl = beaconLevel(t);
    const bp = obs.clone().multiplyScalar(1.004).applyMatrix4(pU.uEarth.value);
    beacon.set(camera, bp, 8, 4.0 * bl);
    beaconHalo.set(camera, bp, 64, 0.30 * bl);

    // stars dim a touch under the title and credits
    const skyK = 1 - 0.35 * U.smooth(171.5, 174, t);
    sky.uniforms.uGal.value = 3.2e7 * skyK;
    sky.uniforms.uLocal.value = 170 * skyK;

    pU.uTime.value = t;
    pU.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    pU.uEarthC.value.set(0, 0, 0);
    pU.uSweep.value = U.lerp(W * 0.18, W * 0.86, U.prog(t, 174.0, 175.6));
    parts.visible = t < T_HOLD + T_OUT + 0.05;
  };

  inst.bloom = function (t) {
    const k = U.smooth(171.5, 173.5, t) * (1 - U.smooth(T_HOLD, T_HOLD + T_OUT, t));
    return { strength: 0.55 + 0.25 * k, radius: 0.45 + 0.05 * k, threshold: 0.62 - 0.12 * k };
  };

  // credits, drawn in the 2D layer below the framework's fades
  inst.overlay = function (t, g) {
    const cr = EN.credits;
    if (t < cr.start - 0.1 || t > cr.end + 0.1) return;
    const out = 1 - U.smooth(cr.end - 1.0, cr.end, t);
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    cr.lines.forEach((line, i) => {
      const last = i === cr.lines.length - 1;
      const t0 = cr.start + i * 0.75;
      const a = U.smooth(t0, t0 + 1.1, t) * out;
      if (a <= 0) return;
      const y = H / 2 - 50 + i * 56 + (last ? 22 : 0);
      g.globalAlpha = a;
      g.font = `bold ${last ? 30 : 26}px ${FONT}`;
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 12;
      g.fillStyle = last ? '#f2f1ea' : '#a9a8a2';
      g.fillText(line, W / 2, y);
      if (last) {
        g.shadowColor = 'rgba(210,225,255,0.35)';
        g.shadowBlur = 14;
        g.fillText(line, W / 2, y);
      }
    });
    g.restore();
  };

  return inst;
}
