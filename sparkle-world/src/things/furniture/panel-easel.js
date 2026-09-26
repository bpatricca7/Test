// The Easel panel ('easel'): paint a 16x16 pixel picture with big color buttons (brush,
// fill bucket, undo, clear), then "Done" hangs it on the easel (entity data.pic).
// Also the Mailbox letter panel ('letter'): a friendly note from a random friend.

import { icon } from '../../ui/icons.js';
import { EASEL_COLORS, DEFAULT_PIC } from './models-garden.js';
import { escapeHtml } from '../../core/util.js';

const CSS = /* css */ `
.sw-easel { display: flex; gap: 16px; align-items: flex-start; justify-content: center; flex-wrap: wrap; }
.sw-easel-canvas { width: min(416px, 78vw, 52vh); aspect-ratio: 1; image-rendering: pixelated; border-radius: 12px; border: 8px solid #E7BE8C; box-shadow: 0 8px 20px var(--sw-shadow); touch-action: none; cursor: crosshair; background: #fff; }
.sw-easel-side { display: flex; flex-direction: column; gap: 12px; align-items: center; max-width: 300px; }
.sw-easel-colors { display: grid; grid-template-columns: repeat(4, 56px); gap: 8px; }
.sw-paint { width: 56px; height: 56px; border-radius: 50%; border: 4px solid #fff; background: var(--c); box-shadow: 0 4px 10px var(--sw-shadow); cursor: pointer; transition: transform .15s var(--sw-bounce); }
.sw-paint.sw-sel { transform: scale(1.12); box-shadow: 0 0 0 5px var(--sw-sun), 0 6px 14px var(--sw-shadow); }
.sw-easel-tools { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sw-easel-tools .sw-btn.sw-sel { box-shadow: 0 0 0 5px var(--sw-sun), 0 6px 14px var(--sw-shadow); }
.sw-letter { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.sw-letter-paper { position: relative; width: min(520px, 100%); padding: 28px 30px 30px; border-radius: 18px; background: repeating-linear-gradient(#FFFDF6 0 38px, #FFE3F0 38px 40px); border: 5px solid #FFD1E6; box-shadow: 0 10px 26px var(--sw-shadow); animation: sw-letter-in .6s var(--sw-bounce); font-size: clamp(21px, 3vw, 27px); line-height: 40px; color: var(--sw-ink); font-weight: 600; }
.sw-letter-paper .sw-stamp { position: absolute; top: -18px; right: 18px; width: 64px; height: 72px; border-radius: 8px; background: var(--sw-sky); border: 4px dashed #fff; display: grid; place-items: center; color: #fff; transform: rotate(8deg); box-shadow: 0 4px 10px var(--sw-shadow); }
.sw-letter-paper .sw-stamp svg { width: 36px; height: 36px; }
.sw-letter-from { text-align: right; color: var(--sw-pink); margin-top: 8px; }
@keyframes sw-letter-in { 0% { transform: translateY(60px) scale(.5) rotate(-6deg); opacity: 0; } 100% { transform: none; opacity: 1; } }
`;

const SENDERS = [['Bunny', 'heart'], ['Kitty', 'heart'], ['the Moon', 'moon'], ['Sunny the Sun', 'sun'], ['a Unicorn', 'sparkle'], ['Grandma Owl', 'star'], ['Little Star', 'star'], ['the Flowers', 'sparkle'], ['Puppy', 'heart'], ['the Fairies', 'sparkle']];
const NOTES = [
  'You are a super builder! Your world is so pretty.',
  'Thank you for being so kind. You make everyone smile!',
  'I love your house. Can I come for a tea party?',
  'You are brave, smart and full of sparkles!',
  'Did you know? Your laugh is the best sound in the whole world.',
  'Remember to give yourself a big hug today!',
  'Your outfit today is SO cool. You have great style!',
  'I think you are amazing, just the way you are.',
  'Let us have a picnic on the grass soon!',
  'Every flower in the meadow says hello to you!',
  'You make the world a little bit brighter.',
  'Sweet dreams tonight. I will twinkle just for you.',
  'You can do anything you put your mind to!',
  'Thank you for being my friend.',
  'Your cooking smells yummy all the way up here!',
  'I saw you dancing. It made me dance too!',
];

