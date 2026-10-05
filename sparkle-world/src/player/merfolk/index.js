// Sea forms in the world (docs/teams/merfolk.md): the `merfolk` system. The player turns in
// player.js and the avatar draws the tail; this module adds what goes around it:
//   - the stickers Sea Magic! and Big Leap!, and the "Mermaid magic!" toast once per world visit
//   - the first-turn bubble (Mermaid / Sea Dragon / Just Me, never blocking, §5.2)
//   - the dive, leap and pool tips (§5.4)
//   - the underwater tint (§5.6, game.underwater) and a little bubble trail
//   - game.debug.merfolk for the probes
// Popups that start by themselves (the bubble, the tips) stay off on automated browsers unless
// debug.merfolk.tips(true) turns them on (wave4-integration.md §1.5).

import * as THREE from 'three';
import { installMerfolkStickers } from './stickers.js';
import { depthBelow, seaDeep, UNDERWATER_TINT } from './rules.js';
import { normalizeLook } from '../wardrobe-data.js';
import { picture } from '../../ui/dressup/pictures.js';

const SURFACE = 0.875; // the drawn top of a liquid cell (src/world/mesher.js)
const BUBBLE_LIFE = 8; // s the first-turn bubble stays
const CSS = `
.sw-underwater { position: absolute; inset: 0; pointer-events: none; contain: strict; overflow: hidden; display: none; opacity: 0; transition: opacity .25s ease; z-index: 0; }
.sw-underwater.sw-uw-on { display: block; }
.sw-underwater.sw-uw-in { opacity: 1; }
.sw-uw-rays { position: absolute; left: -50%; top: 0; width: 200%; height: 100%; will-change: transform;
  background: repeating-linear-gradient(100deg, rgba(255,255,255,0) 0 60px, rgba(255,255,255,.04) 60px 110px, rgba(255,255,255,0) 110px 190px);
  animation: sw-uw-rays 8s linear infinite alternate; animation-play-state: paused; }
.sw-underwater.sw-uw-on .sw-uw-rays { animation-play-state: running; }
@keyframes sw-uw-rays { from { transform: translate3d(-6%, 0, 0); } to { transform: translate3d(6%, 0, 0); } }
.lf-bubble[data-owner="merfolk"] .sw-round-face { background: var(--c); }
.lf-bubble[data-owner="merfolk"] .sw-round-face svg { width: 44px; height: 44px; filter: none; }
.lf-bubble[data-owner="merfolk"] .sw-round-face { width: 64px; height: 64px; }
.lf-bubble[data-owner="merfolk"] { transition: opacity .3s ease; }
.lf-bubble[data-owner="merfolk"].mf-fade { opacity: 0; }
@keyframes sw-pulse { 0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0 rgba(108,198,255,0)); } 50% { transform: scale(1.12); filter: drop-shadow(0 0 10px rgba(108,198,255,.9)); } }
.sw-pulse .sw-round-face { animation: sw-pulse .9s ease-in-out infinite; }
`;

