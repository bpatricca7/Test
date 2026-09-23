// ECHO (animated cut) — frame compositor.
//
// render.js loads index.html, calls window.init(timeline, audioEnv) once, then
// window.renderFrame(t) per frame. Each 3D scene lives in scenes/<name>.js and
// exports create(env) -> { scene, camera, update(t), bloom?(t), overlay?(t, g) }.
// This file routes film time to the right scene, runs bloom, and draws the 2D
// layer on top: typewriter narration, subtitles, fades and the vignette.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as U from './lib/util.js';

const W = 1920, H = 1080;
const FONT = '"FreeMono", "Courier New", monospace';

// scene id -> module file (several story scenes can share one module)
const MODULES = {
  valley: 'valley', journey: 'journey', observatory: 'observatory', signal: 'signal',
  fold: 'grid', recognition: 'grid', visitor: 'grid', ending: 'ending',
};

let TL, ENV, renderer, composer, renderPass, bloomPass, ui, g;
const instances = {};   // module name -> created scene
let VIGNETTE;

function buildVignette() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 1.1);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  x.fillStyle = gr;
  x.fillRect(0, 0, W, H);
  return c;
}

// ---------------------------------------------------------------------------
// typewriter narration (same look as the first cut)
// ---------------------------------------------------------------------------

function slotPos(slot) {
  if (slot === 'center') return { x: 0.14 * W, y: 0.5 * H, size: 34 };
  if (slot === 'center-high') return { x: 0.14 * W, y: 0.5 * H - 76, size: 34 };
  if (slot === 'lower') return { x: 0.14 * W, y: 0.855 * H, size: 34 };
  if (slot.startsWith('col')) return { x: 0.47 * W, y: 0.34 * H + (+slot.slice(3)) * 66, size: 32 };
  return { x: 0.14 * W, y: 0.5 * H, size: 34 };
}

function charsTyped(cue, t) {
  const ct = cue.char_times;
  let lo = 0, hi = ct.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

function drawText(t) {
  let cursorCue = null;
  for (const cue of TL.text) if (cue.start <= t && t <= cue.hold_until) cursorCue = cue;
  for (const cue of TL.text) {
    const end = cue.hold_until + cue.fade;
    if (t < cue.start || t > end) continue;
    const n = charsTyped(cue, t);
    const p = slotPos(cue.slot);
    const emph = cue.style === 'emph';
    const txt = cue.text.slice(0, n);
    g.save();
    g.globalAlpha = 1 - U.smooth(cue.hold_until, end, t);
    g.font = `bold ${p.size}px ${FONT}`;
    g.textBaseline = 'middle';
    // a soft dark halo keeps text legible over bright 3D frames
    g.shadowColor = 'rgba(0,0,0,0.85)';
    g.shadowBlur = 14;
    g.fillStyle = emph ? '#ffc98a' : '#ecebe4';
    g.fillText(txt, p.x, p.y);
    g.shadowColor = emph ? 'rgba(255,150,70,0.6)' : 'rgba(210,225,255,0.35)';
    g.shadowBlur = emph ? 16 : 10;
    g.fillText(txt, p.x, p.y);
    if (cue === cursorCue) {
      const typing = t < cue.typed_end + 0.06;
      const on = typing || Math.floor((t - cue.typed_end) / 0.53) % 2 === 1;
      if (on) {
        const w = g.measureText(txt).width;
        g.fillRect(p.x + w + (n ? 3 : 0), p.y - p.size * 0.5, p.size * 0.42, p.size * 0.98);
      }
    }
    g.restore();
  }
}

function drawSubtitle(t) {
  const v = TL.voice;
  const a = U.window01(t, v.start - 0.3, v.start + 4.2, 0.3, 0.8);
  if (a <= 0) return;
  let s = '';
  for (const wd of v.words) if (t >= wd.t) s += (s ? ' ' : '') + wd.w;
  g.save();
  g.globalAlpha = a;
  g.font = `bold 42px ${FONT}`;
  g.textBaseline = 'middle';
  const full = v.words.map(w => w.w).join(' ');
  const fw = g.measureText(full).width;
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 16;
  g.fillStyle = '#ffd2a8';
  g.fillText(s, W / 2 - fw / 2, H * 0.88);
  g.shadowColor = 'rgba(255,120,60,0.7)';
  g.shadowBlur = 18;
  g.fillText(s, W / 2 - fw / 2, H * 0.88);
  g.restore();
}

// ---------------------------------------------------------------------------

function sceneAt(t) {
  const S = TL.scenes;
  for (let i = 0; i < S.length; i++) {
    if (t >= S[i].start && (t < S[i].end || i === S.length - 1)) return S[i];
  }
  return S[S.length - 1];
}

window.init = async function (timeline, audioEnv, only) {
  TL = timeline;
  ENV = audioEnv;
  await document.fonts.load(`bold 34px ${FONT}`);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('gl'), antialias: true, preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.8, 0.5, 0.2);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  ui = document.getElementById('ui');
  g = ui.getContext('2d');
  VIGNETTE = buildVignette();

  const env = { THREE, TL, ENV, W, H, renderer, U, FONT };
  const wanted = new Set(Object.values(MODULES).filter(m => !only || only.includes(m)));
  for (const m of wanted) {
    const mod = await import(`./scenes/${m}.js`);
    instances[m] = await mod.create(env);
  }
  return Object.keys(instances);
};

window.renderFrame = function (t) {
  const sc = sceneAt(t);
  const inst = instances[MODULES[sc.id]];

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);

  if (inst) {
    inst.update(t, sc.id);
    const b = inst.bloom ? inst.bloom(t, sc.id) : { strength: 0.8, radius: 0.5, threshold: 0.2 };
    bloomPass.strength = b.strength;
    bloomPass.radius = b.radius;
    bloomPass.threshold = b.threshold;
    renderPass.scene = inst.scene;
    renderPass.camera = inst.camera;
    composer.render();
    if (inst.overlay) inst.overlay(t, g, sc.id);
  } else {
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
  }

  // dips to black between scenes
  const fin = sc.fade_in || 0, fout = sc.fade_out || 0;
  const vis = U.window01(t, sc.start, sc.end, fin, fout);
  if (inst && vis < 1) {
    g.globalAlpha = 1 - vis;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }

  g.drawImage(VIGNETTE, 0, 0);
  drawText(t);
  drawSubtitle(t);
  if (inst && inst.overlayTop) inst.overlayTop(t, g, sc.id);
  return sc.id;
};
