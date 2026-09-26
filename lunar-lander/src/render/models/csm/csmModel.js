// Apollo 11 Command/Service Module "Columbia" — exterior model. Owned by the CSM-MODEL agent.
//
// Contract (ARCHITECTURE.md §6): createCSMModel(ctx) -> { root, update(frame, vessel), setIVA(on) }
//
//   root        THREE.Group in the CSM body frame (-Z forward toward the probe, +Y head-up / side hatch,
//               +X right, origin at the CM/SM interface plane). Geometry follows CSM in constants.js.
//   update()    floating origin: root.position = vessel.pos - frame.origin, root.quaternion = vessel.quat.
//               Also animates: docking-probe retraction while docked (the head seats in the LM drogue
//               apex), SPS gimbal (vessel.mainEngine.gimbal) and nozzle-extension heat glow during long
//               burns, S-band high-gain antenna tracking the Earth, flashing rendezvous beacon.
//               Distance LOD: when the CSM would project to < SPECK_PX (1.5 px) its meshes are hidden and
//               a sunlit point (speck.js) is drawn instead — the moving "star" of the CSM seen from the LM
//               hundreds of km away — unless we are in its cabin or the vessel-shadow pass needs the meshes
//               (it is enabled and the CSM is the active vessel or within 3 km of it). The part animations
//               are skipped while hidden (their state still integrates).
//   setIVA(on)  own exterior -> LAYERS.GHOST (vessel-shadow pass only) except meshes tagged
//               userData.ivaVisible (the docking probe and docking ring, seen from the rendezvous window).
//
// Everything is procedural: cm.js / sm.js (geometry), materials.js + textures.js + texgen.js (maps,
// generated in a Web Worker).

import * as THREE from 'three';
import { CSM, EARTH, LAYERS } from '../../../core/constants.js';
import { windowPocket } from './profile.js';
import { PartBuilder } from './geom.js';
import { createCSMMaterials } from './materials.js';
import { buildCM, buildProbe } from './cm.js';
import { buildSM, buildBeacon, buildSPS, buildHGA } from './sm.js';
import { createSpeck, projectedPx, SPECK_PX } from './speck.js';

const RAD2DEG = 180 / Math.PI;
const PROBE_RETRACT = 0.35; // m: extended tip -3.55 -> seated in the LM drogue apex at -3.20
const SPS_PIVOT_Z = 4.72; // gimbal ring plane (m, body)
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _earth = new THREE.Vector3(EARTH.distance, 0, 0);
const _z = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();
const HGA_LIMIT = (70 * Math.PI) / 180; // max boresight deflection from the boom axis
const SHADOW_KEEP = 3000; // m: the CSM this close to the active vessel may be in the vessel-shadow box
const _cm = new THREE.Vector3();

/** Plain-array copy of a CSM.windows entry. */
function winSpec(w) {
  return { center: w.center.toArray(), normal: w.normal.toArray(), up: w.up.toArray(), width: w.width, height: w.height, round: !!w.round };
}

/**
 * Create the CSM exterior model.
 * @param {object} ctx RenderContext (uses ctx.quality, ctx.game?.events)
 * @returns {{root: THREE.Group, update(frame: object, vessel: object): void, setIVA(on: boolean): void,
 *   materials: Object<string, THREE.Material>, ready: Promise<void>, stats(): {triangles: number, meshes: number},
 *   parts: object}}
 */
