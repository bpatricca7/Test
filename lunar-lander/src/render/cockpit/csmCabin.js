// STUB — owned by the CSM-CABIN agent. Contract: createCSMCabin(ctx) -> { root, update(frame, vessel), setActive(bool) }
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';

export function createCSMCabin(ctx) {
  const root = new THREE.Group();
  root.name = 'CSMCabin';
  root.visible = false;
  return {
    root,
    setActive(on) { root.visible = on; },
    update(frame, v) {
      if (!root.visible) return;
      root.position.copy(v.pos).sub(frame.origin);
      root.quaternion.copy(v.quat);
    },
  };
}
