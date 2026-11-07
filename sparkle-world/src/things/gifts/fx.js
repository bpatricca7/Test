// Small screen effects for the gift panels, copies of the squish team's (src/things/squish/fx.js,
// themselves copies of the coins' "is the world clear?" rule, the shop's confetti burst and the
// sticker pop's rays) with this team's CSS prefix, so the two modules never depend on each other.
// Visual randomness uses mulberry32 (seeded).

import { mulberry32 } from '../../core/util.js';

/**
 * Something covers the world: a panel, a dialog, the page hidden, loading, photo mode, a fade,
 * a sticker pop, a tutorial tip or any speech bubble (the one-popup-at-a-time rule).
 */
export function blocked(game) {
  const ui = game.ui;
  if (!ui) return true;
  return !!(ui.current || ui.dialogOpen || document.hidden || game.loading || game.mode !== 'play' ||
    (game.container && game.container.classList.contains('sw-photo-mode')) ||
    (ui.fader && ui.fader.classList.contains('sw-on')) ||
    ui.root.querySelector(':scope > .sw-stkpop') || ui.root.classList.contains('sw-tut-on') ||
    bubbleUp(game));
}

function bubbleUp(game) {
  const root = game.container || document;
  for (const b of root.querySelectorAll('.lf-bubble')) {
    if (!b.hidden && b.offsetWidth > 0 && b.offsetHeight > 0) return true;
  }
  return false;
}

export const FX_CSS = /* css */ `
.gf-confetti { position: absolute; width: 10px; height: 14px; border-radius: 3px; pointer-events: none; z-index: 5; animation: gf-confetti 1.3s cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes gf-confetti { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
.gf-rays { position: absolute; pointer-events: none; will-change: transform; animation: gf-rays-spin 8s linear infinite; }
@keyframes gf-rays-spin { to { transform: rotate(360deg); } }
`;

let burstSeed = 1;
/** A confetti burst at (x, y) in `host` (CSS px), in the gift's own colors when given. */
export function confetti(ui, host, x, y, n = 24, colors = null) {
  const rand = mulberry32(burstSeed++ * 7919);
  const cols = colors && colors.length ? colors : ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF'];
  for (let i = 0; i < Math.min(60, n); i++) {
    const c = ui.el('div', 'gf-confetti');
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.style.background = cols[i % cols.length];
    if (i % 3 === 0) c.style.borderRadius = '50%';
    const a = rand() * Math.PI * 2, d = 60 + rand() * 120;
    c.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    c.style.setProperty('--dy', `${Math.sin(a) * d - 60}px`);
    c.style.setProperty('--rot', `${rand() * 720 - 360}deg`);
    host.appendChild(c);
    setTimeout(() => c.remove(), 1400);
  }
}

let raysImg = null;
/** Soft warm rays behind a finished gift (painted once, copied). */
export function rays(size = 256) {
  if (!raysImg) {
    const S = 256;
    raysImg = document.createElement('canvas');
    raysImg.width = raysImg.height = S;
    const g = raysImg.getContext('2d');
    const cols = ['rgba(255,226,120,0.8)', 'rgba(255,170,190,0.7)', 'rgba(170,230,210,0.7)'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = cols[i % 3];
      g.beginPath();
      g.moveTo(S / 2, S / 2);
      g.arc(S / 2, S / 2, S / 2, a - 0.13, a + 0.13);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
  }
  const c = document.createElement('canvas');
  c.width = c.height = raysImg.width;
  c.className = 'gf-rays';
  c.style.width = c.style.height = `${size}px`;
  c.getContext('2d').drawImage(raysImg, 0, 0);
  return c;
}
