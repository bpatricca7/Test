// Emote wheel: the 'emotes' action (HUD Emotes button, G key) opens a round menu of big emote
// buttons, each pictured with YOUR avatar doing that emote (rendered once per look). Picking
// one closes the wheel and calls game.player.emote(name). Keys 1-7 pick, G / Esc close.

import { EMOTES, normalizeLook } from './wardrobe-data.js';
import { getStage } from '../ui/dressup/stage.js';
import { picture } from '../ui/dressup/pictures.js';

// the moment of each emote shown in its picture, and how to frame it
const SHOTS = {
  wave: { t: 0.8, frame: { cy: 1.25, span: 1.55, yaw: 0.25, pitch: 0.1 } },
  dance: { t: 0.6, frame: { cy: 1.2, span: 1.75, yaw: 0.3, pitch: 0.1 } },
  twirl: { t: 1.35, frame: { cy: 1.05, span: 1.95, yaw: 0.2, pitch: 0.1 } },
  cartwheel: { t: 0.62, frame: { cy: 1.05, span: 2.05, yaw: 0.15, pitch: 0.1 } },
  jump: { t: 0.47, frame: { cy: 1.35, span: 2.0, yaw: 0.25, pitch: 0.1 } },
  heart: { t: 1.0, frame: { cy: 1.22, span: 1.25, yaw: 0.25, pitch: 0.08 } },
  sit: { t: 2.0, frame: { cy: 0.66, span: 1.55, yaw: 0.5, pitch: 0.25 } },
};

const SOUNDS = { wave: 'pop', dance: 'note:72', twirl: 'magic', cartwheel: 'whoosh', jump: 'jump', heart: 'pet', sit: 'pop' };

export function install(game) {
  const ui = game.ui;
  if (!ui) return;
  const stage = getStage();
  let wheel = null;
  let buttons = [];
  let wasOpen = false; // was the wheel open before the current key press?

  function pick(name) {
    const p = game.player;
    ui.close();
    if (!p) return;
    if (p.state === 'sit' || p.state === 'sleep' || p.state === 'ride') {
      game.toast('Stand up first, then try again!', { icon: 'emote' });
      return;
    }
    if (p.swimming) {
      game.toast('Swim to the shore first!', { icon: 'emote' });
      return;
    }
    p.emote(name);
    game.audio.play(SOUNDS[name] || 'sparkle');
  }

  function refreshPictures() {
    const look = normalizeLook(game.profile.look);
    const sig = JSON.stringify(look);
    for (const b of buttons) {
      const shot = SHOTS[b.name];
      const key = `emote|${b.name}|${sig}`;
      if (b.key === key) continue;
      b.key = key;
      stage.snapshot(key, look, { frame: shot.frame, pose: { emote: b.name, t: shot.t }, size: 176 }).then((canvas) => {
        if (b.key !== key || !canvas) {
          if (!canvas && b.key === key) b.key = null;
          return;
        }
        const g = b.canvas.getContext('2d');
        g.clearRect(0, 0, 176, 176);
        g.drawImage(canvas, 0, 0);
        b.canvas.hidden = false;
        b.fallback.hidden = true;
      });
    }
  }

  ui.registerPanel('emotes', {
    fullscreen: true,
    title: 'Emotes',
    build(container) {
      const root = ui.el('div', 'sw-emo');
      const dim = ui.el('div', 'sw-emo-dim');
      dim.addEventListener('pointerdown', () => ui.close());
      wheel = ui.el('div', 'sw-emo-wheel');
      wheel.appendChild(ui.el('div', 'sw-emo-ring'));
      wheel.appendChild(ui.el('div', 'sw-emo-title', 'Emotes'));
      buttons = EMOTES.map((e, i) => {
        const b = ui.el('button', 'sw-emo-btn');
        b.type = 'button';
        b.dataset.emote = e.key;
        b.setAttribute('aria-label', e.name);
        const deg = -90 + (i / EMOTES.length) * 360;
        b.style.transform = `rotate(${deg.toFixed(2)}deg) translateX(var(--r)) rotate(${(-deg).toFixed(2)}deg)`;
        const face = ui.el('span', 'sw-emo-face');
        const c = document.createElement('canvas');
        c.width = c.height = 176;
        c.hidden = true;
        const fb = ui.el('span', '');
        fb.innerHTML = picture(e.key, 60);
        face.append(fb, c);
        const key = ui.el('span', 'sw-emo-key', String(i + 1));
        b.append(face, ui.el('span', 'sw-emo-label', e.name), key);
        b.addEventListener('click', () => pick(e.key));
        wheel.appendChild(b);
        return { name: e.key, b, canvas: c, fallback: fb, key: null };
      });
      const close = ui.button({ icon: 'close', variant: 'white', size: 'icon', className: 'sw-emo-close', title: 'Close', onClick: () => ui.close() });
      wheel.appendChild(close);
      root.append(dim, wheel);
      container.appendChild(root);
    },
    onOpen() {
      game.container.classList.toggle('sw-touch-ui', !!game.input.touchMode);
      refreshPictures();
    },
  });

  game.registerAction('emotes', (g) => {
    if (g.mode !== 'play' || !g.player) return false;
    if (g.ui.isOpen('emotes')) {
      g.ui.close();
      return true;
    }
    if (g.ui.current && g.ui.current !== 'emotes') return false;
    g.audio.play('pop');
    return g.ui.open('emotes');
  });

  // while the wheel is open: 1-7 pick, G closes (the game ignores keys while paused). The
  // capture listener notes the state before the game sees the key, so the G press that opens
  // the wheel does not also close it.
  window.addEventListener('keydown', () => { wasOpen = ui.isOpen('emotes'); }, true);
  game.input.on('key', (e) => {
    if (!e.down || e.repeat || !wasOpen || !ui.isOpen('emotes') || ui.dialogOpen) return;
    if (e.code === 'KeyG') {
      ui.close();
      return;
    }
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) {
      const em = EMOTES[Number(m[1]) - 1];
      if (em) pick(em.key);
    }
  });

  // warm the pictures up after dressing up, so the wheel opens with them ready
  game.events.on('outfit:changed', () => { if (game.mode === 'play' && buttons.length) refreshPictures(); });
}
