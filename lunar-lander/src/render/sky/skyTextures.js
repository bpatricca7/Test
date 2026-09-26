// Earth and Milky Way textures: generated in a Web Worker (inline import — works from file://), with
// a time-sliced main-thread fallback (<= ~3 ms per frame) if workers are unavailable.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import SkyWorker from './sky.worker.js?worker&inline';
import { prepareEarth, generateEarthRows, generateMilkyWayRows } from './skyGen.js';

function dataTex(W, H, data, srgb) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Start generating the sky textures.
 * @param {object} opts {earthW, earthH, mwW, mwH}
 * @returns {{earthAlbedo: THREE.DataTexture, earthClouds: THREE.DataTexture, milkyWay: THREE.DataTexture,
 *   state: {earth: boolean, milkyWay: boolean}, tick(): void, dispose(): void}}
 *   Textures are 1x1 placeholders until `state.*` becomes true (the same texture objects are updated).
 */
export function createSkyTextures({ earthW = 1024, earthH = 512, mwW = 1024, mwH = 512 } = {}) {
  const earthAlbedo = dataTex(1, 1, new Uint8Array([10, 30, 70, 255]), true);
  const earthClouds = dataTex(1, 1, new Uint8Array([90, 0, 0, 255]), false);
  const milkyWay = dataTex(1, 1, new Uint8Array([0, 0, 0, 255]), false);
  const state = { earth: false, milkyWay: false };

  function setImage(tex, W, H, data) {
    tex.dispose(); // GPU storage is immutable (texStorage2D): release the 1x1 placeholder first
    tex.image = { data, width: W, height: H };
    tex.needsUpdate = true;
  }

  let worker = null;
  let fallback = null; // time-sliced generator state
  try {
    worker = new SkyWorker();
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'earth') {
        setImage(earthAlbedo, m.W, m.H, m.albedo);
        setImage(earthClouds, m.W, m.H, m.clouds);
        state.earth = true;
      } else if (m.kind === 'milkyway') {
        setImage(milkyWay, m.W, m.H, m.data);
        state.milkyWay = true;
      }
      if (state.earth && state.milkyWay) {
        worker.terminate();
        worker = null;
      }
    };
    worker.onerror = (err) => {
      console.warn('sky worker failed, generating on the main thread', err?.message || err);
      worker?.terminate();
      worker = null;
      startFallback();
    };
    worker.postMessage({ kind: 'earth', W: earthW, H: earthH });
    worker.postMessage({ kind: 'milkyway', W: mwW, H: mwH });
  } catch (e) {
    startFallback();
  }

  function startFallback() {
    if (fallback) return;
    fallback = {
      phase: 'earth',
      prep: null,
      y: 0,
      albedo: new Uint8Array(earthW * earthH * 4),
      clouds: new Uint8Array(earthW * earthH * 4),
      mw: new Uint8Array(mwW * mwH * 4),
    };
  }

  /** Advance the main-thread fallback generator by a few milliseconds (no-op when the worker runs). */
  function tick() {
    if (!fallback) return;
    const t0 = performance.now();
    const f = fallback;
    while (performance.now() - t0 < 3) {
      if (f.phase === 'earth') {
        if (!f.prep) {
          f.prep = prepareEarth(earthW, earthH);
          return;
        }
        generateEarthRows(f.prep, f.y, Math.min(earthH, f.y + 2), f.albedo, f.clouds);
        f.y += 2;
        if (f.y >= earthH) {
          if (!state.earth) {
            setImage(earthAlbedo, earthW, earthH, f.albedo);
            setImage(earthClouds, earthW, earthH, f.clouds);
            state.earth = true;
          }
          f.phase = 'mw';
          f.y = 0;
        }
      } else if (f.phase === 'mw') {
        generateMilkyWayRows(mwW, mwH, f.y, Math.min(mwH, f.y + 2), f.mw);
        f.y += 2;
        if (f.y >= mwH) {
          setImage(milkyWay, mwW, mwH, f.mw);
          state.milkyWay = true;
          fallback = null;
          return;
        }
      }
    }
  }

  return {
    earthAlbedo,
    earthClouds,
    milkyWay,
    state,
    tick,
    dispose() {
      worker?.terminate();
      earthAlbedo.dispose();
      earthClouds.dispose();
      milkyWay.dispose();
    },
  };
}
