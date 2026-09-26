// Bootstrap + main loop. Owned by the integrator (see ARCHITECTURE.md §Main loop).
import * as THREE from 'three';
import { createGameState, readParams } from './core/state.js';
import { LAYERS } from './core/constants.js';
import { createRenderer } from './render/renderer.js';
import { createSim } from './sim/sim.js';
import { createGNC } from './gnc/gnc.js';
import { createTerrain } from './render/terrain/terrain.js';
import { createSky } from './render/sky/sky.js';
import { createEffects } from './render/fx/effects.js';
import { createPost } from './render/post.js';
import { createLMModel } from './render/models/lm/lmModel.js';
import { createCSMModel } from './render/models/csm/csmModel.js';
import { createLMCabin } from './render/cockpit/lmCabin.js';
import { createCSMCabin } from './render/cockpit/csmCabin.js';
import { createCameras } from './render/cameras.js';
import { createInput } from './input/input.js';
import { createAudio } from './audio/audio.js';
import { createUI } from './ui/ui.js';

const FIXED_DT = 1 / 60;

async function boot() {
  const params = readParams();
  const game = createGameState(params);
  window.game = game; // debugging & tests

  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');

  const R = createRenderer(canvas, game);
  const { ctx } = R;

  const gnc = createGNC(game);
  const sim = createSim(game, { gnc });

  // --- world & vessels (each module adds its own objects to ctx.scene) ---
  const terrain = createTerrain(ctx);
  const sky = createSky(ctx);
  const lmModel = createLMModel(ctx);
  const csmModel = createCSMModel(ctx);
  ctx.scene.add(lmModel.root, csmModel.root);
  const lmCabin = createLMCabin(ctx);
  const csmCabin = createCSMCabin(ctx);
  ctx.scene.add(lmCabin.root, csmCabin.root);
  const fx = createEffects(ctx);
  const post = createPost(ctx);
  const cameras = createCameras(game, ctx);
  const input = createInput(game, canvas);
  const audio = createAudio(game);

  const api = {
    scenarios: sim.scenarios,
    startScenario(id) {
      sim.loadScenario(id);
      game.started = true;
      if (params.camera) cameras.setMode(params.camera);
      audio.resume?.();
    },
    ctx,
    cameras,
    sim,
  };
  const ui = createUI(game, uiRoot, api);

  // Test/debug hooks (used by tools/shot.mjs and QA). Keep stable.
  game.debug = {
    THREE,
    ctx,
    sim,
    gnc,
    cameras,
    api,
    modules: { terrain, sky, fx, post, lmModel, csmModel, lmCabin, csmCabin, input, audio, ui },
    setCamera: (mode) => cameras.setMode(mode),
    setVessel: (id) => game.events.emit('action', { name: 'SWITCH_VESSEL', to: id }),
    startScenario: (id) => api.startScenario(id),
    /** Advance the simulation by `seconds` of sim time immediately (no rendering). */
    advance(seconds, h = 1 / 60) {
      let t = 0;
      while (t < seconds - 1e-9) {
        const d = Math.min(h, seconds - t);
        sim.step(d, { ignoreWarp: true });
        t += d;
      }
    },
    renderFrames: 0,
  };

  if (params.autostart && params.scenario) {
    api.startScenario(params.scenario);
    if (params.t > 0) game.debug.advance(params.t);
  }

  // --- main loop ---
  let last = performance.now();
  let readyFrames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let realDt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (params.fixedStep) realDt = FIXED_DT;
    game.time.realDt = realDt;

    input.update(realDt);
    let simDt = 0;
    if (game.started && !game.time.paused) simDt = sim.step(realDt) || 0;
    game.time.simDt = simDt;

    cameras.update(realDt);
    const f = R.beginFrame({ realDt, simDt });

    // IVA: own exterior model becomes a shadow-only "ghost"; cabins only render when used
    const ivaId = game.view.mode === 'iva' ? game.view.ivaVessel : null;
    lmModel.setIVA(ivaId === 'LM');
    csmModel.setIVA(ivaId === 'CSM');
    lmCabin.setActive(ivaId === 'LM');
    csmCabin.setActive(ivaId === 'CSM');

    // The title screen covers the canvas completely: skip the world until a mission is loaded.
    if (!game.started) {
      ui.update(f);
      audio.update(f);
      game.time.frame++;
      game.debug.renderFrames++;
      if (!window.__READY && ++readyFrames > 3) window.__READY = true;
      return;
    }

    terrain.update(f);
    sky.update(f);
    lmModel.update(f, game.vessels.LM);
    csmModel.update(f, game.vessels.CSM);
    lmCabin.update(f, game.vessels.LM);
    csmCabin.update(f, game.vessels.CSM);
    fx.update(f);

    R.renderVesselShadow();
    post.render(f);

    ui.update(f);
    audio.update(f);

    game.time.frame++;
    game.debug.renderFrames++;
    if (!window.__READY) {
      // "ready" once terrain reports it has built its initial LOD (or after 600 frames)
      readyFrames++;
      const terrainReady = terrain.isReady ? terrain.isReady() : true;
      if ((terrainReady && readyFrames > 3) || readyFrames > 600) window.__READY = true;
    }
  }
  requestAnimationFrame(frame);
  document.getElementById('boot')?.remove();
}

boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('boot');
  if (el) el.textContent = 'Failed to start: ' + e.message;
});

export { LAYERS };
