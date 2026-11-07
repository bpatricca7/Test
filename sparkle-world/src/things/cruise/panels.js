// The cruise's panels:
//   cruise-play   the mini games (games.js) on one canvas: a hint and a big Play button, the
//                 round, then a cheer with the score and the best kept (index.js keeps scores
//                 and pays the daily coins)
//   cruise-lift   big deck buttons (top deck first); a "ding", a short fade and she is there
//   cruise-board  "What's On": the ship's activities with pictures; "Take me there" (a fade)

import { makeGame, W, H } from './games.js';
import { rng } from './logic.js';
import { crIcon } from './art.js';
import { icon2 } from '../../ui/menus/icons2.js';

const CHEERS = ['Great job!', 'Hooray!', 'Super!', 'Wonderful!', 'You did it!', 'Amazing!'];

export const CSS = /* css */ `
.cr-icon { width: 1.2em; height: 1.2em; flex: none; }
.cr-play { display: flex; flex-direction: column; gap: 10px; }
.cr-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cr-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; background: #fff; border: 3px solid var(--sw-pink-soft, #FFD1E6); font-size: 19px; font-weight: 700; color: var(--sw-ink); white-space: nowrap; }
.cr-chip .cr-icon { color: #FFB300; }
.cr-chip--time { margin-left: auto; border-color: #A6D8FF; }
.cr-chip--time.cr-low { animation: cr-pulse .6s ease-in-out infinite; border-color: #FFC94D; }
.cr-stage { position: relative; width: 100%; aspect-ratio: ${W} / ${H}; max-height: calc(100vh - 250px); margin: 0 auto; border-radius: 22px; overflow: hidden; border: 4px solid #fff; box-shadow: 0 6px 18px rgba(58,31,77,.18); background: #22205E; touch-action: none; }
.cr-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: pointer; }
.cr-over { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; text-align: center; background: rgba(58,31,77,.42); color: #fff; }
.cr-over[hidden] { display: none; }
.cr-over-title { font-size: 40px; font-weight: 700; text-shadow: 0 3px 0 rgba(58,31,77,.5); line-height: 1.1; }
.cr-over-hint { font-size: 22px; font-weight: 600; max-width: 520px; text-shadow: 0 2px 0 rgba(58,31,77,.5); }
.cr-over-score { font-size: 64px; font-weight: 700; color: #FFE070; text-shadow: 0 4px 0 rgba(58,31,77,.5); line-height: 1; }
.cr-over-best { font-size: 20px; font-weight: 700; padding: 4px 16px; border-radius: 999px; background: rgba(255,255,255,.92); color: var(--sw-ink); }
.cr-over-best.cr-new { background: #FFE070; animation: cr-pulse .8s ease-in-out infinite; }
.cr-over-row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.cr-actions { display: flex; justify-content: center; min-height: 68px; }
.cr-actions .sw-btn { min-width: 220px; }
.cr-actions[hidden] { display: none; }
.cr-confetti { position: absolute; width: 10px; height: 14px; border-radius: 3px; pointer-events: none; animation: cr-confetti 1.4s cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes cr-confetti { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
@keyframes cr-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
.cr-lift { display: flex; flex-direction: column; gap: 12px; }
.cr-lift-btn.sw-btn { justify-content: flex-start; width: 100%; font-size: 26px; min-height: 72px; }
.cr-lift-btn .cr-num { display: inline-grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; background: rgba(255,255,255,.9); color: var(--sw-ink); font-size: 24px; flex: none; text-shadow: none; }
.cr-lift-btn.cr-here { filter: saturate(.5); }
.cr-lift-here { margin-left: auto; font-size: 17px; padding: 3px 12px; border-radius: 999px; background: rgba(255,255,255,.85); color: var(--sw-ink); text-shadow: none; }
.cr-board { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.cr-act { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 10px 12px; border-radius: 24px; background: #fff; border: 4px solid var(--ac); box-shadow: 0 4px 10px rgba(58,31,77,.12); }
.cr-act-pic { width: 76px; height: 76px; border-radius: 22px; display: grid; place-items: center; background: var(--ac); color: #fff; box-shadow: inset 0 -4px 0 rgba(0,0,0,.12); }
.cr-act-pic .cr-icon { width: 50px; height: 50px; }
.cr-act-name { font-size: 22px; font-weight: 700; color: var(--sw-ink); text-align: center; }
.cr-act .sw-btn { width: 100%; font-size: 18px; }
.cr-empty { font-size: 21px; font-weight: 600; text-align: center; padding: 20px; color: var(--sw-ink); }
@media (max-width: 600px) {
  .cr-over-title { font-size: 30px; }
  .cr-over-score { font-size: 48px; }
  .cr-over-hint { font-size: 18px; }
  .cr-chip { font-size: 16px; padding: 4px 10px; }
  .cr-stage { max-height: calc(100vh - 210px); }
}
`;

