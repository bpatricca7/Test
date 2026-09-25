// STUB — owned by the GNC agent. Replace with the full implementation.
// Contract: createGNC(game) -> { reset(), update(h) }   (update called once per physics substep)
import * as THREE from 'three';

export function createGNC(game) {
  game.events.on('action', (a) => {
    const v = game.active;
    if (a.name === 'KILL_ROT') v.angVel.set(0, 0, 0);
  });
  return {
    reset() {},
    update(h) {
      for (const v of Object.values(game.vessels)) {
        const c = v.ctrl;
        v.mainEngine.throttleCmd = c.throttle;
        const cmd = new THREE.Vector3(c.pitch, -c.yaw, -c.roll).multiplyScalar(0.35);
        // rate command: drive angVel toward cmd
        v.debugAngAcc = cmd.sub(v.angVel).multiplyScalar(2.0);
      }
    },
  };
}
