// ECHO (characters cut) — frame compositor.
//
// render.js loads index.html, calls window.init(timeline, audioEnv, only) once,
// then window.renderFrame(t) per frame. The film itself is one scene module,
// scenes/film.js; this file runs bloom and draws the 2D layer on top: the
// typewriter opening, dialogue subtitles, the title card and credits.
//
// Test mode: `render.js --only <module>` with a module that isn't part of the
// film (e.g. test_human) renders that module for every t, for building pieces
// in isolation.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as U from './lib/util.js';

const W = 1920, H = 1080;
const FONT = '"FreeMono", "Courier New", monospace';
const SUB_FONT = '"DejaVu Sans", "Liberation Sans", sans-serif';
const MODULES = { film: 'film' };

let TL, ENV, renderer, composer, renderPass, bloomPass, bokehPass, gradePass, g, VIGNETTE, TEST = null;
const LETTERBOX = Math.round((H - W / 2.39) / 2);   // 2.39:1 scope bars

// film grade, in display space: teal-leaning shadows, warm highlights, a gentle S-curve
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 1.0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmt; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 g = c + vec3(-0.010, 0.006, 0.020) * (1.0 - smoothstep(0.0, 0.45, l))
                 + vec3(0.022, 0.010, -0.016) * smoothstep(0.35, 1.0, l);
      g = mix(g, g * g * (3.0 - 2.0 * g), 0.22);
      g = mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, 1.04);
      gl_FragColor = vec4(mix(c, clamp(g, 0.0, 1.0), uAmt), 1.0);
    }`,
};
const instances = {};

function buildVignette() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.1);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);
  return c;
}

// ---------------------------------------------------------------------------
// typewriter opening (same look as the earlier cuts)
// ---------------------------------------------------------------------------

function charsTyped(cue, t) {
  const ct = cue.char_times;
  let lo = 0, hi = ct.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

function drawTypewriter(t) {
  let cursorCue = null;
  for (const cue of TL.text) if (cue.start <= t && t <= cue.hold_until) cursorCue = cue;
  for (const cue of TL.text) {
    const end = cue.hold_until + cue.fade;
    if (t < cue.start || t > end) continue;
    const n = charsTyped(cue, t);
    const x = 0.14 * W, y = 0.5 * H, size = 34;
    const txt = cue.text.slice(0, n);
    g.save();
    g.globalAlpha = 1 - U.smooth(cue.hold_until, end, t);
    g.font = `bold ${size}px ${FONT}`;
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(210,225,255,0.35)';
    g.shadowBlur = 10;
    g.fillStyle = '#ecebe4';
    g.fillText(txt, x, y);
    if (cue === cursorCue) {
      const on = t < cue.typed_end + 0.06 || Math.floor((t - cue.typed_end) / 0.53) % 2 === 1;
      if (on) g.fillRect(x + g.measureText(txt).width + (n ? 3 : 0), y - size * 0.5, size * 0.42, size * 0.98);
    }
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// dialogue subtitles
// ---------------------------------------------------------------------------

function drawSubtitles(t) {
  for (const d of TL.dialogue) {
    const dur = d.duration || d.target;
    const a = U.window01(t, d.start - 0.05, d.start + dur + 0.45, 0.12, 0.25);
    if (a <= 0) continue;
    g.save();
    g.globalAlpha = a;
    g.font = `600 38px ${SUB_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const y = H - LETTERBOX / 2;
    g.lineJoin = 'round';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(d.text, W / 2, y);
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 12;
    g.fillStyle = d.speaker === 'visitor' ? '#bff4ff' : '#f4f2ea';
    g.fillText(d.text, W / 2, y);
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// title card and credits
// ---------------------------------------------------------------------------

function drawTitles(t) {
  const tc = TL.title_card;
  const a = U.window01(t, tc.start, tc.hold_until + tc.out, tc.in, tc.out);
  if (a > 0) {
    const p = U.clamp((t - tc.start) / (tc.hold_until + tc.out - tc.start));
    g.save();
    g.globalAlpha = a;
    g.font = `bold 150px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = 150 * U.lerp(1.0, 1.1, p);
    const letters = tc.text.split('');
    const total = step * (letters.length - 1);
    g.fillStyle = '#f2f1ea';
    g.shadowColor = 'rgba(190,215,255,0.55)';
    g.shadowBlur = U.lerp(40, 14, U.smooth(tc.start, tc.start + tc.in, t));
    letters.forEach((ch, i) => g.fillText(ch, W / 2 - total / 2 + i * step, H / 2));
    g.restore();
  }
  const cr = TL.credits;
  const ca = U.window01(t, cr.start, cr.end, 1.0, 1.0);
  if (ca > 0) {
    g.save();
    g.font = `bold 26px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    cr.lines.forEach((line, i) => {
      g.globalAlpha = ca * U.smooth(cr.start + i * 0.6, cr.start + i * 0.6 + 1.0, t);
      const last = i === cr.lines.length - 1;
      g.fillStyle = last ? '#f2f1ea' : '#a9a8a2';
      g.fillText(line, W / 2, H / 2 - 50 + i * 56 + (last ? 20 : 0));
    });
    g.restore();
  }
}

// ---------------------------------------------------------------------------

function sceneAt(t) {
  const S = TL.scenes;
  for (let i = 0; i < S.length; i++) if (t >= S[i].start && (t < S[i].end || i === S.length - 1)) return S[i];
  return S[S.length - 1];
}

window.init = async function (timeline, audioEnv, only) {
  TL = timeline;
  ENV = audioEnv;
  await document.fonts.load(`bold 34px ${FONT}`);
  await document.fonts.load(`600 40px ${SUB_FONT}`);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('gl'), antialias: true, preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  composer.addPass(renderPass);
  bokehPass = new BokehPass(new THREE.Scene(), new THREE.PerspectiveCamera(), { focus: 1.0, aperture: 0.002, maxblur: 0.008 });
  bokehPass.enabled = false;
  composer.addPass(bokehPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.6, 0.4, 0.8);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);

  g = document.getElementById('ui').getContext('2d');
  VIGNETTE = buildVignette();

  const env = { THREE, TL, ENV, W, H, renderer, U, FONT };
  const film = Object.values(MODULES);
  if (only && only.length === 1 && !film.includes(only[0])) TEST = only[0];
  const wanted = TEST ? [TEST] : film.filter(m => !only || only.includes(m));
  for (const m of wanted) {
    const mod = await import(`./scenes/${m}.js`);
    instances[m] = await mod.create(env);
  }
  return Object.keys(instances);
};

