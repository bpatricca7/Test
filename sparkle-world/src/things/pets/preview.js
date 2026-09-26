// A small live 3D preview for our panels (the adoption panel's spinning pet, the cooking
// panel's finished dish). ONE extra WebGL canvas, created on first use and moved between
// panels; it only renders while mounted in the page. Drag to spin. If WebGL is not
// available it reports `failed` and the panels show a thumbnail instead.

import * as THREE from 'three';
import { disposeObject } from '../../core/models.js';

class Preview {
  constructor(game) {
    this.game = game;
    this.failed = false;
    this.object = null;
    this.onFrame = null;
    this.spin = 0.7;
    this.yaw = 0;
    this.t = 0;
    this._drag = null;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lf-preview';
    this.canvas.style.touchAction = 'none';
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch (err) {
      console.warn('[life] preview renderer unavailable', err);
      this.failed = true;
      return;
    }
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xe6d6ff, 2.1));
    const key = new THREE.DirectionalLight(0xfff4ea, 2.0);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xdfe9ff, 0.9);
    rim.position.set(-4, 2, -3);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.size = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this._drag = { x: e.clientX, yaw: this.yaw };
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    c.addEventListener('pointermove', (e) => {
      if (this._drag) this.yaw = this._drag.yaw + (e.clientX - this._drag.x) * 0.012;
    });
    const up = () => { this._drag = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  /** Put the canvas into a container at size x size CSS px. */
  mount(container, size = 240) {
    if (this.failed) return false;
    if (this.canvas.parentNode !== container) container.appendChild(this.canvas);
    if (size !== this.size) {
      this.size = size;
      this.renderer.setSize(size, size, true);
    }
    return true;
  }

  unmount() {
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }

  /**
   * Show an object (replacing and disposing the previous one). opts: { onFrame(dt, t, obj),
   * spin (rad/s), yaw, dir: camera direction, zoom, lift (look-at height share) }
   */
  show(object, { onFrame = null, spin = 0.7, yaw = 0.5, dir = [0, 0.42, 1], zoom = 1, lift = 0.5 } = {}) {
    if (this.failed) return;
    this.clear();
    this.object = object;
    this.onFrame = onFrame;
    this.spin = spin;
    this.yaw = yaw;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.add(object);
    this.pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y;
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.62 + 0.05;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = (radius / Math.sin(fov / 2)) * zoom;
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
    const ty = size.y * lift;
    this.camera.position.set(d.x, ty + d.y, d.z);
    this.camera.near = dist / 40;
    this.camera.far = dist * 5;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, ty, 0);
  }

  clear() {
    if (this.object) {
      this.pivot.remove(this.object);
      disposeObject(this.object);
      this.object = null;
      this.onFrame = null;
    }
  }

  update(dt) {
    if (this.failed || !this.object || !this.canvas.isConnected || !this.canvas.offsetParent) return;
    this.t += dt;
    if (!this._drag) this.yaw += this.spin * dt;
    this.pivot.rotation.y = this.yaw;
    if (this.onFrame) {
      try {
        this.onFrame(dt, this.t, this.object);
      } catch (err) {
        console.warn('[life] preview frame failed', err);
        this.onFrame = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

const previews = new WeakMap();

/** The shared preview for this game (created on first use; renders from a small system). */
export function preview(game) {
  let p = previews.get(game);
  if (!p) {
    p = new Preview(game);
    previews.set(game, p);
    game.addSystem({ name: 'life-preview', update: (dt) => p.update(dt) });
  }
  return p;
}
