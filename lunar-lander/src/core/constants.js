// Physical constants, vehicle data and shared geometry.
//
// EVERY module that needs a number describing the Moon, the Sun, a spacecraft's
// mass/propulsion, or a spacecraft's geometry (windows, eye points, thrusters,
// landing gear, docking ports) MUST read it from here so that physics, guidance,
// exterior models, cockpits, effects and audio agree.
//
// Units: SI (m, kg, s, N, rad) unless the name says otherwise.
//
// Vessel body frames (three.js local space of each vessel group):
//   LM : +Y = up along the descent/ascent engine thrust axis (Apollo +X)
//        -Z = forward, out of the front windows / forward hatch (Apollo +Z)
//        +X = right, from the crew's point of view (Apollo +Y)
//        Origin: on the centreline, at the plane of the footpad bottoms (gear extended).
//   CSM: -Z = forward, toward the CM apex / docking probe (Apollo +X)
//        +Y = crew "head-up" direction (toward the side hatch)
//        +X = right, from the crew's point of view
//        Origin: on the centreline, at the CM/SM interface plane (base of the CM heat shield).
//   Both: pitch = rotation about +X, yaw = about +Y, roll = about +Z (right-hand rule),
//   so "nose up" = +wx, "nose right" = -wy, "roll right (right side down)" = -wz.

import * as THREE from 'three';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const deg = Math.PI / 180;

// ---------------------------------------------------------------- units
export const FT = 0.3048; // m per foot
export const NMI = 1852; // m per nautical mile
export const LBF = 4.44822; // N per pound-force
export const LB = 0.453592; // kg per pound
export const G0 = 9.80665; // standard gravity for Isp

// ---------------------------------------------------------------- Moon
export const MOON = {
  mu: 4.9028e12, // m^3/s^2
  radius: 1737400, // reference radius, m (terrain heights are relative to this)
  // The Moon is modelled as NON-ROTATING in the Moon-Centred Inertial (MCI) frame.
  // MCI: +Z = lunar north pole, +X = lon 0 (sub-Earth point), +Y = lon 90 E.
};

// Tranquility Base (Apollo 11 landing site) — the guidance target for landing scenarios.
export const LANDING_SITE = {
  name: 'Tranquility Base',
  latDeg: 0.67408,
  lonDeg: 23.47297,
};

// ---------------------------------------------------------------- Sun / Earth
// The Sun is fixed in MCI. Chosen so that at the landing site the Sun is 10.8 deg
// above the EASTERN horizon (Apollo 11 conditions): the LM approaches flying WEST
// with the Sun low behind it, so long shadows point ahead of the spacecraft.
export const SUN_ELEVATION_AT_SITE_DEG = 10.8;
export const SUN_AZIMUTH_AT_SITE_DEG = 91.0; // from north, clockwise (90 = due east)
export const SUN = {
  // direction is computed in core/frames.js -> sunDirectionMCI() from the numbers above
  intensity: 7.0, // three.js DirectionalLight intensity used for sunlight everywhere
  color: 0xfff6ea, // slightly warm white (no atmosphere on the Moon)
  angularDiameterDeg: 0.533,
};
export const EARTH = {
  radius: 6371000,
  distance: 384400000, // along +X in MCI (Earth hangs over lon 0, lat 0)
};

// ---------------------------------------------------------------- render layers
export const LAYERS = {
  WORLD: 0, // terrain, sky, rocks — seen by the main camera
  VESSEL: 1, // exterior spacecraft models — main camera + vessel shadow pass
  GHOST: 2, // own exterior model while in IVA view — ONLY in the vessel shadow pass
  CABIN: 3, // cockpit interiors — main camera only
  FX: 4, // plumes, particles, dust — main camera only
};