/** A chunky ui button with one of our pictures. */
function btn(ui, { pic, label, variant = 'pink', size = 'big', onClick, className = '' }) {
  const b = ui.button({ label, variant, size, onClick, className });
  if (pic) b.insertAdjacentHTML('afterbegin', crIcon(pic));
  return b;
}

/**
 * Register the three panels. env: { sfx, finish(key, score) -> { best, isBest },
 * goLift(stop, args), board() -> [{ key, name, icon, color, go() }] }.
 */
export function installPanels(game, env) {
  const ui = game.ui;
  if (!ui || typeof ui.registerPanel !== 'function') return;
  ui.addStyles(CSS);
  installPlay(game, ui, env);
  installLift(game, ui, env);
  installBoard(game, ui, env);
}

// ---------- the game panel ----------

function installPlay(game, ui, env) {
  const P = {
    root: null, canvas: null, ctx: null, stage: null, over: null, actions: null, act: null,
    status: null, timeChip: null, bestChip: null,
    key: null, opts: null, g: null, state: 'idle', raf: 0, last: 0, left: 0, w: 0, h: 0, seed: 1,
  };

  const resize = () => {
    const c = P.canvas;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (w !== P.w || h !== P.h) {
      P.w = w;
      P.h = h;
      c.width = w;
      c.height = h;
    }
  };

  const draw = () => {
    if (!P.g || !P.ctx) return;
    resize();
    const c = P.ctx;
    c.setTransform(P.w / W, 0, 0, P.h / H, 0, 0);
    try {
      P.g.draw(c);
    } catch (err) {
      console.warn('[cruise] draw failed', err);
    }
  };

  const chips = () => {
    if (!P.g) return;
    P.status.textContent = P.g.status();
    if (P.g.time) {
      P.timeChip.hidden = false;
      const s = Math.max(0, Math.ceil(P.left));
      P.timeChip.lastChild.textContent = `${s}`;
      P.timeChip.classList.toggle('cr-low', s <= 5 && P.state === 'play');
    } else P.timeChip.hidden = true;
  };

  const loop = (now) => {
    P.raf = 0;
    if (P.state !== 'play' && P.state !== 'ready') return;
    const dt = Math.min(0.05, Math.max(0, (now - P.last) / 1000));
    P.last = now;
    if (P.state === 'play' && P.g) {
      if (P.g.time && !P.timeUp) {
        P.left -= dt;
        if (P.left <= 0) {
          P.left = 0;
          P.timeUp = true;
          P.g.timeUp();
        }
      }
      try {
        P.g.update(dt);
      } catch (err) {
        console.warn('[cruise] game update failed', err);
        P.g.finished = true;
      }
      chips();
      if (P.g.finished) {
        draw();
        finish();
        return;
      }
    }
    draw();
    P.raf = requestAnimationFrame(loop);
  };

  const run = () => {
    if (!P.raf) {
      P.last = performance.now();
      P.raf = requestAnimationFrame(loop);
    }
  };

  const stop = () => {
    if (P.raf) cancelAnimationFrame(P.raf);
    P.raf = 0;
  };

  const newGame = () => {
    P.seed = (P.seed * 1103515245 + 12345 + Date.now()) >>> 0;
    P.g = makeGame(P.key, { sfx: env.sfx, rand: rng(P.seed), opts: P.opts || {} });
    P.left = P.g.time || 0;
    P.timeUp = false;
    ui.setTitle('cruise-play', P.g.title);
    const best = env.best ? env.best(P.key) : 0;
    P.bestChip.lastChild.textContent = best > 0 ? `Best ${best}` : 'Best -';
    chips();
  };

  const showReady = () => {
    P.state = 'ready';
    newGame();
    P.over.innerHTML = '';
    P.over.hidden = false;
    P.over.append(ui.el('div', 'cr-over-title', P.g.title), ui.el('div', 'cr-over-hint', P.g.hint));
    const go = btn(ui, { pic: 'go', label: 'Play!', variant: 'mint', onClick: start });
    P.over.appendChild(go);
    P.actions.hidden = true;
    run();
  };

  const start = () => {
    if (P.state !== 'ready') return;
    P.state = 'play';
    P.over.hidden = true;
    P.over.innerHTML = '';
    if (P.g.act) {
      P.actions.hidden = false;
      P.act.lastChild.textContent = P.g.act;
    } else P.actions.hidden = true;
    game.audio.play('pop');
    run();
  };

  const confetti = () => {
    const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#4FB8FF', '#9C7BFF'];
    for (let i = 0; i < 36; i++) {
      const d = ui.el('div', 'cr-confetti');
      d.style.left = `${50 + (Math.random() - 0.5) * 20}%`;
      d.style.top = '45%';
      d.style.background = cols[i % cols.length];
      d.style.setProperty('--dx', `${(Math.random() - 0.5) * 520}px`);
      d.style.setProperty('--dy', `${-60 - Math.random() * 220}px`);
      d.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
      P.stage.appendChild(d);
      setTimeout(() => d.remove(), 1500);
    }
  };

  const finish = () => {
    P.state = 'done';
    P.actions.hidden = true;
    const res = P.g.result();
    let rec = { best: res.score, isBest: false };
    try {
      rec = env.finish(P.key, res.score) || rec;
    } catch (err) {
      console.warn('[cruise] finish failed', err);
    }
    env.sfx.cheer();
    confetti();
    P.over.innerHTML = '';
    P.over.hidden = false;
    P.over.append(
      ui.el('div', 'cr-over-title', CHEERS[Math.floor(Math.random() * CHEERS.length)]),
      ui.el('div', 'cr-over-score', String(res.score)),
      ui.el('div', 'cr-over-hint', res.line),
    );
    const best = ui.el('div', 'cr-over-best' + (rec.isBest && res.score > 0 ? ' cr-new' : ''), rec.isBest && res.score > 0 ? 'New best!' : `Best ${rec.best}`);
    P.over.appendChild(best);
    P.bestChip.lastChild.textContent = `Best ${rec.best}`;
    const row = ui.el('div', 'cr-over-row');
    row.append(
      btn(ui, { pic: 'again', label: 'Again!', variant: 'mint', onClick: showReady }),
      btn(ui, { pic: 'done', label: 'Done', variant: 'white', onClick: () => ui.close() }),
    );
    P.over.appendChild(row);
  };

  const onKey = (e) => {
    if (!ui.isOpen('cruise-play')) return;
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (P.state === 'ready') start();
    else if (P.state === 'play' && P.g && P.g.act) P.g.action();
    else return;
    e.preventDefault();
  };

  ui.registerPanel('cruise-play', {
    title: 'Play!',
    icon: 'star',
    width: 920,
    build(container) {
      P.root = ui.el('div', 'cr-play');
      const bar = ui.el('div', 'cr-bar');
      P.status = ui.el('span', 'cr-chip');
      P.timeChip = ui.el('span', 'cr-chip cr-chip--time');
      P.timeChip.innerHTML = icon2('clock');
      P.timeChip.appendChild(ui.el('span', '', '40'));
      P.bestChip = ui.el('span', 'cr-chip');
      P.bestChip.innerHTML = crIcon('star');
      P.bestChip.appendChild(ui.el('span', '', 'Best -'));
      bar.append(P.status, P.timeChip, P.bestChip);
      P.stage = ui.el('div', 'cr-stage');
      P.canvas = ui.el('canvas');
      P.canvas.setAttribute('aria-label', 'Game');
      P.ctx = P.canvas.getContext('2d');
      P.over = ui.el('div', 'cr-over');
      P.stage.append(P.canvas, P.over);
      P.canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (P.state === 'ready') {
          start();
          return;
        }
        if (P.state !== 'play' || !P.g) return;
        const r = P.canvas.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
        try {
          P.g.tap(x, y);
        } catch (err) {
          console.warn('[cruise] tap failed', err);
        }
      });
      P.actions = ui.el('div', 'cr-actions');
      P.act = btn(ui, { pic: 'throw', label: 'Go!', variant: 'pink', onClick: () => { if (P.state === 'play' && P.g) P.g.action(); } });
      P.actions.appendChild(P.act);
      P.actions.hidden = true;
      P.root.append(bar, P.stage, P.actions);
      container.appendChild(P.root);
      if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
    },
    onOpen(args) {
      const a = args || {};
      P.key = a.game || 'star';
      P.opts = a.opts || {};
      const pic = { hoops: 'throw', ring: 'ring', shuffle: 'puck', golf: 'putt' }[P.key] || 'throw';
      P.act.querySelector('.cr-icon').outerHTML = crIcon(pic);
      showReady();
    },
    onClose() {
      stop();
      P.state = 'idle';
      P.g = null;
      if (P.over) P.over.innerHTML = '';
    },
  });

  if (game.debug && game.debug.cruise) game.debug.cruise.play = () => P;
  env.playState = () => P;
}

