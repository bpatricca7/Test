// Pets UI: the adoption panel ('adopt': pick a color with a live spinning preview, pick a
// name, Adopt!), the Pets panel ('pets': your pets, Call / Stay / Rename / Home / Goodbye,
// adopt more), the little action bubble over a pet after petting it (Ride / Feed / Stay),
// and the HUD buttons (Pets, Hop off).

import { SPECIES, SPECIES_KEYS, buildRig, petThumbObject, optsKey } from './species.js';
import { newAnim, animate, playTrick } from './anim.js';
import { preview } from './preview.js';
import { lifeButton, lifeHud, lifeIcon, toScreen, basketCount } from './kit.js';
import { sfx } from './sfx.js';
import { FOOD, foodIcon } from '../food-models.js';

const CSS = /* css */ `
.lf-adopt { display: grid; grid-template-columns: minmax(200px, 290px) 1fr; gap: 20px; align-items: start; }
.lf-stage { position: relative; width: 100%; aspect-ratio: 1; border-radius: 28px; overflow: hidden;
  background: radial-gradient(circle at 50% 42%, #FFFFFF 0%, #FFEAF4 48%, #E3D8FF 100%);
  border: 5px solid #fff; box-shadow: inset 0 -10px 0 rgba(58,31,77,.05), 0 8px 20px var(--sw-shadow); }
.lf-stage::before { content: ''; position: absolute; left: 14%; right: 14%; bottom: 12%; height: 14%; border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255,255,255,.95), rgba(255,255,255,0) 70%); }
.lf-stage canvas, .lf-stage > img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.lf-stage .lf-spark { position: absolute; width: 22px; height: 22px; color: var(--sw-sun); animation: sw-twinkle 1.8s ease-in-out infinite; pointer-events: none; }
.lf-stage .lf-spark svg { width: 100%; height: 100%; }
.lf-stage-hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 14px; font-weight: 600; color: var(--sw-lav); pointer-events: none; }
.lf-variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
.lf-variant { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 4px 8px; min-height: 104px;
  border-radius: 20px; background: #fff; border: 4px solid var(--sw-pink-soft); cursor: pointer; font-family: var(--sw-font);
  transition: transform .18s var(--sw-bounce), border-color .15s; }
.lf-variant img { width: 66px; height: 66px; pointer-events: none; }
.lf-variant span { font-size: 15px; font-weight: 700; color: var(--sw-ink); text-align: center; line-height: 1.05; }
.lf-group { grid-column: 1 / -1; font-size: 16px; font-weight: 700; color: var(--sw-lav); margin: 4px 0 -2px; display: flex; align-items: center; gap: 6px; }
.lf-group svg { width: 18px; height: 18px; color: var(--sw-pink); }
.lf-opts { display: flex; gap: 10px; margin: 10px 0 4px; flex-wrap: wrap; }
.lf-opt { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 6px 16px 6px 8px; border-radius: 26px; background: #fff;
  border: 4px solid var(--sw-pink-soft); font: 700 17px var(--sw-font); color: var(--sw-ink); cursor: pointer; transition: transform .18s var(--sw-bounce), border-color .15s; }
.lf-opt img { width: 40px; height: 40px; }
.lf-opt:active { transform: scale(.94); }
.lf-opt.sw-sel { border-color: var(--sw-pink); box-shadow: 0 0 0 3px #fff, 0 5px 14px rgba(255,95,162,.4); }
.lf-variant:hover { transform: translateY(-3px) scale(1.03); }
.lf-variant:active { transform: scale(.94); }
.lf-variant.sw-sel { border-color: var(--sw-pink); box-shadow: 0 0 0 4px #fff, 0 6px 18px rgba(255,95,162,.45); transform: scale(1.05); }
.lf-variant .lf-check { position: absolute; top: -9px; right: -9px; width: 30px; height: 30px; border-radius: 50%; background: var(--sw-pink); color: #fff; border: 3px solid #fff; display: none; place-items: center; }
.lf-variant.sw-sel .lf-check { display: grid; }
.lf-variant .lf-check svg { width: 17px; height: 17px; }
.lf-name-row { display: flex; gap: 8px; align-items: center; }
.lf-name-row .sw-input { flex: 1; min-width: 0; }
.lf-adopt .sw-chips { justify-content: flex-start; margin: 10px 0 4px; }
.lf-adopt .sw-chip { font-size: 16px; padding: 7px 14px; min-height: 40px; }
.lf-go { display: flex; justify-content: center; margin-top: 14px; position: sticky; bottom: -2px; z-index: 2; padding: 10px 0 4px;
  background: linear-gradient(rgba(255,248,252,0), #FFF8FC 38%); }
.lf-variants.lf-many { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
.lf-variants.lf-many .lf-variant { min-height: 90px; padding: 4px 3px 6px; }
.lf-variants.lf-many .lf-variant img { width: 54px; height: 54px; }
.lf-variants.lf-many .lf-variant span { font-size: 14px; }
.lf-go .sw-btn { min-width: 220px; }

.lf-pets { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
.lf-pet { background: #fff; border-radius: 22px; border: 4px solid var(--sw-pink-soft); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 5px 14px var(--sw-shadow); }
.lf-pet-top { display: flex; align-items: center; gap: 10px; }
.lf-pet-top img { width: 76px; height: 76px; flex: none; border-radius: 18px; background: radial-gradient(circle at 50% 40%, #fff, #FFEAF4 70%, #EFE8FF); }
.lf-pet-name { font-size: 22px; font-weight: 700; color: var(--sw-ink); line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lf-pet-meta { font-size: 15px; font-weight: 600; color: var(--sw-lav); display: flex; align-items: center; gap: 6px; }
.lf-pet-meta svg { width: 18px; height: 18px; color: var(--sw-pink); }
.lf-pet-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.lf-pet-actions .sw-btn { padding: 4px 6px; gap: 4px; min-height: 46px; font-size: 15px; min-width: 0; }
.lf-pet-actions .sw-btn svg { width: 1.15em; height: 1.15em; }
.lf-section { font-size: 20px; font-weight: 700; color: var(--sw-lav); margin: 18px 0 10px; display: flex; align-items: center; gap: 8px; }
.lf-section svg { width: 24px; height: 24px; }
.lf-species { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; }
.lf-empty { text-align: center; padding: 12px; font-size: 19px; color: var(--sw-lav); font-weight: 600; }

.lf-bubble { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); display: none; flex-direction: column; align-items: center; gap: 6px; width: max-content; max-width: 94vw;
  padding: 8px 12px 10px; background: rgba(255,255,255,.97); border: 4px solid var(--sw-pink-soft); border-radius: 26px;
  box-shadow: 0 8px 22px var(--sw-shadow); z-index: 3; }
.lf-bubble.lf-on { display: flex; }
.lf-bubble::after { content: ''; position: absolute; left: 50%; bottom: -13px; width: 20px; height: 20px; margin-left: -10px; background: #fff; border-right: 4px solid var(--sw-pink-soft); border-bottom: 4px solid var(--sw-pink-soft); transform: rotate(45deg); border-radius: 0 0 6px 0; }
.lf-bubble-name { font-size: 18px; font-weight: 700; color: var(--sw-pink); display: flex; align-items: center; gap: 6px; }
.lf-bubble-name svg { width: 20px; height: 20px; }
.lf-bubble-row { display: flex; gap: 8px; align-items: flex-start; }
.lf-bubble .sw-round-face { width: 56px; height: 56px; }
.lf-bubble .sw-round-face svg { width: 30px; height: 30px; }
.lf-bubble .sw-round-face img { width: 44px; height: 44px; }
.lf-bubble .sw-round-label { font-size: 14px; }
.lf-bubble .lf-count { position: absolute; top: -4px; right: -6px; min-width: 24px; height: 24px; padding: 0 5px; border-radius: 12px; background: var(--sw-pink); color: #fff; font-size: 13px; font-weight: 700; display: grid; place-items: center; border: 2px solid #fff; }
.lf-bubble .sw-round { position: relative; }
@media (max-width: 640px) {
  .lf-adopt { grid-template-columns: 1fr; gap: 12px; }
  .lf-stage { width: min(230px, 64vw); margin: 0 auto; }
  .lf-variants { grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px; }
  .lf-variant { min-height: 92px; }
  .lf-variant img { width: 54px; height: 54px; }
  .lf-pets { grid-template-columns: 1fr; }
}
`;

