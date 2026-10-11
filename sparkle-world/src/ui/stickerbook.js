// Sticker Book: action 'stickers' + panel 'stickers'. A real sticker album: two paper pages
// with spiral rings (one page on phones), six stickers per page. Earned stickers are glossy
// die-cut pictures that shimmer, tilt a little and show the day they were earned; locked ones
// are soft silhouettes with a hint ("Sleep in a bed"). Tap a sticker to see it big. Progress:
// "12 of 21 stickers". Page with the Back / Next buttons, swipes or the arrow keys.

import { icon } from './icons.js';

const PER_PAGE = 6;
const PAGE_TITLES = ['Build & Home', 'Treats & Treasures', 'Fun & Magic', 'Big Adventures', 'Even More!', 'Super Stars'];
const TILTS = [-5, 3, -2, 4, -4, 2, 5, -3];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CSS = /* css */ `
.sw-sb { position: relative; display: flex; flex-direction: column; gap: 12px; }
.sw-sb-top { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.sw-sb-count { display: flex; align-items: center; gap: 8px; font-size: 22px; font-weight: 700; color: var(--sw-ink); }
.sw-sb-count svg { width: 30px; height: 30px; color: #FFB300; filter: drop-shadow(0 2px 0 rgba(58,31,77,.12)); }
.sw-sb-count b { color: var(--sw-pink); font-size: 26px; }
.sw-sb-bar { width: min(280px, 60vw); height: 22px; border-radius: 999px; background: #fff; border: 4px solid #fff; box-shadow: 0 3px 10px var(--sw-shadow), inset 0 0 0 2px var(--sw-lav-soft); overflow: hidden; }
.sw-sb-bar i { display: block; height: 100%; border-radius: 999px; background: repeating-linear-gradient(-45deg, var(--sw-pink) 0 10px, #FF86BC 10px 20px); transition: width .6s var(--sw-bounce); }

.sw-sb-book { perspective: 1600px; }
.sw-sb-spread { display: flex; padding: 10px; border-radius: 26px; background: linear-gradient(135deg, #D9C8FF, #FFC6E2); box-shadow: 0 8px 0 rgba(58,31,77,.1), 0 14px 30px rgba(58,31,77,.22); transform-origin: 50% 50%; }
.sw-sb-spread.sw-flip-next { animation: sw-sb-next .42s var(--sw-bounce); }
.sw-sb-spread.sw-flip-prev { animation: sw-sb-prev .42s var(--sw-bounce); }
@keyframes sw-sb-next { 0% { transform: rotateY(-14deg) translateX(40px); opacity: .2; } 100% { transform: none; opacity: 1; } }
@keyframes sw-sb-prev { 0% { transform: rotateY(14deg) translateX(-40px); opacity: .2; } 100% { transform: none; opacity: 1; } }
.sw-sb-page { position: relative; flex: 1 1 0; min-width: 0; min-height: 356px; padding: 14px 12px 30px;
  background-color: #FFFDF7; background-image: radial-gradient(rgba(156,123,255,.16) 1.3px, transparent 1.5px); background-size: 18px 18px;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.9), inset 0 -6px 12px rgba(156,123,255,.08); }
.sw-sb-left { border-radius: 18px 6px 6px 18px; }
.sw-sb-right { border-radius: 6px 18px 18px 6px; }
.sw-sb-page.sw-sb-empty .sw-sb-grid { opacity: 0; }
.sw-sb-rings { width: 26px; flex: none; display: flex; flex-direction: column; justify-content: space-around; align-items: center; padding: 16px 0; background: linear-gradient(90deg, #EFE7FF, #FFFDF7 30%, #FFFDF7 70%, #EFE7FF); }
.sw-sb-rings i { display: block; width: 34px; height: 12px; border-radius: 8px; border: 4px solid #B9A6F2; background: transparent; box-shadow: 0 2px 0 rgba(58,31,77,.12); }
.sw-sb-ptitle { display: table; margin: 0 auto 10px; padding: 3px 16px 4px; font-size: 17px; font-weight: 700; color: #7A5BD6; transform: rotate(-2deg);
  background: repeating-linear-gradient(45deg, rgba(255,209,230,.95) 0 8px, rgba(255,232,243,.95) 8px 16px); border-radius: 4px; box-shadow: 0 2px 4px rgba(58,31,77,.1); }
.sw-sb-right .sw-sb-ptitle { transform: rotate(2deg); background: repeating-linear-gradient(45deg, rgba(200,236,255,.95) 0 8px, rgba(229,246,255,.95) 8px 16px); color: #3A8FCC; }
.sw-sb-pno { position: absolute; bottom: 8px; left: 0; right: 0; text-align: center; font-size: 13px; font-weight: 700; color: #B9A6F2; }
.sw-sb-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 6px; }

.sw-stk { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px 6px; border: 0; background: none; cursor: pointer; font-family: var(--sw-font); border-radius: 18px; min-height: 44px; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.sw-stk:focus-visible { outline: 4px solid var(--sw-sun); }
.sw-stk-pic { position: relative; width: 104px; height: 104px; transform: rotate(var(--tilt, 0deg)); transition: transform .25s var(--sw-bounce); }
.sw-stk:hover .sw-stk-pic, .sw-stk:active .sw-stk-pic { transform: rotate(0deg) scale(1.1); }
.sw-stk-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.sw-stk--got .sw-stk-pic canvas { transform: scale(1.12); }
/* the white outline copy shows only where a soft band of the mask passes: a sweeping shine */
.sw-stk-shine { opacity: .8;
  -webkit-mask-image: linear-gradient(115deg, transparent 38%, #000 47%, rgba(0,0,0,.6) 52%, transparent 60%);
  mask-image: linear-gradient(115deg, transparent 38%, #000 47%, rgba(0,0,0,.6) 52%, transparent 60%);
  -webkit-mask-size: 300% 100%; mask-size: 300% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  animation: sw-stk-shine 3.6s ease-in-out infinite; }
@keyframes sw-stk-shine { 0%, 55% { -webkit-mask-position: 100% 0; mask-position: 100% 0; } 100% { -webkit-mask-position: 0% 0; mask-position: 0% 0; } }
.sw-stk--locked .sw-stk-pic::before { content: ''; position: absolute; inset: 8px; border: 3px dashed #DCD0F2; border-radius: 28px; }
.sw-stk--locked .sw-stk-pic canvas { opacity: .9; }
.sw-stk-name { font-size: 15px; font-weight: 700; color: var(--sw-ink); line-height: 1.1; text-align: center; max-width: 124px; }
.sw-stk-sub { font-size: 12.5px; font-weight: 600; color: #9C7BFF; line-height: 1.15; text-align: center; max-width: 124px; }
.sw-stk--locked .sw-stk-name { color: #8E7DB8; }
.sw-stk--locked .sw-stk-sub { color: #A796CC; }
.sw-stk-new { position: absolute; top: -2px; right: -6px; padding: 1px 8px; border-radius: 999px; background: var(--sw-pink); color: #fff; font-size: 12px; font-weight: 700; border: 2px solid #fff; box-shadow: 0 2px 6px var(--sw-shadow); animation: sw-twinkle 1.4s ease-in-out infinite; }

.sw-sb-nav { display: flex; align-items: center; justify-content: center; gap: 14px; }
.sw-sb-dots { display: flex; gap: 8px; }
.sw-sb-dots span { width: 14px; height: 14px; border-radius: 50%; background: var(--sw-lav-soft); border: 2px solid #fff; box-shadow: 0 2px 5px var(--sw-shadow); }
.sw-sb-dots span.sw-on { background: var(--sw-pink); transform: scale(1.2); }
.sw-sb-nav .sw-btn[disabled] { visibility: hidden; }

.sw-sb-detail { position: absolute; inset: -8px; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 16px;
  background: radial-gradient(circle at 50% 40%, rgba(255,247,252,.97), rgba(243,234,255,.97)); border-radius: 24px; animation: sw-fade .2s ease-out; text-align: center; }
.sw-sb-detail[hidden] { display: none; }
.sw-sb-detail .sw-stk-pic { width: min(230px, 52vw); height: min(230px, 52vw); animation: sw-pop .4s var(--sw-bounce); }
.sw-sb-detail h3 { margin: 4px 0 0; font-size: 30px; color: var(--sw-pink); }
.sw-sb-detail p { margin: 0 0 8px; font-size: 19px; font-weight: 600; color: var(--sw-ink); }

@media (max-width: 700px) {
  .sw-sb-rings, .sw-sb-right { display: none; }
  .sw-sb-left { border-radius: 18px; }
  .sw-sb-page { min-height: 0; }
  .sw-stk-pic { width: 84px; height: 84px; }
  .sw-stk-name, .sw-stk-sub { max-width: 100px; }
  .sw-stk-name { font-size: 14px; }
  .sw-sb-count { font-size: 19px; }
  .sw-sb-nav { gap: 8px; }
  .sw-sb-nav .sw-btn { padding: 4px 14px; min-height: 48px; font-size: 18px; }
}
`;

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function install(game) {
  const ui = game.ui;
  if (!ui) return;
  ui.addStyles(CSS);
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 700px)') : null;
  const single = () => !!(mq && mq.matches);

  let root = null, spread = null, pages = [], countEl = null, barEl = null, dotsEl = null, prevBtn = null, nextBtn = null, detail = null;
  let view = 0, list = [], unseen = new Set();

  const pageCount = () => Math.max(1, Math.ceil(list.length / PER_PAGE));
  const viewCount = () => (single() ? pageCount() : Math.ceil(pageCount() / 2));

  function stickerEl(s, i, big = false) {
    const locked = !s.earned;
    const b = ui.el(big ? 'div' : 'button', `sw-stk ${locked ? 'sw-stk--locked' : 'sw-stk--got'}`);
    if (!big) {
      b.type = 'button';
      b.setAttribute('aria-label', locked ? `${s.name}: ${s.hint}` : s.name);
      b.dataset.sticker = s.id;
    }
    const pic = ui.el('span', 'sw-stk-pic');
    pic.style.setProperty('--tilt', `${big ? 0 : TILTS[i % TILTS.length]}deg`);
    pic.appendChild(game.stickers.canvas(s.id, { locked }));
    if (!locked) {
      // a white copy of the sticker outline, shown through a moving gradient mask = a shine
      const sh = game.stickers.shape(s.id);
      sh.classList.add('sw-stk-shine');
      sh.style.animationDelay = `${(i % 5) * 0.6}s`;
      pic.appendChild(sh);
      if (!big && unseen.has(s.id)) pic.appendChild(ui.el('span', 'sw-stk-new', 'NEW!'));
    }
    b.appendChild(pic);
    if (!big) {
      b.appendChild(ui.el('span', 'sw-stk-name', s.name));
      b.appendChild(ui.el('span', 'sw-stk-sub', locked ? s.hint : fmtDate(s.earned)));
      b.addEventListener('click', () => showDetail(s, i));
    }
    return b;
  }

  function fillPage(page, index) {
    page.el.innerHTML = '';
    const items = list.slice(index * PER_PAGE, index * PER_PAGE + PER_PAGE);
    page.el.classList.toggle('sw-sb-empty', !items.length);
    if (!items.length) return;
    page.el.appendChild(ui.el('div', 'sw-sb-ptitle', PAGE_TITLES[index % PAGE_TITLES.length]));
    const grid = ui.el('div', 'sw-sb-grid');
    items.forEach((s, k) => grid.appendChild(stickerEl(s, index * PER_PAGE + k)));
    page.el.appendChild(grid);
    page.el.appendChild(ui.el('div', 'sw-sb-pno', String(index + 1)));
  }

  function render(dir = 0) {
    if (!root) return;
    const vc = viewCount();
    view = Math.max(0, Math.min(view, vc - 1));
    const first = single() ? view : view * 2;
    fillPage(pages[0], first);
    if (!single()) fillPage(pages[1], first + 1);
    const got = list.filter((s) => s.earned).length;
    countEl.innerHTML = `${icon('star')}<span><b>${got}</b> of ${list.length} stickers</span>`;
    barEl.style.width = `${list.length ? Math.round((got / list.length) * 100) : 0}%`;
    dotsEl.innerHTML = '';
    for (let i = 0; i < vc; i++) dotsEl.appendChild(ui.el('span', i === view ? 'sw-on' : ''));
    prevBtn.disabled = view <= 0;
    nextBtn.disabled = view >= vc - 1;
    if (dir) {
      spread.classList.remove('sw-flip-next', 'sw-flip-prev');
      void spread.offsetWidth;
      spread.classList.add(dir > 0 ? 'sw-flip-next' : 'sw-flip-prev');
    }
  }

  function turn(dir) {
    const vc = viewCount();
    const next = Math.max(0, Math.min(vc - 1, view + dir));
    if (next === view) return;
    view = next;
    game.audio.play('page');
    hideDetail();
    render(dir);
  }

  function showDetail(s, i) {
    detail.innerHTML = '';
    detail.appendChild(stickerEl(s, i, true));
    detail.appendChild(ui.el('h3', '', s.name));
    detail.appendChild(ui.el('p', '', s.earned ? `You earned it on ${fmtDate(s.earned)}!` : `How to get it: ${s.hint}`));
    detail.appendChild(ui.button({ icon: 'check', label: 'OK!', variant: s.earned ? 'pink' : 'lav', onClick: hideDetail }));
    detail.hidden = false;
    game.audio.play(s.earned ? 'sparkle' : 'pop');
  }

  function hideDetail() {
    if (detail) detail.hidden = true;
  }

  function onKey(e) {
    if (!ui.isOpen('stickers') || ui.dialogOpen) return;
    if (e.key === 'ArrowRight') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  }

  // [{ key, build(el), refresh() }] registered by other modules on game:ready (ocean: Sea Friends)
  if (!game.stickerBookExtras) game.stickerBookExtras = [];
  let extrasEl = null;
  const extrasBuilt = new Set();

  ui.registerPanel('stickers', {
    title: 'Sticker Book',
    icon: 'sticker',
    width: 1000,
    back: (g) => (g.mode === 'title' && ui.hasPanel('title') ? 'title' : null),
    build(container) {
      root = ui.el('div', 'sw-sb');
      const top = ui.el('div', 'sw-sb-top');
      countEl = ui.el('div', 'sw-sb-count');
      const bar = ui.el('div', 'sw-sb-bar');
      barEl = ui.el('i');
      bar.appendChild(barEl);
      top.append(countEl, bar);
      const book = ui.el('div', 'sw-sb-book');
      spread = ui.el('div', 'sw-sb-spread');
      const left = { el: ui.el('div', 'sw-sb-page sw-sb-left') };
      const right = { el: ui.el('div', 'sw-sb-page sw-sb-right') };
      const rings = ui.el('div', 'sw-sb-rings');
      for (let i = 0; i < 7; i++) rings.appendChild(ui.el('i'));
      spread.append(left.el, rings, right.el);
      pages = [left, right];
      book.appendChild(spread);
      // swipe to turn pages
      let sx = null, sy = 0;
      book.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
      book.addEventListener('pointerup', (e) => {
        if (sx === null) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        sx = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(dx < 0 ? 1 : -1);
      });
      const nav = ui.el('div', 'sw-sb-nav');
      prevBtn = ui.button({ icon: 'back', label: 'Back', variant: 'lav', onClick: () => turn(-1) });
      prevBtn.classList.add('sw-sb-prev');
      nextBtn = ui.button({ icon: 'play', label: 'Next', variant: 'pink', onClick: () => turn(1) });
      nextBtn.classList.add('sw-sb-next');
      dotsEl = ui.el('div', 'sw-sb-dots');
      nav.append(prevBtn, dotsEl, nextBtn);
      detail = ui.el('div', 'sw-sb-detail');
      detail.hidden = true;
      detail.addEventListener('click', (e) => { if (e.target === detail) hideDetail(); });
      // extra rows under the pages, built on first open (game.stickerBookExtras: the Sea Friends)
      extrasEl = ui.el('div', 'sw-sb-extras');
      root.append(top, book, nav, extrasEl, detail);
      container.appendChild(root);
      if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (ui.isOpen('stickers')) render(); });
    },
    onOpen(args) {
      list = game.stickers ? game.stickers.all() : [];
      unseen = new Set(game.stickers && game.stickers.unseen ? game.stickers.unseen() : []);
      hideDetail();
      // open on the page with the newest sticker
      let page = 0;
      if (args && args.sticker) page = Math.max(0, list.findIndex((s) => s.id === args.sticker)) / PER_PAGE | 0;
      else if (unseen.size) page = Math.max(0, list.findIndex((s) => unseen.has(s.id))) / PER_PAGE | 0;
      view = single() ? page : page >> 1;
      render();
      for (const x of game.stickerBookExtras || []) {
        if (!extrasBuilt.has(x)) { const el = ui.el('div', 'sw-sb-extra'); extrasEl.appendChild(el); x.build(el); extrasBuilt.add(x); }
        if (x.refresh) x.refresh();
      }
      if (game.stickers && game.stickers.markSeen) game.stickers.markSeen();
      document.addEventListener('keydown', onKey);
    },
    onClose() {
      hideDetail();
      document.removeEventListener('keydown', onKey);
    },
  });

  game.registerAction('stickers', (g) => g.ui.toggle('stickers'));
}
