// Camera rig: third person over-the-shoulder orbit (drag / right-side touch, wheel/pinch zoom
// 2..9, pulls in so it never clips into blocks) and first person (V key / Settings).
//
// Third person sits a little to the right of and above the head, looking past it, so the
// avatar stands left of centre and the spot being built on (screen centre) stays visible.

import { clamp } from '../core/util.js';
import { raycastVoxels, makeVoxelHit } from '../world/raycast.js';

const SENS_MOUSE = 0.0055;
const SENS_TOUCH = 0.0075;
const TURN_SPEED = 2.4; // rad/s for arrow keys
const EYE = 1.55;
const HEAD = 1.45;
const SHOULDER = 0.75; // sideways offset of the orbit pivot (to the camera's right)
const LIFT = 0.3; // the pivot also sits this far above the head
const HIDE_AVATAR_WITHIN = 1.15; // camera this close to the head: hide the avatar

export class CameraRig {
  constructor(game, player) {
    this.game = game;
    this.player = player;
    this.mode = 'third';
    this.yaw = player.yaw;
    this.pitch = 0.32;
    this.distance = 4.5; // wanted distance
    this.current = 4.5; // after collision pull-in
    this.shoulder = 1; // share of the shoulder offset in use (pulled in beside walls)
    this._rays = [[0, 0], [0.22, 0.14], [-0.22, 0.14], [0.22, -0.14], [-0.22, -0.14]];
    this._hit = makeVoxelHit();
    this._accept = null;
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
    this.shoulder = 1;
    this.update(0, true);
  }

  /** Distance a ray travels from (x,y,z) along (dx,dy,dz) before a solid block, up to max. */
  _clear(x, y, z, dx, dy, dz, max) {
    const g = this.game;
    if (!this._accept) {
      const props = g.registry.blocks.props;
      this._accept = (id) => props.opaque[id] === 1 || props.solid[id] === 1;
    }
    const hit = raycastVoxels(g.world, x, y, z, dx, dy, dz, max, this._accept, this._hit);
    return hit ? hit.distance : max;
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
    const hx = p.x, hy = p.y + headY, hz = p.z;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = -sp, dz = Math.cos(this.yaw) * cp;

    if (first && state !== 'sleep') {
      cam.position.set(hx, hy, hz);
      cam.lookAt(hx + dx, hy + dy, hz + dz);
      if (this.player.avatar) this.player.avatar.group.visible = false;
      return;
    }

    // the orbit pivot: over the right shoulder (centred when lying in bed), never inside a wall
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw); // camera right
    const wantShoulder = state === 'sleep' ? 0 : 1;
    let shoulderRoom = wantShoulder;
    if (g.world && wantShoulder > 0) {
      const len = Math.hypot(SHOULDER, LIFT);
      const free = this._clear(hx, hy, hz, rx * SHOULDER / len, LIFT / len, rz * SHOULDER / len, len + 0.3);
      shoulderRoom = clamp((free - 0.3) / len, 0, 1);
    }
    if (snap || shoulderRoom < this.shoulder) this.shoulder = shoulderRoom;
    else this.shoulder += (shoulderRoom - this.shoulder) * Math.min(1, 6 * dt);
    // portrait phones are narrow: a smaller sideways step keeps her from drifting to the edge
    const side = SHOULDER * Math.min(1, cam.aspect * 1.4) * this.shoulder;
    const tx = hx + rx * side, ty = hy + LIFT * this.shoulder, tz = hz + rz * side;

    // pull in when blocks are between the pivot and the camera
    let allowed = this.distance;
    if (g.world) {
      // perpendicular offsets approximate the near-plane corners
      for (const [ox, oy] of this._rays) {
        const free = this._clear(tx + rx * ox, ty + oy, tz + rz * ox, -dx, -dy, -dz, this.distance + 0.3);
        if (free < this.distance + 0.3) allowed = Math.min(allowed, Math.max(0.3, free - 0.3));
      }
    }
    if (snap || allowed < this.current) this.current = allowed;
    else this.current += (allowed - this.current) * Math.min(1, 5 * dt);

    cam.position.set(tx - dx * this.current, ty - dy * this.current, tz - dz * this.current);
    cam.lookAt(tx, ty, tz);
    if (this.player.avatar) {
      const near = Math.hypot(cam.position.x - hx, cam.position.y - hy, cam.position.z - hz);
      this.player.avatar.group.visible = near > HIDE_AVATAR_WITHIN;
    }
  }
}
