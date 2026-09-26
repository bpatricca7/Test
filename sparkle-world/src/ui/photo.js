// Photo mode: action 'photo' (P key + the HUD Photo button). The UI fades away, a viewfinder
// says "Smile!", then click-flash: the picture becomes a polaroid card with the world name and
// the date, and fun frames (hearts, stars, flowers, rainbow). Save it to the device (the
// `downloads` capability inside claude.ai, else an <a download> link) or take another.
// Emits 'photo:taken' (the Photographer sticker listens to it).

import { icon2, button2 } from './menus/icons2.js';
import { saveFile, safeFileName } from './menus/files.js';
import { raycastVoxels } from '../world/raycast.js';

const SMILE_MS = 700;
const MAX_W = 960;

const CSS = /* css */ `
.sw-app.sw-photo-mode .sw-layer-hud, .sw-app.sw-photo-mode .sw-hint, .sw-app.sw-photo-mode .sw-toasts, .sw-app.sw-photo-mode .sw-joy { opacity: 0 !important; transition: opacity .2s; pointer-events: none !important; }
.sw-viewfinder { position: absolute; inset: 0; pointer-events: none; z-index: 45; display: none; }
.sw-viewfinder.sw-on { display: block; }
.sw-vf-corner { position: absolute; width: 64px; height: 64px; border: 7px solid #fff; filter: drop-shadow(0 2px 4px rgba(58,31,77,.35)); animation: sw-vf .35s var(--sw-bounce) both; }
.sw-vf-corner.tl { left: 6%; top: 8%; border-right: 0; border-bottom: 0; border-radius: 18px 0 0 0; }
.sw-vf-corner.tr { right: 6%; top: 8%; border-left: 0; border-bottom: 0; border-radius: 0 18px 0 0; }
.sw-vf-corner.bl { left: 6%; bottom: 8%; border-right: 0; border-top: 0; border-radius: 0 0 0 18px; }
.sw-vf-corner.br { right: 6%; bottom: 8%; border-left: 0; border-top: 0; border-radius: 0 0 18px 0; }
@keyframes sw-vf { from { transform: scale(1.25); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.sw-vf-text { position: absolute; left: 50%; top: 14%; transform: translateX(-50%); font: 700 44px var(--sw-font); color: #fff; -webkit-text-stroke: 8px var(--sw-pink); paint-order: stroke fill; animation: sw-pop .4s var(--sw-bounce); white-space: nowrap; }
.sw-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 46; }
.sw-flash.sw-go { animation: sw-flash .7s ease-out; }
@keyframes sw-flash { 0% { opacity: 0; } 8% { opacity: 1; } 100% { opacity: 0; } }

.sw-photo { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: calc(14px + var(--sw-safe-t)) 14px calc(14px + var(--sw-safe-b)); background: radial-gradient(circle at 50% 40%, rgba(255,230,243,.72), rgba(58,31,77,.55)); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.sw-photo-card { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; }
.sw-photo-card canvas { max-width: min(92vw, 720px); max-height: 100%; width: auto; height: auto; transform: rotate(-2.5deg); border-radius: 6px; box-shadow: 0 18px 44px rgba(58,31,77,.45), 0 4px 0 rgba(58,31,77,.08); animation: sw-drop .6s var(--sw-bounce); }
@keyframes sw-drop { 0% { transform: translateY(-60px) rotate(8deg) scale(.7); opacity: 0; } 100% { transform: rotate(-2.5deg); opacity: 1; } }
.sw-photo-frames { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sw-frame-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 48px; padding: 4px 14px 4px 10px; border-radius: 999px; border: 3px solid #fff; background: rgba(255,255,255,.85); color: var(--sw-ink); font: 700 16px var(--sw-font); cursor: pointer; box-shadow: 0 3px 8px var(--sw-shadow); touch-action: manipulation; }
.sw-frame-btn svg { width: 24px; height: 24px; color: var(--sw-pink); }
.sw-frame-btn.sw-sel { background: var(--sw-pink); color: #fff; border-color: #fff; box-shadow: 0 0 0 3px var(--sw-pink), 0 4px 10px var(--sw-shadow); }
.sw-frame-btn.sw-sel svg { color: #fff; }
.sw-photo-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
@media (max-width: 600px) {
  .sw-frame-btn { font-size: 14px; padding: 3px 10px 3px 7px; min-height: 44px; }
  .sw-frame-btn span { display: none; }
  .sw-frame-btn { padding: 3px 9px; }
  .sw-photo-actions .sw-btn { font-size: 17px; padding: 6px 14px; }
}
`;

