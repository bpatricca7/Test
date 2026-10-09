// The Squish Shelf's pictures in batches: several toys drawn in ONE go on the game's own
// thumbnail renderer (game.thumbs.renderer: no WebGL context of our own, and its shaders for
// plain colors are already compiled by the Bag's pictures), each into its own 192 px cell of an
// offscreen target, then copied out with one read-back (started without waiting, collected in a
// later frame) and cut into 96 px pictures. The
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
// a batch whose fence has not passed after this many frames is read back anyway
const WAIT_FRAMES = 30;
const DIR = new THREE.Vector3(0.4, 0.45, 1.5).normalize();
const WARM = [['pf_strawberry', true], ['st_snowball', false], ['st_gold', false]];

// The 2D canvases only cut and encode pixels that are already read back: kept in memory (no
// GPU-backed canvas), so a picture's toDataURL never waits for the GPU's queue (on the GPU-less
// test machine one waited 1 s behind the game's own frame).
const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

export function sheetRenderer(thumbs) {
  let scene = null, camera = null, out2d = null;
  let sheer = 'no'; // 'no' | 'busy' | 'yes': the toys' shaders for the offscreen target
  let rt = null, cell = null, warmStep = 0, warmModel = null;
  // A toy's new shader program, made by compileAsync: without the browser's parallel-compile
  // extension three's compileAsync is ready at once, and the first draw then waits for the
  // link (done on demand, not in the background: a 1 s wait first did not shorten it) and
  // for three's three error-log reads, each a round trip that waits for everything the GPU
  // has queued (on the GPU-less test machine 1.2 s + 0.3 s + 0.3 s in one draw). So the
  // link's status is read in a frame of its own (a failed link is still reported) and the
  // warm-up draw after it skips the logs.
  let newProgs = null;
  const inFlight = []; // batches drawn, their pixels on the way back (start / collect)
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

  /** The batch's pixels (bottom-up rows) -> one 96 px PNG data URL per job. */
  function cut(px, W, H, jobs) {
    out2d.width = W;
    out2d.height = H;
    const g = ctx2d(out2d);
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
    const cg = ctx2d(cell);
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
  }


  return {
    /**
     * Before the first batch (or ahead of time: index.js warmShelf): the offscreen target, then
     * the toys' shaders for it. Each in a frame of its own (a software renderer takes most of a
     * second for them).
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
        const cg = ctx2d(cell);
        cg.putImageData(cg.createImageData(OUT, OUT), 0, 0);
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
      // compiled: drawn once into the target in a frame of its own (the program links on its
      // first draw; a batch's read-back right after would wait for that too), no read-back
      if (warmModel) {
        const r = thumbs.renderer;
        if (newProgs) {
          // the link's status, in a frame of its own (three's own check is skipped below)
          const gl = r.getContext();
          for (const p of newProgs) {
            if (p.program && !gl.getProgramParameter(p.program, gl.LINK_STATUS)) console.error('[squish] shelf shader failed', gl.getProgramInfoLog(p.program));
          }
          newProgs = null;
          return true;
        }
        const m = warmModel;
        warmModel = null;
        const checks = r.debug.checkShaderErrors;
        try {
          const prev = r.getRenderTarget();
          rt.viewport.set(0, 0, CELL, CELL);
          r.setRenderTarget(rt);
          r.debug.checkShaderErrors = false;
          r.render(scene, camera);
          rt.viewport.set(0, 0, rt.width, rt.height);
          r.setRenderTarget(prev);
        } catch { /* the batch draws it anyway */ } finally {
          r.debug.checkShaderErrors = checks;
        }
        scene.remove(m);
        disposeObject(m);
        warmStep++;
        return true;
      }
      sheer = 'busy';
      let m = null, progs = 0;
      const done = () => {
        warmModel = m;
        if (!m) warmStep++;
        else if (thumbs.renderer.info.programs.length > progs) newProgs = thumbs.renderer.info.programs.slice(progs);
        sheer = 'no';
      };
      try {
        m = toyModel(sample[0], { glitter: sample[1], hitbox: false });
        scene.add(m);
        camera.position.set(0, 0.3, 2);
        camera.near = 0.01;
        camera.far = 200;
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        camera.lookAt(0, 0.2, 0);
        const r = thumbs.renderer, prev = r.getRenderTarget();
        progs = r.info.programs.length;
        r.setRenderTarget(rt);
        const p = r.compileAsync ? r.compileAsync(scene, camera) : null;
        r.setRenderTarget(prev);
        if (p && p.then) p.then(done, done);
        else done();
      } catch {
        if (m) {
          scene.remove(m);
          disposeObject(m);
          m = null;
        }
        done();
      }
      return true;
    },
    /** Can a batch be drawn now (the thumbnail renderer is there and working)? */
    ready() {
      return !!(thumbs && thumbs.renderer && !thumbs.lost && !thumbs.failed);
    },
    /**
     * Draw up to MAX_BATCH toys ([{ key, glitter }]) into the offscreen target and start their
     * read-back without waiting for it: the pixels go into a buffer on the GPU side, behind a
     * fence, and collect() hands them out in a later frame once the fence has passed. (A plain
     * read-back here waited for everything the GPU had queued, the game's own last frame too: on
     * the GPU-less test machine 500-1230 ms a batch, the same for 1 picture as for 6, so smaller
     * batches could not help.) Returns false when the renderer is not there (the caller falls
     * back to the thumbnail queue).
     */
    start(list) {
      if (!this.ready()) return false;
      setup();
      const r = thumbs.renderer;
      const gl = r.getContext();
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
      // the whole batch into one pixel buffer on the GPU side (from the target's resolved
      // pixels, as three's own read-back reads them), then a fence after it
      let buf = null, sync = null;
      try {
        buf = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, W * H * 4, gl.STREAM_READ);
        r.state.bindFramebuffer(gl.FRAMEBUFFER, r.properties.get(rt).__webglFramebuffer);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
      } catch (err) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        if (buf) gl.deleteBuffer(buf);
        buf = null;
        console.warn('[squish] shelf pictures failed', err && err.message);
      } finally {
        r.setRenderTarget(prevTarget);
        r.setClearColor(_col, prevClear);
      }
      inFlight.push({ jobs, W, H, buf, sync, frames: 0, gl });
      return true;
    },
    /** How many batches are still on their way back. */
    inFlight() {
      return inFlight.length;
    },
    /**
     * The batches whose fence has passed, in the order they were started: [{ jobs, urls }]
     * (a url is '' when that picture failed; the caller falls back to the thumbnail queue).
     * The fence is only looked at, never waited for; a batch still not back after
     * WAIT_FRAMES frames is read anyway (that read waits, but the pictures still arrive).
     */
    collect() {
      const out = [];
      for (let left = inFlight.length; left > 0; left--) {
        const b = inFlight[0];
        const gl = b.gl;
        const lost = !this.ready() || thumbs.renderer.getContext() !== gl || gl.isContextLost();
        if (lost || !b.buf || !b.sync) {
          inFlight.shift();
          out.push({ jobs: b.jobs, urls: b.jobs.map(() => '') });
          continue;
        }
        b.frames++;
        if (gl.getSyncParameter(b.sync, gl.SYNC_STATUS) !== gl.SIGNALED && b.frames < WAIT_FRAMES) break;
        inFlight.shift();
        let urls = null;
        try {
          const px = new Uint8Array(b.W * b.H * 4);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b.buf);
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
          urls = cut(px, b.W, b.H, b.jobs);
        } catch (err) {
          console.warn('[squish] shelf pictures failed', err && err.message);
        } finally {
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
          gl.deleteBuffer(b.buf);
          gl.deleteSync(b.sync);
        }
        out.push({ jobs: b.jobs, urls: urls || b.jobs.map(() => '') });
        break; // one batch's pictures a frame (cutting them into PNGs is work too)
      }
      return out;
    },
  };
}
