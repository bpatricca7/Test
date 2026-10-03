// AvatarStage: ONE small extra WebGL renderer shared by the Dress-Up Studio preview, the item
// thumbnails (each option rendered on a mini avatar) and the emote wheel pictures.
//
//   stage.snapshot(key, look, { frame, pose, size }) -> Promise<HTMLCanvasElement|null>
//     (cached by key; rendered a few per frame into a corner of the canvas and copied out)
//   stage.attach(el) / detach()   the live preview canvas (the Studio draws the scene)
//   stage.frame(dt)               called every frame by a game system
//
// Snapshots are drawn right before the preview in the same frame, so they never show. They
// share a small time budget per frame: a snapshot that overran it (a first shader compile, a
// new outfit's textures) makes the next ones wait about as long, so opening the emote wheel or
// a Dress-Up tab never turns into a run of long frames.

import * as THREE from 'three';
import { createAvatar } from '../../player/avatar.js';

const MAX_CACHE = 220;
const SNAP_BUDGET_MS = 10; // snapshot work per frame (at least one snapshot when not resting)
const SNAP_MAX_PER_FRAME = 8;

/** Camera framings (avatar space) for thumbnails: centre height, vertical span, angles. */
export const FRAMES = {
  full: { cy: 0.97, span: 2.25, yaw: 0.35, pitch: 0.1 },
  hair: { cy: 1.28, span: 1.28, yaw: 0.85, pitch: 0.12 },
  head: { cy: 1.55, span: 1.22, yaw: 0.4, pitch: 0.14 },
  face: { cy: 1.42, span: 0.82, yaw: 0.14, pitch: 0.06 },
  torso: { cy: 0.9, span: 0.98, yaw: 0.35, pitch: 0.08 },
  legs: { cy: 0.52, span: 1.1, yaw: 0.35, pitch: 0.1 },
  dress: { cy: 0.74, span: 1.55, yaw: 0.35, pitch: 0.1 },
  feet: { cy: 0.2, span: 0.8, yaw: 0.6, pitch: 0.3 },
  back: { cy: 1.05, span: 1.95, yaw: Math.PI * 0.84, pitch: 0.12 },
  neck: { cy: 1.12, span: 0.86, yaw: 0.2, pitch: 0.1 },
  hand: { cy: 1.1, span: 2.1, yaw: -0.4, pitch: 0.1 },
  emote: { cy: 0.95, span: 2.25, yaw: 0.3, pitch: 0.1 },
};

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6d6ff, 1.75));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.75);
  key.position.set(2.5, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd6ef, 1.0);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xdfe9ff, 0.45);
  fill.position.set(-3, 1, 2);
  scene.add(fill);
}

export class AvatarStage {
  constructor() {
    this.renderer = null;
    this.failed = false;
    this.jobs = [];
    this.cache = new Map(); // key -> { promise, canvas }
    this.attachedTo = null;
    this.onPreviewFrame = null; // (dt) -> void, set by the Studio
    this.previewScene = new THREE.Scene();
    addLights(this.previewScene);
    this.previewCamera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.snapScene = new THREE.Scene();
    addLights(this.snapScene);
    this.snapCamera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.snapAvatar = null;
    this._ro = null;
    this._size = { w: 0, h: 0 };
    this._restUntil = 0; // performance.now() before which queued snapshots wait
    this._lastJobMs = 0;
    this.stats = { snapshots: 0, maxJobMs: 0, rests: 0 };
  }

  ensure() {
    if (this.renderer || this.failed) return !!this.renderer;
    try {
      const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setClearColor(0x000000, 0);
      r.domElement.className = 'sw-dress-canvas';
      r.domElement.style.touchAction = 'none';
      r.setSize(256, 256, false);
      this.renderer = r;
      return true;
    } catch (err) {
      console.warn('[dressup] preview renderer unavailable', err);
      this.failed = true;
      return false;
    }
  }

  attach(el) {
    if (!this.ensure()) return null;
    const c = this.renderer.domElement;
    if (c.parentNode !== el) el.appendChild(c);
    this.attachedTo = el;
    this._resize();
    if (!this._ro && typeof ResizeObserver === 'function') {
      this._ro = new ResizeObserver(() => this._resize());
    }
    if (this._ro) {
      this._ro.disconnect();
      this._ro.observe(el);
    }
    return c;
  }

