// The elves' screens: the speech bubble over an elf (its name, what it says, big buttons), the
// "Twinkle Elves" panel (who is hiding, who was found, the house elf), the "Find the elves"
// counter in the life column, and the one-thing-at-a-time rule for the popups this module
// starts by itself (wave5-plan.md §0, the squish team's rule, copied).

import { lifeHud, lifeIcon, toScreen } from '../pets/kit.js';
import { NAMES, SCHEMES } from './data.js';
import { buildElf } from './models.js';

// buttons in the bubble use the core icon set for these, the life icons (pets/kit.js) otherwise
const CORE_ICONS = new Set(['heart', 'pencil', 'home', 'check', 'star', 'close', 'back']);

const CSS = /* css */ `
.el-bubble.lf-bubble { border-color: #BFF0DE; max-width: min(360px, 92vw); }
.el-bubble.lf-bubble::after { border-right-color: #BFF0DE; border-bottom-color: #BFF0DE; }
.el-bubble .el-bub-name { font-size: 19px; font-weight: 700; color: #2FA37F; display: flex; align-items: center; gap: 6px; }
.el-bubble .el-bub-name svg { width: 22px; height: 22px; }
.el-bubble .el-bub-line { font-size: 19px; font-weight: 600; color: var(--sw-ink); text-align: center; line-height: 1.2; max-width: 300px; }
.el-bubble .el-bub-sub { font-size: 15px; font-weight: 700; color: var(--sw-lav); }
.el-bubble .lf-bubble-row { margin-top: 2px; }
.el-bubble .sw-round-face { width: 54px; height: 54px; }
.el-bubble .sw-round-face svg { width: 28px; height: 28px; }

.el-find .sw-round-face { position: relative; }
.el-count { position: absolute; top: -8px; right: -12px; min-width: 30px; height: 26px; padding: 0 6px; border-radius: 999px; background: #2FA37F; color: #fff; border: 3px solid #fff; font-size: 14px; font-weight: 700; line-height: 20px; text-align: center; box-shadow: 0 2px 6px var(--sw-shadow); pointer-events: none; white-space: nowrap; }
.el-find.el-done .el-count { background: var(--sw-sun); color: var(--sw-ink); }

.el-panel { display: flex; flex-direction: column; gap: 14px; }
.el-intro { display: flex; align-items: center; gap: 14px; background: linear-gradient(135deg, #E9FBF4, #F3EDFF); border-radius: 22px; padding: 12px 16px; }
.el-intro img { width: 84px; height: 84px; flex: none; }
.el-intro-text { font-size: 19px; font-weight: 600; color: var(--sw-ink); line-height: 1.25; }
.el-intro-text b { display: block; font-size: 23px; color: #2FA37F; }
.el-progress { height: 16px; border-radius: 999px; background: #EAE3F7; overflow: hidden; margin-top: 8px; box-shadow: inset 0 2px 3px rgba(58,31,77,.12); }
.el-progress > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #5ED6B4, #FFC93C); transition: width .5s var(--sw-bounce); }
.el-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }
.el-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px 10px; border-radius: 20px; background: #fff; border: 4px solid #E6F7F1; box-shadow: 0 4px 10px rgba(58,31,77,.1); }
.el-card img { width: 72px; height: 72px; }
.el-card-name { font-size: 17px; font-weight: 700; color: var(--sw-ink); }
.el-card-where { font-size: 13px; font-weight: 600; color: var(--sw-lav); text-align: center; line-height: 1.1; min-height: 15px; }
.el-card.el-hidden img { filter: grayscale(1) brightness(1.55) opacity(.45); }
.el-card.el-hidden .el-card-name { color: #B4A8CC; }
.el-card .el-mark { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 18px; font-weight: 700; color: #fff; background: #2FA37F; border: 3px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); }
.el-card.el-hidden .el-mark { background: #C9B6FF; }
.el-card .el-mark svg { width: 18px; height: 18px; }
.el-home { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: #FFF6E8; border-radius: 22px; padding: 12px 16px; }
.el-home img { width: 64px; height: 64px; flex: none; }
.el-home-text { flex: 1 1 200px; font-size: 18px; font-weight: 600; color: var(--sw-ink); line-height: 1.25; }
.el-home-text b { color: #E07A2E; }
.el-home-hint { display: block; margin-top: 4px; font-size: 17px; color: #2FA37F; }
.el-buttons { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
@media (max-width: 520px) {
  .el-grid { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 8px; }
  .el-card img { width: 58px; height: 58px; }
  .el-intro img { width: 64px; height: 64px; }
  .el-intro-text { font-size: 17px; }
}
`;