// ---------------------------------------------------------------- Lunar Module (Apollo 11 "Eagle")
export const LM = {
  name: 'Eagle',
  // masses (kg)
  descentDryMass: 2034,
  descentPropMax: 8248,
  ascentDryMass: 2445, // incl. crew & equipment
  ascentPropMax: 2353,
  rcsPropMax: 287,
  // component centres of mass in LM body frame (m) — physics blends these by mass
  cgDescentDry: v(0, 2.10, 0),
  cgDescentProp: v(0, 2.25, 0),
  cgAscentDry: v(0, 4.55, -0.15),
  cgAscentProp: v(0, 4.30, 0.25),
  cgRcsProp: v(0, 4.75, 0),
  // Principal moments of inertia about the CG (kg m^2) for the FULL fuelled LM and for the
  // ascent stage alone (full). Physics scales linearly with mass between empty and full.
  inertiaFull: v(32000, 25000, 30000), // about body X (pitch), Y (yaw), Z (roll)
  inertiaAscent: v(6800, 5500, 6200),
  // Descent Propulsion System — throttleable, gimballed to thrust through the CG
  dps: {
    name: 'DPS',
    maxThrust: 45040, // N (10,125 lbf)
    isp: 311,
    minThrottle: 0.10,
    maxThrottle: 1.0,
    thrustDir: v(0, 1, 0), // force direction on the vehicle (body)
    nozzleExit: v(0, 0.78, 0), // centre of the nozzle exit plane (body)
    nozzleExitRadius: 0.76,
    nozzleThroat: v(0, 1.95, 0),
  },
  // Ascent Propulsion System — fixed thrust, not throttleable
  aps: {
    name: 'APS',
    maxThrust: 15570, // N (3,500 lbf)
    isp: 311,
    minThrottle: 1.0,
    maxThrottle: 1.0,
    thrustDir: v(0, 1, 0),
    nozzleExit: v(0, 3.10, 0),
    nozzleExitRadius: 0.44,
    nozzleThroat: v(0, 3.75, 0),
  },
  rcs: {
    thrust: 445, // N (100 lbf) per jet
    isp: 290,
    minImpulseBit: 0.014, // s — shortest pulse (used by PULSE mode)
    quadRadius: 1.55, // quads sit at (±1.55, 4.80, ±1.55)
    quadHeight: 4.80,
    nozzleOffset: 0.26, // jet exit distance from quad centre along its exhaust direction
  },
  // Landing gear: 4 legs on the body axes. Forward leg (-Z) carries the ladder & porch.
  gear: {
    padCenterRadius: 4.55, // horizontal distance of footpad centre from the centreline
    padRadius: 0.47,
    padHeight: 0.18,
    // Leg attachment points on the descent stage (primary strut upper end), per leg below
    strutTopRadius: 2.05,
    strutTopY: 2.85,
    maxStroke: 0.81, // m of primary-strut compression (crushable honeycomb)
    // contact probes (1.73 m) hang below the pads of the aft, left and right legs
    probeLength: 1.73,
    probeLegs: ['aft', 'left', 'right'],
    legs: [
      { id: 'fwd', dir: v(0, 0, -1) },
      { id: 'right', dir: v(1, 0, 0) },
      { id: 'aft', dir: v(0, 0, 1) },
      { id: 'left', dir: v(-1, 0, 0) },
    ],
  },
  // Main structure envelope (used by models, physics contact hulls, shadow boxes)
  descentStage: {
    widthFlats: 4.22, // octagon across flats (m)
    yBottom: 1.35,
    yTop: 3.10,
  },
  ascentStage: {
    yBottom: 3.10,
    yTop: 6.10, // top of cabin structure
    // crew cabin: cylinder of diameter 2.34 m, axis along Z (front/back)
    cabinRadius: 1.17,
    cabinAxisY: 4.60,
    cabinFrontZ: -1.25, // forward bulkhead plane (windows / hatch are on this face)
    cabinRearZ: -0.18,
    width: 4.29, // incl. RCS quads
  },
  docking: {
    // drogue / overhead hatch on the ascent stage top, on the centreline
    port: v(0, 6.45, 0),
    axis: v(0, 1, 0),
    tunnelRadius: 0.42,
  },
  // Crew stations & windows (shared by the exterior model, the cabin and the LPD computation)
  eyeCDR: v(-0.40, 5.20, -0.90), // Commander's design eye point (standing, left)
  eyeLMP: v(0.40, 5.20, -0.90), // LM Pilot (right)
  windows: {
    // Planar triangles, vertices in LM body frame (counter-clockwise seen from OUTSIDE).
    cdr: [v(-0.08, 5.52, -1.14), v(-0.16, 4.72, -1.24), v(-0.80, 5.52, -1.00)],
    lmp: [v(0.08, 5.52, -1.14), v(0.80, 5.52, -1.00), v(0.16, 4.72, -1.24)],
    // Overhead docking window above the CDR: rectangle centre / outward normal / size
    overhead: { center: v(-0.42, 5.70, -0.72), normal: v(0, 1, 0), width: 0.32, height: 0.14 },
  },
  forwardHatch: { center: v(0, 3.86, -1.26), width: 0.81, height: 0.81 }, // square hatch below the DSKY/windows
  floorY: 3.46, // cabin floor height (crew stand on it)
};

