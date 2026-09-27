// Offscreen 3D thumbnails: thumbs.get(key, build) renders the Object3D returned by build()
// (centered, framed, softly lit, transparent background) into a 96x96 PNG data URL.
// Results are cached by key; jobs are queued and rendered by a small second WebGLRenderer
// (so the main canvas and its color pipeline are never disturbed), within a per-frame budget.
//
// Priorities: 'high' (on screen right now: the hotbar, the open Bag; ItemRegistry.iconFor asks
// with it), 'normal' (the default) and 'low' (warm-ups nobody is looking at yet). Asking again
// for a queued key at a higher priority moves it up. A job that overruns the frame budget (a
// slow device, a first shader compile) makes the queue rest about as long as the overrun before
// the next job, so a long queue never becomes a long run of stalled frames; 'high' jobs do not
// wait for the rest to end.
//
// Context loss: nothing is rendered (or cached) while the thumbnail context is lost; a job
// drawn just as it went is queued again. If the context is not back after a few seconds, a
// fresh renderer is made.

import * as THREE from 'three';
import { disposeObject } from './models.js';

const SIZE = 96;
const RENDER = SIZE * 2; // supersampled, then scaled down
const PRIORITY = { high: 0, normal: 1, low: 2 };
const RESTORE_WAIT_MS = 3000;

export class Thumbs {
  constructor() {
    this.cache = new Map();
    this.queue = []; // queued jobs, highest priority first (first come first served within one)
    this._jobs = new Map(); // key -> queued job
    this._ctxPriority = null; // set by withPriority()
    this._restUntil = 0; // performance.now() before which non-'high' jobs wait
    this._lastJobMs = 0;
    this.renderer = null;
    this.failed = false;
    this.lost = false;
    this._lostTimer = 0;
    this.stats = { rendered: 0, requeued: 0, maxJobMs: 0, rests: 0 };
  }

  /**
   * Promise<dataURL> ('' if thumbnails are unavailable). build() -> THREE.Object3D.
   * opts: { dir, zoom, priority: 'high' | 'normal' | 'low' }
   */
  get(key, build, opts = {}) {
    const pri = PRIORITY[opts.priority || this._ctxPriority] ?? 1;
    let p = this.cache.get(key);
    if (p) {
      const job = this._jobs.get(key);
      if (job && pri < job.pri) {
        this.queue.splice(this.queue.indexOf(job), 1);
        job.pri = pri;
        this._insert(job);
      }
      return p;
    }
    p = new Promise((resolve) => {
      const job = { key, build, opts, resolve, pri };
      this._jobs.set(key, job);
      this._insert(job);
    });
    this.cache.set(key, p);
    return p;
  }

  /** Run fn(); every get() it makes synchronously asks at this priority. Returns fn's result. */
  withPriority(priority, fn) {
    const prev = this._ctxPriority;
    this._ctxPriority = priority;
    try {
      return fn();
    } finally {
      this._ctxPriority = prev;
    }
  }

  has(key) {
    return this.cache.has(key);
  }

  get pending() {
    return this.queue.length;
  }

  _insert(job) {
    const q = this.queue;
    let i = q.length;
    while (i > 0 && q[i - 1].pri > job.pri) i--;
    q.splice(i, 0, job);
  }

  _contextLost() {
    if (this.lost) return true;
    try {
      return !!this.renderer && this.renderer.getContext().isContextLost();
    } catch {
      return true;
    }
  }