/**
 * Something covers the world: a panel, a dialog, the page hidden, loading, photo mode, a fade,
 * a sticker pop, a tutorial tip, or any speech bubble that is up (`.lf-bubble`). Copied from
 * the squish team's rule (src/things/squish/fx.js) so this module reaches into no other.
 */
export function blocked(game) {
  const ui = game.ui;
  if (!ui) return true;
  if (ui.current || ui.dialogOpen || document.hidden || game.loading || game.mode !== 'play') return true;
  if (game.container && game.container.classList.contains('sw-photo-mode')) return true;
  if (ui.fader && ui.fader.classList.contains('sw-on')) return true;
  if (ui.root.querySelector(':scope > .sw-stkpop') || ui.root.classList.contains('sw-tut-on')) return true;
  const root = game.container || document;
  for (const b of root.querySelectorAll('.lf-bubble')) {
    if (!b.hidden && b.offsetWidth > 0 && b.offsetHeight > 0) return true;
  }
  return false;
}

/** A portrait of elf scheme i (a cached thumbnail; resolves a data URL or ''). */
export function elfPortrait(game, i, greet = false) {
  if (!game.thumbs) return Promise.resolve('');
  const key = greet ? 'elf:face:greet' : `elf:face:${i}`;
  return game.thumbs.get(key, () => buildElf(i, greet ? { role: 'greet' } : {}), { dir: [0.35, 0.3, 1], zoom: 1.0 }).catch(() => '');
}

/**
 * sys: the elves system (index.js) with: state() { hiders: [{ idx, name, sc, where, found }],
 * house: { name, sc, where, foundToday } | null, isHoliday, met }, getDoor(), rename(), bye().
 */
