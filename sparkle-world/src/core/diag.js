// Diagnostics "flight recorder": remembers errors, long frames, stalls and lost WebGL
// contexts so a freeze on a real device can be understood afterwards. Inside a claude.ai
// Artifact whose cloud saves work (db + user capabilities, see storage.js) the report is also
// saved in the viewer's own subtree, `data/users/<uid>/profile/diag/<session>` (small,
// throttled), so it can be read back later; everywhere else it stays in memory and is
// reachable as window.__game.diag.report().
// It also records how many WebGL contexts are alive at once and the live 2D canvases (count,
// megabytes, peak): iOS caps both, so a device that runs short can be recognised afterwards.

const MAX_ITEMS = 40;
const UPLOAD_EVERY_MS = 60000;
const STALL_MS = 3000;
const CANVAS_SAMPLE_MS = 10000;

export class Diagnostics {
  constructor(game) {
    this.game = game;
    this.session = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    this.started = Date.now();
    this.errors = [];
    this.longFrames = [];
    this.stalls = [];
    this.contexts = { created: 0, lost: 0, restored: 0, live: 0, maxLive: 0 };
    // 2D canvases with a backing store, as weak references (counting never keeps one alive)
    this.canvas = { created: 0, peakCount: 0, peakMB: 0 };
    this._canvasRefs = [];
    this.lastFrameAt = performance.now();
    this.frames = 0;
    this._seen = new Set();
    this._dirty = false;
    this._uploading = false;
    this._lastUpload = 0;
    this._install();
  }

  _push(list, item) {
    list.push(item);
    if (list.length > MAX_ITEMS) list.shift();
    this._dirty = true;
  }

  /** Record a problem once per distinct message (repeats only bump a counter). */
  error(kind, err) {
    const message = String((err && err.message) || err || 'unknown').slice(0, 300);
    const key = kind + '|' + message;
    const at = Math.round((Date.now() - this.started) / 1000);
    if (this._seen.has(key)) {
      const prev = this.errors.find((e) => e.key === key);
      if (prev) { prev.count++; prev.lastAt = at; this._dirty = true; }
      return;
    }
    this._seen.add(key);
    const stack = String((err && err.stack) || '').split('\n').slice(0, 6).join('\n').slice(0, 900);
    this._push(this.errors, { key, kind, message, stack, at, lastAt: at, count: 1, mode: this.game.mode });
    this._scheduleUpload();
  }

  /** Called by the game loop with the stage timings of a slow frame. */
  longFrame(ms, stages) {
    this._push(this.longFrames, {
      at: Math.round((Date.now() - this.started) / 1000), ms: Math.round(ms), stages, mode: this.game.mode,
    });
    if (ms > 1500) this._scheduleUpload();
  }

  /**
   * Live 2D canvases (collected ones drop out, 1x1 ones count as none): count, megabytes
   * (4 bytes per pixel) and the peaks seen so far.
   */
  canvasStats() {
    let count = 0, px = 0;
    const keep = [];
    for (const ref of this._canvasRefs) {
      const c = ref.deref();
      if (!c) continue;
      keep.push(ref);
      const a = (c.width | 0) * (c.height | 0);
      if (a <= 1) continue;
      count++;
      px += a;
    }
    this._canvasRefs = keep;
    const mb = +((px * 4) / 1048576).toFixed(1);
    const C = this.canvas;
    if (count > C.peakCount) C.peakCount = count;
    if (mb > C.peakMB) C.peakMB = mb;
    return { count, mb, peakCount: C.peakCount, peakMB: C.peakMB, created: C.created };
  }

  frameDone(now) {
    this.lastFrameAt = now;
    this.frames++;
  }