  /** Called by the game loop: render queued thumbnails within a small time budget. */
  update(budgetMs = 6) {
    const q = this.queue;
    if (!q.length) return;
    if (this._contextLost()) {
      this._onLost();
      return;
    }
    const start = performance.now();
    // resting after an over-budget job; what is on screen right now does not wait
    if (start < this._restUntil && q[0].pri > 0) return;
    let spent = 0;
    while (q.length) {
      // a job about as slow as the last one would overshoot what is left: next frame
      if (spent > 0 && this._lastJobMs > budgetMs - spent) return;
      const job = q.shift();
      const t0 = performance.now();
      let url = '';
      try {
        url = this._render(job.build(), job.opts);
      } catch (err) {
        console.warn('[thumbs] failed', job.key, err);
      }
      const now = performance.now();
      this._lastJobMs = now - t0;
      if (this._lastJobMs > this.stats.maxJobMs) this.stats.maxJobMs = this._lastJobMs;
      if (this._contextLost()) {
        // the context went away mid-render: the picture is blank, draw it again once it is back
        this.stats.requeued++;
        q.unshift(job);
        this._onLost();
        return;
      }
      this._jobs.delete(job.key);
      this.stats.rendered++;
      job.resolve(url);
      spent = now - start;
      if (spent >= budgetMs) {
        // over budget: rest about as long as the overshoot (longer before background warm-ups)
        const next = q[0];
        this._restUntil = now + (spent - budgetMs) * (next && next.pri === 2 ? 3 : 1);
        this.stats.rests++;
        return;
      }
    }
  }

  _setup() {
    if (this.renderer || this.failed) return !!this.renderer;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = RENDER;
      canvas.height = RENDER;
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(RENDER, RENDER, false);
      this.renderer.setClearColor(0x000000, 0);
      canvas.addEventListener('webglcontextlost', () => this._onLost());
      canvas.addEventListener('webglcontextrestored', () => {
        clearTimeout(this._lostTimer);
        this.lost = false;
      });
      if (!this.scene) {
        this.scene = new THREE.Scene();
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe6d6ff, 2.2));
        const key = new THREE.DirectionalLight(0xfff4ea, 2.0);
        key.position.set(3, 5, 4);
        this.scene.add(key);
        const rim = new THREE.DirectionalLight(0xdfe9ff, 0.8);
        rim.position.set(-4, 2, -3);
        this.scene.add(rim);
        this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 200);
        this.out = document.createElement('canvas');
        this.out.width = SIZE;
        this.out.height = SIZE;
        this.outCtx = this.out.getContext('2d');
      }
      return true;
    } catch (err) {
      console.warn('[thumbs] renderer unavailable', err);
      this.renderer = null;
      this.failed = true;
      // nothing can be drawn: answer everyone waiting with "no picture"
      for (const job of this.queue) job.resolve('');
      this.queue.length = 0;
      this._jobs.clear();
      return false;
    }
  }

  /**
   * The thumbnail context was lost (memory pressure, the GPU process restarting): render
   * nothing until three.js restores it; if it does not come back soon, start a fresh renderer.
   */
  _onLost() {
    if (this.lost) return;
    this.lost = true;
    clearTimeout(this._lostTimer);
    this._lostTimer = setTimeout(() => {
      if (!this.lost) return;
      const old = this.renderer;
      this.renderer = null;
      this.lost = false;
      try { if (old) old.dispose(); } catch { /* the old context is gone anyway */ }
    }, RESTORE_WAIT_MS);
  }

  /** opts.dir: camera direction [x,y,z] (default front-right, slightly above); opts.zoom */
  _render(object, opts) {
    if (!object || !this._setup()) return '';
    const pivot = new THREE.Group();
    pivot.add(object);
    this.scene.add(pivot);
    try {
      pivot.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(pivot);
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      object.position.sub(center);
      const dir = new THREE.Vector3(...(opts.dir || [0.9, 0.75, 1.5])).normalize();
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const dist = (Math.max(0.05, sphere.radius) / Math.sin(fov / 2)) * (opts.zoom || 0.9);
      this.camera.position.copy(dir.multiplyScalar(dist));
      this.camera.near = dist / 50;
      this.camera.far = dist * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(0, 0, 0);
      this.renderer.render(this.scene, this.camera);
      this.outCtx.clearRect(0, 0, SIZE, SIZE);
      this.outCtx.imageSmoothingEnabled = true;
      this.outCtx.imageSmoothingQuality = 'high';
      this.outCtx.drawImage(this.renderer.domElement, 0, 0, SIZE, SIZE);
      return this.out.toDataURL('image/png');
    } finally {
      this.scene.remove(pivot);
      disposeObject(object);
    }
  }
}