export function installElfUI(game, sys) {
  const ui = game.ui;
  ui.addStyles(CSS);

  // ---------------- the bubble over an elf ----------------
  const bubble = ui.el('div', 'lf-bubble el-bubble');
  bubble.dataset.owner = 'elves';
  ui.hudLayer.appendChild(bubble);
  const bub = { entity: null, openedAt: 0, idle: 0, ttl: 9 };
  const at = { x: 0, y: 0 };

  const roundBtn = (label, color, icon, onClick) => {
    const b = ui.el('button', 'sw-round');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    const f = ui.el('span', 'sw-round-face');
    f.style.setProperty('--c', color);
    f.innerHTML = CORE_ICONS.has(icon) && ui.icon ? ui.icon(icon) : lifeIcon(icon);
    b.append(f, ui.el('span', 'sw-round-label', label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.play('click');
      bub.idle = 0;
      onClick();
    });
    return b;
  };

  /**
   * opts: { name, line, sub, buttons: [{ label, color, icon, onClick }], ttl }. icon: a
   * life icon (pets/kit.js) or a core icon name.
   */
  function showBubble(entity, { name = '', line = '', sub = '', buttons = [], ttl = 9 } = {}) {
    if (!entity) return;
    bub.entity = entity;
    bub.openedAt = performance.now();
    bub.idle = 0;
    bub.ttl = ttl;
    bubble.innerHTML = '';
    const n = ui.el('div', 'el-bub-name');
    n.innerHTML = lifeIcon('el_elf');
    n.appendChild(document.createTextNode(name));
    bubble.appendChild(n);
    if (line) bubble.appendChild(ui.el('div', 'el-bub-line', line));
    if (sub) bubble.appendChild(ui.el('div', 'el-bub-sub', sub));
    if (buttons.length) {
      const row = ui.el('div', 'lf-bubble-row');
      for (const b of buttons) row.appendChild(roundBtn(b.label, b.color || '#2FA37F', b.icon || 'heart', () => { if (b.close !== false) hideBubble(); b.onClick && b.onClick(); }));
      bubble.appendChild(row);
    }
    bubble.classList.add('lf-on');
    positionBubble();
  }

  function hideBubble() {
    bub.entity = null;
    bubble.classList.remove('lf-on');
  }

  function positionBubble() {
    const e = bub.entity;
    if (!e || !e.object3d) return;
    const dy = (e.data && Number.isFinite(e.data.dy) ? e.data.dy : 0) + (e.yOffset || 0);
    const p = e.object3d.position;
    const s = toScreen(game, p.x, e.y + dy + 1.15, p.z, at);
    if (!s) {
      bubble.style.visibility = 'hidden';
      return;
    }
    bubble.style.visibility = '';
    const w = bubble.offsetWidth || 240, h = bubble.offsetHeight || 120;
    const W = game.container.clientWidth, H = game.container.clientHeight;
    const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, s.x));
    const y = Math.max(h + 8, Math.min(H - 90, s.y));
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
  }

  game.input.on('tap', () => {
    if (bub.entity && performance.now() - bub.openedAt > 150) hideBubble();
  });
  game.events.on('ui:open', hideBubble);
  game.events.on('world:unload', hideBubble);

  // ---------------- the "Find the elves" counter (life column) ----------------
  const hud = lifeHud(game);
  const findBtn = hud.add('elves', { icon: 'el_elf', label: 'Elves', color: '#2FA37F', order: 26, onClick: () => ui.open('elves') });
  findBtn.classList.add('el-find');
  findBtn.setAttribute('aria-label', 'Find the elves');
  const count = ui.el('span', 'el-count', '0/0');
  findBtn.querySelector('.sw-round-face').appendChild(count);

  function setCounter(found, total) {
    const show = total > 0 && game.mode === 'play';
    hud.show('elves', show);
    if (!show) return;
    const text = `${found}/${total}`;
    if (count.textContent !== text) count.textContent = text;
    findBtn.classList.toggle('el-done', found >= total);
    findBtn.setAttribute('aria-label', `Find the elves: ${found} of ${total}`);
  }

  // ---------------- the Twinkle Elves panel ----------------
  let body = null;
  const img = (src = '') => {
    const i = ui.el('img');
    i.alt = '';
    i.draggable = false;
    if (src) i.src = src;
    return i;
  };
  const portraitInto = (el, i, greet = false) => { elfPortrait(game, i, greet).then((u) => { if (u) el.src = u; }); };

  function render() {
    if (!body) return;
    const s = sys.state();
    body.innerHTML = '';
    const wrap = ui.el('div', 'el-panel');

    // intro: the greeter says hello; the progress bar in a village
    const intro = ui.el('div', 'el-intro');
    const gi = img();
    portraitInto(gi, 0, true);
    const it = ui.el('div', 'el-intro-text');
    const total = s.hiders.length;
    const found = s.hiders.filter((h) => h.found).length;
    if (total) {
      it.appendChild(ui.el('b', '', found >= total ? `You found all ${total} elves!` : `${found} of ${total} elves found`));
      it.appendChild(document.createTextNode(found >= total ? 'Hooray! The Twinkle Elves love playing with you.' : 'Listen for the jingle! It gets louder when an elf is near.'));
      const bar = ui.el('div', 'el-progress');
      const fill = ui.el('i');
      fill.style.width = `${Math.round((found / Math.max(1, total)) * 100)}%`;
      bar.appendChild(fill);
      it.appendChild(bar);
    } else {
      it.appendChild(ui.el('b', '', 'The Twinkle Elves'));
      it.appendChild(document.createTextNode('Twelve little elves who love to play hide and seek!'));
    }
    intro.append(gi, it);
    wrap.appendChild(intro);

    // the elves: hiding ones in a village, else all twelve to meet
    const grid = ui.el('div', 'el-grid');
    const list = total
      ? s.hiders
      : NAMES.map((name, i) => ({ idx: i, name, sc: i, where: '', found: true, meet: true }));
    for (const h of list) {
      const card = ui.el('div', 'el-card' + (h.found ? '' : ' el-hidden'));
      const im = img();
      portraitInto(im, h.sc);
      card.appendChild(im);
      card.appendChild(ui.el('div', 'el-card-name', h.found || h.meet ? h.name : '?'));
      card.appendChild(ui.el('div', 'el-card-where', h.meet ? '' : h.found ? 'Found!' : h.where || 'Hiding...'));
      if (!h.meet) {
        const mark = ui.el('div', 'el-mark');
        if (h.found) mark.innerHTML = ui.icon('check');
        else mark.textContent = '?';
        card.appendChild(mark);
      }
      grid.appendChild(card);
    }
    wrap.appendChild(grid);

    // the house elf (or how to get one)
    if (!s.isGuest) {
      const home = ui.el('div', 'el-home');
      const hi = img();
      const t = ui.el('div', 'el-home-text');
      const btns = ui.el('div', 'el-buttons');
      if (s.house) {
        portraitInto(hi, s.house.sc);
        const b = ui.el('b', '', s.house.name);
        t.append(b, document.createTextNode(s.house.foundToday ? ' lives here! See you tomorrow morning.' : ' lives here and is hiding somewhere!'));
        const hint = ui.el('span', 'el-home-hint', '');
        hint.hidden = true;
        t.appendChild(hint);
        if (!s.house.foundToday && s.house.where) {
          btns.appendChild(ui.button({ icon: 'star', label: 'Hint', variant: 'sun', onClick: () => { hint.textContent = `Look ${s.house.where}!`; hint.hidden = false; } }));
        }
        btns.appendChild(ui.button({ icon: 'pencil', label: 'Name', variant: 'lav', onClick: () => sys.rename() }));
      } else {
        portraitInto(hi, 3);
        t.appendChild(document.createTextNode('An elf can live at your house and hide in a new place every morning! Put an Elf Door by your bed.'));
        btns.appendChild(ui.button({ icon: 'home', label: 'Elf Door', variant: 'mint', onClick: () => sys.getDoor() }));
      }
      home.append(hi, t, btns);
      wrap.appendChild(home);
    }

    const go = ui.el('div', 'el-buttons');
    go.appendChild(ui.button({ icon: 'heart', label: total && found < total ? 'Find them!' : 'Yay!', variant: 'pink', size: 'big', onClick: () => ui.close() }));
    wrap.appendChild(go);
    body.appendChild(wrap);
  }

  ui.registerPanel('elves', {
    title: 'Twinkle Elves',
    icon: 'star',
    width: 760,
    build(container) {
      body = container;
    },
    onOpen() {
      sys.onPanelOpen();
      render();
    },
  });

  // portraits warm up quietly in the background
  function warm() {
    if (!game.thumbs) return;
    const run = () => {
      for (let i = 0; i < SCHEMES.length; i++) elfPortrait(game, i);
      elfPortrait(game, 0, true);
    };
    if (typeof game.thumbs.withPriority === 'function') game.thumbs.withPriority('low', run);
    else run();
  }

  return {
    showBubble,
    hideBubble,
    bubbleFor: () => bub.entity,
    setCounter,
    render: () => { if (ui.isOpen('elves')) render(); },
    warm,
    update(dt) {
      if (!bub.entity) return;
      bub.idle += dt;
      const e = bub.entity;
      const pl = game.player;
      const far = pl && e.object3d ? pl.position.distanceTo(e.object3d.position) > 12 : true;
      if (!e.object3d || game.paused || bub.idle > bub.ttl || far) {
        hideBubble();
        return;
      }
      positionBubble();
    },
  };
}
