// Apollo 11 Lunar Module "Eagle" — exterior model. Owned by the LM-MODEL agent.
//
// Contract (ARCHITECTURE.md §6): createLMModel(ctx) -> { root, update(frame, vessel), setIVA(on) }
//
//   root        THREE.Group in the LM body frame (+Y up, -Z forward, +X right, origin at the
//               footpad-bottom plane). Holds the ascent stage and — until staging — the descent stage.
//   update()    floating origin: root.position = vessel.pos - frame.origin, root.quaternion = vessel.quat.
//               After staging (vessel.staged) the descent stage is re-parented to its own group in
//               ctx.scene, placed at vessel.descentStage.{pos, quat}. Landing-gear pistons stroke by
//               vessel.gear.pads[i].compression along the same axis the physics uses; the contact
//               probes fold as they touch the ground (and stay bent).
//               Distance LOD: when a stage would project to < SPECK_PX (1.5 px) its meshes are hidden and a
//               sunlit point (speck.js) is drawn instead — unless the vessel-shadow pass needs the meshes
//               (it is enabled and the stage is within 3 km of the active vessel).
//   setIVA(on)  own exterior -> LAYERS.GHOST (only the vessel-shadow pass sees it) except meshes
//               tagged userData.ivaVisible (the RCS quads, visible through the windows). A descent
//               stage left on the surface stays on LAYERS.VESSEL (it is not "our" cabin any more).
//
// Everything is procedural: see ascent.js, descent.js, materials.js, textures.js.

import * as THREE from 'three';
import { LAYERS } from '../../../core/constants.js';
import { createLMMaterials } from './materials.js';
import { buildAscentStage } from './ascent.js';
import { buildDescentStage } from './descent.js';
import { texturesReady } from './textures.js';
import { createSpeck, projectedPx, SPECK_PX } from './speck.js';

const _w = new THREE.Vector3();
const _up = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const _cm = new THREE.Vector3();
const SHADOW_KEEP = 3000; // m: stages this close to the active vessel may be in the vessel-shadow box

/**
 * Create the LM exterior model.
 * @param {object} ctx RenderContext (uses ctx.scene, ctx.quality, ctx.game?.events)
 * @returns {{root: THREE.Group, update(frame: object, vessel: object): void, setIVA(on: boolean): void,
 *   descentRoot: THREE.Group, materials: Object<string, THREE.Material>, ready: Promise<void>,
 *   stats(): {triangles: number, meshes: number}}}
 */
