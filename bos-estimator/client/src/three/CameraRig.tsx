// Camera rig (UI spec §9.2–9.3): view offset from the shell's insets (the canvas is never resized by panels),
// binary-search fit of the site bounds into the free rect, the fit trigger rules, frame-selection, entering and
// leaving a building, auto-orbit and dynamic near/far. MapControls: left-drag pans, right-drag orbits, wheel zooms.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls } from '@react-three/drei';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import type { Box2, SiteLayout } from './layout';
import { UNIT_FT } from './layout';
import { freeRect, insets } from './insets';
import { bridge } from './bridge';
import { rt } from './runtime';
import { explodeGap } from './InteriorCrew';

const DEG = Math.PI / 180;
const AZIMUTH = 35 * DEG;
const defaultPolar = (n: number) => (n > 100 ? 40 : 50) * DEG;
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

interface Pose { target: THREE.Vector3; pos: THREE.Vector3; zoom?: number }
const isOrtho = (c: THREE.Camera): c is THREE.OrthographicCamera => (c as THREE.OrthographicCamera).isOrthographicCamera === true;
const PLAN_HEIGHT = 1500;
interface Anim { from: Pose; to: Pose; t0: number; dur: number; kind: 'fit' | 'frame' | 'enter' | 'leave' | 'refit'; fit?: FitSpec }
interface FitSpec { bounds: Box2; maxH: number; az: number; polar: number }

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

function corners(b: Box2, maxH: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, Math.max(0.5, maxH)]) out.push(new THREE.Vector3(b.x + (sx * b.w) / 2, y, b.z + (sz * b.d) / 2));
  return out;
}

/** Project world points to viewport px with a camera; returns the 2D bbox and whether all are in front. */
function projectBox(cam: THREE.Camera, pts: THREE.Vector3[], W: number, H: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = true;
  for (const p of pts) {
    _p.copy(p).project(cam);
    if (_p.z > 1 || _p.z < -1) front = false;
    const x = ((_p.x + 1) / 2) * W, y = ((1 - _p.y) / 2) * H;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, front };
}

/** Fit `bounds` (0 → maxH tall) into the free rect at the given azimuth / polar; recentres the projected box. */
/** Plan view: north-up, top-down orthographic; zoom = px per scene unit so the bounds fill the free rect − 4%. */
function orthoFit(W: number, H: number, spec: FitSpec): Pose & { dist: number } {
  const fr = freeRect(W, H);
  const b = spec.bounds;
  const zoom = Math.max(0.05, Math.min((fr.w * 0.92) / Math.max(1, b.w), (fr.h * 0.92) / Math.max(1, b.d)));
  const target = new THREE.Vector3(b.x, 0, b.z);
  return { target, pos: new THREE.Vector3(b.x, PLAN_HEIGHT, b.z + 0.01), zoom, dist: PLAN_HEIGHT };
}

export function computeFit(camera: THREE.Camera, W: number, H: number, spec: FitSpec): Pose & { dist: number } {
  if (isOrtho(camera)) return orthoFit(W, H, spec);
  const fr = freeRect(W, H);
  const cam = new THREE.PerspectiveCamera((camera as THREE.PerspectiveCamera).fov, W / H, 0.1, 1e6);
  cam.setViewOffset(W, H, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, W, H);
  cam.updateProjectionMatrix();
  const b = spec.bounds;
  const pts = corners(b, spec.maxH);
  const R = Math.max(10, Math.hypot(b.w, b.d, spec.maxH) / 2);
  const dir = new THREE.Vector3(Math.sin(spec.polar) * Math.sin(spec.az), Math.cos(spec.polar), Math.sin(spec.polar) * Math.cos(spec.az));
  const mx = fr.w * 0.04, my = fr.h * 0.04;
  const target = new THREE.Vector3(b.x, 0, b.z);
  const place = (t: THREE.Vector3, d: number) => { cam.position.copy(t).addScaledVector(dir, d); cam.lookAt(t); cam.updateMatrixWorld(); };
  const fits = () => { const pb = projectBox(cam, pts, W, H); return pb.front && pb.x0 >= fr.x0 + mx && pb.x1 <= fr.x1 - mx && pb.y0 >= fr.y0 + my && pb.y1 <= fr.y1 - my; };
  const right = new THREE.Vector3(Math.cos(spec.az), 0, -Math.sin(spec.az));
  const fwd = new THREE.Vector3(-Math.sin(spec.az), 0, -Math.cos(spec.az));
  let d = R * 2;
  for (let iter = 0; iter < 4; iter++) {
    let lo = 0.2 * R, hi = 8 * R;
    for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; place(target, mid); if (fits()) hi = mid; else lo = mid; }
    d = hi;
    place(target, d);
    const pb = projectBox(cam, pts, W, H);
    const dx = fr.cx - pb.cx, dy = fr.cy - pb.cy;
    if (Math.hypot(dx, dy) < 0.75) break;
    // screen Jacobian of moving the camera + target together along right / forward
    const s0 = _v.copy(target).project(cam); const sx0 = ((s0.x + 1) / 2) * W, sy0 = ((1 - s0.y) / 2) * H;
    const sr = _v.copy(target).add(right).project(cam); const srx = ((sr.x + 1) / 2) * W - sx0, sry = ((1 - sr.y) / 2) * H - sy0;
    const sf = _v.copy(target).add(fwd).project(cam); const sfx = ((sf.x + 1) / 2) * W - sx0, sfy = ((1 - sf.y) / 2) * H - sy0;
    // moving the rig by v moves the image by −J·v; want the image to move by (dx, dy)
    const det = srx * sfy - sfx * sry;
    if (Math.abs(det) < 1e-9) break;
    const a = (-dx * sfy + sfx * dy) / det;
    const c = (-srx * dy + sry * dx) / det;
    target.addScaledVector(right, a).addScaledVector(fwd, c);
  }
  return { target, pos: target.clone().addScaledVector(dir, d), dist: d };
}

