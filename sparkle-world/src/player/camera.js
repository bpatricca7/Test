// Camera rig: third person orbit (drag / right-side touch, wheel/pinch zoom 2..9, pulls in
// so it never clips into blocks) and first person (V key / Settings).

import { clamp } from '../core/util.js';
import { raycastVoxels } from '../world/raycast.js';

const SENS_MOUSE = 0.0055;
const SENS_TOUCH = 0.0075;
const TURN_SPEED = 2.4; // rad/s for arrow keys
const EYE = 1.55;
const HEAD = 1.45;

export class CameraRig {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.mode = 'third';
    this.yaw = player.yaw;
    this.pitch = 0.32;
    this.distance = 4.5; // wanted distance
    this.current = 4.5; // after collision pull-in
    this._rays = [[0, 0], [0.22, 0.14], [-0.22, 0.14], [0.22, -0.14], [-0.22, -0.14]];
  }

  setMode(mode) {
    this.mode = mode === 'first' ? 'first' : 'third';
    if (this.player.avatar) this.player.avatar.group.visible = this.mode === 'third';
  }

  toggleMode() {
    this.setMode(this.mode === 'first' ? 'third' : 'first');
    this.game.audio.play('click');
  }

  /** Jump straight to the target pose (after teleports and world loads). */
  snap() {
    this.current = this.distance;
    this.update(0, true);
  }

  update(dt, snap = false) {
    const g = this.game;
    const input = g.input;
    const sens = input.touchMode ? SENS_TOUCH : SENS_MOUSE;
    this.yaw -= input.look.dx * sens + input.turn * TURN_SPEED * dt;
    this.pitch += input.look.dy * sens;
    if (input.zoom) this.distance = clamp(this.distance + input.zoom * 0.7, 2, 9);
    const first = this.mode === 'first';
    this.pitch = clamp(this.pitch, first ? -1.45 : -0.9, first ? 1.45 : 1.3);

    const p = this.player.position;
    const cam = g.camera;
    const state = this.player.state;
    const headY = state === 'sleep' ? 0.6 : state === 'sit' ? 0.75 : first ? EYE : HEAD;
    const tx = p.x, ty = p.y + headY, tz = p.z;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = -sp, dz = Math.cos(this.yaw) * cp;

    if (first && state !== 'sleep') {
      cam.position.set(tx, ty, tz);
      cam.lookAt(tx + dx, ty + dy, tz + dz);
      if (this.player.avatar) this.player.avatar.group.visible = false;
      return;
    }

    // third person: pull in when blocks are between the head and the camera
    let allowed = this.distance;
    if (g.world) {
      const props = g.registry.blocks.props;
      const accept = (id) => props.opaque[id] === 1 || props.solid[id] === 1;
      // perpendicular offsets approximate the near-plane corners
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      for (const [ox, oy] of this._rays) {
        const sx = tx + rx * ox, sy = ty + oy, sz = tz + rz * ox;
        const hit = raycastVoxels(g.world, sx, sy, sz, -dx, -dy, -dz, this.distance + 0.3, accept);
        if (hit) allowed = Math.min(allowed, Math.max(0.3, hit.distance - 0.3));
      }
    }
    if (snap || allowed < this.current) this.current = allowed;
    else this.current += (allowed - this.current) * Math.min(1, 5 * dt);

    cam.position.set(tx - dx * this.current, ty - dy * this.current, tz - dz * this.current);
    cam.lookAt(tx, ty, tz);
    if (this.player.avatar) this.player.avatar.group.visible = this.current > 0.9;
  }
}
