// 3D markers projected onto the HUD with ctx.project(mci): the landing-site designator (follows
// LPD redesignations: vessel.gnc.targetDir) and the other spacecraft (range and closing rate).
// Markers hidden behind the Moon are not drawn; targets off-screen or behind the camera are
// pinned to the screen edge with an arrow pointing toward them.

import * as THREE from 'three';
import { h, s } from './dom.js';
import { fmtDist, fmtSpeed } from './format.js';
import { MOON } from '../core/constants.js';
import { SITE_DIR } from '../core/frames.js';
import { terrainHeight } from '../world/moon.js';

// Pinned (off-screen) markers stay inside this safe area, clear of the HUD panels (px).
const EDGE = { left: 44, right: 44, top: 140, bottom: 64 };

function siteReticle() {
  return s('svg', { class: 'ret', width: 30, height: 30, viewBox: '-15 -15 30 30' },
    s('path', { d: 'M 0 -10 L 10 0 L 0 10 L -10 0 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }),
    s('path', { d: 'M 0 -14 L 0 -11 M 0 14 L 0 11 M -14 0 L -11 0 M 14 0 L 11 0', stroke: 'currentColor', 'stroke-width': 1.4 }),
    s('circle', { cx: 0, cy: 0, r: 1.6, fill: 'currentColor' }),
  );
}

function vesselReticle() {
  return s('svg', { class: 'ret', width: 34, height: 34, viewBox: '-17 -17 34 34' },
    s('path', { d: 'M -14 -7 L -14 -14 L -7 -14 M 7 -14 L 14 -14 L 14 -7 M 14 7 L 14 14 L 7 14 M -7 14 L -14 14 L -14 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }),
  );
}

function arrowReticle() {
  return s('svg', { class: 'ret arrow', width: 26, height: 26, viewBox: '-13 -13 26 26' },
    s('path', { d: 'M 9 0 L -5 -7 L -2 0 L -5 7 Z', fill: 'currentColor', 'fill-opacity': 0.9 }),
  );
}

function makeMarker(kind, reticle) {
  const ret = reticle();
  const arrow = arrowReticle();
  const name = h('span.n');
  const dist = h('span.d');
  const el = h(`div.mk.${kind}.hidden`, null, ret, arrow, h('div.lbl', null, name, dist));
  return { el, ret, arrow, name, dist, last: { t: '', n: '', d: '', edge: null, side: null, rot: '' } };
}

export function createMarkers(game, ctx) {
  const site = makeMarker('site', siteReticle);
  const ves = makeMarker('ves', vesselReticle);
  const el = h('div.markers', null, site.el, ves.el);
  const proj = {};
  const _p = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _d = new THREE.Vector3();

  /** True if the segment camera -> p passes through the Moon (reference sphere minus a margin). */
  function occluded(cam, p) {
    _d.subVectors(p, cam);
    const len = _d.length();
    if (len < 1) return false;
    _d.divideScalar(len);
    const R = MOON.radius - 2000; // terrain relief margin
    const b = cam.dot(_d);
    const c = cam.lengthSq() - R * R;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len;
  }

  /** A surface point is hidden when the camera is below its local horizon (ignoring relief). */
  function belowHorizon(cam, p) {
    _c.copy(p).normalize();
    return _d.subVectors(cam, p).dot(_c) < -50;
  }

  function place(m, mci, name, distText, show) {
    if (!show) {
      if (!m.el.classList.contains('hidden')) m.el.classList.add('hidden');
      return;
    }
    const r = ctx.project(mci, proj);
    const w = ctx.renderer.domElement.clientWidth || window.innerWidth;
    const hgt = ctx.renderer.domElement.clientHeight || window.innerHeight;
    let x = r.x;
    let y = r.y;
    let edge = false;
    let rot = 0;
    const x0 = EDGE.left, x1 = w - EDGE.right, y0 = EDGE.top, y1 = hgt - EDGE.bottom;
    if (r.behind || !r.onScreen || x < x0 || x > x1 || y < y0 || y > y1) {
      edge = true;
      // pin to the safe rectangle along the ray from its centre toward the target
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      let dx = x - cx;
      let dy = y - cy;
      if (r.behind) {
        dx = -dx;
        dy = -dy;
      }
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
      const k = Math.min((x1 - cx) / Math.max(1e-6, Math.abs(dx)), (y1 - cy) / Math.max(1e-6, Math.abs(dy)));
      x = cx + dx * k;
      y = cy + dy * k;
      rot = Math.atan2(dy, dx);
    }
    const L = m.last;
    if (m.el.classList.contains('hidden')) m.el.classList.remove('hidden');
    const tr = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (L.t !== tr) {
      m.el.style.transform = tr;
      L.t = tr;
    }
    if (L.edge !== edge) {
      m.el.classList.toggle('edge', edge);
      m.ret.style.display = edge ? 'none' : '';
      m.arrow.style.display = edge ? '' : 'none';
      L.edge = edge;
    }
    if (edge) {
      const rs = `translate(-50%, -50%) rotate(${rot.toFixed(3)}rad)`;
      if (L.rot !== rs) {
        m.arrow.style.transform = rs;
        L.rot = rs;
      }
      const left = x < w / 2;
      if (L.side !== left) {
        m.el.classList.toggle('l', left);
        L.side = left;
      }
    }
    if (L.n !== name) {
      m.name.textContent = name;
      L.n = name;
    }
    if (L.d !== distText) {
      m.dist.textContent = distText;
      L.d = distText;
    }
  }

  function update(visible) {
    const v = game.active;
    if (!visible || !v) {
      place(site, null, '', '', false);
      place(ves, null, '', '', false);
      return;
    }
    const cam = game.view.cameraMCI;
    const units = game.settings.units;

    // ---- landing site / guidance target
    const lm = game.vessels.LM;
    const dir = (lm && lm.gnc && lm.gnc.targetDir) || SITE_DIR;
    const redesignated = dir.angleTo ? dir.angleTo(SITE_DIR) > 2e-7 : false;
    const hgt = terrainHeight(dir.x, dir.y, dir.z);
    _p.copy(dir).multiplyScalar(MOON.radius + hgt);
    const t = v.tel;
    const range = Number.isFinite(t.rangeToSite) ? t.rangeToSite : _p.distanceTo(v.pos);
    const showSite = range > 25 && range < 800000 && !belowHorizon(cam, _p) && !(v.type === 'LM' && v.landed && range < 200);
    const rd = fmtDist(range, units);
    place(site, _p, redesignated && v.type === 'LM' ? 'Landing point' : 'Tranquility Base', `${rd.v} ${rd.u}`, showSite);

    // ---- the other spacecraft
    const o = game.inactive;
    const rt = t.relTarget;
    const showVes = !!o && !v.docked && !o.crashed && o.pos.distanceTo(cam) > 4 && !occluded(cam, o.pos);
    if (showVes) {
      const r = fmtDist(rt && Number.isFinite(rt.range) ? rt.range : o.pos.distanceTo(v.pos), units);
      const closing = rt && Number.isFinite(rt.rangeRate) && rt.range < 50000 ? -rt.rangeRate : NaN;
      const c = fmtSpeed(closing, units, { plus: true });
      place(ves, o.pos, o.name, Number.isFinite(closing) ? `${r.v} ${r.u}  ${c.v} ${c.u}` : `${r.v} ${r.u}`, true);
    } else place(ves, null, '', '', false);
  }

  return { el, update };
}
