// Shared game state. This file defines the DATA SHAPE every module reads/writes.
// Behaviour lives elsewhere (sim/, gnc/, render/, ui/ ...). Modules may ADD fields
// to these objects but must never rename or repurpose the fields defined here.

import * as THREE from 'three';
import { EventBus } from './events.js';
import { LM, CSM, lmRcsJets, csmRcsJets, lmFootpads } from './constants.js';
import { SITE_DIR } from './frames.js';

/**
 * Pilot control inputs for one vessel. Written by input/ (for the ACTIVE vessel only), read by gnc/.
 * On a vessel switch the rotation/translation axes of the vessel left behind are zeroed; its throttle
 * lever keeps its setting (a hovering LM must not drop). The sim sets the lever to 0 at ABORT STAGE
 * hand-over and after automatic-throttle phases (bumpless automatic-to-manual hand-over).
 */
export function createControls() {
  return {
    // rotation hand controller (ACA), each -1..1
    pitch: 0, // + = nose up (rotate about +X)
    yaw: 0, // + = nose right
    roll: 0, // + = roll right (right side down)
    // translation hand controller (TTCA), each -1..1
    transFwd: 0, // + = accelerate toward body forward (-Z)
    transRight: 0, // + = toward body +X
    transUp: 0, // + = toward body +Y
    // throttle lever 0..1 (manual throttle). 0 = engine off.
    throttle: 0,
    // precision ("fine") control scale active
    fine: false,
  };
}

/** Telemetry block computed by sim/ after every physics step. SI units. */
export function createTelemetry() {
  return {
    altitude: 0, // above the terrain directly below the vessel CG (m)
    altitudeRef: 0, // above the reference sphere MOON.radius (m)
    terrainHeight: 0, // terrain height below the vessel relative to MOON.radius (m)
    radarAltitude: 0, // LM landing-radar altitude (slant-corrected); NaN when no lock
    vSpeed: 0, // radial velocity (m/s, + = climbing)
    hSpeed: 0, // horizontal speed magnitude (m/s)
    velENU: new THREE.Vector3(), // velocity in local east/north/up (m/s)
    lat: 0, // deg
    lon: 0, // deg
    heading: 0, // horizontal velocity track, deg from north
    attitude: { heading: 0, pitch: 0, roll: 0, tiltFromVertical: 0 }, // see frames.horizonAttitude
    periapsisAlt: 0,
    apoapsisAlt: 0,
    period: 0,
    orbitalSpeed: 0,
    inclinationDeg: 0,
    accel: 0, // non-gravitational acceleration magnitude (m/s^2)
    twr: 0, // current thrust / (mass * local gravity)
    maxTwr: 0, // at full throttle
    rangeToSite: 0, // ground range to the landing site / guidance target (m)
    bearingToSite: 0, // deg from north
    fuelFraction: 1, // main propellant remaining / max
    rcsFraction: 1,
    burnTimeLeft: 0, // s of main engine at current (or min) throttle before depletion
    relTarget: null, // {range, rangeRate, pos: Vector3 (body frame of this vessel)} to the other vessel
  };
}