const FRAMES = [['none', 'Plain', 'none'], ['hearts', 'Hearts', 'hearts'], ['stars', 'Stars', 'stars'], ['flowers', 'Flowers', 'flower'], ['rainbow', 'Rainbow', 'rainbow']];

// ---------- little painters ----------

function heart(g, x, y, s, color, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s / 24, s / 24);
  g.beginPath();
  g.moveTo(0, 8);
  g.bezierCurveTo(-14, -1, -10, -14, 0, -7);
  g.bezierCurveTo(10, -14, 14, -1, 0, 8);
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2.5;
  g.strokeStyle = '#FFFFFF';
  g.stroke();
  g.restore();
}

function star(g, x, y, r, color, rot = 0) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.45;
    g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, r * 0.12);
  g.strokeStyle = '#FFFFFF';
  g.stroke();
  g.restore();
}

function sparkle(g, x, y, r, color) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
  g.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
  g.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
  g.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
  g.fillStyle = color;
  g.fill();
  g.restore();
}

function flower(g, x, y, r, petal, center) {
  g.save();
  g.translate(x, y);
  g.fillStyle = petal;
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.48, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, r * 0.36, 0, Math.PI * 2);
  g.fillStyle = center;
  g.fill();
  g.restore();
}

function leaf(g, x, y, r, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2);
  g.fillStyle = '#7FD37A';
  g.fill();
  g.restore();
}

