// Menus: title screen, New World wizard, My Worlds list and the pause panel.
// The Menus team adds the live 3D title backdrop, export/import and more polish.

import { icon } from './icons.js';

const CSS = /* css */ `
.sw-title { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(180deg, #6EC3FF 0%, #A9DEFF 38%, #FFE0F0 78%, #FFD1E6 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: calc(20px + var(--sw-safe-t)) 16px calc(20px + var(--sw-safe-b)); }
.sw-cloud { position: absolute; width: 180px; height: 56px; border-radius: 40px; background: #fff; opacity: .92; animation: sw-drift linear infinite; box-shadow: 0 10px 0 rgba(255,255,255,.4); }
.sw-cloud::before, .sw-cloud::after { content: ''; position: absolute; background: #fff; border-radius: 50%; }
.sw-cloud::before { width: 80px; height: 80px; left: 26px; top: -40px; }
.sw-cloud::after { width: 64px; height: 64px; left: 88px; top: -28px; }
.sw-hills { position: absolute; left: 0; right: 0; bottom: 0; height: 34%; pointer-events: none; }
.sw-hills svg { width: 100%; height: 100%; display: block; }
.sw-logo { position: relative; z-index: 2; text-align: center; line-height: .92; margin: 0; font-weight: 700; font-size: clamp(56px, 12vw, 128px); letter-spacing: 2px; animation: sw-pop .6s var(--sw-bounce); }
.sw-logo .sw-word { display: block; white-space: nowrap; }
.sw-logo .sw-l { display: inline-block; -webkit-text-stroke: 12px #fff; paint-order: stroke fill; text-shadow: 0 9px 0 rgba(58,31,77,.16); animation: sw-float 3s ease-in-out infinite; }
.sw-logo-sparkle { position: absolute; color: var(--sw-sun); width: 44px; height: 44px; animation: sw-twinkle 1.8s ease-in-out infinite; filter: drop-shadow(0 3px 0 #fff); }
.sw-tagline { position: relative; z-index: 2; font-size: clamp(18px, 3vw, 26px); font-weight: 600; color: var(--sw-ink); background: rgba(255,255,255,.85); padding: 6px 20px; border-radius: 999px; border: 3px solid #fff; box-shadow: 0 4px 12px var(--sw-shadow); }
.sw-title-buttons { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: stretch; gap: 12px; width: min(360px, 88vw); margin-top: 6px; }
.sw-title-small { position: relative; z-index: 2; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.sw-floaty { position: absolute; width: 64px; height: 64px; animation: sw-float 3.4s ease-in-out infinite; filter: drop-shadow(0 8px 10px rgba(58,31,77,.2)); z-index: 1; }

.sw-field-label { font-size: 19px; font-weight: 700; color: var(--sw-lav); margin: 10px 0 8px; display: flex; align-items: center; gap: 8px; }
.sw-field-label svg { width: 22px; height: 22px; }
.sw-biomes { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.sw-biome { position: relative; border-radius: 22px; border: 4px solid #fff; padding: 12px 10px 12px; cursor: pointer; text-align: center; box-shadow: 0 5px 14px var(--sw-shadow); transition: transform .18s var(--sw-bounce), box-shadow .18s; font-family: var(--sw-font); color: var(--sw-ink); }
.sw-biome img { width: 70px; height: 70px; display: block; margin: 0 auto 4px; filter: drop-shadow(0 5px 6px rgba(58,31,77,.2)); }
.sw-biome-name { font-size: 18px; font-weight: 700; }
.sw-biome-desc { font-size: 13px; opacity: .8; line-height: 1.15; margin-top: 2px; }
.sw-biome.sw-sel { border-color: var(--sw-pink); transform: scale(1.04); box-shadow: 0 0 0 4px #fff, 0 8px 22px rgba(255,95,162,.45); }
.sw-biome .sw-check { position: absolute; top: -10px; right: -10px; width: 34px; height: 34px; border-radius: 50%; background: var(--sw-pink); color: #fff; border: 3px solid #fff; display: none; place-items: center; }
.sw-biome.sw-sel .sw-check { display: grid; }
.sw-biome .sw-check svg { width: 20px; height: 20px; }
.sw-sizes { display: flex; gap: 10px; flex-wrap: wrap; }
.sw-toggle.sw-sel { --c: var(--sw-lav); --fg: #fff; border-color: #fff; }
.sw-create-row { display: flex; justify-content: center; margin-top: 18px; }

.sw-worlds { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
.sw-world { background: #fff; border-radius: 22px; border: 4px solid var(--sw-pink-soft); overflow: hidden; box-shadow: 0 5px 14px var(--sw-shadow); display: flex; flex-direction: column; }
.sw-world-thumb { aspect-ratio: 16 / 10; background: linear-gradient(135deg, #BDF5C6, #9FD8FF); display: grid; place-items: center; overflow: hidden; }
.sw-world-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sw-world-thumb svg { width: 48px; height: 48px; color: #fff; }
.sw-world-info { padding: 8px 12px 4px; }
.sw-world-name { font-size: 19px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-world-meta { font-size: 14px; color: var(--sw-lav); font-weight: 600; }
.sw-world-actions { display: flex; gap: 6px; padding: 6px 10px 12px; align-items: center; }
.sw-world-actions .sw-btn--pink { flex: 1; }
.sw-empty { text-align: center; padding: 24px; font-size: 20px; color: var(--sw-lav); display: flex; flex-direction: column; align-items: center; gap: 14px; }

.sw-pause { display: flex; flex-direction: column; gap: 12px; align-items: stretch; width: min(380px, 100%); margin: 0 auto; }
.sw-pause-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
@media (max-width: 600px) {
  .sw-biomes { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .sw-biome img { width: 54px; height: 54px; }
  .sw-biome-desc { display: none; }
  .sw-floaty { width: 44px; height: 44px; }
  .sw-logo .sw-l { -webkit-text-stroke: 9px #fff; }
}
`;