function baseVessel(id, type, name) {
  return {
    id, // 'LM' | 'CSM'
    type, // 'LM' | 'CSM'
    name,
    // ---- kinematic state (MCI, doubles) ----
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(), // body -> MCI
    angVel: new THREE.Vector3(), // body frame, rad/s
    // ---- mass properties (maintained by sim/) ----
    mass: 0,
    cg: new THREE.Vector3(), // body frame
    inertia: new THREE.Vector3(1, 1, 1), // principal moments about CG, body axes
    // ---- propulsion ----
    mainEngine: null, // see createLM/createCSM
    propellant: { main: 0, mainMax: 0, rcs: 0, rcsMax: 0 },
    rcs: { jets: [] }, // see constants lmRcsJets()/csmRcsJets()
    // ---- status ----
    landed: false,
    crashed: false,
    crashReason: null,
    docked: false,
    dockedTo: null,
    // ---- control / guidance ----
    ctrl: createControls(),
    gnc: {
      rcsMode: 'RATE', // 'RATE' (rate command / attitude hold) | 'PULSE' | 'DIRECT'
      attHold: true, // hold attitude when the hand controller is released (RATE mode)
      autopilot: 'OFF', // attitude autopilot: 'OFF' | 'KILLROT' | 'PROGRADE' | 'RETROGRADE' |
      //   'RADIAL_OUT' | 'RADIAL_IN' | 'NORMAL' | 'ANTINORMAL' | 'LOCAL_VERTICAL' | 'TARGET' | 'GUIDANCE'
      throttleMode: 'MANUAL', // 'MANUAL' | 'AUTO' (guidance drives throttle)
      program: 'P00', // AGC major mode
      attError: new THREE.Vector3(), // deg, body axes (pitch, yaw, roll) — FDAI error needles
      rodCmd: 0, // P66 commanded vertical rate (m/s)
      targetDir: SITE_DIR.clone(), // unit MCI direction of the landing target (LPD redesignation moves it)
      lpdAngle: null, // deg, LPD look angle (P64)
      lpdTimeLeft: null, // s
    },
    // Apollo Guidance Computer display (DSKY) — written by gnc/, read by cockpit instruments & UI
    agc: {
      prog: '00',
      verb: '06',
      noun: '00',
      r1: '', // strings of up to 6 chars incl. sign, e.g. '+00350' ('' = blank)
      r2: '',
      r3: '',
      flashVerbNoun: false, // flashing = awaiting crew response (PRO)
      lights: {
        uplinkActy: false, temp: false, noAtt: false, gimbalLock: false, stby: false, keyRel: false,
        prog: false, restart: false, oprErr: false, tracker: false, alt: false, vel: false, compActy: false,
      },
      alarmCode: null, // e.g. '1202'
    },
    // Caution & warning — written by sim/ and gnc/, read by cockpit, UI, audio
    cw: {
      masterAlarm: false,
      lights: {}, // name -> boolean, e.g. {'DES QTY': true, 'LUNAR CONTACT': false}
    },
    tel: createTelemetry(),
  };
}

/** Lunar Module vessel state (fully fuelled, docked-configuration defaults). */
export function createLM() {
  const v = baseVessel('LM', 'LM', LM.name);
  v.mainEngine = {
    ...structuredCloneEngine(LM.dps),
    throttle: 0, // actual 0..1 (fraction of maxThrust); 0 = not firing
    throttleCmd: 0, // commanded by gnc/ 0..1
    armed: true,
    firing: false,
    gimbal: new THREE.Vector2(), // trim gimbal angles (rad) for effects only
  };
  v.propellant = { main: LM.descentPropMax, mainMax: LM.descentPropMax, rcs: LM.rcsPropMax, rcsMax: LM.rcsPropMax, ascent: LM.ascentPropMax, ascentMax: LM.ascentPropMax };
  v.rcs = { jets: lmRcsJets() };
  v.staged = false; // true once the ascent stage has separated (mainEngine becomes the APS)
  v.descentStage = null; // after staging: {pos: Vector3, quat: Quaternion} of the stage left behind
  v.gear = {
    pads: lmFootpads().map((p) => ({ ...p, compression: 0, contact: false, load: 0 })),
    probeContact: false, // LUNAR CONTACT
  };
  v.cw.lights = {
    'LUNAR CONTACT': false, 'DES QTY': false, 'MASTER ALARM': false, 'ENG FIRE': false, 'RCS': false,
    'ALT': false, 'VEL': false, 'PGNS': false, 'ASC QTY': false, 'RCS TCA': false,
  };
  return v;
}

/** Command/Service Module vessel state. */
export function createCSM() {
  const v = baseVessel('CSM', 'CSM', CSM.name);
  v.mainEngine = {
    ...structuredCloneEngine(CSM.sps),
    throttle: 0,
    throttleCmd: 0,
    armed: true,
    firing: false,
    gimbal: new THREE.Vector2(),
  };
  v.propellant = { main: CSM.spsPropMax, mainMax: CSM.spsPropMax, rcs: CSM.rcsPropMax, rcsMax: CSM.rcsPropMax };
  v.rcs = { jets: csmRcsJets() };
  v.cw.lights = { 'SPS PRESS': false, 'SM RCS A': false, 'CMC': false, 'MASTER ALARM': false, 'SPS QTY': false };
  return v;
}

function structuredCloneEngine(e) {
  return {
    name: e.name,
    maxThrust: e.maxThrust,
    isp: e.isp,
    minThrottle: e.minThrottle,
    maxThrottle: e.maxThrottle,
    thrustDir: e.thrustDir.clone(),
    nozzleExit: e.nozzleExit.clone(),
    nozzleExitRadius: e.nozzleExitRadius,
    nozzleThroat: e.nozzleThroat.clone(),
  };
}

