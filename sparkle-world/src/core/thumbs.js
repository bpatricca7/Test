// Offscreen 3D thumbnails: thumbs.get(key, build) renders the Object3D returned by build()
// (centered, framed, softly lit, transparent background) into a 96x96 PNG data URL.
// Results are cached by key; jobs are queued and a few are rendered per frame by a small
// second WebGLRenderer (so the main canvas and its color pipeline are never disturbed).

import * as THREE from 'three';
import { disposeObject } from './models.js';

const SIZE = 96;
const RENDER = SIZE * 2; // supersampled, then scaled down

export class Thumbs {
  constructor() {
    this.cache = new Map();
    this.queue = [];
    this.renderer = null;
    this.failed = false;
  }

  /** Promise<dataURL> ('' if thumbnails are unavailable). build() -> THREE.Object3D */
  get(key, build, opts = {}) {
    let p = this.cache.get(key);
    if (p) return p;
    p = new Promise((resolve) => this.queue.push({ key, build, opts, resolve }));
    this.cache.set(key, p);
    return p;
  }

  has(key) {
    return this.cache.has(key);
  }

  /** Called by the game loop: render queued thumbnails within a small time budget. */
  update(budgetMs = 6) {
    if (!this.queue.length) return;
    const start = performance.now();
    while (this.queue.length && performance.now() - start < budgetMs) {
      const job = this.queue.shift();
      let url = '';
      try {
        url = this._render(job.build(), job.opts);
      } catch (err) {
        console.warn('[thumbs] failed', job.key, err);
      }
      job.resolve(url);
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
      return true;
    } catch (err) {
      console.warn('[thumbs] renderer unavailable', err);
      this.failed = true;
      return false;
    }
  }

  /** opts.dir: camera direction [x,y,z] (default front-right, slightly above); opts.zoom */
  _render(object, opts) {
    if (!object || !this._setup()) return '';
    const pivot = new THREE.Group();
    pivot.add(object);
    this.scene.add(pivot);
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
    const url = this.out.toDataURL('image/png');
    this.scene.remove(pivot);
    disposeObject(object);
    return url;
  }
}