window.renderFrame = function (t) {
  const sc = TEST ? { id: TEST, start: 0, end: 1e9 } : sceneAt(t);
  const inst = TEST ? instances[TEST] : instances[MODULES[sc.id]];

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);

  if (inst) {
    inst.update(t, sc.id);
    const b = inst.bloom ? inst.bloom(t, sc.id) : { strength: 0.6, radius: 0.4, threshold: 0.8 };
    bloomPass.strength = b.strength;
    bloomPass.radius = b.radius;
    bloomPass.threshold = b.threshold;
    renderPass.scene = inst.scene;
    renderPass.camera = inst.camera;
    // depth of field: the scene says what to focus on (distance in metres) and how shallow
    const d = inst.dof ? inst.dof(t, sc.id) : null;
    bokehPass.enabled = !!d;
    if (d) {
      bokehPass.scene = inst.scene;
      bokehPass.camera = inst.camera;
      bokehPass.uniforms.focus.value = d.focus;
      bokehPass.uniforms.aperture.value = d.aperture;
      bokehPass.uniforms.maxblur.value = d.maxblur ?? 0.008;
    }
    gradePass.uniforms.uAmt.value = inst.grade === false ? 0 : 1;
    composer.render();
    if (inst.overlay) inst.overlay(t, g, sc.id);
  } else {
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
  }

  const vis = U.window01(t, sc.start, sc.end, sc.fade_in || 0, sc.fade_out || 0);
  if (inst && vis < 1) {
    g.globalAlpha = 1 - vis;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
  if (inst) g.drawImage(VIGNETTE, 0, 0);
  if (!TEST && inst && sc.id === 'film') {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, LETTERBOX);
    g.fillRect(0, H - LETTERBOX, W, LETTERBOX);
  }
  if (!TEST) {
    drawTypewriter(t);
    drawSubtitles(t);
    drawTitles(t);
  }
  return sc.id;
};
