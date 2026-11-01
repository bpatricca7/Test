// Map-style touch gestures for the 3D view (mobile contract). Mouse input keeps the desktop MapControls mapping;
// for fingers the MapControls touch handling is switched off and this component drives the same camera + target:
//   one finger      pans: the ground point under the finger stays under it, with a fling on release
//   two fingers     pinch zooms about the fingers, twist rotates about them, and their midpoint pans (the map sticks
//                   to both fingers); two fingers moving up / down together tilt (perspective camera only)
//   tap             selects a building / grounds area / crew member (synthesized click through the r3f event
//                   system, with a 10 px slop so a drag never selects); a near miss goes to the nearest building
//   double tap      goes inside a building; on empty ground it zooms in
//   two-finger tap  zooms out
// Camera moves are announced to the controls' start / change / end listeners, so CameraRig treats them exactly
// like a mouse drag (cancels transitions, marks userMoved).
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import type { SiteLayout } from './layout';
import { hoverFromScene, hoverSrc, tapCtx } from './hover';
import { bridge } from './bridge';
import { rt } from './runtime';

/** a touch that moves less than this (CSS px) is a tap */
export const TAP_SLOP = 10;
const TAP_MS = 600;
const DOUBLE_MS = 320;
const DOUBLE_PX = 34;
/** a tap that misses every pickable object selects the nearest building within this radius (CSS px) */
const NEAR_PX = 24;
/** the two-finger gesture is classified (tilt or transform) once a finger moved this far */
const CLASSIFY_PX = 8;
const FLING_TAU = 320; // ms: velocity decay time constant
const UP = new THREE.Vector3(0, 1, 0);

interface Pt { x: number; y: number; x0: number; y0: number }
interface Two { cx: number; cy: number; d: number; a: number }
type Controls = MapControlsImpl & { touches: { ONE: number; TWO: number } };

