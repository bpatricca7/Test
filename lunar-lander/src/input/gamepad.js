// Gamepad API polling (standard mapping). Converts the first connected controller into
// hand-controller axes with deadzones and expo curves, plus raw button states for edge detection.
// Never throws when the API is missing (older browsers, headless tests, insecure contexts).

import { GAMEPAD } from './bindings.js';
import { stickDeadzone, axisDeadzone, expo } from './axes.js';

/**
 * @returns {{poll(): object|null, id: string|null}}
 *   poll() -> null when no controller is connected, else
 *   { pitch, yaw, roll, transUp, lt, rt, buttons: boolean[] }  (axes -1..1, triggers 0..1)
 */
export function createGamepadReader() {
  const out = { pitch: 0, yaw: 0, roll: 0, transUp: 0, lt: 0, rt: 0, buttons: new Array(17).fill(false) };
  const reader = {
    id: null,
    poll() {
      let pads = null;
      try {
        pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
      } catch {
        pads = null; // blocked by a permissions policy
      }
      if (!pads) return null;
      let gp = null;
      for (const p of pads) {
        if (p && p.connected !== false && p.axes && p.buttons) {
          if (!gp || (p.mapping === 'standard' && gp.mapping !== 'standard')) gp = p;
        }
      }
      if (!gp) {
        reader.id = null;
        return null;
      }
      reader.id = gp.id;
      const A = GAMEPAD.axes;
      const ax = (i) => (Number.isFinite(gp.axes[i]) ? gp.axes[i] : 0);
      const dz = GAMEPAD.deadzone;
      // left stick: roll (x), pitch (y; pulled back = +1 = nose up, like an aircraft stick)
      const [lx, ly] = stickDeadzone(ax(A.roll), ax(A.pitch), dz);
      // right stick: yaw (x), vertical translation (y; pushed up = -1 = translate up)
      const [rx, ry] = stickDeadzone(ax(A.yaw), ax(A.transUp), dz);
      out.roll = expo(lx, GAMEPAD.expoRotation);
      out.pitch = expo(ly, GAMEPAD.expoRotation);
      out.yaw = expo(rx, GAMEPAD.expoRotation);
      out.transUp = -expo(ry, GAMEPAD.expoTranslation);
      const btn = (i) => gp.buttons[i];
      const val = (i) => {
        const b = btn(i);
        if (!b) return 0;
        return typeof b === 'object' ? (Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0) : b ? 1 : 0;
      };
      out.lt = axisDeadzone(val(GAMEPAD.buttons.LT), 0.06);
      out.rt = axisDeadzone(val(GAMEPAD.buttons.RT), 0.06);
      for (let i = 0; i < out.buttons.length; i++) {
        const b = btn(i);
        out.buttons[i] = !!(b && (typeof b === 'object' ? b.pressed || b.value > 0.5 : b));
      }
      return out;
    },
  };
  return reader;
}
