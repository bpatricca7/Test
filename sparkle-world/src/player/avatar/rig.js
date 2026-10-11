// Avatar skeleton: rest pivots (avatar space: origin at the feet, facing +Z, ~1.75 tall) and
// the bone hierarchy. Left = +X (her left), right = -X. Everything else is authored in the
// same space and attached to the bone it moves with.

export const HIP = 0.64; // hip joint height
export const PIVOT_Y = 0.9; // whole-body rotations (lying down, cartwheels, twirls) turn here

export const REST = {
  body: [0, 0, 0],
  hips: [0, HIP, 0],
  legL: [0.1, HIP, 0],
  kneeL: [0.1, 0.34, 0],
  legR: [-0.1, HIP, 0],
  kneeR: [-0.1, 0.34, 0],
  torso: [0, 0.68, 0],
  head: [0, 1.1, 0],
  armL: [0.275, 1.04, 0],
  elbowL: [0.275, 0.82, 0],
  armR: [-0.275, 1.04, 0],
  elbowR: [-0.275, 0.82, 0],
};

export const PARENT = {
  hips: 'body', legL: 'hips', kneeL: 'legL', legR: 'hips', kneeR: 'legR', torso: 'hips',
  head: 'torso', armL: 'torso', elbowL: 'armL', armR: 'torso', elbowR: 'armR',
};

export const BONES = ['hips', 'legL', 'kneeL', 'legR', 'kneeR', 'torso', 'head', 'armL', 'elbowL', 'armR', 'elbowR'];

// head box (avatar space)
export const HEAD = { x: 0.31, y0: 1.13, y1: 1.71, z: 0.27 };
// hand centre (right hand holds items)
export const HAND_R = [-0.275, 0.61, 0.005];