const grew = (fit: Box2 | null, b: Box2) => {
  if (!fit) return true;
  const ex = (Math.max(fit.x + fit.w / 2, b.x + b.w / 2) - Math.min(fit.x - fit.w / 2, b.x - b.w / 2)) / fit.w;
  const ez = (Math.max(fit.z + fit.d / 2, b.z + b.d / 2) - Math.min(fit.z - fit.d / 2, b.z - b.d / 2)) / fit.d;
  return Math.max(ex, ez) > 1.25;
};

function unionBox(boxes: Box2[]): Box2 {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of boxes) { x0 = Math.min(x0, b.x - b.w / 2); x1 = Math.max(x1, b.x + b.w / 2); z0 = Math.min(z0, b.z - b.d / 2); z1 = Math.max(z1, b.z + b.d / 2); }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const plan = isOrtho(camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<MapControlsImpl>(null);
  const { layout } = useDerived();
  const projectId = useStore((s) => s.project?.id ?? s.projectId);
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const camCmd = useStore((s) => s.camCmd);
  const phase = useStore((s) => s.extraction.phase ?? 'idle');
  const running = useStore((s) => s.extraction.running);
  const autoOrbit = useStore((s) => s.autoOrbit);

  const anim = useRef<Anim | null>(null);
  const view = useRef({ W: 0, H: 0, version: -1 });
  const st = useRef({
    project: '', fitted: false, atFit: false, pendingFit: false, pendingExtract: false,
    inRun: false, runFits: 0, runUserMoved: false, lastAutoAt: -1e9, lastGrowthAt: -1e9,
    fitBounds: null as Box2 | null, lastSpec: null as FitSpec | null, lastInteract: performance.now(), lastChange: 0,
    preEnter: null as Pose | null, inBuilding: false, damping: true, camSeq: camCmd?.seq ?? 0, maxDist: 400,
    fitLayout: null as SiteLayout | null, lastCmdFitAt: -1e9,
  });
  const layoutRef = useRef<SiteLayout | null>(layout);
  layoutRef.current = layout;

  const reduced = () => useStore.getState().reducedMotion ?? false;
  const startAnim = (to: Pose, dur: number, kind: Anim['kind'], fit?: FitSpec) => {
    const c = controls.current;
    const from: Pose = { target: (c?.target ?? new THREE.Vector3()).clone(), pos: camera.position.clone(), zoom: camera.zoom };
    st.current.maxDist = Math.max(st.current.maxDist, to.pos.distanceTo(to.target) * 1.25);
    if (c) { c.maxDistance = st.current.maxDist; c.enableDamping = false; st.current.damping = false; }
    anim.current = { from, to, t0: performance.now(), dur: reduced() ? 0 : dur, kind, fit };
    bridge.transitioning = true;
    invalidate();
  };

  const siteSpec = (l: SiteLayout | null, headroom = 1): FitSpec => {
    const empty = !l || (l.buildings.length === 0 && l.zones.length === 0);
    const b = empty ? { x: 0, z: 0, w: 320, d: 320 } : l.bounds; // empty project: a neutral patch of ground around the origin
    let bounds = headroom === 1 ? b : { x: b.x, z: b.z, w: b.w * headroom, d: b.d * headroom };
    let n = l?.buildings.length ?? 0;
    if (headroom !== 1 && l) {
      // while streaming, frame the campus the run is heading for: new rows are appended south and widen with
      // the lot area, so both sides grow with √(expected / registered); the north edge stays put
      const exp = useStore.getState().extraction.progress?.expected;
      if (exp && n > 0 && exp > n) {
        const k = Math.min(4, Math.max(headroom, Math.sqrt(exp / n)));
        const north = b.z - b.d / 2;
        bounds = { x: b.x, z: north + (b.d * k) / 2, w: b.w * k, d: b.d * k };
        n = exp;
      }
    }
    return { bounds, maxH: l?.maxHeight ?? 0, az: AZIMUTH, polar: defaultPolar(n) };
  };
  const fitSite = (opts: { cut?: boolean; count?: boolean; headroom?: number; kind?: Anim['kind'] } = {}) => {
    const l = layoutRef.current;
    const spec = siteSpec(l, opts.headroom ?? 1);
    const pose = computeFit(camera, size.width, size.height, spec);
    startAnim(pose, opts.cut ? 0 : 600, opts.kind ?? 'fit', spec);
    const s = st.current;
    s.fitBounds = spec.bounds; s.lastSpec = spec; s.atFit = true; s.preEnter = null; s.fitLayout = l;
    if (opts.count !== false) { rt.cam.fits++; rt.cam.userMoved = false; if (s.inRun) s.runFits++; }
    rt.cam.lastFitAt = performance.now();
  };

  // ---- plan view on / off swaps the default camera: re-fit at once in the new one
  const firstCam = useRef(true);
  useEffect(() => {
    view.current.version = -2;
    if (firstCam.current) { firstCam.current = false; return; }
    if (layoutRef.current && !st.current.inBuilding) { fitSite({ cut: true, count: false }); st.current.fitted = true; }
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- project change: next layout gets a first fit
  useEffect(() => {
    const s = st.current;
    if (s.project !== projectId) { s.project = projectId; s.fitted = false; s.pendingFit = false; s.atFit = false; s.preEnter = null; s.inBuilding = false; }
  }, [projectId]);

  // ---- run lifecycle and phase triggers
  useEffect(() => {
    const s = st.current;
    if (running && !s.inRun) { s.inRun = true; s.runFits = 0; s.runUserMoved = false; }
  }, [running]);
  const prevPhase = useRef(phase);
  useEffect(() => {
    const s = st.current;
    const was = prevPhase.current; prevPhase.current = phase;
    if (phase === was) return;
    if (phase === 'uploading' || phase === 'reading') { if (!s.inRun) { s.inRun = true; s.runFits = 0; s.runUserMoved = false; } }
    if (phase === 'extracting') {
      s.lastAutoAt = performance.now();
      if (s.runUserMoved) return;
      const l = layoutRef.current;
      if (l && (l.buildings.length || l.zones.length)) { fitSite({ headroom: 1.15 }); s.fitted = true; } else s.pendingExtract = true;
    } else if (phase === 'done') {
      s.lastAutoAt = performance.now();
      s.pendingExtract = false;
      // one fit for "run done", whether the shell's request or the phase change arrives first
      if (!s.runUserMoved && !s.inBuilding && performance.now() - s.lastCmdFitAt > 2500) fitSite();
      s.inRun = false;
    } else if (phase === 'failed' || phase === 'cancelled' || phase === 'idle') { s.inRun = false; s.pendingExtract = false; }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- layout changes: first fit, deferred extract fit, growth while streaming
  useEffect(() => {
    const s = st.current;
    const l = layout;
    if (!l) {
      if (!s.fitted && !s.atFit) { fitSite({ cut: true, count: false }); }
      return;
    }
    const has = l.buildings.length > 0 || l.zones.length > 0;
    if (!has) { if (!s.fitted && !s.atFit) fitSite({ cut: true, count: false }); return; }
    const now = performance.now();
    if (!s.fitted || s.pendingFit) {
      s.fitted = true; s.pendingFit = false; s.lastAutoAt = now;
      if (s.inRun) { if (!s.runUserMoved) { fitSite({ headroom: 1.15 }); s.pendingExtract = false; } }
      else fitSite({ cut: true });
      return;
    }
    if (s.pendingExtract && s.inRun && !s.runUserMoved) { s.pendingExtract = false; s.lastAutoAt = now; fitSite({ headroom: 1.15 }); return; }
    if (s.inRun && !s.runUserMoved && s.runFits < 2 && now - s.lastGrowthAt > 4000 && !s.inBuilding && grew(s.fitBounds, l.bounds)) {
      s.lastGrowthAt = now; fitSite({ headroom: 1.3 });
    }
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- camera commands from the shell
  useEffect(() => {
    const s = st.current;
    if (!camCmd || camCmd.seq === s.camSeq) return;
    s.camSeq = camCmd.seq;
    if (camCmd.kind === 'fit-site') {
      if (performance.now() - s.lastAutoAt < 2500) {
        // the shell's own request for the same moment as an automatic trigger (first data, run done): one fit.
        // If the layout was re-packed in
        // between (relayout after a first read), retarget it without counting another fit.
        if (layoutRef.current && layoutRef.current !== s.fitLayout && !s.runUserMoved && !s.inBuilding) fitSite({ count: false });
        return;
      }
      if (!layoutRef.current) { s.pendingFit = true; return; }
      if (s.inBuilding) return;
      fitSite();
      s.fitted = true; s.lastCmdFitAt = performance.now();
    } else frameSelection();
  }, [camCmd?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameSelection = () => {
    const l = layoutRef.current; const c = controls.current; if (!l || !c) return;
    const sel = useStore.getState().selection;
    let box: Box2 | null = null; let lot: Box2 | null = null; let h = 0;
    if (sel.kind === 'facility') { const b = l.buildings.find((x) => x.id === sel.id); if (b) { box = b.box; lot = b.lot; h = b.height; } }
    else if (sel.kind === 'grounds') { const z = l.zones.find((x) => x.id === sel.id); if (z) { box = z.box; lot = z.box; } }
    if (!box || !lot) { fitSite(); return; }
    if (st.current.inBuilding) return;
    const target = new THREE.Vector3(box.x, 0, box.z);
    const offset = camera.position.clone().sub(c.target);
    if (isOrtho(camera)) {
      const zoom = Math.max(1, box.w, box.d) * camera.zoom < 24 ? 80 / Math.max(1, lot.w, lot.d) : camera.zoom;
      startAnim({ target, pos: target.clone().add(offset), zoom }, 300, 'frame');
      st.current.atFit = false; rt.cam.retargets++;
      return;
    }
    let pos = target.clone().add(offset);
    // dolly in only when the footprint would project below 24 px
    const tmp = camera.clone(); tmp.position.copy(pos); tmp.lookAt(target); tmp.updateMatrixWorld();
    const pb = projectBox(tmp, corners(box, h), size.width, size.height);
    if (Math.hypot(pb.x1 - pb.x0, pb.y1 - pb.y0) < 24) pos = target.clone().addScaledVector(offset.normalize(), Math.max(lot.w, lot.d) * 2.2 + 18);
    startAnim({ target, pos }, 300, 'frame');
    st.current.atFit = false;
    rt.cam.retargets++;
  };

  // ---- entering / leaving a building, switching Interior / Grounds
  const selId = selection.kind === 'facility' ? selection.id : null;
  useEffect(() => {
    const s = st.current; const c = controls.current; const l = layoutRef.current;
    const inside = focusMode === 'building' && selId != null;
    if (inside && l && c) {
      const b = l.buildings.find((x) => x.id === selId);
      if (!b) return;
      if (!s.inBuilding) s.preEnter = { target: c.target.clone(), pos: camera.position.clone() };
      s.inBuilding = true; s.atFit = false;
      const az = c.getAzimuthalAngle();
      if (buildingTab === 'grounds') {
        const attached = l.zones.filter((z) => z.facilityId === b.id).map((z) => z.box);
        const spec: FitSpec = { bounds: unionBox([b.lot, ...attached]), maxH: b.height, az, polar: 30 * DEG };
        startAnim(computeFit(camera, size.width, size.height, spec), 600, 'enter');
      } else {
        const hx = Math.max(b.height, Math.min(b.floors, 24) * (b.floorHeight + explodeGap(b)));
        const pol = 55 * DEG;
        // spec distance max(w, d, h) × 1.5 + 8, pulled back when the (exploded) building would not fit the free rect
        const fit = computeFit(camera, size.width, size.height, { bounds: { x: b.box.x, z: b.box.z, w: b.box.w + 2, d: b.box.d + 2 }, maxH: hx, az, polar: pol });
        const dist = Math.max(Math.max(b.box.w, b.box.d, hx) * 1.5 + 8, fit.dist);
        if (dist > Math.max(b.box.w, b.box.d, hx) * 1.5 + 8) startAnim({ target: fit.target, pos: fit.pos }, 600, 'enter');
        else {
          const target = new THREE.Vector3(b.box.x, hx * 0.4, b.box.z);
          const pos = target.clone().add(new THREE.Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az)).multiplyScalar(dist));
          startAnim({ target, pos }, 600, 'enter');
        }
      }
    } else if (!inside && s.inBuilding) {
      s.inBuilding = false;
      if (s.preEnter) { startAnim(s.preEnter, 600, 'leave'); s.preEnter = null; }
    }
  }, [focusMode, buildingTab, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- per-frame: view offset, insets-driven refit, animation, near/far, orbit, bridge
  const lastFrame = useRef(performance.now());
  useFrame(() => {
    const c = controls.current;
    const W = size.width, H = size.height;
    const s = st.current;
    const v = view.current;
    if (v.W !== W || v.H !== H || v.version !== insets.version) {
      const insetsChanged = v.version !== insets.version && v.version >= 0;
      v.W = W; v.H = H; v.version = insets.version;
      camera.setViewOffset(W, H, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2, W, H);
      camera.updateProjectionMatrix();
      if (insetsChanged && !insets.animating && s.atFit && !s.inBuilding && s.lastSpec && !rt.cam.userMoved) {
        // re-fit into the new free rect (not counted as a fit trigger)
        const spec = siteSpec(layoutRef.current);
        startAnim(computeFit(camera, W, H, spec), 400, 'refit', spec);
        s.lastSpec = spec; s.fitBounds = spec.bounds;
      }
    }
    const a = anim.current;
    if (a && c) {
      const k = a.dur <= 0 ? 1 : Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = easeOutCubic(k);
      c.target.lerpVectors(a.from.target, a.to.target, e);
      camera.position.lerpVectors(a.from.pos, a.to.pos, e);
      if (a.to.zoom != null && a.from.zoom != null && isOrtho(camera)) { camera.zoom = a.from.zoom + (a.to.zoom - a.from.zoom) * e; camera.updateProjectionMatrix(); }
      camera.lookAt(c.target);
      if (k >= 1) {
        anim.current = null;
        bridge.transitioning = false;
        if (a.fit) {
          camera.updateMatrixWorld();
          const pb = projectBox(camera, corners(a.fit.bounds, a.fit.maxH), W, H);
          const fr = freeRect(W, H);
          rt.cam.fitError = Math.hypot(pb.cx - fr.cx, pb.cy - fr.cy);
        }
      }
      invalidate();
    } else if (c && !s.damping) { c.enableDamping = true; s.damping = true; }
    // near / far follow the viewing distance (depth precision for flat layers)
    const dist = c ? camera.position.distanceTo(c.target) : 200;
    if (!isOrtho(camera)) {
      const near = Math.min(12, Math.max(0.2, dist * 0.012));
      const far = Math.max(3000, dist * 14);
      if (Math.abs(camera.near - near) / near > 0.15 || Math.abs(camera.far - far) / far > 0.15) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    }
    if (c) {
      const l = layoutRef.current;
      const R = l ? Math.hypot(l.bounds.w, l.bounds.d) / 2 : 100;
      c.maxDistance = Math.max(4 * R, 400, s.maxDist);
      const idle = performance.now() - s.lastInteract > 9000;
      const orbit = autoOrbit && idle && !anim.current && !running && !s.inBuilding;
      c.autoRotate = orbit; c.autoRotateSpeed = 0.35;
      if (orbit) invalidate();
      bridge.azimuth = c.getAzimuthalAngle();
    }
    bridge.pxPerFoot = isOrtho(camera) ? camera.zoom / UNIT_FT : H / (2 * dist * Math.tan((camera.fov * DEG) / 2)) / UNIT_FT;
    const now = performance.now(); const dt = now - lastFrame.current; lastFrame.current = now;
    if (dt > 0) bridge.fps = bridge.fps * 0.9 + (1000 / dt) * 0.1;
    rt.cam.moving = anim.current != null || now - s.lastChange < 150;
  }, -3);

  const handlers = useMemo(() => ({
    onStart: () => {
      const s = st.current;
      s.lastInteract = performance.now(); s.atFit = false;
      if (anim.current) { anim.current = null; bridge.transitioning = false; }
      rt.cam.userMoved = true;
      if (s.inRun) s.runUserMoved = true;
    },
    onChange: () => { st.current.lastChange = performance.now(); },
  }), []);

  return plan
    ? <MapControls key="plan" ref={controls} makeDefault enableDamping dampingFactor={0.12} enableRotate={false} minPolarAngle={0} maxPolarAngle={0} minZoom={0.05} maxZoom={60} onStart={handlers.onStart} onChange={handlers.onChange} />
    : <MapControls key="persp" ref={controls} makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={80 * DEG} minDistance={6} maxDistance={4000} onStart={handlers.onStart} onChange={handlers.onChange} />;
}