const COMMON_NAMES = ['Biscuit', 'Luna', 'Sprinkles', 'Mochi', 'Coco', 'Daisy', 'Bubbles', 'Pudding', 'Marshmallow', 'Honey'];

export function petThumb(game, species, variant, opts = null) {
  const ok = optsKey(opts);
  return game.thumbs.get(`pet:${species}:${variant}${ok ? ':' + ok : ''}`, () => petThumbObject(species, variant, opts || {}), { dir: [0.95, 0.5, 1.5], zoom: 0.82 });
}

function img(ui, url) {
  const i = ui.el('img');
  i.alt = '';
  i.draggable = false;
  if (url) i.src = url;
  return i;
}

export function installPetUI(game, sys) {
  const ui = game.ui;
  ui.addStyles(CSS);

  // ---------------- adoption panel ----------------
  const adopt = { species: 'puppy', variant: null, spot: null, rig: null, anim: null, hopT: 0, braids: false };
  let stage, variantsEl, optsEl, nameInput, chipsEl, fallbackImg, goBtn, pickText;
  const PICK_TEXT = { puppy: 'Pick a color or a breed', kitty: 'Pick a color or a breed', horse: 'Pick a coat', turtle: 'Pick a shell' };
  const adoptOpts = () => (adopt.species === 'horse' && adopt.braids ? { braids: true } : {});

  const suggestions = (species) => {
    const own = SPECIES[species].names;
    const taken = new Set(sys.pets.map((p) => p.name));
    const pool = [...own.slice(0, 5), ...COMMON_NAMES].filter((n, i, a) => a.indexOf(n) === i && !taken.has(n));
    return pool.slice(0, 8);
  };

  const showPreview = () => {
    const pv = preview(game);
    const rig = buildRig(adopt.species, adopt.variant, adoptOpts());
    adopt.rig = rig;
    adopt.anim = newAnim();
    adopt.hopT = 1.2;
    if (pv.failed || !pv.mount(stage, 280)) {
      fallbackImg.hidden = false;
      petThumb(game, adopt.species, adopt.variant, adoptOpts()).then((url) => { fallbackImg.src = url; });
      return;
    }
    fallbackImg.hidden = true;
    const big = SPECIES[adopt.species].rideable;
    pv.show(rig.root, {
      spin: 0.55, yaw: 0.6, dir: [0, big ? 0.35 : 0.42, 1], zoom: big ? 1.02 : 1.08, lift: 0.45,
      onFrame: (dt) => {
        const a = adopt.anim;
        a.lookYaw = Math.sin(a.t * 0.7) * 0.3;
        a.wag = 0.8;
        adopt.hopT -= dt;
        if (adopt.hopT <= 0) {
          adopt.hopT = 3 + Math.random() * 2;
          playTrick(a, Math.random() < 0.5 ? 'hop' : SPECIES[adopt.species].trick);
          a.happy = 1.4;
        }
        animate(rig, a, dt);
      },
    });
  };

  const groupLabel = (text, iconName) => {
    const h = ui.el('div', 'lf-group');
    h.innerHTML = lifeIcon(iconName);
    h.appendChild(document.createTextNode(text));
    return h;
  };

  const renderVariants = () => {
    variantsEl.innerHTML = '';
    const all = SPECIES[adopt.species].variants;
    variantsEl.classList.toggle('lf-many', all.length > 6);
    const grouped = all.some((v) => v.group === 'breeds');
    // colors first, then breeds (with a little heading each)
    const order = grouped ? [...all.filter((v) => v.group !== 'breeds'), ...all.filter((v) => v.group === 'breeds')] : all;
    let lastGroup = null;
    for (const v of order) {
      const grp = v.group === 'breeds' ? 'breeds' : 'colors';
      if (grouped && grp !== lastGroup) {
        variantsEl.appendChild(groupLabel(grp === 'breeds' ? 'Breeds' : 'Colors', grp === 'breeds' ? 'paw' : 'sparkle'));
        lastGroup = grp;
      }
      const b = ui.el('button', 'lf-variant' + (v.key === adopt.variant ? ' sw-sel' : ''));
      b.type = 'button';
      b.dataset.variant = v.key;
      b.setAttribute('aria-label', v.name);
      const pic = img(ui, '');
      pic.style.visibility = 'hidden';
      petThumb(game, adopt.species, v.key, adoptOpts()).then((url) => { if (url) { pic.src = url; pic.style.visibility = 'visible'; } });
      const check = ui.el('span', 'lf-check');
      check.innerHTML = ui.icon('check');
      b.append(pic, ui.el('span', '', v.name), check);
      b.addEventListener('click', () => {
        if (adopt.variant === v.key) return;
        adopt.variant = v.key;
        sfx(game, 'pop', { pitch: 1.1 });
        renderVariants();
        renderOpts();
        showPreview();
      });
      variantsEl.appendChild(b);
    }
  };

  const renderChips = () => {
    chipsEl.innerHTML = '';
    for (const n of suggestions(adopt.species)) {
      const c = ui.el('button', 'sw-chip', n);
      c.type = 'button';
      c.addEventListener('click', () => {
        nameInput.value = n;
        sfx(game, 'pop', { pitch: 1.2 });
      });
      chipsEl.appendChild(c);
    }
  };

  // options a species offers (the horse's mane: flowing or braided)
  const renderOpts = () => {
    optsEl.innerHTML = '';
    optsEl.hidden = adopt.species !== 'horse';
    if (adopt.species !== 'horse') return;
    for (const [braids, label] of [[false, 'Flowing Mane'], [true, 'Braided Mane']]) {
      const b = ui.el('button', 'lf-opt' + (adopt.braids === braids ? ' sw-sel' : ''));
      b.type = 'button';
      b.dataset.braids = braids ? '1' : '0';
      const pic = img(ui, '');
      petThumb(game, 'horse', adopt.variant, braids ? { braids: true } : null).then((url) => { if (url) pic.src = url; });
      b.append(pic, ui.el('span', '', label));
      b.addEventListener('click', () => {
        if (adopt.braids === braids) return;
        adopt.braids = braids;
        sfx(game, 'pop', { pitch: 1.15 });
        renderOpts();
        renderVariants();
        showPreview();
      });
      optsEl.appendChild(b);
    }
  };

  const doAdopt = () => {
    const name = nameInput.value.trim() || suggestions(adopt.species)[0] || SPECIES[adopt.species].names[0];
    const spot = adopt.spot;
    const opts = adoptOpts();
    ui.close();
    const pet = sys.adopt(adopt.species, adopt.variant, name, spot, { opts });
    if (pet) game.toast(`Welcome home, ${pet.name}!`, { icon: 'heart', big: true, color: 'pink' });
  };

  ui.registerPanel('adopt', {
    title: 'New Friend!',
    icon: 'heart',
    width: 860,
    build(container) {
      const wrap = ui.el('div', 'lf-adopt');
      stage = ui.el('div', 'lf-stage');
      fallbackImg = img(ui, '');
      fallbackImg.hidden = true;
      stage.appendChild(fallbackImg);
      for (const [x, y, d] of [[8, 12, 0], [80, 18, 0.6], [14, 70, 1.1], [84, 66, 0.3]]) {
        const s = ui.el('span', 'lf-spark');
        s.innerHTML = lifeIcon('sparkle');
        s.style.left = x + '%';
        s.style.top = y + '%';
        s.style.animationDelay = d + 's';
        stage.appendChild(s);
      }
      stage.appendChild(ui.el('div', 'lf-stage-hint', 'Drag to spin!'));
      const side = ui.el('div', 'lf-side');
      const colorLabel = ui.el('div', 'sw-field-label');
      colorLabel.innerHTML = lifeIcon('sparkle');
      pickText = document.createTextNode('Pick a color');
      colorLabel.appendChild(pickText);
      variantsEl = ui.el('div', 'lf-variants');
      optsEl = ui.el('div', 'lf-opts');
      optsEl.hidden = true;
      const nameLabel = ui.el('div', 'sw-field-label');
      nameLabel.innerHTML = ui.icon('pencil');
      nameLabel.appendChild(document.createTextNode('Name'));
      const row = ui.el('div', 'lf-name-row');
      nameInput = ui.el('input', 'sw-input lf-name');
      nameInput.maxLength = 18;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck = false;
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doAdopt(); }
      });
      const dice = lifeButton(ui, {
        icon: 'dice', variant: 'sun', size: 'icon', title: 'Surprise name',
        onClick: () => {
          const s = suggestions(adopt.species);
          nameInput.value = s[Math.floor(Math.random() * s.length)] || nameInput.value;
          sfx(game, 'boing');
        },
      });
      row.append(nameInput, dice);
      chipsEl = ui.el('div', 'sw-chips');
      const go = ui.el('div', 'lf-go');
      goBtn = lifeButton(ui, { icon: 'heart', label: 'Adopt!', variant: 'pink', size: 'big', className: 'lf-adopt-go', onClick: doAdopt });
      go.appendChild(goBtn);
      side.append(colorLabel, variantsEl, optsEl, nameLabel, row, chipsEl, go);
      wrap.append(stage, side);
      container.appendChild(wrap);
    },
    onOpen(args = {}) {
      adopt.species = SPECIES[args.species] ? args.species : 'puppy';
      adopt.spot = args.spot || null;
      adopt.variant = SPECIES[adopt.species].variants[0].key;
      adopt.braids = false;
      pickText.textContent = PICK_TEXT[adopt.species] || 'Pick a color';
      ui.setTitle('adopt', `Meet your ${SPECIES[adopt.species].name}!`);
      const s = suggestions(adopt.species);
      nameInput.value = s[0] || '';
      renderVariants();
      renderOpts();
      renderChips();
      showPreview();
      sfx(game, SPECIES[adopt.species].voice, { volume: 0.7 });
    },
    onClose() {
      const pv = preview(game);
      pv.clear();
      pv.unmount();
    },
  });

  // ---------------- pets panel ----------------
  let listEl, adoptRow;
  const MODE_TEXT = { follow: 'Following you', stay: 'Staying put', home: 'At home' };

  const renderPets = () => {
    listEl.innerHTML = '';
    if (!sys.pets.length) {
      listEl.className = '';
      listEl.appendChild(ui.el('div', 'lf-empty', 'No pets yet! Pick a friend below.'));
    } else {
      listEl.className = 'lf-pets';
    }
    for (const pet of sys.pets) {
      const card = ui.el('div', 'lf-pet');
      const top = ui.el('div', 'lf-pet-top');
      const pic = img(ui, '');
      petThumb(game, pet.species, pet.variant, pet.opts).then((url) => { pic.src = url; });
      const words = ui.el('div');
      words.style.minWidth = '0';
      const meta = ui.el('div', 'lf-pet-meta');
      meta.innerHTML = lifeIcon('paw');
      meta.appendChild(document.createTextNode(`${SPECIES[pet.species].name} · ${MODE_TEXT[pet.mode]}`));
      words.append(ui.el('div', 'lf-pet-name', pet.name), meta);
      top.append(pic, words);
      const acts = ui.el('div', 'lf-pet-actions');
      acts.append(
        lifeButton(ui, { icon: 'bell', label: 'Call', variant: 'mint', size: 'small', onClick: () => { sys.call(pet); renderPets(); } }),
        pet.mode === 'follow'
          ? lifeButton(ui, { icon: 'sit', label: 'Stay', variant: 'sky', size: 'small', onClick: () => { sys.setMode(pet, 'stay'); renderPets(); } })
          : lifeButton(ui, { icon: 'paw', label: 'Follow', variant: 'sky', size: 'small', onClick: () => { sys.setMode(pet, 'follow'); renderPets(); } }),
        lifeButton(ui, { icon: 'pencil', label: 'Name', variant: 'sun', size: 'small', onClick: () => rename(pet) }),
        lifeButton(ui, { icon: 'home', label: 'Home', variant: 'lav', size: 'small', onClick: () => { sys.sendHome(pet); renderPets(); } }),
        lifeButton(ui, { icon: 'eat', label: 'Feed', variant: 'pink', size: 'small', onClick: () => { ui.close(); sys.call(pet, false); showBubble(pet, 'feed'); } }),
        lifeButton(ui, { icon: 'wave', label: 'Bye', variant: 'white', size: 'small', onClick: () => goodbye(pet) }),
      );
      card.append(top, acts);
      listEl.appendChild(card);
    }
    adoptRow.innerHTML = '';
    for (const sp of SPECIES_KEYS) {
      const b = ui.el('button', 'lf-variant');
      b.type = 'button';
      b.setAttribute('aria-label', 'Adopt a ' + SPECIES[sp].name);
      const pic = img(ui, '');
      petThumb(game, sp, SPECIES[sp].variants[0].key).then((url) => { pic.src = url; });
      b.append(pic, ui.el('span', '', SPECIES[sp].name));
      b.addEventListener('click', () => {
        if (sys.pets.length >= sys.max) {
          game.toast(`You have ${sys.max} pets! That's so much love!`, { icon: 'heart' });
          return;
        }
        game.setSlot(game.hotbar.index, 'pet:' + sp);
        ui.close();
        game.toast(`Tap the ground to meet your new ${SPECIES[sp].name}!`, { icon: 'heart' });
      });
      adoptRow.appendChild(b);
    }
  };

  async function rename(pet) {
    const name = await ui.textInput({ title: `New name for ${pet.name}`, value: pet.name, suggestions: suggestions(pet.species).slice(0, 6), ok: 'Save' });
    if (!name) return;
    pet.setName(name);
    sfx(game, 'pop');
    game.toast(`Hello, ${pet.name}!`, { icon: 'heart' });
    if (ui.isOpen('pets')) renderPets();
  }

  async function goodbye(pet) {
    const first = await ui.confirm({ title: `Say goodbye to ${pet.name}?`, text: `${pet.name} will go back to the pet meadow.`, yes: 'Bye bye', no: 'Stay!', icon: 'heart' });
    if (!first) return;
    const second = await ui.confirm({ title: 'Are you sure?', text: `Give ${pet.name} one last hug!`, yes: 'Yes, bye', no: 'No, stay!', icon: 'heart' });
    if (!second) return;
    sys.remove(pet, { fx: true });
    game.toast(`Bye bye, ${pet.name}! Come visit!`, { icon: 'heart' });
    if (ui.isOpen('pets')) renderPets();
  }

  ui.registerPanel('pets', {
    title: 'My Pets',
    icon: 'heart',
    width: 860,
    build(container) {
      listEl = ui.el('div', 'lf-pets');
      const sec = ui.el('div', 'lf-section');
      sec.innerHTML = lifeIcon('paw');
      sec.appendChild(document.createTextNode('Adopt a new friend'));
      adoptRow = ui.el('div', 'lf-species');
      container.append(listEl, sec, adoptRow);
    },
    onOpen() {
      renderPets();
    },
  });

  // ---------------- bubble over a pet ----------------
  const bubble = ui.el('div', 'lf-bubble');
  ui.hudLayer.appendChild(bubble);
  const bub = { pet: null, openedAt: 0, idle: 0, view: 'main' };
  const at = { x: 0, y: 0 };

  const roundBtn = (label, color, face, onClick, count = null) => {
    const b = ui.el('button', 'sw-round');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    const f = ui.el('span', 'sw-round-face');
    f.style.setProperty('--c', color);
    if (typeof face === 'string') f.innerHTML = face;
    else f.appendChild(face);
    b.append(f, ui.el('span', 'sw-round-label', label));
    if (count !== null) b.appendChild(ui.el('span', 'lf-count', String(count)));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      game.audio.play('click');
      bub.idle = 0;
      onClick();
    });
    return b;
  };

  function renderBubble() {
    const pet = bub.pet;
    if (!pet) return;
    bubble.innerHTML = '';
    const name = ui.el('div', 'lf-bubble-name');
    name.innerHTML = lifeIcon('eat');
    name.appendChild(document.createTextNode(pet.name));
    const row = ui.el('div', 'lf-bubble-row');
    if (bub.view === 'feed') {
      const treat = FOOD[SPECIES[pet.species].treat];
      const tImg = img(ui, '');
      foodIcon(game, SPECIES[pet.species].treat).then((u) => { tImg.src = u; });
      row.appendChild(roundBtn(treat ? treat.name : 'Treat', 'var(--sw-sun)', tImg, () => { sys.feed(pet, 'treat'); hideBubble(); }));
      const owned = Object.keys(game.profile.basket || {}).filter((k) => FOOD[k] && FOOD[k].kind !== 'flower' && basketCount(game, k) > 0).slice(0, 4);
      for (const k of owned) {
        const fi = img(ui, '');
        foodIcon(game, k).then((u) => { fi.src = u; });
        row.appendChild(roundBtn(FOOD[k].name, 'var(--sw-pink-soft)', fi, () => { sys.feed(pet, k); hideBubble(); }, basketCount(game, k)));
      }
      row.appendChild(roundBtn('Back', 'var(--sw-lav)', ui.icon('back'), () => { bub.view = 'main'; renderBubble(); }));
    } else {
      if (SPECIES[pet.species].rideable) row.appendChild(roundBtn('Ride', 'var(--sw-pink)', lifeIcon('ride'), () => { hideBubble(); sys.mount(pet); }));
      row.appendChild(roundBtn('Feed', 'var(--sw-sun)', lifeIcon('eat'), () => { bub.view = 'feed'; renderBubble(); }));
      if (pet.mode === 'follow') row.appendChild(roundBtn('Stay', 'var(--sw-sky)', lifeIcon('sit'), () => { sys.setMode(pet, 'stay'); hideBubble(); }));
      else row.appendChild(roundBtn('Follow', 'var(--sw-mint)', lifeIcon('paw'), () => { sys.setMode(pet, 'follow'); hideBubble(); }));
      row.appendChild(roundBtn('Trick', 'var(--sw-lav)', lifeIcon('sparkle'), () => { sys.doTrick(pet); }));
    }
    bubble.append(name, row);
  }

  function showBubble(pet, view = 'main') {
    bub.pet = pet;
    bub.view = view;
    bub.openedAt = performance.now();
    bub.idle = 0;
    renderBubble();
    bubble.classList.add('lf-on');
    positionBubble();
  }

  function hideBubble() {
    bub.pet = null;
    bubble.classList.remove('lf-on');
  }

  function positionBubble() {
    const pet = bub.pet;
    if (!pet) return;
    const p = pet.pos;
    const s = toScreen(game, p.x, p.y + pet.tagY + 0.28, p.z, at);
    if (!s) {
      bubble.style.visibility = 'hidden';
      return;
    }
    bubble.style.visibility = '';
    const w = bubble.offsetWidth || 240, h = bubble.offsetHeight || 120;
    const W = game.container.clientWidth, Hh = game.container.clientHeight;
    const x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, s.x));
    const y = Math.max(h + 8, Math.min(Hh - 90, s.y));
    bubble.style.left = Math.round(x) + 'px';
    bubble.style.top = Math.round(y) + 'px';
  }

  game.input.on('tap', () => {
    if (bub.pet && performance.now() - bub.openedAt > 120) hideBubble();
  });
  game.events.on('ui:open', hideBubble);
  game.events.on('world:unload', hideBubble);

  // ---------------- HUD buttons ----------------
  const hud = lifeHud(game);
  hud.add('pets', { icon: 'paw', label: 'Pets', color: 'var(--sw-mint)', order: 20, onClick: () => ui.open('pets') });
  const hop = hud.add('hopoff', { icon: 'hopoff', label: 'Hop off', color: 'var(--sw-pink)', order: 0, onClick: () => sys.dismount() });
  hop.classList.add('lf-pulse');
  const refreshHud = () => {
    hud.show('pets', sys.pets.length > 0 && !(hudOther.pets));
    hud.show('hopoff', !!sys.rider);
  };
  const hudOther = { pets: false };
  game.events.on('world:load', () => {
    hudOther.pets = false;
    // if the HUD team already shows a Pets button, ours stays hidden
    setTimeout(() => {
      hudOther.pets = !!ui.hudLayer.querySelector('.sw-hud [data-action="pets"], .sw-hud [aria-label="Pets"]');
      refreshHud();
    }, 0);
    refreshHud();
  });

  return {
    showBubble,
    hideBubble,
    refreshHud,
    refreshPanel: () => { if (ui.isOpen('pets')) renderPets(); },
    update(dt) {
      if (!bub.pet) return;
      const pet = bub.pet;
      bub.idle += dt;
      if (!sys.pets.includes(pet) || pet.riding || game.paused || bub.idle > 9 || !pet.isNearPlayer(10)) {
        hideBubble();
        return;
      }
      pet.attention = Math.max(pet.attention, 0.5);
      positionBubble();
    },
  };
}