const metrics = (a: Pt, b: Pt): Two => ({ cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x) });
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function TouchControls() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as Controls | null;
  const { layout } = useDerived();
  const layoutRef = useRef<SiteLayout | null>(layout);
  layoutRef.current = layout;

  // fingers belong to this component: MapControls ignores touch pointers (unknown TOUCH action → state NONE)
  useEffect(() => {
    if (!controls) return;
    const prev = controls.touches;
    controls.touches = { ONE: -1, TWO: -1 };
    return () => { controls.touches = prev; };
  }, [controls]);

  const G = useRef({
    pts: new Map<number, Pt>(), order: [] as number[],
    mode: 'none' as 'none' | 'pan' | 'two', two: 'undecided' as 'undecided' | 'transform' | 'tilt',
    started: false, maxPts: 0, moved: 0, t0: 0, x0: 0, y0: 0, target: null as Element | null, onCanvas: false,
    anchor: new THREE.Vector3(), hasAnchor: false,
    prev: null as Two | null, twoStart: null as Two | null, twoP0: null as [Pt, Pt] | null,
    vel: [] as { t: number; x: number; z: number }[],
    fling: null as null | { vx: number; vz: number; last: number },
    tween: null as null | { x: number; y: number; factor: number; applied: number; t0: number; dur: number },
    lastTap: null as null | { t: number; x: number; y: number },
  });

  // ---- camera helpers (read the current camera / controls at call time: plan view swaps both)
  const rc = useRef(new THREE.Raycaster());
  const _n = useRef(new THREE.Vector2());
  const _a = useRef(new THREE.Vector3());
  const _b = useRef(new THREE.Vector3());

  const cam = () => get().camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
  const ctl = () => get().controls as Controls | null;
  const isOrtho = (c: THREE.Camera): c is THREE.OrthographicCamera => (c as THREE.OrthographicCamera).isOrthographicCamera === true;

  /** the point on the horizontal plane through the controls' target under a viewport position */
  const groundAt = (x: number, y: number, out: THREE.Vector3) => {
    const c = cam(); const k = ctl(); if (!k) return false;
    const r = gl.domElement.getBoundingClientRect();
    _n.current.set(((x - r.left) / Math.max(1, r.width)) * 2 - 1, -((y - r.top) / Math.max(1, r.height)) * 2 + 1);
    c.updateMatrixWorld();
    rc.current.setFromCamera(_n.current, c);
    const ray = rc.current.ray; const py = k.target.y;
    const dist = c.position.distanceTo(k.target);
    // near the horizon the plane hit runs away: clamp the ray length, then drop the point onto the plane
    const maxT = Math.max(60, dist * 5);
    let t = ray.direction.y < -1e-4 ? (py - ray.origin.y) / ray.direction.y : Infinity;
    if (!(t > 0) || t > maxT) t = maxT;
    out.copy(ray.origin).addScaledVector(ray.direction, t); out.y = py;
    return true;
  };

  const startMove = () => {
    const g = G.current; const k = ctl();
    g.fling = null; g.tween = null; rt.animating.delete('touch');
    if (!g.started && k) { g.started = true; k.dispatchEvent({ type: 'start' } as never); }
  };
  const endMove = () => {
    const g = G.current; const k = ctl();
    if (g.started && k) { g.started = false; k.dispatchEvent({ type: 'end' } as never); }
  };
  const commit = () => {
    const c = cam(); const k = ctl(); if (!k) return;
    c.lookAt(k.target); c.updateMatrixWorld();
    k.update();
    invalidate();
  };
  const translate = (dx: number, dz: number) => {
    const c = cam(); const k = ctl(); if (!k) return;
    c.position.x += dx; c.position.z += dz; k.target.x += dx; k.target.z += dz;
  };

  /** zoom by s (> 1 = closer) and rotate by da about the ground point under (x0, y0), then pan it under (x1, y1) */
  const transform = (x0: number, y0: number, x1: number, y1: number, s: number, da: number) => {
    const c = cam(); const k = ctl(); if (!k) return;
    const g0 = _a.current, g1 = _b.current;
    groundAt(x0, y0, g0);
    if (isOrtho(c)) {
      const z = THREE.MathUtils.clamp(c.zoom * s, k.minZoom, k.maxZoom);
      if (z !== c.zoom) { c.zoom = z; c.updateProjectionMatrix(); }
    } else if (s !== 1) {
      const dist = c.position.distanceTo(k.target);
      const nd = THREE.MathUtils.clamp(dist / s, k.minDistance, k.maxDistance);
      const ks = nd / Math.max(1e-6, dist);
      c.position.sub(g0).multiplyScalar(ks).add(g0);
      k.target.sub(g0).multiplyScalar(ks).add(g0);
    }
    if (da !== 0 && k.enableRotate && !isOrtho(c)) {
      c.position.sub(g0).applyAxisAngle(UP, da).add(g0);
      k.target.sub(g0).applyAxisAngle(UP, da).add(g0);
    }
    c.lookAt(k.target); c.updateMatrixWorld();
    groundAt(x1, y1, g1);
    translate(g0.x - g1.x, g0.z - g1.z);
    commit();
  };

  const tilt = (dy: number) => {
    const c = cam(); const k = ctl(); if (!k || isOrtho(c) || !k.enableRotate) return;
    const H = Math.max(1, gl.domElement.clientHeight);
    const off = c.position.clone().sub(k.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    // fingers up → more oblique (towards the horizon), like a maps app
    sph.phi = THREE.MathUtils.clamp(sph.phi - (dy / H) * Math.PI * 0.9, Math.max(0.02, k.minPolarAngle), k.maxPolarAngle);
    sph.makeSafe();
    c.position.copy(k.target).add(off.setFromSpherical(sph));
    commit();
  };

  /** animated anchored zoom (double tap on the ground, two-finger tap) */
  const zoomAt = (x: number, y: number, factor: number) => {
    const g = G.current;
    const k = ctl(); if (!k) return;
    g.fling = null;
    k.dispatchEvent({ type: 'start' } as never); k.dispatchEvent({ type: 'end' } as never);
    g.tween = { x, y, factor, applied: 1, t0: performance.now(), dur: useStore.getState().reducedMotion ? 0 : 280 };
    rt.animating.add('touch'); invalidate();
  };

  /** the building whose roof (or label) is nearest to a viewport point, within NEAR_PX */
  const nearestBuilding = (x: number, y: number): string | null => {
    const l = layoutRef.current; if (!l) return null;
    const c = cam(); c.updateMatrixWorld();
    const r = gl.domElement.getBoundingClientRect();
    let best: string | null = null, bd = NEAR_PX;
    const ids = new Set(l.buildings.map((b) => b.id));
    for (const lb of rt.labels) {
      if (!ids.has(lb.id)) continue;
      const dx = Math.max(lb.x - x, 0, x - (lb.x + lb.w)), dy = Math.max(lb.y - y, 0, y - (lb.y + lb.h));
      const dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = lb.id; }
    }
    const v = _a.current;
    for (const b of l.buildings) {
      v.set(b.box.x, Math.max(0.6, b.height), b.box.z).project(c);
      if (v.z > 1 || v.z < -1) continue;
      const px = r.left + ((v.x + 1) / 2) * r.width, py = r.top + ((1 - v.y) / 2) * r.height;
      const dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; best = b.id; }
    }
    return best;
  };

  const onTap = (x: number, y: number, target: Element | null) => {
    const g = G.current; const now = performance.now();
    const st = useStore.getState();
    const dbl = g.lastTap != null && now - g.lastTap.t < DOUBLE_MS && Math.hypot(x - g.lastTap.x, y - g.lastTap.y) < DOUBLE_PX;
    g.lastTap = dbl ? null : { t: now, x, y };
    const label = (target as HTMLElement | null)?.closest?.('.label-layer [data-id]') as HTMLElement | null;
    if (label) {
      // the label's own (native) click selects it; a double tap on a building's label goes inside
      if (dbl && label.dataset.kind === 'facility' && label.dataset.id) { st.select({ kind: 'facility', id: label.dataset.id }); st.setFocusMode('building'); }
      return;
    }
    if (!g.onCanvas) return;
    const opts: MouseEventInit = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, button: 0, view: window };
    tapCtx.active = true; tapCtx.hit = null;
    try {
      gl.domElement.dispatchEvent(new MouseEvent('click', { ...opts, detail: dbl ? 2 : 1 }));
      if (dbl) gl.domElement.dispatchEvent(new MouseEvent('dblclick', { ...opts, detail: 2 }));
    } finally { tapCtx.active = false; }
    const hit = tapCtx.hit as typeof tapCtx.hit;
    tapCtx.hit = null;
    const s2 = useStore.getState();
    const inside = s2.focusMode === 'building';
    if (hit && (hit.kind === 'facility' || hit.kind === 'grounds') && hit.id) { hoverFromScene(inside ? null : hit.id, { touch: true }); return; }
    if (hit?.kind === 'agent') { hoverFromScene(null, { touch: true }); return; }
    if (inside) return;
    // nothing pickable under the finger (or only the ground): small roofs and pins forward to the nearest building
    const near = nearestBuilding(x, y);
    if (near) {
      s2.select({ kind: 'facility', id: near });
      if (dbl) { s2.setFocusMode('building'); hoverFromScene(null, { touch: true }); } else hoverFromScene(near, { touch: true });
      return;
    }
    hoverFromScene(null, { touch: true });
    if (hit?.kind === 'ground' || !hit) {
      if (s2.selectedAgentId) s2.setSelectedAgent(null);
      if (dbl) zoomAt(x, y, 2);
    }
  };

  // ---- pointer plumbing on the scene root (the canvas and the label layer)
  useEffect(() => {
    const root = (gl.domElement.closest('.scene-root') as HTMLElement | null) ?? gl.domElement.parentElement;
    if (!root) return;
    const g = G.current;
    const canvasBox = () => gl.domElement.parentElement ?? gl.domElement;
    const twoPts = (): [Pt, Pt] | null => { const a = g.pts.get(g.order[0]), b = g.pts.get(g.order[1]); return a && b ? [a, b] : null; };
    const resetPan = (id: number) => { const p = g.pts.get(id); if (!p) return; g.mode = 'pan'; g.hasAnchor = groundAt(p.x, p.y, g.anchor); g.vel = []; };
    const beginTwo = () => {
      const tp = twoPts(); if (!tp) return;
      g.mode = 'two'; g.two = 'undecided';
      g.twoP0 = [{ ...tp[0] }, { ...tp[1] }];
      g.twoStart = metrics(tp[0], tp[1]); g.prev = g.twoStart;
      g.vel = [];
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const k = ctl(); if (!k || k.enabled === false) return;
      if (useStore.getState().view === 'table') return;
      if (g.pts.has(e.pointerId)) return;
      if (g.pts.size === 0) {
        g.t0 = performance.now(); g.x0 = e.clientX; g.y0 = e.clientY; g.maxPts = 0; g.moved = 0;
        g.target = e.target as Element; g.onCanvas = canvasBox().contains(e.target as Node);
        g.fling = null; g.tween = null; rt.animating.delete('touch');
      }
      g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      g.order.push(e.pointerId);
      g.maxPts = Math.max(g.maxPts, g.pts.size);
      if (g.pts.size === 1) resetPan(e.pointerId);
      else if (g.pts.size === 2) beginTwo();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      // fingers never hover: keep touch moves away from the r3f raycaster, MapControls and the label drag relay
      e.stopPropagation();
      const p = g.pts.get(e.pointerId); if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      g.moved = Math.max(g.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
      if (g.mode === 'pan' && g.order[0] === e.pointerId) {
        if (!g.started && g.moved < TAP_SLOP) return;
        startMove();
        const v = _b.current;
        if (!g.hasAnchor) { g.hasAnchor = groundAt(p.x, p.y, g.anchor); return; }
        groundAt(p.x, p.y, v);
        const dx = g.anchor.x - v.x, dz = g.anchor.z - v.z;
        translate(dx, dz);
        commit();
        const now = performance.now();
        g.vel.push({ t: now, x: dx, z: dz });
        while (g.vel.length && now - g.vel[0].t > 120) g.vel.shift();
      } else if (g.mode === 'two') {
        const tp = twoPts(); if (!tp || !g.prev || !g.twoStart || !g.twoP0) return;
        const cur = metrics(tp[0], tp[1]);
        if (g.two === 'undecided') {
          const d0 = { x: tp[0].x - g.twoP0[0].x, y: tp[0].y - g.twoP0[0].y }, d1 = { x: tp[1].x - g.twoP0[1].x, y: tp[1].y - g.twoP0[1].y };
          if (Math.max(Math.hypot(d0.x, d0.y), Math.hypot(d1.x, d1.y)) < CLASSIFY_PX) return;
          const c = cam(); const k = ctl();
          const sideBySide = Math.abs(g.twoP0[1].y - g.twoP0[0].y) < 1.2 * Math.abs(g.twoP0[1].x - g.twoP0[0].x);
          const vertical = d0.y * d1.y > 0 && Math.abs(d0.y) > 1.5 * Math.abs(d0.x) && Math.abs(d1.y) > 1.5 * Math.abs(d1.x);
          const rigid = Math.abs(cur.d - g.twoStart.d) < 0.4 * (Math.abs(d0.y) + Math.abs(d1.y)) / 2 && Math.abs(wrap(cur.a - g.twoStart.a)) < 0.12;
          g.two = vertical && rigid && sideBySide && !isOrtho(c) && k?.enableRotate ? 'tilt' : 'transform';
          g.prev = g.twoStart;
        }
        startMove();
        if (g.two === 'tilt') tilt(cur.cy - g.prev.cy);
        else transform(g.prev.cx, g.prev.cy, cur.cx, cur.cy, cur.d / g.prev.d, wrap(cur.a - g.prev.a));
        g.prev = cur;
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !g.pts.has(e.pointerId)) return;
      const now = performance.now();
      g.pts.delete(e.pointerId);
      g.order = g.order.filter((id) => id !== e.pointerId);
      if (g.pts.size === 1) { resetPan(g.order[0]); return; } // two → one finger: keep panning with the other
      if (g.pts.size >= 2) { beginTwo(); return; }
      // all fingers up
      const wasPan = g.mode === 'pan' && g.started;
      g.mode = 'none';
      if (e.type === 'pointercancel') { endMove(); return; }
      if (wasPan && g.vel.length >= 2 && now - g.vel[g.vel.length - 1].t < 60) {
        const span = Math.max(16, now - g.vel[0].t);
        let sx = 0, sz = 0; for (const v of g.vel) { sx += v.x; sz += v.z; }
        const vx = sx / span, vz = sz / span;
        const k = ctl(); const c = cam();
        const dist = k ? c.position.distanceTo(k.target) : 100;
        // ignore slow releases (< ~0.15 viewport heights per second)
        if (Math.hypot(vx, vz) * 1000 > dist * 0.15) { g.fling = { vx, vz, last: now }; rt.animating.add('touch'); invalidate(); }
      }
      endMove();
      const quick = now - g.t0 < TAP_MS && g.moved < TAP_SLOP;
      if (quick && g.maxPts === 1) onTap(g.x0, g.y0, g.target);
      else if (quick && g.maxPts === 2 && now - g.t0 < 400 && g.twoStart) { g.lastTap = null; zoomAt(g.twoStart.cx, g.twoStart.cy, 0.5); }
    };

    // a tap on the canvas is synthesized above: no native click (it would use the browser's own slop)
    const onTouchEnd = (e: TouchEvent) => { if (canvasBox().contains(e.target as Node) && e.cancelable) e.preventDefault(); };

    root.addEventListener('pointerdown', onDown, { capture: true });
    root.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onUp, { capture: true });
    window.addEventListener('pointercancel', onUp, { capture: true });
    root.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      root.removeEventListener('pointerdown', onDown, { capture: true });
      root.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onUp, { capture: true });
      window.removeEventListener('pointercancel', onUp, { capture: true });
      root.removeEventListener('touchend', onTouchEnd);
      rt.animating.delete('touch');
    };
  }, [gl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- a tap's tooltip belongs to that tap: it goes when the selection moves on or the view changes
  useEffect(() => useStore.subscribe((s, p) => {
    if (!hoverSrc.touch || s.hoverId == null) return;
    const selId = s.selection.kind ? (s.selection as { id: string }).id : null;
    if ((s.selection !== p.selection && selId !== s.hoverId) || s.focusMode !== p.focusMode || s.view !== p.view) hoverFromScene(null, { touch: true });
  }), []);

  // ---- fling and zoom tween
  useFrame(() => {
    const g = G.current;
    if (!g.fling && !g.tween) return;
    if (bridge.transitioning) { g.fling = null; g.tween = null; rt.animating.delete('touch'); return; } // a camera transition took over
    const now = performance.now();
    if (g.fling) {
      const f = g.fling; const dt = Math.min(50, now - f.last); f.last = now;
      translate(f.vx * dt, f.vz * dt); commit();
      const decay = Math.exp(-dt / FLING_TAU); f.vx *= decay; f.vz *= decay;
      const k = ctl(); const dist = k ? cam().position.distanceTo(k.target) : 100;
      if (Math.hypot(f.vx, f.vz) * 1000 < dist * 0.01) g.fling = null;
    }
    if (g.tween) {
      const t = g.tween; const k = t.dur <= 0 ? 1 : Math.min(1, (now - t.t0) / t.dur);
      const e = 1 - Math.pow(1 - k, 3);
      const want = Math.pow(t.factor, e);
      transform(t.x, t.y, t.x, t.y, want / t.applied, 0);
      t.applied = want;
      if (k >= 1) g.tween = null;
    }
    if (!g.fling && !g.tween) rt.animating.delete('touch');
  }, -4);

  return null;
}
