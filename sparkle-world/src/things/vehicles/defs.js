// The fleet: nine cars, vans and boats she can drive (docs/teams/vehicles.md §2). Pure data,
// no models (index.js pairs each key with its build function), so Node tests can read it.
//
// Model space (the furniture convention): block units, footprint [0,w] x [0,h] x [0,d], nose
// = front = +Z. The driver sits on the left (+X) in two-wide cars: left of a +Z-facing car is
// +X, because the camera's right at yaw 0 is -X.
//
// def.vehicle (kept on the furniture def; entities.define() keeps unknown fields):
//   kind 'car' | 'kart' | 'van' | 'boat', water (boats), noun (for toasts), hint (Hand),
//   seat [x,y,z] (the seat SURFACE, the avatar's sitting origin), pose 'sit', door +1 left /
//   -1 right (where she steps out), body { halfW, halfL, height } (the physics probes),
//   speed / reverse (blocks per second), accel, turn (rad/s), cam (extra camera distance),
//   horn, engine (sfx voices), lamps [[x,y,z], ...] (headlamps, model units),
//   wheels { r, axles: [z, ...] } (spin), passenger (a second seat; unused in this wave).

// Ice Cream Van swatches: the shops' Ice Cream Truck colors, so the two match
const TRUCK_COLORS = ['#A6D8FF', '#FF9CCB', '#9BE8CF', '#C8B4FF', '#FFE38F', '#FFBFA0'];

