// Message ticker and voice captions: 'message' events {text, level, duration?} and 'callout'
// events {text, who} fade out after their duration. Newest last. In exterior views the stack sits
// top-centre under the mission clock (clear of the spacecraft and the touchdown area); in the
// cockpit it sits low over the panel edge (see styles.js).
//
// Repeated identical messages collapse into one line with a counter. A new caption from the same
// speaker replaces that speaker's previous caption instead of stacking (Aldrin's altitude calls
// arrive every 3-4 s during the last 100 ft), and captions are shortened when `fast` is set.

import { h } from './dom.js';

const MAX_ITEMS = 4;
const FADE_MS = 600;
const DEFAULT_S = { info: 3.5, good: 4.5, warn: 5, alarm: 6.5 };

export function createTicker() {
  const el = h('div.ticker');
  /** @type {{node: HTMLElement, key: string, until: number, count: number, who?: string, cnt?: HTMLElement, removing?: number}[]} */
  let items = [];

  function remove(it, now) {
    if (it.removing) return;
    it.removing = now;
    it.node.classList.add('out');
    setTimeout(() => it.node.remove(), FADE_MS);
  }

  function trim(now) {
    const live = items.filter((i) => !i.removing);
    for (let k = 0; k < live.length - MAX_ITEMS; k++) remove(live[k], now);
  }

  function add(key, node, seconds, who) {
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
    if (who) {
      // one live caption per speaker: the newest call replaces the previous one in place
      const prev = items.find((i) => i.who === who && !i.removing);
      if (prev) {
        prev.node.replaceWith(node);
        el.appendChild(node); // newest last
        Object.assign(prev, { node, key, until: now + seconds * 1000, count: 1, cnt: null });
        items = items.filter((i) => i !== prev).concat(prev);
        return;
      }
    }
    el.appendChild(node);
    items.push({ node, key, until: now + seconds * 1000, count: 1, who });
    trim(now);
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
    /**
     * @param {{text: string, who?: string}} c
     * @param {{fast?: boolean}} [o] fast: short captions (final approach, calls every few seconds)
     */
    callout(c, o = {}) {
      if (!c || !c.text) return;
      const who = String(c.who || '').toUpperCase();
      const secs = o.fast ? Math.min(4.5, 2.6 + c.text.length * 0.02) : Math.min(10, 3.2 + c.text.length * 0.06);
      add(`c:${who}:${c.text}`, h('div.tmsg.tcap', null, who ? h(`span.who.${who}`, null, who) : null, c.text), secs, who || 'VOICE');
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