function cloud(g, x, y, s) {
  g.save();
  g.fillStyle = '#FFFFFF';
  g.shadowColor = 'rgba(58,31,77,0.18)';
  g.shadowBlur = 8;
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, -0.35, 1.2], [1.9, 0, 0.95], [0.95, 0.3, 1]]) {
    g.beginPath();
    g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Points spread along the edge of a rectangle (for frame decorations). */
function edgePoints(x, y, w, h, n, rand) {
  const pts = [];
  const per = 2 * (w + h);
  for (let i = 0; i < n; i++) {
    let d = ((i + rand() * 0.6) / n) * per;
    let px, py;
    if (d < w) { px = x + d; py = y; } else if ((d -= w) < h) { px = x + w; py = y + d; } else if ((d -= h) < w) { px = x + w - d; py = y + h; } else { d -= w; px = x; py = y + h - d; }
    pts.push([px, py]);
  }
  return pts;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compose the polaroid: white card, photo, frame decorations, caption. */
function composePolaroid(out, photo, { frame, title, date, name, seed }) {
  const pw = photo.width, ph = photo.height;
  const pad = Math.round(pw * 0.05);
  const bottom = Math.round(pw * 0.2);
  out.width = pw + pad * 2;
  out.height = ph + pad + bottom;
  const g = out.getContext('2d');
  const W = out.width, H = out.height;
  // paper
  g.fillStyle = '#FFFDF8';
  g.fillRect(0, 0, W, H);
  const rand = seeded(seed);
  g.fillStyle = 'rgba(58,31,77,0.035)';
  for (let i = 0; i < 900; i++) g.fillRect(rand() * W, rand() * H, 2, 2);
  // photo with a soft inner edge
  g.drawImage(photo, pad, pad);
  g.strokeStyle = 'rgba(58,31,77,0.12)';
  g.lineWidth = 3;
  g.strokeRect(pad + 1.5, pad + 1.5, pw - 3, ph - 3);

  const u = pw / 100; // decoration unit
  if (frame === 'hearts') {
    const colors = ['#FF5FA2', '#FF8CC6', '#FFB8D6', '#C9B8FF', '#FF7A9C'];
    for (const [x, y] of edgePoints(pad, pad, pw, ph, 22, rand)) heart(g, x, y, u * (4 + rand() * 4), colors[Math.floor(rand() * colors.length)], (rand() - 0.5) * 0.8);
  } else if (frame === 'stars') {
    const colors = ['#FFC94D', '#FFD95E', '#FFB02E', '#FF9ED2', '#B9A2FF'];
    for (const [x, y] of edgePoints(pad, pad, pw, ph, 20, rand)) star(g, x, y, u * (2.2 + rand() * 2.8), colors[Math.floor(rand() * colors.length)], rand() * 1.2);
    for (let i = 0; i < 12; i++) sparkle(g, pad + rand() * pw, pad + rand() * ph * 0.35, u * (0.8 + rand() * 1.2), 'rgba(255,255,255,0.9)');
  } else if (frame === 'flowers') {
    const petals = ['#FF8CC6', '#FFE38A', '#FFFFFF', '#C9B8FF', '#FF9F8A'];
    const corners = [[pad, pad], [pad + pw, pad], [pad, pad + ph], [pad + pw, pad + ph]];
    for (const [cx, cy] of corners) {
      for (let i = 0; i < 5; i++) {
        const a = rand() * Math.PI * 2, d = rand() * u * 9;
        leaf(g, cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * 1.3, u * 3, rand() * 3);
      }
      for (let i = 0; i < 5; i++) {
        const a = rand() * Math.PI * 2, d = rand() * u * 8;
        flower(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, u * (2.6 + rand() * 1.8), petals[Math.floor(rand() * petals.length)], '#FFC94D');
      }
    }
  } else if (frame === 'rainbow') {
    const cols = ['#FF6B8B', '#FFA94D', '#FFD43B', '#8CE07A', '#6CC6FF', '#A98BFF'];
    const cx = pad + pw * 0.18, cy = pad + ph * 0.34, R = pw * 0.26, band = u * 2.4;
    g.save();
    g.beginPath();
    g.rect(pad, pad, pw, ph);
    g.clip();
    g.globalAlpha = 0.85;
    cols.forEach((c, i) => {
      g.beginPath();
      g.arc(cx, cy, R - i * band, Math.PI, Math.PI * 2);
      g.lineWidth = band;
      g.strokeStyle = c;
      g.stroke();
    });
    g.restore();
    cloud(g, cx - R + u * 1, cy + u * 1, u * 3.4);
    cloud(g, cx + R - u * 5, cy + u * 1, u * 3.4);
    for (let i = 0; i < 10; i++) sparkle(g, pad + pw * 0.45 + rand() * pw * 0.5, pad + rand() * ph * 0.4, u * (0.8 + rand()), '#FFFFFF');
  }

  // washi tape at the top
  g.save();
  g.translate(W / 2, pad * 0.35);
  g.rotate(-0.04);
  g.fillStyle = 'rgba(255,140,198,0.72)';
  g.fillRect(-u * 12, -pad * 0.45, u * 24, pad * 0.9);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = -11; i < 12; i += 3) g.fillRect(i * u, -pad * 0.45, u * 1.2, pad * 0.9);
  g.restore();

  // caption
  const font = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = Math.round(bottom * 0.3);
  g.font = `700 ${size}px ${font}`;
  while (g.measureText(title).width > pw * 0.9 && size > 14) {
    size -= 2;
    g.font = `700 ${size}px ${font}`;
  }
  g.fillStyle = '#3A1F4D';
  const ty = ph + pad + bottom * 0.4;
  g.fillText(title, W / 2, ty);
  g.font = `600 ${Math.round(bottom * 0.17)}px ${font}`;
  g.fillStyle = '#9C7BFF';
  const sub = name ? `${date}  ·  by ${name}` : date;
  g.fillText(sub, W / 2, ph + pad + bottom * 0.72);
  heart(g, W / 2 - g.measureText(sub).width / 2 - u * 3.5, ph + pad + bottom * 0.72, u * 3, '#FF5FA2');
  heart(g, W / 2 + g.measureText(sub).width / 2 + u * 3.5, ph + pad + bottom * 0.72, u * 3, '#FF5FA2');
}

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);

  const viewfinder = ui.el('div', 'sw-viewfinder');
  for (const c of ['tl', 'tr', 'bl', 'br']) viewfinder.appendChild(ui.el('div', `sw-vf-corner ${c}`));
  const vfText = ui.el('div', 'sw-vf-text', 'Smile!');
  viewfinder.appendChild(vfText);
  const flash = ui.el('div', 'sw-flash');
  ui.root.append(viewfinder, flash);

  let busy = false;
  let photoCanvas = null; // the raw picture
  const card = document.createElement('canvas'); // the composed polaroid
  let frame = 'hearts';
  let meta = null;
  let seed = 1;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Grab the 3D view (no UI), cropped to 4:3 (landscape) or 3:4 (portrait). */
  const capture = () => {
    const r = game.renderer;
    const src = r.domElement;
    game.events.emit('thumbnail:before', {});
    r.render(game.scene, game.camera);
    const sw = src.width, sh = src.height;
    const portrait = sh > sw;
    const aspect = portrait ? 3 / 4 : 4 / 3;
    let cw = sw, ch = sw / aspect;
    if (ch > sh) { ch = sh; cw = sh * aspect; }
    const outW = Math.min(portrait ? Math.round(MAX_W * 0.75) : MAX_W, Math.round(cw));
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = Math.round(outW / aspect);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, c.width, c.height);
    game.events.emit('thumbnail:after', {});
    return c;
  };

  // ---------- selfie: the camera swings round in front of her for the picture ----------
  let selfieOn = false;
  let patchedRig = null;
  let restoreRig = null;
  const selfieCamera = () => {
    const p = game.player, cam = game.camera, w = game.world;
    if (!p || !w) return;
    const yaw = p.yaw || 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const hx = p.position.x, hy = p.position.y + 1.3, hz = p.position.z;
    let dist = 3.3;
    const props = game.registry.blocks.props;
    const hit = raycastVoxels(w, hx, hy, hz, fx, 0.28, fz, dist + 0.4, (id) => props.solid[id] === 1);
    if (hit) dist = Math.max(1.3, hit.distance - 0.4);
    const len = Math.hypot(1, 0.28);
    cam.position.set(hx + (fx / len) * dist, hy + (0.28 / len) * dist + 0.15, hz + (fz / len) * dist);
    cam.lookAt(hx, hy - 0.15, hz);
    if (p.avatar) p.avatar.group.visible = true;
  };
  const startSelfie = () => {
    const rig = game.cameraRig;
    if (!rig || patchedRig) return;
    const orig = rig.update;
    const hadOwn = Object.prototype.hasOwnProperty.call(rig, 'update');
    restoreRig = () => { if (hadOwn) rig.update = orig; else delete rig.update; };
    patchedRig = rig;
    rig.update = function selfieUpdate(dt, snap) {
      orig.call(this, dt, snap);
      if (selfieOn) selfieCamera();
    };
    selfieOn = true;
    selfieCamera();
    const pl = game.player;
    if (pl && pl.state === 'walk' && typeof pl.emote === 'function') {
      try { pl.emote('heart'); } catch { /* the avatar may not know it */ }
    }
  };
  const endSelfie = () => {
    selfieOn = false;
    if (restoreRig) restoreRig();
    restoreRig = null;
    patchedRig = null;
  };
  game.events.on('world:unload', endSelfie);

  const recompose = () => {
    if (!photoCanvas) return;
    composePolaroid(card, photoCanvas, { frame, seed, ...meta });
  };

  /** opts.selfie: turn the camera round to take her picture from the front. */
  async function takePhoto({ selfie = false } = {}) {
    if (busy || game.mode !== 'play' || !game.world) return false;
    if (ui.current && ui.current !== 'photo') return false;
    busy = true;
    try {
      if (ui.current === 'photo') ui.close();
      ui.hint(null);
      game.container.classList.add('sw-photo-mode');
      viewfinder.classList.add('sw-on');
      vfText.style.animation = 'none';
      void vfText.offsetWidth;
      vfText.style.animation = '';
      game.audio.play('chime');
      if (selfie) startSelfie();
      await wait(selfie ? SMILE_MS + 500 : SMILE_MS);
      viewfinder.classList.remove('sw-on');
      if (selfie) selfieCamera();
      photoCanvas = capture();
      endSelfie();
      flash.classList.remove('sw-go');
      void flash.offsetWidth;
      flash.classList.add('sw-go');
      game.audio.play('camera');
      const now = new Date();
      let date;
      try { date = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }); } catch { date = now.toDateString(); }
      meta = {
        title: game.world.meta.name || 'Sparkle World',
        date,
        name: game.profile.playerName || (game.profile.look && game.profile.look.name) || '',
        stamp: now,
      };
      seed = (Math.random() * 1e9) | 0;
      game.events.emit('photo:taken', {});
      await wait(260);
      game.container.classList.remove('sw-photo-mode');
      if (game.mode === 'play') ui.open('photo');
      return true;
    } catch (err) {
      console.error('[photo] failed', err);
      endSelfie();
      game.container.classList.remove('sw-photo-mode');
      viewfinder.classList.remove('sw-on');
      return false;
    } finally {
      busy = false;
    }
  }

  async function savePhoto() {
    if (!photoCanvas) return;
    recompose();
    const blob = await new Promise((res) => card.toBlob(res, 'image/png'));
    if (!blob) {
      game.toast('Oops! Could not save the photo.');
      return;
    }
    const d = meta.stamp;
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const res = await saveFile({ filename: `${safeFileName(meta.title)} photo ${stamp}.png`, data: blob, mime: 'image/png' });
    if (res === 'saved') {
      game.toast('Photo saved!', { icon: 'photo', color: 'mint' });
      game.audio.play('success');
    } else if (res === 'failed') {
      game.toast('Oops! Saving does not work here.', { icon: 'sparkle' });
    }
  }

  // ---------- the polaroid panel ----------
  let framesRow;
  const renderFrames = () => {
    framesRow.innerHTML = '';
    for (const [key, label, ic] of FRAMES) {
      const b = ui.el('button', 'sw-frame-btn' + (key === frame ? ' sw-sel' : ''));
      b.type = 'button';
      b.dataset.frame = key;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon2(ic);
      b.appendChild(ui.el('span', '', label));
      b.addEventListener('click', () => {
        if (frame === key) return;
        frame = key;
        game.audio.play('pop');
        for (const el of framesRow.children) el.classList.toggle('sw-sel', el.dataset.frame === key);
        recompose();
      });
      framesRow.appendChild(b);
    }
  };

  ui.registerPanel('photo', {
    fullscreen: true,
    build(container) {
      const root = ui.el('div', 'sw-photo');
      const holder = ui.el('div', 'sw-photo-card');
      holder.appendChild(card);
      card.setAttribute('role', 'img');
      card.setAttribute('aria-label', 'Your photo');
      framesRow = ui.el('div', 'sw-photo-frames');
      const actions = ui.el('div', 'sw-photo-actions');
      actions.append(
        button2(ui, { icon: 'download', label: 'Save', variant: 'pink', className: 'sw-photo-save', onClick: () => savePhoto() }),
        button2(ui, { icon: 'photo', label: 'Take another', variant: 'mint', className: 'sw-photo-again', onClick: () => { ui.close(); setTimeout(() => takePhoto(), 300); } }),
        button2(ui, { icon: 'heart', label: 'Selfie!', variant: 'lav', className: 'sw-photo-selfie', onClick: () => { ui.close(); setTimeout(() => takePhoto({ selfie: true }), 300); } }),
        button2(ui, { icon: 'check', label: 'Done', variant: 'white', className: 'sw-photo-done', onClick: () => ui.close() }),
      );
      root.append(holder, framesRow, actions);
      container.appendChild(root);
    },
    onOpen() {
      recompose();
      renderFrames();
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    },
  });

  game.registerAction('photo', (g, opts) => takePhoto(opts || {}));
  game.photo = { take: takePhoto, save: savePhoto, get canvas() { return card; } };
}
