// Copies of three small effects that live as local closures in files this team does not change
// (the squish team doc §4.1): the coins' "is the world clear?" rule (src/things/shops/coins.js),
// the shop's confetti burst (src/things/shops/panel.js) and the sticker pop's rays
// (src/life/stickers.js). Visual randomness uses mulberry32 (seeded).

import { mulberry32 } from '../../core/util.js';

/**
 * Something covers the world: a panel, a dialog, the page hidden, loading, photo mode, a fade,
 * a sticker pop or a tutorial tip (the coins' rule), and also any speech bubble that is up
 * (a pet's, a dolphin's or the sea form's: `.lf-bubble`, wave-4 integration §1.4).
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

/** Is any `.lf-bubble` showing (pets, the dolphin's Ride / Trick, the sea form's choice)? */
export function bubbleUp(game) {
  const root = game.container || document;
  for (const b of root.querySelectorAll('.lf-bubble')) {
    if (!b.hidden && b.offsetWidth > 0 && b.offsetHeight > 0) return true; // display: none gives 0
  }
  return false;
}

export const CSS = /* css */ `
.sq-confetti { position: absolute; width: 10px; height: 14px; border-radius: 3px; pointer-events: none; z-index: 5; animation: sq-confetti 1.2s cubic-bezier(.2,.7,.4,1) forwards; }
@keyframes sq-confetti { 0% { transform: translate(0, 0) rotate(0); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; } }
.sq-rays { position: absolute; pointer-events: none; will-change: transform; animation: sq-rays-spin 8s linear infinite; }
@keyframes sq-rays-spin { to { transform: rotate(360deg); } }
`;

let burstSeed = 1;
/** The shop's confetti burst at (x, y) in `host` (CSS px). */
export function confetti(ui, host, x, y, n = 22) {
  const rand = mulberry32(burstSeed++ * 7919);
  const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF'];
  for (let i = 0; i < n; i++) {
    const c = ui.el('div', 'sq-confetti');
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
    c.style.background = cols[i % cols.length];
    const a = rand() * Math.PI * 2, d = 60 + rand() * 110;
    c.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    c.style.setProperty('--dy', `${Math.sin(a) * d - 50}px`);
    c.style.setProperty('--rot', `${rand() * 720 - 360}deg`);
    host.appendChild(c);
    setTimeout(() => c.remove(), 1300);
  }
}

let raysImg = null;
/** Soft pastel sun rays (a canvas, painted once and copied), the sticker pop's. */
export function rays(size = 256) {
  if (!raysImg) {
    const S = 256;
    raysImg = document.createElement('canvas');
    raysImg.width = raysImg.height = S;
    const g = raysImg.getContext('2d');
    const cols = ['rgba(255,226,120,0.8)', 'rgba(200,184,255,0.7)', 'rgba(255,190,225,0.75)'];
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
    const glow = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.36);
    glow.addColorStop(0, 'rgba(255,252,230,0.95)');
    glow.addColorStop(1, 'rgba(255,245,210,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, S, S);
  }
  const c = document.createElement('canvas');
  c.width = c.height = raysImg.width;
  c.className = 'sq-rays';
  c.style.width = c.style.height = `${size}px`;
  c.getContext('2d').drawImage(raysImg, 0, 0);
  return c;
}
