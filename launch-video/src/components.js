// Reusable on-screen pieces: kinetic words, browser window + camera, agent cursor, action log, keycaps.
import { h, box, css, text, toggle, clamp, lerp, range, kf, spring, E } from './engine.js';

/* ───────────────────────── Kinetic words ───────────────────────── */

/** Build a line of words. `accent` = indices rendered in brand green. */
export function wordLine(words, { cls = '', accent = [] } = {}) {
  const spans = words.map((w, i) =>
    h('span', { class: `w${accent.includes(i) ? ' accent' : ''}` }, h('span', { class: 'wi', text: w })),
  );
  const el = h('div', { class: `wordline ${cls}` }, spans);
  return { el, spans: spans.map((s) => s.firstChild) };
}

/** Words slam in: big scale + blur collapsing to crisp, one per time in `times`. */
export function stamp(spans, t, times, { from = 1.45, dur = 0.32 } = {}) {
  spans.forEach((s, i) => {
    const p = range(t, times[i], times[i] + dur);
    const vis = t >= times[i];
    css(s, {
      opacity: vis ? String(clamp(p * 2.2)) : '0',
      transform: `scale(${lerp(from, 1, E.outExpo(p)).toFixed(4)})`,
      filter: p < 1 ? `blur(${lerp(14, 0, E.outExpo(p)).toFixed(2)}px)` : 'none',
    });
  });
}

/** Words rise out of a mask, staggered. */
export function rise(spans, t, t0, { stagger = 0.06, dur = 0.55 } = {}) {
  spans.forEach((s, i) => {
    const p = E.outExpo(range(t, t0 + i * stagger, t0 + i * stagger + dur));
    css(s, { transform: `translateY(${lerp(110, 0, p).toFixed(2)}%)`, opacity: p > 0 ? '1' : '0' });
  });
}

/** Scene-level exit: punch in + blur + fade. */
export function punchOut(el, t, t0, dur = 0.28) {
  const p = E.inCubic(range(t, t0, t0 + dur));
  css(el, {
    transform: `scale(${lerp(1, 1.12, p).toFixed(4)})`,
    filter: p > 0 ? `blur(${(p * 18).toFixed(2)}px)` : 'none',
    opacity: String(1 - p),
  });
}

/* ───────────────────────── Browser window + camera ───────────────────────── */

export const APP_W = 1280;
export const APP_H = 716;

export function makeWindow({ url, lock = true }) {
  const content = h('div', { class: 'app-content', style: box(0, 0, APP_W, APP_H) });
  const viewport = h('div', { class: 'viewport' }, content);
  const el = h(
    'div',
    { class: 'window' },
    h(
      'div',
      { class: 'chrome' },
      h('div', { class: 'dots' }, h('i'), h('i'), h('i')),
      h('div', { class: 'url' }, lock ? h('span', { class: 'lock', html: LOCK }) : null, h('span', { text: url })),
      h('div', { class: 'chrome-right' }, h('i'), h('i')),
    ),
    viewport,
  );
  return { el, content, viewport };
}

/** camera frames: [[t, scale, focusX, focusY, ease?], ...] in app-content coordinates. */
export function applyCamera(content, t, frames) {
  const [s, fx, fy] = kf(
    t,
    frames.map(([ft, sc, x, y, e]) => [ft, [sc, x, y], e]),
    E.inOutQuint,
  );
  const tx = clamp(APP_W / 2 - fx * s, APP_W - APP_W * s, 0);
  const ty = clamp(APP_H / 2 - fy * s, APP_H - APP_H * s, 0);
  css(content, { transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})` });
}

/* ───────────────────────── Cursor ───────────────────────── */

const ARROW =
  '<svg width="30" height="34" viewBox="0 0 30 34"><path d="M3 2.5 L3 27 L9.4 20.8 L14 31 L18.4 29.1 L13.9 19.1 L22.6 19.1 Z" fill="currentColor" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
const LOCK =
  '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.2" width="8" height="5.8" rx="1.3" fill="currentColor"/><path d="M3.8 5.4V3.9a2.2 2.2 0 0 1 4.4 0v1.5" stroke="currentColor" stroke-width="1.3" fill="none"/></svg>';

export function makeCursor({ label = 'Agent', variant = 'agent' } = {}) {
  const ripple = h('div', { class: 'ripple' });
  const arrow = h('div', { class: 'arrow', html: ARROW });
  const tag = h('div', { class: 'ctag', text: label });
  const el = h('div', { class: `cursor ${variant}` }, ripple, arrow, tag);
  return { el, arrow, ripple };
}

/** path: [[t, x, y], ...]; clicks: [t, ...]. Coordinates are in the parent's space. */
export function updateCursor(c, t, path, clicks = []) {
  const [x, y] = kf(t, path.map(([pt, px, py, e]) => [pt, [px, py], e]), E.inOutCubic);
  const shown = range(t, path[0][0] - 0.15, path[0][0] + 0.1);
  let press = 0;
  let rp = 1;
  for (const c0 of clicks) {
    if (t >= c0 && t < c0 + 0.6) {
      press = Math.sin(Math.PI * range(t, c0, c0 + 0.16));
      rp = range(t, c0, c0 + 0.5);
    }
  }
  css(c.el, {
    transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`,
    opacity: String(shown),
  });
  css(c.arrow, { transform: `scale(${(1 - 0.2 * press).toFixed(3)})` });
  css(c.ripple, {
    transform: `translate(-50%, -50%) scale(${lerp(0.3, 2.6, E.outCubic(rp)).toFixed(3)})`,
    opacity: String(rp < 1 ? (1 - rp) * 0.75 : 0),
  });
}