// ---------------------------------------------------------------- Command/Service Module ("Columbia")
export const CSM = {
  name: 'Columbia',
  cmDryMass: 5560,
  smDryMass: 6110,
  spsPropMax: 7000, // remaining in lunar orbit (enough for TEI + margin)
  rcsPropMax: 560, // SM RCS (4 quads)
  cgCM: v(0, 0.10, -1.05),
  cgSMDry: v(0, 0, 2.60),
  cgSpsProp: v(0, 0, 2.30),
  cgRcsProp: v(0, 0, 1.40),
  inertiaFull: v(118000, 118000, 30000), // pitch (X), yaw (Y), roll (Z)
  inertiaEmpty: v(76000, 76000, 21000),
  sps: {
    name: 'SPS',
    maxThrust: 91190, // N (20,500 lbf)
    isp: 314,
    minThrottle: 1.0,
    maxThrottle: 1.0,
    thrustDir: v(0, 0, -1), // pushes toward the nose
    nozzleExit: v(0, 0, 7.80),
    nozzleExitRadius: 1.25,
    nozzleThroat: v(0, 0, 5.10),
  },
  rcs: {
    thrust: 445,
    isp: 290,
    minImpulseBit: 0.014,
    quadRadius: 2.10, // radial distance of quad centre from the axis
    quadZ: 1.35, // 1.35 m aft of CM/SM interface
    quadAngles: [7.25, 97.25, 187.25, 277.25].map((a) => a * deg), // measured from +Y toward +X
    quadNames: ['A', 'B', 'C', 'D'],
    nozzleOffset: 0.22,
  },
  cm: {
    // Aft heat shield: spherical cap bulging 0.30 m toward the SM (z = 0 .. +0.30).
    // Conical side wall: 33 deg half-angle from r = 1.955 at z = 0 to r = 0.625 at z = -2.05,
    // then a rounded forward shoulder (forward heat shield) to z = -2.55 (r ~ 0.45),
    // then the docking tunnel ring to z = -2.95.
    baseRadius: 1.955,
    coneHalfAngle: 33 * deg,
    coneTopZ: -2.05,
    coneTopRadius: 0.625,
    shoulderZ: -2.55,
    apexZ: -2.95,
    heatShieldBulge: 0.30,
    tunnelRadius: 0.42,
    // Inner pressure vessel is ~0.12 m inside the outer mould line.
    wallThickness: 0.12,
  },
  sm: {
    radius: 1.955,
    zFront: 0.05,
    zRear: 5.00,
  },
  docking: {
    probeTip: v(0, 0, -3.55), // extended probe tip
    port: v(0, 0, -2.95), // docking ring plane (meets the LM drogue port when hard-docked)
    axis: v(0, 0, -1),
  },
  // Crew: couches with backs toward +Z (heat shield), faces toward -Z (instrument panel/apex),
  // heads toward +Y. Eye points are for the crew in lunar orbit (slightly raised from couches).
  eyeCDR: v(-0.62, 0.28, -0.45), // left couch
  eyeCMP: v(0.0, 0.28, -0.45), // centre couch
  eyeLMP: v(0.62, 0.28, -0.45), // right couch
  // Main Display Console: a three-section console (left wing, centre, right wing) that follows
  // the cone, ~0.65 m in front of the crew's faces. The CDR's line of sight to the LEFT
  // RENDEZVOUS WINDOW and to the HATCH WINDOW must stay clear of it.
  mainDisplayConsole: { center: v(0, 0.05, -1.10), width: 1.85, height: 0.80 },
  windows: {
    // Rectangles: centre, outward normal, up (in-plane "top" direction), width, height (m).
    // Rendezvous windows are recessed pockets in the cone that look FORWARD (-Z).
    rendezvousLeft: { center: v(-0.78, 0.65, -1.45), normal: v(-0.25, 0.35, -0.90).normalize(), up: v(0, 0.93, 0.36).normalize(), width: 0.20, height: 0.28 },
    rendezvousRight: { center: v(0.78, 0.65, -1.45), normal: v(0.25, 0.35, -0.90).normalize(), up: v(0, 0.93, 0.36).normalize(), width: 0.20, height: 0.28 },
    // Side windows lie flush in the cone wall.
    sideLeft: { center: v(-1.29, 0.23, -1.00), normal: v(-0.826, 0.146, -0.545).normalize(), up: v(0, 0.5, 0.87).normalize(), width: 0.33, height: 0.33 },
    sideRight: { center: v(1.29, 0.23, -1.00), normal: v(0.826, 0.146, -0.545).normalize(), up: v(0, 0.5, 0.87).normalize(), width: 0.33, height: 0.33 },
    // Hatch window: in the side hatch on the +Y side of the cone (round, 0.28 m).
    hatch: { center: v(0, 1.24, -1.10), normal: v(0, 0.839, -0.545).normalize(), up: v(0, 0.545, 0.839).normalize(), width: 0.28, height: 0.28, round: true },
  },
};

