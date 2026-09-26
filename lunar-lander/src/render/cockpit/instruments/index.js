// Live Apollo instruments (INSTRUMENTS agent) — used by the LM and CSM cabins.
//
// Contract (ARCHITECTURE.md §7): every factory returns
//   { object: THREE.Object3D, width, height, update(vessel, game, dt) }
// The face lies in the local XY plane facing +Z, centred on the origin, depth toward -Z. Metres.
// Objects are already on LAYERS.CABIN. Call update() every frame (it rate-limits itself to <= 30 Hz
// and only redraws canvases when the displayed content changes); `dt` is the real frame time.
//
// MOUNTING: instruments are real boxes — the FDAI ball, tape drums, display wells and cases extend
// BEHIND the face plane by `inst.depth` metres (the bezel sits in front, z = 0..+4 mm). Mount them
// in a cut-out: createPanel({ holes: [{ x, y, w: inst.mountHole.w, h: inst.mountHole.h }] }) and put
// inst.object at (x, y, 0) on that panel, or stand them proud of solid structure by >= inst.depth.
// A solid plate directly behind the face hides the ball / tapes / displays.
//
//   createDSKY({keyboard, variant})            0.203 × 0.216  vessel.agc (+ .pressKey(label))
//   createFDAI({size, rateScale, errorScale})  size × size    attitude vs local vertical, rates, errors
//   createAltTapes({source})                   0.12 × 0.16    ALT (ft) / ALT RATE (ft/s)
//   createRangeTapes()                         0.12 × 0.16    RANGE (nmi) / RANGE RATE (ft/s), tel.relTarget
//   createCrossPointer({size, scale})          size × size    body forward / lateral velocity (ft/s)
//   createMissionTimer({label})                0.20 × 0.055   game.time.met HHH:MM:SS
//   createEventTimer({label})                  0.12 × 0.05    MM:SS (TIG countdown / since ignition)
//   createAnnunciatorPanel({labels, cols, cellW, cellH, style})  cols*cellW × rows*cellH, vessel.cw.lights
//   createMasterAlarm({flash, size})           0.045 × 0.045  vessel.cw.masterAlarm
//   createGauge({kind, label, min, max, units, getValue, width, height, ticks, redline, yellow})
//   createThrustIndicator()                    0.10 × 0.12    T/W + THRUST % (CMD & ACT)
//   createContactLights({label})               0.09 × 0.03    LUNAR CONTACT (blue)
//   createEMS({deltaV})                        0.26 × 0.18    CSM entry monitor, ΔV counter in vessel.ems.dv
//   createGPI()                                0.14 × 0.12    CSM SPS gimbal position / fuel pressure
//   createPropellantGauges()                   0.18 × 0.10    CSM SPS quantity, UNBAL, SM RCS qty
//   createDigitalReadout({digits, decimals, sign, color, label, getValue, width, height})  extra
export { createDSKY } from './dsky.js';
export { createFDAI } from './fdai.js';
export { createAltTapes, createRangeTapes, TAPES } from './tapes.js';
export { createCrossPointer } from './crosspointer.js';
export { createMissionTimer, createEventTimer } from './timers.js';
export { createAnnunciatorPanel, createMasterAlarm, createContactLights } from './lights.js';
export { createGauge, createThrustIndicator, createGPI, createPropellantGauges, createDigitalReadout } from './gauges.js';
export { createEMS } from './ems.js';
export { drawSegChar, createDisplay, createCase, limiter } from './common.js';
export { fdaiBallQuaternion, fdaiBallLocal, tapeScale, formatMET, formatMMSS, crossPointerVelocities } from './math.js';