export const VEHICLES = [
  {
    key: 'car_bubble', name: 'Bubble Car', size: [2, 2, 2],
    colors: ['#FF9CCB', '#9BE8CF', '#C8B4FF', '#A6D8FF', '#FFE38F', '#FFBFA0'],
    colliders: [[0.06, 0, 0.06, 1.94, 1.55, 1.94]],
    vehicle: {
      kind: 'car', noun: 'car', hint: 'Tap to drive!', seat: [1.0, 0.45, 0.95], pose: 'sit', door: 1,
      body: { halfW: 0.88, halfL: 0.88, height: 1.6 }, speed: 6.5, reverse: 2.5, accel: 5, turn: 2.2, cam: 1.5,
      horn: 'meep', engine: 'buzz', lamps: [[0.6, 0.8, 1.92], [1.4, 0.8, 1.92]], wheels: { r: 0.26, axles: [0.45, 1.55] },
    },
  },
  {
    key: 'car_convertible', name: 'Convertible', size: [2, 2, 3],
    colors: ['#FF5FA2', '#6CC6FF', '#3FD8B0', '#9C7BFF', '#FFC94D', '#FFFFFF'],
    colliders: [[0.06, 0, 0.04, 1.94, 1.25, 2.96]],
    vehicle: {
      kind: 'car', noun: 'car', hint: 'Tap to drive!', seat: [1.32, 0.5, 1.25], passenger: [0.68, 0.5, 1.25], pose: 'sit', door: 1,
      body: { halfW: 0.88, halfL: 1.38, height: 1.3 }, speed: 8, reverse: 2.5, accel: 5, turn: 2.0, cam: 1.5,
      horn: 'aooga', engine: 'purr', lamps: [[0.45, 0.62, 2.98], [1.55, 0.62, 2.98]], wheels: { r: 0.28, axles: [0.62, 2.38] },
    },
  },
  {
    key: 'car_jeep', name: 'Safari Jeep', size: [2, 2, 3],
    colors: ['#E9C98F', '#8FD4A8', '#FF9F5A', '#6CC6FF', '#FF6F7D', '#B9A3FF'],
    colliders: [[0.06, 0, 0.04, 1.94, 1.7, 2.96]],
    vehicle: {
      kind: 'car', noun: 'jeep', hint: 'Tap to drive!', seat: [1.32, 0.62, 1.3], passenger: [0.68, 0.62, 1.3], pose: 'sit', door: 1,
      body: { halfW: 0.88, halfL: 1.38, height: 1.7 }, speed: 7, reverse: 2.5, accel: 5, turn: 2.0, cam: 1.8,
      horn: 'honk', engine: 'rumble', lamps: [[0.4, 0.86, 2.98], [1.6, 0.86, 2.98]], wheels: { r: 0.34, axles: [0.62, 2.38] },
    },
  },
  {
    key: 'car_kart', name: 'Go-Kart', size: [1, 1, 2],
    colors: ['#FF4F7B', '#4FB8FF', '#3FD8B0', '#FFC94D', '#9C7BFF', '#FF9F43'],
    colliders: [[0.06, 0, 0.05, 0.94, 0.7, 1.95]],
    vehicle: {
      kind: 'kart', noun: 'go-kart', hint: 'Tap to drive!', seat: [0.5, 0.28, 0.75], pose: 'sit', door: 1,
      body: { halfW: 0.4, halfL: 0.9, height: 0.9 }, speed: 8.5, reverse: 2.5, accel: 7, turn: 2.6, cam: 1.0,
      horn: 'beep', engine: 'zip', lamps: [[0.3, 0.36, 1.96], [0.7, 0.36, 1.96]], wheels: { r: 0.2, axles: [0.35, 1.62] },
    },
  },
  {
    key: 'van_camper', name: 'Road Trip Van', size: [2, 3, 4],
    colors: ['#8FE3D0', '#FFB3C7', '#A6D8FF', '#FFE38F', '#C8B4FF', '#FFBFA0'],
    colliders: [[0.06, 0, 0.04, 1.94, 2.6, 3.96]],
    vehicle: {
      kind: 'van', noun: 'van', hint: 'Tap to drive!', seat: [1.3, 0.9, 2.85], passenger: [0.7, 0.9, 2.85], pose: 'sit', door: 1,
      body: { halfW: 0.88, halfL: 1.88, height: 2.6 }, speed: 6, reverse: 2.2, accel: 4, turn: 1.6, cam: 2.5,
      horn: 'toot', engine: 'hum', lamps: [[0.42, 0.78, 3.98], [1.58, 0.78, 3.98]], wheels: { r: 0.3, axles: [0.75, 3.2] },
    },
  },
  {
    key: 'van_icecream', name: 'Ice Cream Van', size: [2, 3, 4],
    colors: TRUCK_COLORS,
    colliders: [[0.06, 0, 0.04, 1.94, 2.6, 3.96]],
    vehicle: {
      kind: 'van', noun: 'van', hint: 'Tap to drive!', seat: [1.3, 0.9, 2.85], passenger: [0.7, 0.9, 2.85], pose: 'sit', door: 1,
      body: { halfW: 0.88, halfL: 1.88, height: 2.6 }, speed: 6, reverse: 2.2, accel: 4, turn: 1.6, cam: 2.5,
      horn: 'jingle', engine: 'hum', lamps: [[0.42, 0.78, 3.98], [1.58, 0.78, 3.98]], wheels: { r: 0.3, axles: [0.75, 3.2] },
    },
  },
  {
    key: 'boat_speed', name: 'Speedboat', size: [2, 2, 4],
    colors: ['#FF5FA2', '#3AAEF0', '#22BF95', '#9C7BFF', '#FFC94D', '#FF7A59'],
    colliders: [[0.05, 0, 0.05, 1.95, 1.3, 3.95]],
    vehicle: {
      kind: 'boat', water: true, noun: 'boat', hint: 'Tap to drive the boat!', seat: [1.0, 1.05, 1.6], pose: 'sit', door: 1,
      body: { halfW: 0.85, halfL: 1.85, height: 1.0 }, speed: 9.5, reverse: 2.0, accel: 4, turn: 1.8, cam: 2.2,
      horn: 'toot', engine: 'putt', lamps: [[0.7, 1.3, 3.7], [1.3, 1.3, 3.7]],
    },
  },
  {
    key: 'boat_swan', name: 'Swan Boat', size: [2, 2, 3],
    colors: ['#FFFFFF', '#FFD1E6', '#E6DDFF', '#BFE9FF', '#FFF1B8', '#C9F2E4'],
    colliders: [[0.05, 0, 0.05, 1.95, 1.3, 2.95]],
    vehicle: {
      kind: 'boat', water: true, noun: 'boat', hint: 'Tap to pedal!', seat: [1.0, 1.0, 1.1], pose: 'sit', door: 1,
      body: { halfW: 0.85, halfL: 1.35, height: 1.0 }, speed: 4, reverse: 1.5, accel: 3, turn: 2.0, cam: 2.0,
      horn: 'quack', engine: 'pedal', lamps: [[0.7, 1.2, 2.6], [1.3, 1.2, 2.6]],
    },
  },
  {
    key: 'boat_sail', name: 'Sailboat', size: [2, 4, 4],
    colors: ['#FF9CCB', '#A6D8FF', '#FFE38F', '#9BE8CF', '#C8B4FF', '#FFFFFF'],
    colliders: [[0.05, 0, 0.05, 1.95, 1.3, 3.95]],
    vehicle: {
      kind: 'boat', water: true, noun: 'boat', hint: 'Tap to sail!', seat: [1.0, 1.05, 0.9], pose: 'sit', door: 1,
      body: { halfW: 0.85, halfL: 1.85, height: 1.0, clearance: 3.9 }, speed: 6.5, reverse: 1.5, accel: 2.5, turn: 1.5, cam: 3.0,
      horn: 'ding', engine: 'sail', lamps: [[0.75, 1.25, 3.6], [1.25, 1.25, 3.6]],
    },
  },
];

export const VEHICLE_KEYS = VEHICLES.map((v) => v.key);
const byKey = new Map(VEHICLES.map((v) => [v.key, v]));

/** The fleet entry for a key, or null. */
export function vehicleDef(key) {
  return byKey.get(key) || null;
}