/* ───────────────────────── Action log (agent HUD) ───────────────────────── */

const ROW_H = 58;

const stamp10 = (secs) => `00:${String(Math.floor(secs)).padStart(2, '0')}.${Math.floor((secs % 1) * 10)}`;

export function makeActionLog({ agent, task, entries, clock = (t) => t }) {
  const rows = entries.map((e) =>
    h(
      'div',
      { class: `logrow${e.done ? ' done' : ''}` },
      h('div', { class: 'ico' }, h('span', { class: 'spin' }), h('span', { class: 'chk', text: '✓' })),
      h('div', { class: 'lt', text: stamp10(clock(e.t)) }),
      h('div', { class: 'lv', text: e.verb }),
      h('div', { class: 'lx', text: e.text }),
    ),
  );
  const list = h('div', { class: 'loglist' }, rows);
  const speed = h('div', { class: 'speed', text: '1× speed' });
  const stepEl = h('span', { class: 'mono' });
  const clockEl = h('span', { class: 'mono dim' });
  const bar = h('i');
  const el = h(
    'div',
    { class: 'actionlog' },
    h('div', { class: 'loghead' }, h('span', { class: 'live' }), h('span', { class: 'agent', text: agent }), speed),
    h('div', { class: 'logtask' }, h('span', { class: 'dim', text: 'TASK  ' }), task),
    list,
    h('div', { class: 'logfoot' }, stepEl, clockEl, h('div', { class: 'logbar' }, bar)),
  );
  return {
    el,
    update(t, speedLabel = '1× speed') {
      let last = -1;
      entries.forEach((e, i) => {
        if (t >= e.t) last = i;
      });
      // Rows beyond the visible nine push the list up smoothly as they arrive.
      const scroll = entries.reduce(
        (acc, e, i) => (i >= 9 ? acc + E.outExpo(range(t, e.t, e.t + 0.35)) * ROW_H : acc),
        0,
      );
      entries.forEach((e, i) => {
        const p = E.outExpo(range(t, e.t, e.t + 0.35));
        css(rows[i], {
          transform: `translate(${lerp(24, 0, p).toFixed(1)}px, ${(i * ROW_H - scroll).toFixed(1)}px)`,
          opacity: t >= e.t ? String(p) : '0',
        });
        toggle(rows[i], 'current', i === last && !e.done);
        toggle(rows[i], 'past', i < last || !!e.done);
      });
      text(speed, speedLabel);
      toggle(speed, 'fast', speedLabel !== '1× speed');
      text(stepEl, `Step ${Math.max(1, last + 1)}/${entries.length}`);
      text(clockEl, stamp10(Math.max(0, clock(t))));
      css(bar, { width: `${(((last + 1) / entries.length) * 100).toFixed(1)}%` });
    },
  };
}

/* ───────────────────────── Keycaps overlay ───────────────────────── */

export function makeKeycaps() {
  const cap = h('div', { class: 'keycap' });
  const el = h('div', { class: 'keycaps' }, cap);
  return {
    el,
    update(t, keys) {
      let cur = null;
      for (const k of keys) if (t >= k[0] && t < k[0] + 0.7) cur = k;
      if (!cur) return css(cap, { opacity: '0' });
      const lt = t - cur[0];
      text(cap, cur[1]);
      css(cap, {
        opacity: String(1 - range(lt, 0.5, 0.7)),
        transform: `translateY(${lerp(20, 0, spring(lt, 4, 0.5)).toFixed(2)}px) scale(${(0.92 + 0.08 * spring(lt, 4, 0.5)).toFixed(3)})`,
      });
      toggle(cap, 'down', lt < 0.12);
    },
  };
}