// ---------------------------------------------------------------- nominal mission numbers
export const MISSION = {
  csmOrbitAltitude: 111000, // ~60 nmi circular
  doiPerilune: 15200, // ~50,000 ft (PDI altitude)
  pdiRangeToSite: 480000, // m of ground track from PDI to the landing site
  // Descent guidance phase targets (landing-site-centred; downrange measured along the approach, negative = before the site)
  highGate: { altitude: 2300, downrange: -7900, hSpeed: 150, vSpeed: -45 }, // P63 -> P64
  lowGate: { altitude: 150, downrange: -400, hSpeed: 18, vSpeed: -5 }, // P64 -> P66
  // touchdown limits (LM structural design)
  touchdown: { maxVSpeed: 3.0, maxHSpeed: 1.2, maxTiltDeg: 12 },
};

// ---------------------------------------------------------------- derived helpers
/** Build the LM RCS jet table (16 jets). Returned objects are fresh copies. */
export function lmRcsJets() {
  const { quadRadius: r, quadHeight: y, nozzleOffset: o, thrust } = LM.rcs;
  // quads: 1 = front-right, 2 = aft-right, 3 = aft-left, 4 = front-left
  const quads = [
    { n: 1, sx: 1, sz: -1 },
    { n: 2, sx: 1, sz: 1 },
    { n: 3, sx: -1, sz: 1 },
    { n: 4, sx: -1, sz: -1 },
  ];
  const jets = [];
  for (const q of quads) {
    const c = v(q.sx * r, y, q.sz * r);
    const ex = [
      ['U', v(0, 1, 0)], // exhaust up   -> pushes vehicle down
      ['D', v(0, -1, 0)], // exhaust down -> pushes vehicle up
      ['X', v(q.sx, 0, 0)], // exhaust outboard along X
      ['Z', v(0, 0, q.sz)], // exhaust outboard along Z
    ];
    for (const [s, dir] of ex) {
      jets.push({
        id: `Q${q.n}${s}`,
        quad: q.n,
        pos: c.clone().addScaledVector(dir, o), // nozzle exit position (body)
        exhaustDir: dir.clone(), // unit vector, direction the plume leaves the nozzle (body)
        forceDir: dir.clone().negate(), // unit force on the vehicle (body)
        thrust,
        cmd: 0, // 0..1 commanded duty for this physics step (written by GNC)
        level: 0, // 0..1 actual firing level (written by physics; read by FX/audio/cockpit)
      });
    }
  }
  return jets;
}

/** Build the CSM SM RCS jet table (16 jets). */
export function csmRcsJets() {
  const { quadRadius: r, quadZ: z, quadAngles, quadNames, nozzleOffset: o, thrust } = CSM.rcs;
  const jets = [];
  quadAngles.forEach((a, i) => {
    const radial = v(Math.sin(a), Math.cos(a), 0); // from +Y toward +X
    const tangent = v(Math.cos(a), -Math.sin(a), 0); // radial rotated -90 deg about +Z
    const c = radial.clone().multiplyScalar(r).setZ(z);
    const ex = [
      ['F', v(0, 0, -1)], // exhaust forward -> pushes aft
      ['A', v(0, 0, 1)], // exhaust aft     -> pushes forward
      ['P', tangent.clone()], // tangential +
      ['M', tangent.clone().negate()], // tangential -
    ];
    for (const [s, dir] of ex) {
      jets.push({
        id: `${quadNames[i]}${s}`,
        quad: quadNames[i],
        pos: c.clone().addScaledVector(dir, o),
        exhaustDir: dir.clone(),
        forceDir: dir.clone().negate(),
        thrust,
        cmd: 0,
        level: 0,
      });
    }
  });
  return jets;
}

/** Footpad bottom-centre positions (body frame) with the gear uncompressed. */
export function lmFootpads() {
  return LM.gear.legs.map((l) => ({
    id: l.id,
    pos: l.dir.clone().multiplyScalar(LM.gear.padCenterRadius).setY(0),
    hasProbe: LM.gear.probeLegs.includes(l.id),
  }));
}