/** Parse URL query parameters into game params. */
export function readParams(search = typeof location !== 'undefined' ? location.search : '') {
  const q = new URLSearchParams(search);
  // Normalise the enumerated parameters: a lower-case or unknown value must never break the boot
  // (an unknown vessel id used to leave game.active undefined -> 'Failed to start').
  const pick = (name, allowed, fold) => {
    const raw = (q.get(name) || '').trim();
    if (!raw) return null;
    const v = fold === 'upper' ? raw.toUpperCase() : raw.toLowerCase();
    if (allowed.includes(v)) return v;
    console.warn(`Ignoring unknown ?${name}=${raw} (expected one of ${allowed.join(', ')})`);
    return null;
  };
  const num = (name, def) => {
    if (!q.has(name)) return def;
    const v = +q.get(name);
    return Number.isFinite(v) ? v : def;
  };
  const flag = (name) => (q.has(name) ? !['0', 'false', 'off', 'no'].includes(q.get(name).toLowerCase()) : null);
  return {
    scenario: q.get('scenario') || null, // null => show the menu
    autostart: q.get('autostart') === '1' || q.has('scenario'),
    camera: pick('camera', ['iva', 'chase', 'locked', 'flyby', 'ground', 'target'], 'lower'),
    vessel: pick('vessel', ['LM', 'CSM'], 'upper'),
    fixedStep: q.get('fixedstep') === '1', // advance the sim exactly 1/60 s per frame (tests)
    quality: pick('quality', ['low', 'medium', 'high'], 'lower'),
    // shader / GPU-upload warm-up of the cockpit configurations at mission start (default: on,
    // except in fixed-step test runs where it would only slow down headless screenshots)
    warmup: flag('warmup'),
    // depth buffer: 'reversed' (float reversed-Z, keeps early-Z; default when EXT_clip_control exists)
    // or 'log' (logarithmic depth, gl_FragDepth writes)
    depth: pick('depth', ['reversed', 'log'], 'lower'),
    warp: num('warp', 1),
    hud: q.has('hud') ? q.get('hud') !== '0' : null,
    audio: q.has('audio') ? q.get('audio') !== '0' : null,
    debug: q.get('debug') === '1',
    t: Math.max(0, num('t', 0)), // seconds to fast-forward after loading (tests)
  };
}

/** Create the global game state. */
export function createGameState(params = readParams()) {
  const events = new EventBus();
  const game = {
    params,
    events,
    time: {
      met: 0, // mission elapsed time (s) — scenarios set the historical MET
      warp: params.warp || 1, // time-warp multiplier requested
      warpActual: 1, // multiplier actually applied (sim may limit it)
      paused: false,
      frame: 0,
      realDt: 0, // last frame's real dt (s)
      simDt: 0, // last frame's simulated dt (s)
    },
    vessels: { LM: createLM(), CSM: createCSM() },
    activeId: params.vessel || 'LM',
    get active() {
      return this.vessels[this.activeId];
    },
    get inactive() {
      return this.vessels[this.activeId === 'LM' ? 'CSM' : 'LM'];
    },
    scenarioId: null,
    started: false, // false while the title menu is up
    // Camera / view state — written by render/cameras.js, read by renderer, UI, audio
    view: {
      mode: params.camera || 'iva', // 'iva' | 'chase' | 'orbit' | 'flyby' | 'ground' | 'target'
      cameraMCI: new THREE.Vector3(), // camera position (MCI, doubles)
      quat: new THREE.Quaternion(), // camera orientation (MCI)
      fov: 60, // vertical FOV (deg)
      near: 0.02,
      far: 1e9,
      ivaVessel: null, // id of the vessel whose cabin we are in, or null
      station: 'CDR', // crew station for IVA
    },
    settings: {
      hud: params.hud ?? true,
      units: 'imperial', // 'imperial' (ft, ft/s — Apollo) | 'metric'
      audio: params.audio ?? true,
      volume: 0.8,
      callouts: true, // spoken crew/MCC callouts
      quality: params.quality || 'high',
      invertPitch: false,
      mouseSensitivity: 1,
      historicalAlarms: false, // 1201/1202 program alarms during P63
    },
    result: null, // landing result after touchdown/crash (set by sim/)
    debug: {},
  };
  return game;
}