export function install(game) {
  const ui = game.ui;
  const award = installMerfolkStickers(game);
  const auto = typeof navigator !== 'undefined' && !!navigator.webdriver;
  let tipsOn = !auto;
  const dev = (k, d = 0) => {
    try { return game.store.deviceGet(k, d) ?? d; } catch { return d; }
  };
  const devSet = (k, v) => {
    try { game.store.deviceSet(k, v); } catch { /* storage may be blocked */ }
  };
  const remote = () => !!(game.net && game.net.remoteApplying);

  // ---------- the underwater tint ----------
  let overlay = null, overlayKey = null, overlayOffT = 0;
  if (ui && typeof document !== 'undefined') {
    ui.addStyles(CSS);
    overlay = ui.el('div', 'sw-underwater');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.appendChild(ui.el('div', 'sw-uw-rays'));
    const canvas = game.renderer && game.renderer.domElement;
    if (canvas && canvas.parentNode) canvas.after(overlay);
    else if (game.container) game.container.appendChild(overlay);
  }
  game.underwater = null;
  const setUnderwater = (key) => {
    if (key === game.underwater) return;
    game.underwater = key;
    if (!overlay) return;
    clearTimeout(overlayOffT);
    if (key) {
      if (key !== overlayKey) {
        overlayKey = key;
        const t = UNDERWATER_TINT[key] || UNDERWATER_TINT.water;
        overlay.style.background = `linear-gradient(180deg, ${t[0]}, ${t[1]})`;
      }
      overlay.classList.add('sw-uw-on');
      void overlay.offsetWidth; // start the fade from 0
      overlay.classList.add('sw-uw-in');
    } else {
      overlay.classList.remove('sw-uw-in');
      overlayOffT = setTimeout(() => { if (!game.underwater) overlay.classList.remove('sw-uw-on'); }, 260);
    }
  };
  /** The camera is under a liquid surface: the liquid's block key, or null. */
  const cameraLiquid = () => {
    const w = game.world, cam = game.camera;
    if (!w || !cam || !game.physics) return null;
    const x = cam.position.x, y = cam.position.y, z = cam.position.z;
    if (!game.physics.liquidAt(x, y, z)) return null;
    const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z));
    const above = game.physics.liquidAt(x, y + 1, z);
    if (!above && y - Math.floor(y) >= SURFACE) return null;
    const def = game.registry.blocks.defs[id];
    return def ? def.key : 'water';
  };

  // ---------- the first-turn bubble ----------
  let bubble = null;
  const scratch = new THREE.Vector3();
  const bub = { shownAt: -1, wait: -1, minWait: 0, clearFor: 0, life: 0, tapped: false };
  const popShowing = () => !!(ui && ui.root.querySelector('.sw-stkpop'));
  const otherBubble = () => !!(ui && ui.hudLayer.querySelector('.lf-bubble.lf-on:not([data-owner="merfolk"])'));
  const riding = () => !!(game.player && game.player.state === 'ride');
  const lookForm = () => normalizeLook(game.profile.look).sea.form;

  const roundBtn = (label, color, pic, onClick) => {
    const b = ui.el('button', 'sw-round');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.dataset.form = pic;
    const f = ui.el('span', 'sw-round-face');
    f.style.setProperty('--c', color);
    f.innerHTML = picture(pic, 44);
    b.append(f, ui.el('span', 'sw-round-label', label));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.play('click');
      onClick();
    });
    return b;
  };

  /** Store an explicit form (one look change, like the Studio's commit). */
  const pickForm = (form) => {
    const look = normalizeLook(game.profile.look);
    look.sea = { form, color: look.sea.color };
    game.profile.look = look;
    game.saveProfile(true);
    game.events.emit('avatar:changed', { look: normalizeLook(look) });
    devSet('seaAsked', 2);
    game.audio.play('magic', { pitch: form === 'me' ? 1.0 : 1.2, volume: 0.6 });
  };

  const buildBubble = () => {
    if (bubble || !ui) return bubble;
    bubble = ui.el('div', 'lf-bubble');
    bubble.dataset.owner = 'merfolk';
    const row = ui.el('div', 'lf-bubble-row');
    const boy = typeof game.surpriseStyle === 'function' && game.surpriseStyle() === 'boy';
    const opts = [['mermaid', 'Mermaid', 'var(--sw-mint)'], ['sea_dragon', 'Sea Dragon', 'var(--sw-sky)'], ['me', 'Just Me', 'var(--sw-sun)']];
    if (boy) opts.unshift(opts.splice(1, 1)[0]);
    for (const [form, label, color] of opts) {
      row.appendChild(roundBtn(label, color, form, () => {
        bub.tapped = true;
        pickForm(form);
        hideBubble(false);
      }));
    }
    bubble.appendChild(row);
    ui.hudLayer.appendChild(bubble);
    return bubble;
  };

  function hideBubble(counted = true) {
    if (!bubble) return;
    const wasOn = bubble.classList.contains('lf-on');
    bubble.classList.remove('lf-on', 'mf-fade');
    bubble.remove();
    bubble = null;
    if (wasOn && counted && !bub.tapped) devSet('seaAsked', Math.min(2, dev('seaAsked', 0) + 1));
    bub.shownAt = -1;
  }

  const placeBubble = () => {
    const p = game.player;
    if (!bubble || !p) return;
    const cam = game.camera;
    if (!cam) return;
    const v = { x: 0, y: 0 };
    const pos = p.position;
    // project the point over her head
    const vec = scratch.set(pos.x, pos.y + (p.seaForm ? 1.95 : 2.3), pos.z).project(cam);
    if (vec.z > 1) {
      bubble.style.visibility = 'hidden';
      return;
    }
    v.x = ((vec.x + 1) / 2) * game.container.clientWidth;
    v.y = ((1 - vec.y) / 2) * game.container.clientHeight;
    bubble.style.visibility = '';
    const w = bubble.offsetWidth || 260, h = bubble.offsetHeight || 120;
    const W = game.container.clientWidth, H = game.container.clientHeight;
    bubble.style.left = Math.round(Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, v.x))) + 'px';
    bubble.style.top = Math.round(Math.max(h + 8, Math.min(H - 90, v.y))) + 'px';
  };

  const showBubble = () => {
    buildBubble();
    if (!bubble) return;
    bub.tapped = false;
    bub.life = 0;
    bub.shownAt = performance.now();
    bubble.classList.add('lf-on');
    placeBubble();
  };

  // ---------- tips ----------
  const tips = { dive: -1, diveFirst: false, poolT: 0, pulseT: 0, turnsThisPage: 0 };
  const downBtn = () => (ui ? ui.hudLayer.querySelector('.sw-touch .sw-flybtn[aria-label="Down"]') : null);
  const touchMode = () => !!(game.input && game.input.touchMode);

  // ---------- shader warm-up ----------
  // The sea parts use material kinds nothing else in the game draws: the scales (lit, mapped,
  // vertex colors, emissive), the mermaid's see-through two-sided fins (three.js draws them in
  // two passes) and the sea dragon's unlit blended glow spots. A GPU builds the program and its
  // pipeline the first time a kind is really drawn, which stalled the frame of the first turn
  // (0.3-1 s on a software GPU; compiling alone was not enough). So when a world loads, three
  // stand-ins of the same kinds (one degenerate triangle each: nothing shows) are drawn in the
  // real scene, against its lights and fog, until each has been drawn once, then taken out.
  let warm = null, warmFrames = 0;
  const warmSea = () => {
    const r = game.renderer, cam = game.camera, scene = game.scene;
    if (!r || !cam || !scene) return;
    if (!warm) {
      const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.needsUpdate = true;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
      const mk = (mat) => {
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        m.onAfterRender = () => { m.userData.drawn = true; };
        return m;
      };
      const lam = (o) => new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, emissive: new THREE.Color('#3FD8B0'), ...o });
      warm = new THREE.Group();
      warm.name = 'merfolkWarm';
      warm.add(mk(lam({ side: THREE.DoubleSide, transparent: true, depthWrite: false }))); // fin:
      warm.add(mk(lam({ side: THREE.FrontSide }))); // scale:
      warm.add(mk(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }))); // seaglow:
    }
    for (const m of warm.children) m.userData.drawn = false;
    if (warm.parent !== scene) scene.add(warm);
    warmFrames = 90; // at most: a hidden page draws nothing
    try { if (typeof r.compile === 'function') r.compile(warm, cam, scene); } catch { /* a lost context */ }
  };
  const warmStep = () => {
    if (!warm || !warm.parent) return;
    if (--warmFrames <= 0 || warm.children.every((m) => m.userData.drawn)) warm.parent.remove(warm);
  };
  // The player's own sea parts are built ahead too, hidden, 1.5 s after a world loads or her
  // look changes (building the dragon's parts costs a slow device's frame 10-20 ms): the first
  // turn then only shows them.
  let prepT = 0;
  const prepSoon = () => {
    clearTimeout(prepT);
    prepT = setTimeout(prepareSea, 1500);
  };
  const prepareSea = () => {
    prepT = 0;
    const av = game.player && game.player.avatar;
    if (game.mode !== 'play' || !av || typeof av.prepareSea !== 'function') return;
    try {
      if (!av.prepareSea()) return;
      // and their textures sent to the GPU now (hidden parts are not drawn, so otherwise the
      // upload would fall on the first turn's frame)
      const r = game.renderer;
      if (!r || typeof r.initTexture !== 'function') return;
      const seen = new Set();
      av.group.traverse((o) => {
        const ms = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m.map && !seen.has(m.map)) { seen.add(m.map); r.initTexture(m.map); }
      });
    } catch { /* the first turn builds them */ }
  };

  // ---------- events ----------
  let visitToast = false; // "Mermaid magic!" once per world visit
  let firstEver = false;
  game.events.on('world:load', () => {
    warmSea();
    prepSoon();
    visitToast = false;
    hideBubble(false);
    bub.wait = -1;
    tips.dive = -1;
    tips.poolT = 0;
  });
  game.events.on('world:unload', () => {
    hideBubble(false);
    bub.wait = -1;
    tips.dive = -1;
    setUnderwater(null);
  });
  game.events.on('avatar:changed', prepSoon);
  game.events.on('ui:open', () => {
    if (bubble && bubble.classList.contains('lf-on')) hideBubble(true);
  });

  game.events.on('player:seaform', ({ form } = {}) => {
    if (remote() || !form) return;
    const fresh = award('sea_magic');
    firstEver = fresh;
    tips.turnsThisPage++;
    if (!fresh && !visitToast) {
      const name = form === 'sea_dragon' ? 'Sea Dragon' : 'Mermaid';
      game.toast(`${name} magic!`, { icon: 'sparkle', color: 'mint', duration: 2600, key: 'sea-form-magic' });
    }
    visitToast = true;
    // the first-turn bubble, while the form is still 'auto'
    if (tipsOn && dev('seaAsked', 0) < 2 && lookForm() === 'auto' && bub.wait < 0 && !bubble) {
      bub.wait = 0;
      bub.minWait = fresh ? 2.6 : 0.6;
      bub.clearFor = 0;
    }
    // the leap tip, on the 3rd turn
    if (tipsOn && tips.turnsThisPage === 3 && dev('seaLeapTips', 0) < 1) {
      devSet('seaLeapTips', 1);
      // a friend who is following says it; otherwise a toast
      const fr = game.friends;
      const f = fr && Array.isArray(fr.friends) && fr.ui ? fr.friends.find((x) => x.mode === 'follow' && x.distToPlayer() < 12) : null;
      if (f && typeof fr.ui.showLine === 'function') fr.ui.showLine(f, 'Swim fast and press Up to leap like a dolphin!', 4.5);
      else game.toast('Swim fast + Up = big leap!', { icon: 'up', color: 'sky', key: 'sea-form-leap' });
    }
  });
  game.events.on('player:seaswim', ({ on } = {}) => {
    if (!on) {
      if (bubble) hideBubble(true);
      bub.wait = -1;
      tips.dive = -1;
      return;
    }
    if (tipsOn && dev('seaHints', 0) < 2) {
      tips.dive = 0;
      tips.diveFirst = firstEver;
    }
  });
  game.events.on('player:leap', () => { if (!remote()) award('big_leap'); });
  // a dolphin leap with her on its back counts too (ocean's event, by name: no import)
  game.events.on('sea:leap', (e) => { if (!remote() && e && e.riding) award('big_leap'); });

  // ---------- every frame ----------
  let trailT = 0;
  const sys = {
    name: 'merfolk',
    update(dt) {
      warmStep();
      const p = game.player;
      if (game.mode !== 'play' || !game.physics || !p || !game.world) {
        if (game.underwater) setUnderwater(null);
        if (bubble) hideBubble(false);
        return;
      }
      setUnderwater(cameraLiquid());
      if (game.paused) return;
      const pos = p.position;
      // a few bubbles behind a sea swimmer under the surface
      if (p.seaSwim && p.swimming && game.particles) {
        trailT -= dt;
        if (trailT <= 0) {
          trailT = 0.3;
          const hs = Math.hypot(p.velocity.x, p.velocity.z);
          if (hs > 1 && game.physics.liquidAt(pos.x, pos.y + 1.4, pos.z)) game.particles.emit('bubble', { x: pos.x, y: pos.y + 1.2, z: pos.z }, { count: 1 });
        }
      }
      // the first-turn bubble: waits for the sticker pop, a pet's or a dolphin's bubble, a ride
      if (bub.wait >= 0 && !bubble) {
        bub.wait += dt;
        const clear = !popShowing() && !otherBubble() && !riding() && !ui.current && !ui.dialogOpen;
        bub.clearFor = clear ? bub.clearFor + dt : 0;
        if (!p.seaSwim) bub.wait = -1;
        else if (bub.wait >= bub.minWait && bub.clearFor >= 0.3) {
          bub.wait = -1;
          if (dev('seaAsked', 0) < 2 && lookForm() === 'auto') showBubble();
        } else if (bub.wait > 20) bub.wait = -1;
      }
      if (bubble) {
        bub.life += dt;
        if (riding() || otherBubble()) hideBubble(true);
        else if (bub.life >= BUBBLE_LIFE) hideBubble(true);
        else {
          bubble.classList.toggle('mf-fade', bub.life > BUBBLE_LIFE - 0.4);
          placeBubble();
        }
      }
      // the dive tip: 1.5 s after sea swimming starts, only where there is room to dive
      if (tips.dive >= 0) {
        tips.dive += dt;
        const waitBubble = bubble || bub.wait >= 0 || (tips.diveFirst && popShowing());
        if (!p.seaSwim) tips.dive = -1;
        else if (tips.dive >= 1.5 && !waitBubble && !ui.current) {
          tips.dive = -1;
          if (dev('seaHints', 0) < 2 && depthBelow(game.physics.liquidAt.bind(game.physics), pos.x, pos.y, pos.z) >= 3) {
            devSet('seaHints', dev('seaHints', 0) + 1);
            game.toast(touchMode() ? 'Hold Down to dive!' : 'Hold C to dive!', { icon: 'down', color: 'sky', key: 'sea-form-dive' });
            const b = downBtn();
            if (b) {
              b.classList.add('sw-pulse');
              tips.pulseT = 3;
            }
          }
        } else if (tips.dive > 15) tips.dive = -1;
      }
      if (tips.pulseT > 0) {
        tips.pulseT -= dt;
        if (tips.pulseT <= 0) {
          const b = downBtn();
          if (b) b.classList.remove('sw-pulse');
        }
      }
      // the pool tip: swimming in water too shallow to turn, before she ever turned
      if (tipsOn && p.swimming && !p.seaSwim && !dev('seaPoolHint', false)) {
        const form = p.avatar ? p.avatar.seaForm : 'me';
        const deep = seaDeep(game.physics.liquidAt.bind(game.physics), pos.x, pos.y, pos.z);
        tips.poolT = form !== 'me' && !deep && !(game.stickers && game.stickers.has('sea_magic')) ? tips.poolT + dt : 0;
        if (tips.poolT >= 3) {
          tips.poolT = 0;
          devSet('seaPoolHint', true);
          game.toast(`Make it 2 deep for ${form === 'sea_dragon' ? 'sea dragon' : 'mermaid'} magic!`, { icon: 'deep', color: 'sky', key: 'sea-form-pool' });
        }
      } else tips.poolT = 0;
    },
  };
  game.addSystem(sys);
  game.events.on('title:open', () => setUnderwater(null));

  // ---------- probes ----------
  if (game.debug) {
    const liq = (x, y, z) => !!game.physics && game.physics.liquidAt(x, y, z);
    /** The top liquid cell of a column (or -1) and how many liquid cells are under it. */
    const column = (x, z) => {
      const w = game.world;
      for (let y = w.sy - 1; y >= 1; y--) {
        if (!liq(x + 0.5, y + 0.5, z + 0.5)) {
          const id = w.get(x, y, z);
          if (game.registry.blocks.props.solid[id]) return { top: -1, depth: 0 };
          continue;
        }
        let d = 0;
        while (y - d >= 0 && liq(x + 0.5, y - d + 0.5, z + 0.5)) d++;
        return { top: y, depth: d };
      }
      return { top: -1, depth: 0 };
    };
    const deepSpot = (maxR = 60, minDepth = 4) => {
      if (game.debug.ocean && typeof game.debug.ocean.deepSpot === 'function') {
        // ocean's deep spot (when installed), in this probe API's shape
        try {
          const s = game.debug.ocean.deepSpot();
          const x = Array.isArray(s) ? s[0] : s && s.x, z = Array.isArray(s) ? s[2] : s && s.z;
          if (Number.isFinite(x) && Number.isFinite(z)) {
            const c = column(Math.floor(x), Math.floor(z));
            if (c.depth >= minDepth) return { x: Math.floor(x) + 0.5, y: c.top - 0.6, z: Math.floor(z) + 0.5, top: c.top + 1, depth: c.depth };
          }
        } catch { /* fall back */ }
      }
      const w = game.world, p = game.player;
      if (!w || !p) return null;
      const cx = Math.floor(p.position.x), cz = Math.floor(p.position.z);
      let n = 0;
      for (let r = 0; r <= maxR && n < 9000; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = cx + dx, z = cz + dz;
            if (x < 1 || z < 1 || x >= w.sx - 1 || z >= w.sz - 1) continue;
            if (++n > 9000) return null;
            const c = column(x, z);
            if (c.depth >= minDepth) return { x: x + 0.5, y: c.top - 0.6, z: z + 0.5, top: c.top + 1, depth: c.depth };
          }
        }
      }
      return null;
    };
    /** A deep spot (>= 3 deep) next to land whose top is one block above it (the beach). */
    const shore = (maxR = 60) => {
      if (game.debug.ocean && typeof game.debug.ocean.shoreSpot === 'function') {
        // ocean's shore spot when it already has this API's shape; else our own search below
        try { const s = game.debug.ocean.shoreSpot(); if (s && s.deep && s.land && Number.isFinite(s.top)) return s; } catch { /* fall back */ }
      }
      const w = game.world, p = game.player;
      if (!w || !p) return null;
      const cx = Math.floor(p.position.x), cz = Math.floor(p.position.z);
      const props = game.registry.blocks.props;
      const groundTop = (x, z) => {
        for (let y = w.sy - 1; y >= 0; y--) {
          const id = w.get(x, y, z);
          if (props.solid[id]) return y + 1;
          if (liq(x + 0.5, y + 0.5, z + 0.5)) return -1;
        }
        return -1;
      };
      let n = 0;
      for (let r = 0; r <= maxR; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            if (++n > 12000) return null;
            const x = cx + dx, z = cz + dz;
            if (x < 6 || z < 6 || x >= w.sx - 6 || z >= w.sz - 6) continue;
            const c = column(x, z);
            if (c.depth < 3) continue;
            const wTop = c.top + 1;
            for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              // walk toward land: water up to 4 cells, then sand at most one block above
              for (let k = 1; k <= 4; k++) {
                const lx = x + ax * k, lz = z + az * k;
                const g = groundTop(lx, lz);
                if (g < 0) continue;
                if (g >= wTop && g <= wTop + 1 && groundTop(lx + ax, lz + az) >= g - 0 && groundTop(lx + ax, lz + az) <= g + 1) {
                  return {
                    deep: [x + 0.5, c.top - 0.6, z + 0.5], land: [lx + 0.5, g, lz + 0.5], top: wTop, depth: c.depth,
                    yaw: Math.atan2(ax, az), dir: [ax, az],
                  };
                }
                break;
              }
            }
          }
        }
      }
      return null;
    };
    game.debug.merfolk = {
      state() {
        const p = game.player;
        if (!p) return null;
        return {
          seaSwim: p.seaSwim, seaForm: p.seaForm, gateOn: p.seaGate.on, inT: p.seaGate.inT, outT: p.seaGate.outT,
          swimming: p.swimming, deep: p._seaDeep, underwater: game.underwater, vy: p.velocity.y,
          hs: Math.hypot(p.velocity.x, p.velocity.z), hopT: p._seaSt.hopT, y: p.position.y, state: p.state,
          form: p.avatar ? p.avatar.seaForm : null,
        };
      },
      parts() {
        const p = game.player;
        return p && p.avatar ? p.avatar.seaParts() : null;
      },
      deepSpot,
      shore,
      column: (x, z) => column(Math.floor(x), Math.floor(z)),
      /** Turn the self-starting popups (bubble, tips) on or off on automated pages. */
      tips(on) {
        tipsOn = !!on;
        return tipsOn;
      },
      bubble: () => (bubble && bubble.classList.contains('lf-on') ? [...bubble.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : null),
      hideBubble: () => hideBubble(false),
    };
  }
}
