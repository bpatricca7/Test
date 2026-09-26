// Message ticker and voice captions: 'message' events {text, level, duration?} and 'callout'
// events {text, who} appear bottom-centre, newest last, and fade out after their duration.
// Repeated identical messages collapse into one line with a counter.

import { h } from './dom.js';

const MAX_ITEMS = 5;
const FADE_MS = 600;
const DEFAULT_S = { info: 3.5, good: 4.5, warn: 5, alarm: 6.5 };

export function createTicker() {
  const el = h('div.ticker');
  /** @type {{node: HTMLElement, key: string, until: number, count: number, cnt?: HTMLElement}[]} */
  let items = [];

  function remove(it, now) {
    if (it.removing) return;
    it.removing = now;
    it.node.classList.add('out');
    setTimeout(() => it.node.remove(), FADE_MS);
  }

  function add(key, node, seconds) {
    const now = performance.now();
    const last = items[items.length - 1];
    if (last && last.key === key && !last.removing) {
      // same text again: bump the counter and extend
      last.count++;
      if (!last.cnt) {
        last.cnt = h('span.cnt');
        last.node.appendChild(last.cnt);
      }
      last.cnt.textContent = `×${last.count}`;
      last.until = now + seconds * 1000;
      return;
    }
    el.appendChild(node);
    items.push({ node, key, until: now + seconds * 1000, count: 1 });
    const live = items.filter((i) => !i.removing);
    if (live.length > MAX_ITEMS) remove(live[0], now);
  }

  return {
    el,
    /** @param {{text: string, level?: string, duration?: number}} m */
    message(m) {
      if (!m || !m.text) return;
      const level = ['info', 'good', 'warn', 'alarm'].includes(m.level) ? m.level : 'info';
      const secs = Number.isFinite(m.duration) ? Math.max(1.2, m.duration) : DEFAULT_S[level];
      add(`m:${m.text}`, h(`div.tmsg.${level}`, { role: level === 'alarm' ? 'alert' : 'status' }, m.text), secs);
    },
    /** @param {{text: string, who?: string}} c */
    callout(c) {
      if (!c || !c.text) return;
      const who = String(c.who || '').toUpperCase();
      const secs = Math.min(14, 3.5 + c.text.length * 0.07);
      add(`c:${who}:${c.text}`, h('div.tmsg.tcap', null, who ? h(`span.who.${who}`, null, who) : null, c.text), secs);
    },
    update() {
      const now = performance.now();
      for (const it of items) if (!it.removing && now > it.until) remove(it, now);
      items = items.filter((it) => !it.removing || now - it.removing < FADE_MS + 50);
    },
    clear() {
      for (const it of items) it.node.remove();
      items = [];
    },
  };
}
