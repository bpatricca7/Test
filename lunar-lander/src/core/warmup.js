// One-shot shader / GPU-upload warm-up of the cockpit configurations (owned by the integrator).
//
// Each cabin brings its own lights (point floods, window RectAreaLights) and interior environment map,
// so three.js needs a different program for every lit material in each of the three configurations
// (exterior, LM cockpit, CSM cockpit). Without a warm-up the first switch into a cockpit compiles ~30
// programs, their shadow-depth variants and uploads hundreds of buffers and canvas textures in a single
// frame: a multi-second freeze on ANGLE/D3D. Right after a mission starts (while the terrain is still
// streaming in) this module:
//   1. 'compile': for every configuration, attaches the cabin and calls renderer.compile() on the scene
//      (without the own exterior model, which is a shadow-only ghost in the cockpit). With
//      KHR_parallel_shader_compile the drivers compile in the background; nothing blocks.
//   2. 'pending': polls program.isReady() (non-blocking) until all programs are linked.
//   3. 'render': renders each cockpit configuration once into a tiny off-screen target with the cabin's
//      frustum culling off, which uploads its geometry and textures and builds the shadow-depth variants.
// main.js restores the real configuration right after update() in the same frame, and only the last
// render of a frame reaches the screen, so none of this is ever visible.

import * as THREE from 'three';
import { LM as LM_C, CSM as CSM_C } from './constants.js';

const START_DELAY_FRAMES = 3; // let the first real frames (environment, terrain roots) exist first
const MAX_PENDING_MS = 20000; // give up waiting for parallel compilation after this

/**
 * @param {{R: object, ctx: object, game: object, enabled: boolean,
 *   cabins: {LM: object, CSM: object}, models?: {LM: object, CSM: object}, setCabins(id: string|null): void}} o
 */
export function createWarmup({ R, ctx, game, enabled, cabins, models = {}, setCabins }) {
  const { renderer, scene, camera } = ctx;
  const info = {
    stage: enabled ? 'wait' : 'off',
    frames: 0,
    programsBefore: 0,
    programsAfterCompile: 0,
    programsAfterRender: 0,
    compileMs: 0,
    pendingMs: 0,
    renderMs: 0,
  };
  let target = null;
  let pendingSince = 0;
  const _eye = new THREE.Vector3();

  function getTarget() {
    if (!target) {
      target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
      if (ctx.depthMode === 'reversed') target.depthTexture = new THREE.DepthTexture(4, 4, THREE.FloatType);
    }
    return target;
  }

  /** Attach cabin `cfg` (or none) and place it as if the camera sat at its commander's eye. */
  function prepare(cfg, f) {
    setCabins(cfg);
    if (!cfg) return;
    const v = game.vessels[cfg];
    const eye = cfg === 'LM' ? LM_C.eyeCDR : CSM_C.eyeCDR;
    _eye.copy(eye).applyQuaternion(v.quat).add(v.pos);
    // dt 0: no animation advances; cameraMCI at the eye so distance LODs pick the near meshes
    cabins[cfg].update({ ...f, dt: 0, cameraMCI: _eye }, v);
  }

  function compileAll(f) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(getTarget()); // same output colour space / tone mapping as post's HDR target
    for (const cfg of ['LM', 'CSM', null]) {
      prepare(cfg, f);
      // The own exterior model is a shadow-only ghost in its cockpit: mostly never drawn with the cabin's
      // lights, so leave it out (unlinked for the duration of this synchronous call; compile() also walks hidden
      // objects). The whole scene is compiled in one call: compiling a sub-tree against the scene would
      // count the lights inside that sub-tree twice and predict the wrong programs.
      const ghost = cfg ? models[cfg]?.root : null;
      const gi = ghost ? scene.children.indexOf(ghost) : -1;
      if (gi >= 0) scene.children.splice(gi, 1);
      try {
        renderer.compile(scene, camera);
      } finally {
        if (gi >= 0) scene.children.splice(gi, 0, ghost);
      }
      // ...except its parts that stay visible from inside (userData.ivaVisible, e.g. the LM RCS quads)
      if (ghost) {
        ghost.traverse((o) => {
          if (o.isMesh && o.userData.ivaVisible) renderer.compile(o, camera, scene);
        });
      }
    }
    renderer.setRenderTarget(prevTarget);
  }

  function allReady() {
    for (const p of renderer.info.programs || []) if (p.isReady && !p.isReady()) return false;
    return true;
  }

  function renderAll(f) {
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = true;
    for (const cfg of ['LM', 'CSM']) {
      prepare(cfg, f);
      const culled = [];
      cabins[cfg].root.traverse((o) => {
        if (o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      });
      renderer.shadowMap.needsUpdate = true; // shadow-depth variants of the cabin casters
      renderer.setRenderTarget(getTarget());
      renderer.render(scene, camera);
      for (const o of culled) o.frustumCulled = true;
    }
    renderer.setRenderTarget(prevTarget);
    scene.matrixWorldAutoUpdate = prevAuto;
    // the sun shadow map now holds the last warm-up configuration: re-render it in this frame's real pass
    renderer.shadowMap.needsUpdate = true;
    ctx.requestShadowUpdate?.();
  }

  return {
    info,
    /** Call once per frame after beginFrame() and before the real cabin configuration is applied. */
    update(f) {
      if (info.stage === 'off' || info.stage === 'done') return;
      info.frames++;
      const now = performance.now();
      if (info.stage === 'wait') {
        if (info.frames < START_DELAY_FRAMES) return;
        info.programsBefore = renderer.info.programs?.length ?? 0;
        compileAll(f);
        info.compileMs = Math.round(performance.now() - now);
        info.programsAfterCompile = renderer.info.programs?.length ?? 0;
        info.stage = 'pending';
        pendingSince = performance.now();
        return;
      }
      if (info.stage === 'pending') {
        if (!allReady() && now - pendingSince < MAX_PENDING_MS) return;
        info.pendingMs = Math.round(now - pendingSince);
        renderAll(f);
        info.renderMs = Math.round(performance.now() - now);
        info.programsAfterRender = renderer.info.programs?.length ?? 0;
        info.stage = 'done';
        if (target) {
          target.dispose();
          target = null;
        }
      }
    },
  };
}