const LOGO_COLORS = ['#FF5FA2', '#FFA43B', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF7EB6'];

const NAME_IDEAS = {
  meadow: ['Rainbow Meadow', 'Flower Valley', 'Bunny Hill'],
  flat: ['Dream Town', 'Sparkle City', 'Happy Street'],
  candy: ['Candy Land', 'Cupcake Kingdom', 'Lollipop Hills'],
  beach: ['Seashell Island', 'Sunny Beach', 'Mermaid Lagoon'],
  snow: ['Snowflake Village', 'Frosty Peaks', 'Winter Wonderland'],
  fairy: ['Fairy Forest', 'Glow Garden', 'Moonlight Woods'],
};

function relativeDay(ms) {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Played yesterday';
  return `Played ${days} days ago`;
}

function hillsSvg() {
  return `<svg viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 150 C 180 60 360 60 520 130 C 700 210 860 70 1040 90 C 1120 100 1170 130 1200 140 V300 H0Z" fill="#A6E7A0"/>
    <path d="M0 210 C 220 130 420 170 600 200 C 800 235 980 150 1200 190 V300 H0Z" fill="#86D67A"/>
    <path d="M0 262 C 300 225 520 255 760 245 C 950 238 1080 250 1200 240 V300 H0Z" fill="#74CC6C"/>
  </svg>`;
}

export function install(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const playerName = () => (game.profile.look && game.profile.look.name) || 'My';

  // ---------- title ----------
  let playBtn;
  let smallRow;
  ui.registerPanel('title', {
    fullscreen: true,
    closable: false,
    build(container) {
      const t = ui.el('div', 'sw-title');
      for (let i = 0; i < 5; i++) {
        const c = ui.el('div', 'sw-cloud');
        c.style.top = `${6 + i * 11}%`;
        c.style.animationDuration = `${38 + i * 9}s`;
        c.style.animationDelay = `${-i * 11}s`;
        c.style.transform = `scale(${0.6 + (i % 3) * 0.25})`;
        t.appendChild(c);
      }
      const hills = ui.el('div', 'sw-hills');
      hills.innerHTML = hillsSvg();
      t.appendChild(hills);

      // floating blocks around the logo
      const floaties = [['grass', 12, 20], ['planks_pink', 82, 16], ['wool_sky', 8, 62], ['leaves_cherry', 86, 58], ['lamp_block', 20, 84], ['glass_pink', 76, 84]];
      floaties.forEach(([key, x, y], i) => {
        if (!game.registry.blocks.has(key)) return;
        const img = ui.el('img', 'sw-floaty');
        img.alt = '';
        img.style.left = `${x}%`;
        img.style.top = `${y}%`;
        img.style.animationDelay = `${-i * 0.6}s`;
        game.registry.blocks.iconFor(key).then((url) => { img.src = url; });
        t.appendChild(img);
      });

      const logo = ui.el('h1', 'sw-logo');
      logo.setAttribute('aria-label', 'Sparkle World');
      let n = 0;
      for (const word of ['Sparkle', 'World']) {
        const w = ui.el('span', 'sw-word');
        for (const ch of word) {
          const l = ui.el('span', 'sw-l', ch);
          l.style.color = LOGO_COLORS[n % LOGO_COLORS.length];
          l.style.animationDelay = `${-n * 0.18}s`;
          n++;
          w.appendChild(l);
        }
        logo.appendChild(w);
      }
      for (const [x, y, d] of [[-6, 4, 0], [96, 38, 0.6], [44, 92, 1.1]]) {
        const s = ui.el('span', 'sw-logo-sparkle');
        s.innerHTML = icon('sparkle');
        s.style.left = `${x}%`;
        s.style.top = `${y}%`;
        s.style.animationDelay = `${d}s`;
        logo.appendChild(s);
      }
      const tagline = ui.el('div', 'sw-tagline', 'Build your dream world!');

      const buttons = ui.el('div', 'sw-title-buttons');
      playBtn = ui.button({ icon: 'play', label: 'Play', variant: 'pink', size: 'big', onClick: () => continueLast() });
      const newBtn = ui.button({ icon: 'plus', label: 'New World', variant: 'mint', onClick: () => ui.open('newworld') });
      const worldsBtn = ui.button({ icon: 'world', label: 'My Worlds', variant: 'lav', onClick: () => ui.open('worlds') });
      buttons.append(playBtn, newBtn, worldsBtn);

      smallRow = ui.el('div', 'sw-title-small');
      t.append(logo, tagline, buttons, smallRow);
      container.appendChild(t);
    },
    onOpen() {
      refreshTitle();
    },
  });

  async function refreshTitle() {
    if (!playBtn) return;
    smallRow.innerHTML = '';
    if (game.actions.has('dressup')) smallRow.appendChild(ui.button({ icon: 'dress', label: 'Dress Up', variant: 'white', size: 'small', onClick: () => game.runAction('dressup') }));
    if (game.actions.has('stickers')) smallRow.appendChild(ui.button({ icon: 'sticker', label: 'Stickers', variant: 'white', size: 'small', onClick: () => game.runAction('stickers') }));
    if (ui.hasPanel('settings')) smallRow.appendChild(ui.button({ icon: 'settings', label: 'Settings', variant: 'white', size: 'small', onClick: () => ui.open('settings') }));
    const worlds = await game.store.listWorlds();
    playBtn.hidden = worlds.length === 0;
  }
  game.events.on('profile:changed', refreshTitle);

  async function continueLast() {
    const worlds = await game.store.listWorlds();
    if (!worlds.length) {
      ui.open('newworld');
      return;
    }
    const last = worlds.find((w) => w.id === game.profile.lastWorldId) || worlds[0];
    await game.loadWorld(last.id);
  }

  // ---------- new world ----------
  let nameInput, biomeGrid, sizeRow;
  let choice = { biome: 'meadow', size: 'cozy' };
  let nameTouched = false;
  const suggestName = () => {
    const ideas = NAME_IDEAS[choice.biome] || NAME_IDEAS.meadow;
    return `${playerName()}'s ${ideas[0]}`;
  };

  const renderBiomes = () => {
    biomeGrid.innerHTML = '';
    for (const [key, b] of game.registry.biomes) {
      const card = ui.el('button', 'sw-biome' + (key === choice.biome ? ' sw-sel' : ''));
      card.type = 'button';
      const colors = b.colors || ['#FFFFFF', '#FFD1E6'];
      card.style.background = `linear-gradient(160deg, ${colors[0]}, ${colors[1]})`;
      const img = ui.el('img');
      img.alt = '';
      if (b.iconBlock && game.registry.blocks.has(b.iconBlock)) game.registry.blocks.iconFor(b.iconBlock).then((u) => { img.src = u; });
      const check = ui.el('span', 'sw-check');
      check.innerHTML = icon('check');
      card.append(check, img, ui.el('div', 'sw-biome-name', b.name || key), ui.el('div', 'sw-biome-desc', b.description || ''));
      card.addEventListener('click', () => {
        choice.biome = key;
        game.audio.play('pop');
        if (!nameTouched) nameInput.value = suggestName();
        renderBiomes();
      });
      biomeGrid.appendChild(card);
    }
  };

  const renderSizes = () => {
    sizeRow.innerHTML = '';
    for (const [key, label] of [['cozy', 'Cozy'], ['big', 'Big']]) {
      const b = ui.button({
        icon: key === 'cozy' ? 'home' : 'world', label, variant: 'white', className: 'sw-toggle' + (choice.size === key ? ' sw-sel' : ''),
        onClick: () => { choice.size = key; renderSizes(); },
      });
      sizeRow.appendChild(b);
    }
  };

  ui.registerPanel('newworld', {
    title: 'New World',
    icon: 'sparkle',
    width: 820,
    back: (g) => (g.mode === 'title' ? 'title' : null),
    build(container) {
      const nameLabel = ui.el('div', 'sw-field-label');
      nameLabel.innerHTML = icon('pencil');
      nameLabel.appendChild(document.createTextNode('World name'));
      nameInput = ui.el('input', 'sw-input');
      nameInput.maxLength = 40;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck = false;
      nameInput.addEventListener('input', () => { nameTouched = true; });
      const biomeLabel = ui.el('div', 'sw-field-label');
      biomeLabel.innerHTML = icon('world');
      biomeLabel.appendChild(document.createTextNode('Pick a world'));
      biomeGrid = ui.el('div', 'sw-biomes');
      const sizeLabel = ui.el('div', 'sw-field-label');
      sizeLabel.innerHTML = icon('build');
      sizeLabel.appendChild(document.createTextNode('How big?'));
      sizeRow = ui.el('div', 'sw-sizes');
      const row = ui.el('div', 'sw-create-row');
      const create = ui.button({
        icon: 'sparkle', label: 'Create!', variant: 'pink', size: 'big', className: 'sw-create',
        onClick: () => {
          const name = nameInput.value.trim() || suggestName();
          game.newWorld({ name, biome: choice.biome, size: choice.size });
        },
      });
      row.appendChild(create);
      container.append(nameLabel, nameInput, biomeLabel, biomeGrid, sizeLabel, sizeRow, row);
    },
    onOpen() {
      if (!game.registry.biomes.has(choice.biome)) choice.biome = game.registry.biomes.keys().next().value;
      nameTouched = false;
      nameInput.value = suggestName();
      renderBiomes();
      renderSizes();
    },
  });

  // ---------- my worlds ----------
  let worldsList;
  const renderWorlds = async () => {
    const worlds = await game.store.listWorlds();
    worldsList.innerHTML = '';
    worldsList.className = worlds.length ? 'sw-worlds' : '';
    if (!worlds.length) {
      const empty = ui.el('div', 'sw-empty');
      empty.appendChild(ui.el('div', '', 'No worlds yet. Let\'s make one!'));
      empty.appendChild(ui.button({ icon: 'plus', label: 'New World', variant: 'mint', onClick: () => ui.open('newworld') }));
      worldsList.appendChild(empty);
      return;
    }
    for (const w of worlds) {
      const card = ui.el('div', 'sw-world');
      const thumb = ui.el('div', 'sw-world-thumb');
      if (w.thumbnail) {
        const img = ui.el('img');
        img.alt = '';
        img.src = w.thumbnail;
        thumb.appendChild(img);
      } else {
        thumb.innerHTML = icon('world');
      }
      const info = ui.el('div', 'sw-world-info');
      const biome = game.registry.biomes.get(w.biome);
      info.append(ui.el('div', 'sw-world-name', w.name), ui.el('div', 'sw-world-meta', `${biome ? biome.name : w.biome} · ${relativeDay(w.updatedAt)}`));
      const actions = ui.el('div', 'sw-world-actions');
      actions.append(
        ui.button({ icon: 'play', label: 'Play', variant: 'pink', size: 'small', onClick: () => game.loadWorld(w.id) }),
        ui.button({ icon: 'pencil', variant: 'white', size: 'icon', title: 'Rename', onClick: () => renameWorld(w) }),
        ui.button({ icon: 'trash', variant: 'white', size: 'icon', title: 'Delete', onClick: () => deleteWorld(w) }),
      );
      card.append(thumb, info, actions);
      worldsList.appendChild(card);
    }
  };

  async function renameWorld(meta) {
    const name = await ui.textInput({ title: 'Rename world', value: meta.name, suggestions: (NAME_IDEAS[meta.biome] || NAME_IDEAS.meadow).map((s) => `${playerName()}'s ${s}`), ok: 'Save' });
    if (!name) return;
    const save = await game.store.loadWorld(meta.id);
    if (!save) return;
    save.name = name;
    save.updatedAt = Date.now();
    await game.store.saveWorld(save);
    game.toast('Renamed!', { icon: 'pencil' });
    renderWorlds();
  }

  async function deleteWorld(meta) {
    const first = await ui.confirm({ title: 'Delete this world?', text: `"${meta.name}" will be gone.`, yes: 'Yes, delete', no: 'No, keep it', icon: 'trash' });
    if (!first) return;
    const second = await ui.confirm({ title: 'Are you really sure?', text: 'You can\'t get it back!', yes: 'Yes, delete', no: 'No, keep it', icon: 'trash' });
    if (!second) return;
    await game.store.deleteWorld(meta.id);
    if (game.profile.lastWorldId === meta.id) {
      game.profile.lastWorldId = null;
      game.saveProfile();
    }
    game.toast('World deleted', { icon: 'trash' });
    renderWorlds();
  }

  ui.registerPanel('worlds', {
    title: 'My Worlds',
    icon: 'world',
    width: 860,
    back: (g) => (g.mode === 'title' ? 'title' : null),
    build(container) {
      worldsList = ui.el('div', 'sw-worlds');
      container.appendChild(worldsList);
    },
    onOpen() {
      renderWorlds();
    },
  });

  // ---------- pause ----------
  let pauseToggles;
  const renderToggles = () => {
    pauseToggles.innerHTML = '';
    const s = game.profile.settings;
    const musicOn = s.music > 0;
    const sfxOn = s.sfx > 0;
    pauseToggles.append(
      ui.button({
        icon: musicOn ? 'music' : 'mute', label: musicOn ? 'Music on' : 'Music off', variant: 'white', size: 'small',
        onClick: () => {
          s.music = musicOn ? 0 : 0.5;
          game.applySettings();
          game.audio.music(s.music > 0);
          game.saveProfile();
          renderToggles();
        },
      }),
      ui.button({
        icon: sfxOn ? 'sound' : 'mute', label: sfxOn ? 'Sounds on' : 'Sounds off', variant: 'white', size: 'small',
        onClick: () => {
          s.sfx = sfxOn ? 0 : 0.8;
          game.applySettings();
          game.saveProfile();
          renderToggles();
        },
      }),
      ui.button({
        icon: 'camera3d', label: game.cameraRig && game.cameraRig.mode === 'first' ? 'My eyes' : 'Behind me', variant: 'white', size: 'small',
        onClick: () => {
          game.runAction('camera');
          renderToggles();
        },
      }),
    );
  };

  ui.registerPanel('pause', {
    title: 'Paused',
    icon: 'menu',
    width: 480,
    build(container) {
      const col = ui.el('div', 'sw-pause');
      col.append(
        ui.button({ icon: 'play', label: 'Resume', variant: 'pink', size: 'big', onClick: () => ui.close() }),
        ui.button({ icon: 'home', label: 'Save & Exit', variant: 'lav', onClick: () => game.exitToTitle() }),
      );
      if (ui.hasPanel('settings')) col.appendChild(ui.button({ icon: 'settings', label: 'Settings', variant: 'sky', onClick: () => ui.open('settings') }));
      pauseToggles = ui.el('div', 'sw-pause-row');
      col.appendChild(pauseToggles);
      container.appendChild(col);
    },
    onOpen() {
      renderToggles();
    },
  });
}
