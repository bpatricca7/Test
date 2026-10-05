// The Squish Shelf's pictures in batches: several toys drawn in ONE go on the game's own
// thumbnail renderer (game.thumbs.renderer: no WebGL context of our own, and its shaders for
// plain colors are already compiled by the Bag's pictures), each into its own 192 px cell of an
// offscreen target, then copied out with a single read-back and cut into 96 px pictures. The
// thumbnail queue draws one picture per frame and reads each one back on its own; on a slow
// device (or a software renderer) that costs about a frame per picture, and the shelf has up to
// 96. The renderer's canvas, size and target are left as they were.
//
// Same look as the game's thumbnails (src/core/thumbs.js): transparent background, the same
// lights, a 28 degree lens, framed on the bounding sphere, seen from the front-right, drawn at
// 2x and scaled down.

import * as THREE from 'three';
import { disposeObject } from '../../core/models.js';
import { toyModel } from './models.js';


const OUT = 96; // picture size (CSS px of a cubby)
const CELL = 192; // drawn at 2x, then scaled down (like the thumbnails)
const PER_ROW = 4;
const MAX_BATCH = 12;
const DIR = new THREE.Vector3(0.4, 0.45, 1.5).normalize();
const WARM = [['pf_strawberry', true], ['st_snowball', false], ['st_gold', false]];