export function installEasel(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  let entity = null, grid = null, color = 1, tool = 'brush', canvas, ctx, swatches = [], toolBtns = {};
  const history = [];

  function draw() {
    for (let i = 0; i < 256; i++) {
      ctx.fillStyle = EASEL_COLORS[grid[i]];
      ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }
  }
  function pushUndo() {
    history.push(grid.slice());
    if (history.length > 15) history.shift();
  }
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * 16);
    const y = Math.floor(((e.clientY - r.top) / r.height) * 16);
    return x >= 0 && y >= 0 && x < 16 && y < 16 ? y * 16 + x : -1;
  }
  function fill(i) {
    const from = grid[i];
    if (from === color) return;
    const stack = [i];
    while (stack.length) {
      const j = stack.pop();
      if (grid[j] !== from) continue;
      grid[j] = color;
      const x = j % 16, y = Math.floor(j / 16);
      if (x > 0) stack.push(j - 1);
      if (x < 15) stack.push(j + 1);
      if (y > 0) stack.push(j - 16);
      if (y < 15) stack.push(j + 16);
    }
  }
  function paintAt(e, first) {
    const i = cellAt(e);
    if (i < 0) return;
    if (tool === 'fill') {
      if (!first) return;
      fill(i);
      game.audio.play('pop', { pitch: 0.8 });
    } else if (grid[i] !== color) {
      grid[i] = color;
      game.audio.play('click', { pitch: 1.4 + (i % 16) * 0.03, volume: 0.5 });
    }
    draw();
  }
  function selectColor(i) {
    color = i;
    swatches.forEach((s, j) => s.classList.toggle('sw-sel', j === i));
  }
  function selectTool(t) {
    tool = t;
    for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('sw-sel', k === t);
  }

  ui.registerPanel('easel', {
    title: 'Paint a Picture',
    icon: 'pencil',
    width: 820,
    build(container) {
      const wrap = ui.el('div', 'sw-easel');
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.className = 'sw-easel-canvas';
      ctx = canvas.getContext('2d');
      let down = false;
      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        down = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        pushUndo();
        paintAt(e, true);
      });
      canvas.addEventListener('pointermove', (e) => { if (down) paintAt(e, false); });
      const up = () => { down = false; };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      const side = ui.el('div', 'sw-easel-side');
      const colors = ui.el('div', 'sw-easel-colors');
      swatches = EASEL_COLORS.map((c, i) => {
        const b = ui.el('button', 'sw-paint');
        b.type = 'button';
        b.style.setProperty('--c', c);
        b.setAttribute('aria-label', 'Color ' + (i + 1));
        b.dataset.color = i;
        b.addEventListener('click', () => { game.audio.play('pop', { pitch: 1.2 }); selectColor(i); });
        colors.appendChild(b);
        return b;
      });
      const tools = ui.el('div', 'sw-easel-tools');
      toolBtns.brush = ui.button({ icon: 'pencil', label: 'Brush', variant: 'white', size: 'small', onClick: () => selectTool('brush') });
      toolBtns.fill = ui.button({ icon: 'sparkle', label: 'Fill', variant: 'white', size: 'small', onClick: () => selectTool('fill') });
      const undo = ui.button({ icon: 'undo', label: 'Undo', variant: 'white', size: 'small', onClick: () => { if (history.length) { grid = history.pop(); draw(); } } });
      const clear = ui.button({ icon: 'trash', label: 'Clear', variant: 'white', size: 'small', onClick: () => { pushUndo(); grid.fill(0); draw(); } });
      tools.append(toolBtns.brush, toolBtns.fill, undo, clear);
      const done = ui.button({ icon: 'check', label: 'Done!', variant: 'mint', size: 'big', className: 'sw-easel-done', onClick: finish });
      side.append(colors, tools, done);
      wrap.append(canvas, side);
      container.appendChild(wrap);
    },
    onOpen(args) {
      entity = (args && args.entity) || null;
      const pic = entity && typeof entity.data.pic === 'string' && entity.data.pic.length >= 256 ? entity.data.pic : DEFAULT_PIC;
      grid = Array.from({ length: 256 }, (_, i) => parseInt(pic[i], 16) || 0);
      history.length = 0;
      selectColor(color);
      selectTool('brush');
      draw();
    },
    onClose() {
      entity = null;
    },
  });

  function finish() {
    const pic = grid.map((v) => v.toString(16)).join('');
    const e = entity;
    ui.close();
    if (e && game.entities && game.entities.byUid(e.uid)) {
      game.entities.setData(e, { pic });
      game.celebrate(game.entities.localToWorld(e, 0.5, 1.2, 0.6), 'sparkle', { quiet: true });
      game.audio.play('success');
      game.toast('What a beautiful painting!', { icon: 'star' });
    }
  }

  // ---------- mailbox letters ----------
  let letterRoot = null;
  ui.registerPanel('letter', {
    title: 'You got a letter!',
    icon: 'heart',
    width: 620,
    build(container) {
      letterRoot = ui.el('div', 'sw-letter');
      container.appendChild(letterRoot);
    },
    onOpen(args) {
      const name = (game.profile.look && game.profile.look.name) || game.profile.playerName || 'friend';
      const r = Math.random;
      const [from, ic] = SENDERS[Math.floor(r() * SENDERS.length)];
      const note = NOTES[Math.floor(r() * NOTES.length)];
      letterRoot.innerHTML = '';
      const paper = ui.el('div', 'sw-letter-paper');
      paper.innerHTML = `<div class="sw-stamp">${icon(ic)}</div><div>Dear ${escapeHtml(name)},</div><div>${escapeHtml(note)}</div><div class="sw-letter-from">Love, ${escapeHtml(from)}</div>`;
      const thanks = ui.button({
        icon: 'heart', label: 'Thank you!', variant: 'pink', size: 'big', className: 'sw-letter-thanks',
        onClick: () => {
          const e = args && args.entity;
          ui.close();
          if (e && game.entities && game.entities.byUid(e.uid)) game.celebrate(game.entities.localToWorld(e, 0.5, 1.1, 0.5), 'heart');
        },
      });
      letterRoot.append(paper, thanks);
    },
  });
}