export function createLMModel(ctx) {
  const materials = createLMMaterials({ quality: ctx.quality || 'high' });
  const root = new THREE.Group();
  root.name = 'LM';

  const asc = buildAscentStage(materials);
  const des = buildDescentStage(materials);
  root.add(asc.group);
  root.add(des.group);

  // group that carries the descent stage once the ascent stage has left it behind
  const descentRoot = new THREE.Group();
  descentRoot.name = 'LM descent stage (staged)';
  descentRoot.visible = false;
  ctx.scene?.add(descentRoot);

  // ---- distance LOD: bounding spheres (body frame) and the stand-in specks
  const sphere = (...objs) => {
    const b = new THREE.Box3();
    for (const o of objs) b.expandByObject(o);
    return b.getBoundingSphere(new THREE.Sphere());
  };
  root.updateMatrixWorld(true);
  const sphLM = sphere(asc.group, des.group);
  const sphAsc = sphere(asc.group);
  const sphDes = sphere(des.group);
  // mean projected areas (m^2): ascent ~4.3 x 3.8 m, descent body + gear, whole vehicle
  const speckLM = createSpeck(ctx, { name: 'LM', radius: sphLM.radius, area: 22, flash: true });
  const speckAsc = createSpeck(ctx, { name: 'LM ascent stage', radius: sphAsc.radius, area: 12, flash: true });
  const speckDes = createSpeck(ctx, { name: 'LM descent stage', radius: sphDes.radius, area: 11 });
  speckLM.points.position.copy(sphLM.center);
  speckAsc.points.position.copy(sphAsc.center);
  speckDes.points.position.copy(sphDes.center);
  root.add(speckLM.points, speckAsc.points);
  descentRoot.add(speckDes.points);
  const lod = { lmPx: Infinity, descentPx: Infinity, culled: false, descentCulled: false };

  /**
   * Decide whether a stage is drawn as meshes (true) or as a speck. `centre` is its body-frame
   * sphere centre, `pos`/`quat` its MCI pose.
   */
  function resolved(frame, sph, pos, quat, isActive) {
    _cm.copy(sph.center).applyQuaternion(quat).add(pos);
    const d = _cm.distanceTo(frame.origin);
    const px = ctx.camera ? projectedPx(ctx, sph.radius, d) : Infinity;
    if (px >= SPECK_PX) return { show: true, px, centre: _cm };
    const act = frame.active;
    const nearActive = isActive || (act && act.pos && pos.distanceTo(act.pos) < SHADOW_KEEP);
    if (ctx.vesselShadow?.enabled && nearActive) return { show: true, px, centre: _cm };
    return { show: false, px, centre: _cm };
  }

  const ascMeshes = [];
  const desMeshes = [];
  asc.group.traverse((o) => o.isMesh && ascMeshes.push(o));
  des.group.traverse((o) => o.isMesh && desMeshes.push(o));
  for (const m of [...ascMeshes, ...desMeshes]) m.layers.set(LAYERS.VESSEL);

  let iva = false;
  let stagedNow = false;
  function applyLayers() {
    for (const m of ascMeshes) m.layers.set(iva && !m.userData.ivaVisible ? LAYERS.GHOST : LAYERS.VESSEL);
    // the descent stage is part of "our" vehicle only while attached
    for (const m of desMeshes) m.layers.set(iva && !stagedNow ? LAYERS.GHOST : LAYERS.VESSEL);
  }

  function resetProbes() {
    for (const l of des.legs) {
      l.fold = 0;
      if (l.probe) l.probe.quaternion.identity();
    }
  }
  ctx.game?.events?.on?.('scenario', resetProbes);

  const padById = (v, id) => v.gear?.pads?.find((p) => p.id === id);

  /** Gear stroke + probe folding for the descent stage (attached or left behind). */
  function updateGear(v, attached, bodyQuat) {
    const landedHere = attached ? v.landed : !!v.descentStage?.landed;
    if (attached) _up.copy(v.pos).normalize();
    const alt = v.tel?.altitude;
    for (const l of des.legs) {
      const pad = padById(v, l.id);
      const c = Math.max(0, Math.min(0.81, pad?.compression || 0));
      l.lower.position.copy(l.stroke).multiplyScalar(c);
      if (!l.probe) continue;
      let target = 0;
      if (landedHere || pad?.contact) target = 1.5;
      else if (attached && Number.isFinite(alt) && alt < 12) {
        // height of the probe hinge above the ground (terrain below the CG, local vertical)
        _w.copy(l.probe.position).add(l.lower.position).sub(v.cg || ZERO).applyQuaternion(bodyQuat);
        const h = alt + _w.dot(_up);
        const len = 1.85;
        if (h < len) target = Math.acos(Math.max(0, Math.min(1, h / len)));
      }
      if (target > l.fold) {
        l.fold = target;
        l.probe.quaternion.setFromAxisAngle(l.probeAxis, l.fold);
      }
    }
  }

  return {
    root,
    descentRoot,
    materials,
    /** Resolves when the procedural material maps have been generated (they fill in asynchronously). */
    ready: texturesReady(),
    setIVA(on) {
      if (on === iva) return;
      iva = !!on;
      applyLayers();
    },
    update(frame, v) {
      if (!v) return;
      root.position.copy(v.pos).sub(frame.origin);
      root.quaternion.copy(v.quat);

      const staged = !!v.staged;
      if (staged !== stagedNow) {
        stagedNow = staged;
        if (staged) descentRoot.add(des.group);
        else root.add(des.group);
        applyLayers();
      }
      if (staged) {
        const ds = v.descentStage;
        descentRoot.visible = !!ds;
        if (ds) {
          descentRoot.position.copy(ds.pos).sub(frame.origin);
          descentRoot.quaternion.copy(ds.quat);
          updateGear(v, false, ds.quat);
        }
      } else {
        descentRoot.visible = false;
        updateGear(v, true, v.quat);
      }

      // lights: tracking light (1 flash/s) and docking lights during orbital operations
      const alt = v.tel?.altitude ?? 1e9;
      const orbitalOps = !v.landed && !v.crashed && (staged || alt > 20000);
      const t = frame.time || 0;
      const flash = orbitalOps && t % 1 < 0.08;
      asc.trackingLight.visible = flash;
      for (const l of asc.dockingLights) l.visible = orbitalOps;

      // distance LOD (see header): meshes below ~1.5 px are replaced by a sunlit speck
      const isActive = frame.active ? frame.active === v : true;
      const inIVA = frame.viewMode === 'iva' && frame.ivaVessel === 'LM';
      const sphA = staged ? sphAsc : sphLM;
      const rA = inIVA ? { show: true, px: Infinity } : resolved(frame, sphA, v.pos, v.quat, isActive);
      lod.lmPx = rA.px;
      lod.culled = !rA.show;
      asc.group.visible = rA.show;
      speckLM.points.visible = !staged && !rA.show;
      speckAsc.points.visible = staged && !rA.show;
      if (!rA.show) (staged ? speckAsc : speckLM).update(frame, rA.centre, flash);
      if (!staged) {
        des.group.visible = rA.show;
        speckDes.points.visible = false;
        lod.descentPx = rA.px;
        lod.descentCulled = !rA.show;
      } else if (v.descentStage) {
        const ds = v.descentStage;
        const rD = resolved(frame, sphDes, ds.pos, ds.quat, false);
        lod.descentPx = rD.px;
        lod.descentCulled = !rD.show;
        des.group.visible = rD.show;
        speckDes.points.visible = !rD.show;
        if (!rD.show) speckDes.update(frame, rD.centre, false);
      }
    },
    /** Distance-LOD state of the last update (debug / tests): projected sizes (px) and culling. */
    lod,
    /** Triangle / mesh counts (debug). */
    stats() {
      let triangles = 0;
      let meshes = 0;
      const count = (o) => {
        if (!o.isMesh) return;
        meshes++;
        const g = o.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
      };
      root.traverse(count);
      if (stagedNow) descentRoot.traverse(count);
      return { triangles: Math.round(triangles), meshes };
    },
  };
}