  _install() {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => this.error('error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => this.error('rejection', e.reason));

    // Count every WebGL context the page creates and notice when any of them is lost.
    const diag = this;
    const proto = HTMLCanvasElement.prototype;
    const getContext = proto.getContext;
    const canWeak = typeof WeakRef === 'function';
    proto.getContext = function (type, ...rest) {
      const had = this.__swGL;
      const ctx = getContext.call(this, type, ...rest);
      if (ctx && !this.__sw2d && canWeak && String(type) === '2d') {
        this.__sw2d = true;
        diag.canvas.created++;
        diag._canvasRefs.push(new WeakRef(this));
        if (diag._canvasRefs.length > 4000) diag.canvasStats(); // prune collected ones
      }
      if (ctx && !had && /webgl/.test(String(type))) {
        this.__swGL = true;
        const C = diag.contexts;
        C.created++;
        C.live++;
        C.maxLive = Math.max(C.maxLive, C.live);
        this.addEventListener('webglcontextlost', () => {
          C.lost++;
          C.live--;
          diag.error('webgl', `context lost (${C.created} created, ${C.live + 1} alive)`);
        });
        this.addEventListener('webglcontextrestored', () => {
          C.restored++;
          C.live++;
          diag._dirty = true;
        });
      }
      return ctx;
    };

    // A frame gap while the page is visible means the main thread was blocked (or frames stopped).
    setInterval(() => {
      if (document.hidden) { this.lastFrameAt = performance.now(); return; }
      const gap = performance.now() - this.lastFrameAt;
      if (gap > STALL_MS) {
        this._push(this.stalls, { at: Math.round((Date.now() - this.started) / 1000), ms: Math.round(gap), mode: this.game.mode });
        this.lastFrameAt = performance.now();
        this._scheduleUpload();
      }
    }, 1000);
    // the canvas-memory peak (cheap: a few hundred weak references)
    if (canWeak) setInterval(() => { try { this.canvasStats(); } catch { /* diagnostics only */ } }, CANVAS_SAMPLE_MS);
    document.addEventListener('visibilitychange', () => { this.lastFrameAt = performance.now(); if (document.hidden) this.upload(true); });
    setInterval(() => { if (this._dirty) this.upload(false); }, UPLOAD_EVERY_MS);
  }

  report() {
    const g = this.game;
    const info = g.renderer ? g.renderer.info : null;
    return {
      v: 1,
      session: this.session,
      startedAt: new Date(this.started).toISOString(),
      minutes: +((Date.now() - this.started) / 60000).toFixed(1),
      ua: navigator.userAgent.slice(0, 200),
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
      deviceMemory: navigator.deviceMemory || null,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      mode: g.mode,
      fps: Math.round(g.fps || 0),
      frames: this.frames,
      world: g.world ? { biome: g.world.meta ? g.world.meta.biome : null, size: g.world.sx, entities: g.entities ? g.entities.all().length : null } : null,
      gl: info ? { geometries: info.memory.geometries, textures: info.memory.textures, calls: info.render.calls, programs: info.programs ? info.programs.length : null } : null,
      contexts: this.contexts,
      canvases: this._canvasRefs.length || this.canvas.created ? this.canvasStats() : null,
      audio: g.audio && g.audio.stats ? g.audio.stats() : null,
      errors: this.errors.map(({ key, ...e }) => e),
      longFrames: this.longFrames,
      stalls: this.stalls,
    };
  }

  _scheduleUpload() {
    this._dirty = true;
    if (Date.now() - this._lastUpload > UPLOAD_EVERY_MS) setTimeout(() => this.upload(false), 5000);
  }

  /**
   * Where reports go: the viewer's own cloud subtree, only while the save store has a
   * writable cloud with a user id (never a path other viewers of the artifact share).
   */
  _reportDoc() {
    const store = this.game.store;
    const cloud = store && store.cloud;
    if (!cloud || !cloud.uid || !cloud.root || !store.cloudWritable) return null;
    return cloud.root.collection('diag').doc(this.session);
  }

  /** Save the report to the artifact db (if any). Never throws. */
  async upload(force) {
    if (this._uploading || (!force && !this._dirty)) return;
    if (!this.errors.length && !this.stalls.length && !this.longFrames.some((f) => f.ms > 1500)) return;
    this._uploading = true;
    try {
      const doc = this._reportDoc();
      if (!doc) return;
      this._dirty = false;
      this._lastUpload = Date.now();
      await Promise.race([doc.set(this.report()), new Promise((resolve) => setTimeout(resolve, 10000))]);
    } catch {
      // diagnostics must never cause trouble of their own
    } finally {
      this._uploading = false;
    }
  }
}