// ---------- the lift ----------

function installLift(game, ui, env) {
  const L = { list: null, args: null };
  ui.registerPanel('cruise-lift', {
    title: 'Which deck?',
    icon: 'up',
    width: 520,
    build(container) {
      L.list = ui.el('div', 'cr-lift');
      container.appendChild(L.list);
    },
    onOpen(args) {
      L.args = args || { stops: [] };
      L.list.innerHTML = '';
      const stops = (L.args.stops || []).slice().sort((a, b) => b.y - a.y);
      const cols = ['sky', 'pink', 'mint', 'sun', 'lav'];
      stops.forEach((s, i) => {
        const here = L.args.here && L.args.here.uid === s.uid;
        const b = ui.button({ variant: cols[i % cols.length], size: 'big', className: 'cr-lift-btn' + (here ? ' cr-here' : ''), onClick: () => {
          if (here) {
            ui.close();
            return;
          }
          ui.close();
          env.goLift(s, L.args);
        } });
        const num = ui.el('span', 'cr-num', String(stops.length - i));
        b.append(num, ui.el('span', 'sw-btn-label', s.name));
        if (here) b.appendChild(ui.el('span', 'cr-lift-here', 'You are here'));
        L.list.appendChild(b);
      });
    },
  });
}

// ---------- the "What's On" board ----------

function installBoard(game, ui, env) {
  const B = { grid: null };
  ui.registerPanel('cruise-board', {
    title: "What's On",
    icon: 'star',
    width: 820,
    build(container) {
      B.grid = ui.el('div', 'cr-board');
      container.appendChild(B.grid);
    },
    onOpen() {
      B.grid.innerHTML = '';
      let list = [];
      try {
        list = env.board() || [];
      } catch (err) {
        console.warn('[cruise] board failed', err);
      }
      if (!list.length) {
        B.grid.appendChild(ui.el('div', 'cr-empty', 'Build fun things from the Cruise Fun tab in your Bag, and they show up here!'));
        return;
      }
      for (const a of list) {
        const card = ui.el('div', 'cr-act');
        card.style.setProperty('--ac', a.color);
        const pic = ui.el('div', 'cr-act-pic');
        pic.innerHTML = crIcon(a.icon);
        card.append(pic, ui.el('div', 'cr-act-name', a.name));
        card.appendChild(btn(ui, { pic: 'go', label: a.here ? "You're here!" : 'Take me there', variant: a.here ? 'white' : 'sky', size: 'small', onClick: () => {
          ui.close();
          if (!a.here) a.go();
        } }));
        B.grid.appendChild(card);
      }
    },
  });
}