  detach() {
    if (this._ro) this._ro.disconnect();
    if (this.renderer && this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    this.attachedTo = null;
  }

  _resize() {
    const el = this.attachedTo;
    if (!el || !this.renderer) return;
    const w = Math.max(64, el.clientWidth), h = Math.max(64, el.clientHeight);
    if (w === this._size.w && h === this._size.h) return;
    this._size.w = w;
    this._size.h = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.previewCamera.aspect = w / h;
    this.previewCamera.updateProjectionMatrix();
  }

  get pixelHeight() {
    return this.renderer ? this.renderer.domElement.height : 256;
  }

  // ---------- snapshots ----------

  has(key) {
    const e = this.cache.get(key);
    return !!(e && e.canvas);
  }

  cached(key) {
    const e = this.cache.get(key);
    return e ? e.canvas : null;
  }

  /** Render `look` (posed) into a cached canvas. opts: { frame, pose: { emote, state, t }, size } */
  snapshot(key, look, opts = {}) {
    let e = this.cache.get(key);
    if (e) {
      // refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, e);
      return e.promise;
    }
    e = { canvas: null, promise: null };
    e.promise = new Promise((resolve) => this.jobs.push({ key, look, opts, resolve, entry: e }));
    this.cache.set(key, e);
    if (this.cache.size > MAX_CACHE) {
      for (const [k, v] of this.cache) {
        if (this.cache.size <= MAX_CACHE) break;
        if (!v.canvas) continue;
        this.cache.delete(k);
      }
    }
    return e.promise;
  }

  /** Drop queued jobs whose keys fail `keep` (e.g. thumbnails of a tab no longer shown). */
  prune(keep) {
    this.jobs = this.jobs.filter((j) => {
      if (keep(j.key)) return true;
      this.cache.delete(j.key);
      j.resolve(null);
      return false;
    });
  }

  _snapAvatar(look) {
    if (!this.snapAvatar) {
      this.snapAvatar = createAvatar(look, { blink: false });
      this.snapScene.add(this.snapAvatar.group);
    } else this.snapAvatar.setLook(look);
    return this.snapAvatar;
  }

  _render(job) {
    const r = this.renderer;
    const o = job.opts;
    const f = typeof o.frame === 'string' ? FRAMES[o.frame] || FRAMES.full : { ...FRAMES.full, ...(o.frame || {}) };
    const av = this._snapAvatar(job.look);
    av.resetPose();
    const pose = o.pose || {};
    const state = pose.state || { onGround: true, speed: 0 };
    if (pose.emote) av.playEmote(pose.emote);
    av.settle(state, pose.t ?? 0.45);
    av.group.rotation.y = pose.yaw || 0;
    const cam = this.snapCamera;
    const dist = (f.span / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.02;
    const cx = f.cx || 0, cy = f.cy, cz = f.cz || 0;
    cam.position.set(cx + Math.sin(f.yaw) * Math.cos(f.pitch) * dist, cy + Math.sin(f.pitch) * dist, cz + Math.cos(f.yaw) * Math.cos(f.pitch) * dist);
    cam.aspect = o.aspect || 1;
    cam.near = dist / 20;
    cam.far = dist * 4;
    cam.updateProjectionMatrix();
    cam.lookAt(cx, cy, cz);
    // render into the bottom-left corner, then copy the pixels out
    const canvas = r.domElement;
    const pr = r.getPixelRatio();
    let W = o.size || 192, H = Math.round(W / (o.aspect || 1));
    if (!this.attachedTo && (canvas.width < W || canvas.height < H)) r.setSize(Math.ceil(Math.max(W, 256) / pr), Math.ceil(Math.max(H, 256) / pr), false);
    W = Math.min(W, canvas.width);
    H = Math.min(H, canvas.height);
    r.setScissorTest(true);
    r.setViewport(0, 0, W / pr, H / pr);
    r.setScissor(0, 0, W / pr, H / pr);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.snapScene, cam);
    r.setScissorTest(false);
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    out.getContext('2d').drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    return out;
  }

  // ---------- per frame ----------

  /** Render queued snapshots within this frame's budget (see SNAP_BUDGET_MS). */
  _snapJobs() {
    const t0 = performance.now();
    if (t0 < this._restUntil) return;
    let n = 0;
    while (this.jobs.length && n < SNAP_MAX_PER_FRAME) {
      // one about as slow as the last would overshoot what is left of the budget: next frame
      if (n > 0 && performance.now() - t0 + this._lastJobMs > SNAP_BUDGET_MS) break;
      const job = this.jobs.shift();
      const ts = performance.now();
      let canvas = null;
      try {
        canvas = this._render(job);
      } catch (err) {
        console.warn('[dressup] snapshot failed', job.key, err);
      }
      this._lastJobMs = performance.now() - ts;
      if (this._lastJobMs > this.stats.maxJobMs) this.stats.maxJobMs = this._lastJobMs;
      this.stats.snapshots++;
      job.entry.canvas = canvas;
      if (!canvas) this.cache.delete(job.key);
      job.resolve(canvas);
      n++;
    }
    const spent = performance.now() - t0;
    if (spent > SNAP_BUDGET_MS && this.jobs.length) {
      // over budget: rest about as long as the overshoot before the next snapshot
      this._restUntil = performance.now() + (spent - SNAP_BUDGET_MS);
      this.stats.rests++;
    }
  }

  frame(dt) {
    if (!this.jobs.length && !this.attachedTo) return;
    if (!this.ensure()) {
      for (const j of this.jobs) j.resolve(null);
      this.jobs.length = 0;
      return;
    }
    const r = this.renderer;
    if (this.jobs.length) this._snapJobs();
    if (this.attachedTo) {
      this._resize();
      if (this.onPreviewFrame) this.onPreviewFrame(dt);
      r.setViewport(0, 0, this._size.w, this._size.h);
      r.setClearColor(0x000000, 0);
      r.render(this.previewScene, this.previewCamera);
    }
  }
}

let shared = null;
/** The one stage (created on first use). */
export function getStage() {
  if (!shared) shared = new AvatarStage();
  return shared;
}