export function createCSMModel(ctx) {
  const quality = ctx.quality || 'high';

  // ---- window pockets (shared by the geometry and the foil atlas alpha holes)
  const pockets = Object.entries(CSM.windows).map(([name, w]) => {
    const rv = name.startsWith('rendezvous');
    const p = windowPocket(winSpec(w), { recess: rv ? 0.025 : 0.03, frame: rv ? 0.02 : 0.018, segments: w.round ? 48 : 40 });
    p.name = name;
    return p;
  });
  const quadAzimuthsDeg = CSM.rcs.quadAngles.map((a) => a * RAD2DEG);
  const { M, ready } = createCSMMaterials({ quality, holes: pockets.map((p) => p.footprintUV), quadAzimuthsDeg });

  const root = new THREE.Group();
  root.name = 'CSM';

  // ---- static structure (merged per material)
  const B = new PartBuilder(M);
  buildCM(B, pockets);
  buildSM(B);
  const structure = new THREE.Group();
  structure.name = 'CSM structure';
  B.build(structure);
  root.add(structure);

  // docking ring meshes stay visible in IVA (tag the ring material's mesh)
  structure.traverse((o) => {
    if (o.isMesh && o.material === M.ring) o.userData.ivaVisible = true;
  });

  // ---- docking probe (IVA-visible); the head/piston retracts when docked
  const probe = new THREE.Group();
  probe.name = 'CSM docking probe';
  const probeHead = new THREE.Group();
  probeHead.name = 'CSM probe piston';
  const Bp = new PartBuilder(M);
  const Bh = new PartBuilder(M);
  buildProbe(Bp, Bh);
  Bp.build(probe, { ivaVisible: true });
  Bh.build(probeHead, { ivaVisible: true });
  probe.add(probeHead);
  root.add(probe);

  // ---- SPS engine on its gimbal pivot
  const spsPivot = new THREE.Group();
  spsPivot.name = 'SPS gimbal';
  spsPivot.position.set(0, 0, SPS_PIVOT_Z);
  const spsBody = new THREE.Group();
  spsBody.position.set(0, 0, -SPS_PIVOT_Z);
  const Bs = new PartBuilder(M);
  buildSPS(Bs);
  Bs.build(spsBody);
  spsPivot.add(spsBody);
  root.add(spsPivot);

  // ---- high-gain antenna: fixed boom + steerable dish cluster
  const hgaFixed = new THREE.Group();
  hgaFixed.name = 'HGA boom';
  const hgaYoke = new THREE.Group();
  hgaYoke.name = 'HGA dishes';
  const Bf = new PartBuilder(M);
  const By = new PartBuilder(M);
  const hga = buildHGA(Bf, By);
  Bf.build(hgaFixed);
  By.build(hgaYoke);
  hgaYoke.position.copy(hga.tip);
  hgaYoke.quaternion.setFromUnitVectors(_z, hga.stow);
  root.add(hgaFixed, hgaYoke);
  const hgaStow = hga.stow.clone();
  const hgaAim = hga.stow.clone();

  // ---- flashing rendezvous beacon
  const beacon = new THREE.Group();
  beacon.name = 'CSM rendezvous beacon';
  const Bb = new PartBuilder(M);
  buildBeacon(Bb);
  Bb.build(beacon);
  root.add(beacon);

  // ---- layers / shadows
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.layers.set(LAYERS.VESSEL);
    if (o.material.userData.noShadow) o.castShadow = false;
  });
  // ---- distance LOD: bounding sphere (body frame) and the stand-in speck
  const partGroups = [structure, probe, spsPivot, hgaFixed, hgaYoke, beacon];
  root.updateMatrixWorld(true);
  const sph = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  const speck = createSpeck(ctx, { radius: sph.radius });
  speck.points.position.copy(sph.center);
  root.add(speck.points);
  const lod = { px: Infinity, culled: false, radius: sph.radius };
  let wasCulled = false;

  /** true when the meshes must be drawn (else the speck); also fills lod.px and _cm (MCI centre). */
  function resolved(frame, v) {
    _cm.copy(sph.center).applyQuaternion(v.quat).add(v.pos);
    const inIVA = frame.viewMode === 'iva' && frame.ivaVessel === 'CSM';
    const px = ctx.camera && frame.origin ? projectedPx(ctx, sph.radius, _cm.distanceTo(frame.origin)) : Infinity;
    lod.px = px;
    if (inIVA || px >= SPECK_PX) return true;
    const act = frame.active;
    const isActive = act ? act === v : true;
    const nearActive = isActive || (act && act.pos && v.pos.distanceTo(act.pos) < SHADOW_KEEP);
    return !!(ctx.vesselShadow?.enabled && nearActive);
  }

  let iva = false;
  function applyLayers() {
    for (const m of meshes) m.layers.set(iva && !m.userData.ivaVisible ? LAYERS.GHOST : LAYERS.VESSEL);
  }

  // ---- animated state
  let probeExt = 1; // 1 = extended, 0 = retracted
  let nozzleHeat = 0; // 0..1 (radiation-cooled extension glow)
  let clock = 0;
  const resetState = () => {
    nozzleHeat = 0;
    probeExt = 1;
  };
  ctx.game?.events?.on?.('scenario', resetState);

  function update(frame, v) {
    if (!v) return;
    root.position.copy(v.pos).sub(frame.origin);
    root.quaternion.copy(v.quat);
    const dt = Math.min(0.25, Math.max(0, frame.dt ?? 1 / 60));
    const simDt = Math.max(0, frame.simDt ?? dt);
    clock += dt;

    // docking probe: retract once captured / hard-docked; re-extend after undocking
    const target = v.docked ? 0 : 1;
    const rate = 1 / 1.0; // full stroke in ~1 s (matches the sim's RETRACT_TIME)
    probeExt += Math.max(-rate * dt, Math.min(rate * dt, target - probeExt));
    if (frame.game && frame.game.time && frame.game.time.frame < 2) probeExt = target; // no animation on load
    probeHead.position.z = (1 - probeExt) * PROBE_RETRACT;

    // SPS gimbal (trim angles in rad: x = pitch about +X, y = yaw about +Y)
    const e = v.mainEngine;
    if (e && e.gimbal) spsPivot.rotation.set(e.gimbal.x || 0, e.gimbal.y || 0, 0);
    // nozzle extension heat: glows dull red after ~15 s of firing, cools over a couple of minutes
    const firing = e && e.firing && (e.throttle ?? 1) > 0;
    if (firing) nozzleHeat += (1 - nozzleHeat) * (1 - Math.exp(-simDt / 25));
    else nozzleHeat *= Math.exp(-simDt / 60);
    const h = nozzleHeat;

    // distance LOD: below ~1.5 px draw the sunlit speck instead of the ~40 meshes
    const show = resolved(frame, v);
    lod.culled = !show;
    for (const g of partGroups) g.visible = show;
    speck.points.visible = !show;
    const ph = clock % 1.0; // rendezvous beacon: xenon flash ~ 1 per second
    const flash = ph < 0.06;
    if (!show) {
      speck.update(frame, _cm, flash);
      wasCulled = true;
      return; // part animations skipped while hidden
    }
    const snap = wasCulled || (frame.game && frame.game.time && frame.game.time.frame < 2);
    wasCulled = false;

    M.spsOuter.emissiveIntensity = h > 0.01 ? Math.pow(h, 2) * 0.9 : 0;
    M.spsInner.emissiveIntensity = h > 0.01 ? Math.pow(h, 2) * 0.35 : 0;

    // HGA: point the dish cluster at the Earth (gimbal-limited to the hemisphere away from the SM)
    _v.copy(_earth).sub(v.pos).normalize();
    _qi.copy(v.quat).invert();
    _v.applyQuaternion(_qi); // Earth direction in the body frame
    // gimbal limit: at most HGA_LIMIT from the deployed boom direction; beyond it, the closest point
    const ang = Math.acos(Math.max(-1, Math.min(1, _v.dot(hgaStow))));
    if (ang > HGA_LIMIT) {
      _axis.crossVectors(hgaStow, _v);
      if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0).cross(hgaStow);
      _axis.normalize();
      _v.copy(hgaStow).applyAxisAngle(_axis, HGA_LIMIT);
    }
    // slew at a finite rate (the real antenna drives at a few deg/s)
    hgaAim.lerp(_v, Math.min(1, dt * 1.5)).normalize();
    if (snap) hgaAim.copy(_v); // no slew on load or when the model re-resolves from a speck
    _q.setFromUnitVectors(_z, hgaAim);
    hgaYoke.quaternion.copy(_q);

    // rendezvous beacon: xenon flash ~ 1 per second (20 ms flash, rendered as a few-frame pulse)
    M.lightBeacon.emissiveIntensity = flash ? 60 : 0;
  }

  function stats() {
    let triangles = 0;
    for (const m of meshes) {
      const g = m.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    return { triangles, meshes: meshes.length };
  }

  return {
    root,
    materials: M,
    ready,
    stats,
    parts: { structure, probe, probeHead, spsPivot, hgaYoke, beacon, pockets, speck: speck.points },
    /** Distance-LOD state of the last update (debug / tests): projected diameter (px), culled. */
    lod,
    speck,
    update,
    setIVA(on) {
      if (on === iva) return;
      iva = !!on;
      applyLayers();
    },
  };
}