export function sheetRenderer(thumbs) {
  let scene = null, camera = null, out2d = null;
  let sheer = 'no'; // 'no' | 'busy' | 'yes': the toys' shaders for the offscreen target
  let rt = null, cell = null, warmStep = 0;
  const _col = new THREE.Color();
  const setup = () => {
    if (scene) return;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe6d6ff, 2.2));
    const key = new THREE.DirectionalLight(0xfff4ea, 2.0);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe9ff, 0.8);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    camera = new THREE.PerspectiveCamera(28, 1, 0.01, 200);
    out2d = document.createElement('canvas');
  };
  const _box = new THREE.Box3();
  const _sphere = new THREE.Sphere();
  const _c = new THREE.Vector3();
  const _size = new THREE.Vector2();

  const makeTarget = () => {
    rt = new THREE.WebGLRenderTarget(PER_ROW * CELL, Math.ceil(MAX_BATCH / PER_ROW) * CELL, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    // drawn exactly as on the canvas (sRGB output in plain 8-bit storage, the same shader
    // programs, so nothing new compiles): three's flag for a target that stands for a screen
    rt.isXRRenderTarget = true;
  };

  return {
    /**
     * Before the first batch: the offscreen target, then the toys' shaders for it. Each in a
     * frame of its own (a software renderer takes most of a second for them).
     * Returns true while that work is going on (the caller draws next time).
     */
    prepare(list) {
      if (!this.ready()) return false;
      setup();
      // the offscreen target, made and touched once in a frame of its own
      if (!rt) {
        makeTarget();
        const r = thumbs.renderer;
        const prev = r.getRenderTarget();
        r.setRenderTarget(rt);
        r.clear();
        r.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint8Array(4));
        r.setRenderTarget(prev);
        // the 2D side too (its first picture costs the most)
        cell = document.createElement('canvas');
        cell.width = cell.height = OUT;
        cell.getContext('2d').putImageData(cell.getContext('2d').createImageData(OUT, OUT), 0, 0);
        cell.toDataURL('image/png');
        return true;
      }
      if (sheer === 'yes') return false;
      if (sheer === 'busy') return true;
      // the toys' shaders for this target, one kind a frame (plain colors with glow, the fuzzy
      // texture, the see-through shell), in the background where the browser can
      const sample = WARM[warmStep];
      if (!sample) {
        sheer = 'yes';
        return false;
      }
      sheer = 'busy';
      let m = null;
      const done = () => {
        if (m) {
          scene.remove(m);
          disposeObject(m);
        }
        warmStep++;
        sheer = 'no';
      };
      try {
        m = toyModel(sample[0], { glitter: sample[1], hitbox: false });
        scene.add(m);
        camera.position.set(0, 0.3, 2);
        camera.lookAt(0, 0.2, 0);
        const r = thumbs.renderer, prev = r.getRenderTarget();
        r.setRenderTarget(rt);
        const p = r.compileAsync ? r.compileAsync(scene, camera) : null;
        r.setRenderTarget(prev);
        if (p && p.then) p.then(done, done);
        else done();
      } catch {
        done();
      }
      return true;
    },
    /** Can a batch be drawn now (the thumbnail renderer is there and working)? */
    ready() {
      return !!(thumbs && thumbs.renderer && !thumbs.lost && !thumbs.failed);
    },
    /**
     * Draw up to MAX_BATCH toys ([{ key, glitter }]) and return [dataURL | ''] in the same
     * order, or null when the renderer is not there (the caller falls back to the thumbnail queue).
     */
    draw(list) {
      if (!this.ready()) return null;
      setup();
      const r = thumbs.renderer;
      const jobs = list.slice(0, MAX_BATCH);
      const rows = Math.ceil(jobs.length / PER_ROW);
      const W = PER_ROW * CELL, H = rows * CELL;
      // an offscreen target made once (the canvas itself is never re-sized), 4x MSAA like the
      // thumbnail canvas's antialias
      if (!rt) makeTarget();
      const prevTarget = r.getRenderTarget();
      const prevClear = r.getClearAlpha();
      r.getClearColor(_col);
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      rt.scissorTest = true;
      jobs.forEach((job, i) => {
        const cx = (i % PER_ROW) * CELL, cy = Math.floor(i / PER_ROW) * CELL; // rows from the bottom
        let model = null;
        try {
          model = toyModel(job.key, { glitter: !!job.glitter, hitbox: false });
          const pivot = new THREE.Group();
          pivot.add(model);
          scene.add(pivot);
          pivot.updateMatrixWorld(true);
          _box.setFromObject(pivot);
          _box.getCenter(_c);
          _box.getBoundingSphere(_sphere);
          model.position.sub(_c);
          const dist = (Math.max(0.05, _sphere.radius) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.9;
          camera.position.copy(DIR).multiplyScalar(dist);
          camera.near = dist / 50;
          camera.far = dist * 4;
          camera.aspect = 1;
          camera.updateProjectionMatrix();
          camera.lookAt(0, 0, 0);
          rt.viewport.set(cx, cy, CELL, CELL);
          rt.scissor.set(cx, cy, CELL, CELL);
          r.setRenderTarget(rt); // picks up the viewport and scissor
          r.clear();
          r.render(scene, camera);
          scene.remove(pivot);
        } catch (err) {
          console.warn('[squish] picture failed', job.key, err && err.message);
        } finally {
          if (model) disposeObject(model);
        }
      });
      rt.scissorTest = false;
      rt.viewport.set(0, 0, rt.width, rt.height);
      rt.scissor.set(0, 0, rt.width, rt.height);
      // one read-back for the whole batch, then cut it into pictures
      const px = new Uint8Array(W * H * 4);
      r.readRenderTargetPixels(rt, 0, 0, W, H, px);
      r.setRenderTarget(prevTarget);
      r.setClearColor(_col, prevClear);
      out2d.width = W;
      out2d.height = H;
      const g = out2d.getContext('2d');
      const img = g.createImageData(W, H);
      const row = W * 4;
      const d = img.data;
      for (let y = 0; y < H; y++) d.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row); // GL rows are bottom-up
      // the edges were blended over a clear background: back to straight alpha for ImageData
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3];
        if (a > 0 && a < 255) {
          const k = 255 / a;
          d[i] = Math.min(255, d[i] * k);
          d[i + 1] = Math.min(255, d[i + 1] * k);
          d[i + 2] = Math.min(255, d[i + 2] * k);
        }
      }
      g.putImageData(img, 0, 0);
      if (!cell) {
        cell = document.createElement('canvas');
        cell.width = cell.height = OUT;
      }
      const cg = cell.getContext('2d');
      cg.imageSmoothingEnabled = true;
      cg.imageSmoothingQuality = 'high';
      const urls = jobs.map((job, i) => {
        const col = i % PER_ROW, rowI = Math.floor(i / PER_ROW);
        cg.clearRect(0, 0, OUT, OUT);
        cg.drawImage(out2d, col * CELL, H - (rowI + 1) * CELL, CELL, CELL, 0, 0, OUT, OUT);
        return cell.toDataURL('image/png');
      });
      out2d.width = out2d.height = 1; // let the big copy go
      return urls;
    },
  };
}
