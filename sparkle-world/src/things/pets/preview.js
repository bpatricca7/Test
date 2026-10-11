// A small live 3D preview for our panels (the adoption panel's spinning pet, the cooking
// panel's finished dish). It draws on the Avatar team's shared stage (getStage(): the one
// extra WebGL renderer the Dress-Up Studio and the emote pictures use), so it never adds a
// WebGL context of its own: mount() attaches the stage canvas to a panel element and puts our
// pivot into stage.previewScene; unmount() gives both back. Only one panel is open at a time,
// so the Studio and our panels never need the stage together. Drag to spin. If WebGL is not
// available `failed` is true (after the first mount) and the panels show a thumbnail instead.
// preview(game) itself is cheap: nothing touches WebGL until mount().

import * as THREE from 'three';
import { disposeObject } from '../../core/models.js';
import { getStage } from '../../ui/dressup/stage.js';

const FOV = 30;

class Preview {
  constructor(game) {
    this.game = game;
    this.stage = getStage();
    this.object = null;
    this.onFrame = null;
    this.spin = 0.7;
    this.yaw = 0;
    this.t = 0;
    this._drag = null;
    this.host = null; // the element the stage canvas is attached to while we use it
    this._camWas = null; // the stage camera's lens before we borrowed it
    this.pivot = new THREE.Group();
    this.pivot.name = 'life-preview';
    // where the camera sits for the current object (applied to the stage camera every frame)
    this.cam = { pos: new THREE.Vector3(0, 0.5, 3), ty: 0.5, near: 0.05, far: 50 };
    this._frame = (dt) => this.update(dt);
    this._down = (e) => {
      this._drag = { x: e.clientX, yaw: this.yaw };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this._moveDrag = (e) => {
      if (this._drag) this.yaw = this._drag.yaw + (e.clientX - this._drag.x) * 0.012;
    };
    this._up = () => { this._drag = null; };
  }

  get failed() {
    return this.stage.failed;
  }

  /** The stage canvas while it is ours, else null. */
  get canvas() {
    return this.host && this.stage.renderer ? this.stage.renderer.domElement : null;
  }

  /** Put the preview into a container (the stage canvas fills it and follows its size). */
  mount(container) {
    const stage = this.stage;
    if (this.host && this.host !== container) this.unmount();
    const canvas = stage.attach(container);
    if (!canvas) return false;
    if (this.host !== container) {
      this.host = container;
      const cam = stage.previewCamera;
      this._camWas = { fov: cam.fov, near: cam.near, far: cam.far };
      container.addEventListener('pointerdown', this._down);
      container.addEventListener('pointermove', this._moveDrag);
      container.addEventListener('pointerup', this._up);
      container.addEventListener('pointercancel', this._up);
    }
    if (this.pivot.parent !== stage.previewScene) stage.previewScene.add(this.pivot);
    stage.onPreviewFrame = this._frame;
    return true;
  }

  unmount() {
    const stage = this.stage;
    const host = this.host;
    this.host = null;
    this._drag = null;
    if (this.pivot.parent) this.pivot.parent.remove(this.pivot);
    if (!host) return;
    host.removeEventListener('pointerdown', this._down);
    host.removeEventListener('pointermove', this._moveDrag);
    host.removeEventListener('pointerup', this._up);
    host.removeEventListener('pointercancel', this._up);
    // only hand the stage back if it is still ours (never detach the Dress-Up Studio)
    if (stage.attachedTo === host) {
      if (stage.onPreviewFrame === this._frame) stage.onPreviewFrame = null;
      stage.detach();
      const cam = stage.previewCamera, was = this._camWas;
      if (was) {
        cam.fov = was.fov;
        cam.near = was.near;
        cam.far = was.far;
        cam.updateProjectionMatrix();
      }
    }
    this._camWas = null;
  }

  /**
   * Show an object (replacing and disposing the previous one). opts: { onFrame(dt, t, obj),
   * spin (rad/s), yaw, dir: camera direction, zoom, lift (look-at height share) }
   */
  show(object, { onFrame = null, spin = 0.7, yaw = 0.5, dir = [0, 0.42, 1], zoom = 1, lift = 0.5 } = {}) {
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
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(FOV) / 2)) * zoom;
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
    const ty = size.y * lift;
    this.cam.pos.set(d.x, ty + d.y, d.z);
    this.cam.ty = ty;
    this.cam.near = dist / 40;
    this.cam.far = dist * 5;
  }

  clear() {
    if (this.object) {
      this.pivot.remove(this.object);
      disposeObject(this.object);
      this.object = null;
      this.onFrame = null;
    }
  }

  /** Called by the stage (stage.onPreviewFrame) right before it draws previewScene. */
  update(dt) {
    if (!this.host || !this.object) return;
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
    // the stage camera is shared with the Studio: set all of it every frame
    const cam = this.stage.previewCamera, c = this.cam;
    cam.fov = FOV;
    cam.near = c.near;
    cam.far = c.far;
    cam.position.copy(c.pos);
    cam.updateProjectionMatrix();
    cam.lookAt(0, c.ty, 0);
  }
}

const previews = new WeakMap();

/** The shared preview for this game (no WebGL until it is mounted). */
export function preview(game) {
  let p = previews.get(game);
  if (!p) {
    p = new Preview(game);
    previews.set(game, p);
  }
  return p;
}
