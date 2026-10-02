// "Keep her worlds safe" on the website version (docs/teams/keepsafe.md):
//  - game.keepsafe (src/core/keepsafe.js) asks the browser to keep this site's storage;
//  - on the title screen, a gentle card "It's been a while! Save a copy of your worlds?" when a
//    copy is due (website only, storage not kept for sure or an iPhone/iPad tab, she has worlds,
//    7 days since the last copy; "Not now" waits 7 days). Never while playing, never inside
//    claude.ai (worlds save to her account there), never on file://;
//  - saveAllWorlds(game): every world + her look, outfits, stickers and coins in one file;
//  - openWorldFile(game): "Open a file" for one world or a whole backup; a world that is
//    already here is never replaced without asking (an in-page question with both pictures).

import { KeepSafe } from '../core/keepsafe.js';
import { mergeBackupProfile } from '../core/storage.js';
import { choiceDialog } from './dialogs.js';
import { icon2, button2 } from './menus/icons2.js';
import { saveFile, pickTextFile } from './menus/files.js';

const REMIND_DELAY_MS = 1200; // the title settles first (and a quick Play skips the card)

const CSS = /* css */ `
.ks-card, .ks-conflict { max-height: 100%; overflow-y: auto; overscroll-behavior: contain; }
.ks-card { width: min(500px, 100%); padding-top: 12px; border-color: #FFE38A; background: linear-gradient(180deg, #FFFBEA 0%, #fff 42%); }
.ks-card h3 { margin-top: 0; }
.ks-card .ks-ask { margin: 0 0 18px; font-size: 22px; font-weight: 600; color: var(--sw-ink); }
.ks-card .sw-dialog-buttons { flex-wrap: nowrap; }
.ks-card .sw-dialog-buttons .sw-btn { min-width: 0; flex: 0 1 auto; }
.sw-dialog .sw-dialog-note { margin: 16px 4px 0; font-size: 14px; line-height: 1.35; font-weight: 500; color: #7A6690; text-wrap: pretty; }

/* the picture: her worlds' own pictures tucked into a pink treasure box */
.ks-art { position: relative; width: 260px; height: 160px; margin: 0 auto 4px; pointer-events: none; }
.ks-art > * { position: absolute; }
.ks-lid { left: 0; top: 62px; width: 260px; height: 44px; }
.ks-box { left: 0; top: 92px; width: 260px; height: 68px; filter: drop-shadow(0 6px 8px rgba(58,31,77,.18)); }
.ks-shot { width: 88px; height: 56px; border-radius: 11px; border: 4px solid #fff; background: linear-gradient(135deg, #BDF5C6, #9FD8FF); object-fit: cover; box-shadow: 0 4px 12px rgba(58,31,77,.28); animation: ks-bob 2.6s ease-in-out infinite; }
.ks-spark { width: 22px; height: 22px; animation: sw-twinkle 1.8s ease-in-out infinite; }
.ks-spark svg { width: 100%; height: 100%; }
@keyframes ks-bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }

/* "is already here": the two worlds side by side, three answers in a column */
.ks-conflict { width: min(520px, 100%); }
.ks-conflict h3 { font-size: 25px; line-height: 1.15; overflow-wrap: anywhere; text-wrap: balance; }
.ks-count { margin: 0 0 10px; font-size: 15px; font-weight: 600; color: var(--sw-lav); }
.ks-vs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 12px 0 16px; }
.ks-side { position: relative; background: var(--sw-cream); border: 4px solid var(--sw-lav-soft); border-radius: 20px; padding: 8px 8px 6px; }
.ks-side img { display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 13px; background: linear-gradient(135deg, #BDF5C6, #9FD8FF); }
.ks-side-label { margin-top: 5px; font-size: 17px; font-weight: 700; color: var(--sw-ink); display: flex; align-items: center; justify-content: center; gap: 5px; }
.ks-side-label svg { width: 19px; height: 19px; color: var(--sw-lav); flex: none; }
.ks-side-when { font-size: 14px; font-weight: 600; color: var(--sw-lav); }
.ks-side.ks-newer { border-color: #FFD66B; }
.ks-newer-tag { position: absolute; top: -13px; right: -8px; padding: 2px 10px; border-radius: 999px; background: var(--sw-sun); color: var(--sw-ink); border: 3px solid #fff; font-size: 14px; font-weight: 700; box-shadow: 0 3px 8px var(--sw-shadow); }
.ks-conflict .sw-dialog-buttons { flex-direction: column; align-items: stretch; width: min(360px, 100%); margin: 0 auto; }
@media (max-width: 480px) {
  .ks-card .sw-dialog-buttons { flex-direction: column-reverse; align-items: stretch; flex-wrap: wrap; }
  .ks-card .ks-ask { font-size: 21px; }
  .ks-conflict h3 { font-size: 22px; }
  .ks-side-label { font-size: 15px; }
}
@media (max-height: 560px) {
  .ks-art { transform: scale(.7); margin: -24px auto -22px; }
  .ks-card .ks-ask { margin-bottom: 10px; }
  .sw-dialog .sw-dialog-note { margin-top: 8px; }
}
`;

// a little painted world for a world without a picture yet
const FALLBACK_SHOT = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8FD3FF"/><stop offset="1" stop-color="#FFE0F0"/></linearGradient></defs>' +
  '<rect width="160" height="100" fill="url(#s)"/><circle cx="128" cy="24" r="11" fill="#FFE38A"/>' +
  '<path d="M0 70 Q40 50 80 64 T160 60 V100 H0Z" fill="#A6E7A0"/><path d="M0 84 Q60 70 110 80 T160 78 V100 H0Z" fill="#86D67A"/>' +
  '<rect x="58" y="50" width="30" height="22" fill="#FFB3D4"/><path d="M54 52 L73 36 L92 52Z" fill="#FF5FA2"/><rect x="69" y="60" width="8" height="12" fill="#fff"/></svg>');

const HEART = 'M130 54c-10-6.8-14.2-12.8-11.2-17.8 2.6-4 8.2-3.8 11.2.4 3-4.2 8.6-4.4 11.2-.4 3 5-1.2 11-11.2 17.8Z';

function artHtml(shots) {
  const lid = `<svg class="ks-lid" viewBox="0 0 260 44" aria-hidden="true"><path d="M38 42 L58 8 Q61 3 68 3 H192 Q199 3 202 8 L222 42 Z" fill="#FFC7DF" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M76 12 H184" stroke="#FFE0EE" stroke-width="6" stroke-linecap="round"/></svg>`;
  const box = `<svg class="ks-box" viewBox="0 0 260 68" aria-hidden="true">
    <path d="M38 16 H222 L214 57 Q213 64 205 64 H55 Q47 64 46 57 Z" fill="#FF8FC0" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>
    <path d="M78 22 V62 M182 22 V62" stroke="#FFA9CD" stroke-width="12"/>
    <rect x="26" y="4" width="208" height="20" rx="10" fill="#FFB3D4" stroke="#fff" stroke-width="4"/>
    <circle cx="130" cy="44" r="17" fill="#fff"/>
    <path d="${HEART}" fill="#FF5FA2"/>
  </svg>`;
  const pos = shots.length >= 3
    ? [[30, 48, -12, 0], [82, 34, 0, 0.35], [134, 48, 12, 0.7]]
    : shots.length === 2 ? [[48, 40, -8, 0], [116, 40, 8, 0.4]] : [[82, 36, 0, 0]];
  const cards = pos.map(([x, y, r, d], i) => `<img class="ks-shot" alt="" src="${shots[i] || FALLBACK_SHOT}" style="left:${x}px;top:${y}px;rotate:${r}deg;animation-delay:${-d}s">`).join('');
  const sparks = [[10, 30, '#FFC94D', 0], [228, 18, '#9C7BFF', 0.6], [232, 94, '#3FD8B0', 1.1], [12, 104, '#6CC6FF', 0.3]]
    .map(([x, y, c, d]) => `<span class="ks-spark" style="left:${x}px;top:${y}px;color:${c};animation-delay:${d}s">${icon2('sparkle')}</span>`).join('');
  return lid + cards + box + sparks;
}

function relativeDay(ms) {
  if (!ms) return 'A while ago';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Played today';
  if (days === 1) return 'Played yesterday';
  if (days < 14) return `Played ${days} days ago`;
  if (days < 60) return `Played ${Math.round(days / 7)} weeks ago`;
  return `Played ${Math.round(days / 30)} months ago`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Save every world and her own things in one file. Resolves 'saved' | 'declined' | 'failed'
 * (toasts included). A saved copy counts as a backup (the next reminder is 7 days away).
 */
export async function saveAllWorlds(game) {
  const text = await game.store.exportAll(game.profile);
  if (!text) {
    game.toast('Oops! Could not find your worlds.', { icon: 'sparkle' });
    return 'failed';
  }
  const res = await saveFile({ filename: `Glimmer World backup ${localDay()}.json`, data: text, mime: 'application/json' });
  if (res === 'saved') {
    game.toast('Saved a copy of your worlds!', { icon: 'download', color: 'mint' });
    game.audio.play('success');
    game.events.emit('files:saved', { what: 'all' });
  } else if (res === 'failed') {
    game.toast('Oops! Saving a file does not work here.', { icon: 'sparkle' });
  }
  return res;
}

/** The in-page question for a world that is already here. Resolves 'mine' | 'file' | 'both'. */
function askConflict(game, c) {
  const ui = game.ui;
  const newer = c.same ? null : (c.file.updatedAt || 0) > (c.mine.updatedAt || 0) ? 'file' : 'mine';
  // both played the same day: the time tells them apart
  const sameDay = relativeDay(c.file.updatedAt) === relativeDay(c.mine.updatedAt);
  const when = (ms) => {
    const day = relativeDay(ms);
    if (!sameDay || c.same || !ms) return day;
    try {
      return `${day}, ${new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch {
      return day;
    }
  };
  const vs = el('div', 'ks-vs');
  const side = (which, label, iconName, meta) => {
    const s = el('div', 'ks-side' + (newer === which ? ' ks-newer' : ''));
    s.dataset.side = which;
    const img = el('img');
    img.alt = '';
    img.src = meta.thumbnail || FALLBACK_SHOT;
    const l = el('div', 'ks-side-label');
    l.innerHTML = icon2(iconName);
    l.appendChild(document.createTextNode(label));
    s.append(img, l, el('div', 'ks-side-when', when(meta.updatedAt)));
    if (newer === which) s.appendChild(el('span', 'ks-newer-tag', 'Newer'));
    return s;
  };
  vs.append(side('mine', 'Here now', 'home', c.mine), side('file', 'In the file', 'open', c.file));
  const body = el('div');
  if (c.total > 1) body.appendChild(el('div', 'ks-count', `World ${c.index + 1} of ${c.total} in the file`));
  body.appendChild(vs);
  const choices = c.same
    ? [
      { value: 'both', label: 'Keep both', variant: 'white', icon: 'plus', className: 'ks-both' },
      { value: 'mine', label: 'OK', variant: 'pink', icon: 'check', className: 'ks-mine' },
    ]
    : [
      { value: 'mine', label: 'Keep the one here', variant: 'white', icon: 'home', className: 'ks-mine' },
      { value: 'file', label: 'Use the one in the file', variant: 'sky', icon: 'open', className: 'ks-file' },
      { value: 'both', label: 'Keep both', variant: 'mint', icon: 'plus', className: 'ks-both' },
    ];
  return choiceDialog(ui, {
    title: `\u201C${c.name}\u201D is already here`,
    body,
    text: c.same ? 'They are just the same.' : '',
    choices,
    cancelValue: 'mine',
    focus: c.same ? 1 : 0,
    className: 'ks-conflict',
    makeButton: (o) => button2(ui, o),
  });
}

/**
 * "Open a file": one world or a whole backup. Resolves null (no file picked) or the result of
 * store.importAll(); a backup's look, outfits and stickers are brought in as well
 * (mergeBackupProfile: her look only on a device with no worlds yet; nothing here is lost).
 */
export async function openWorldFile(game) {
  const text = await pickTextFile('.json,application/json,text/plain');
  if (!text) return null;
  const res = await game.store.importAll(text, { ask: (c) => askConflict(game, c) });
  if (res && res.ok && res.profile && mergeBackupProfile(game.profile, res.profile, { fresh: res.fresh })) {
    await game.saveProfile(true);
    game.events.emit('profile:changed', { profile: game.profile });
  }
  return res;
}

export function install(game) {
  const ui = game.ui;
  const ks = (game.keepsafe = new KeepSafe(game));
  ui.addStyles(CSS);
  game.events.on('game:ready', () => ks.start());
  // a world (or all of them) went into a file
  game.events.on('files:saved', () => ks.noteBackup());
  game.registerAction('saveAllToFile', (g) => saveAllWorlds(g));

  // ----- the title card -----
  let shownThisSession = false;
  let timer = 0;
  let asking = false;

  // on the title screen and nothing else going on (a world starting to load counts as gone)
  const titleOnly = () => game.mode === 'title' && !game.world && !game.loading && !game._busy && ui.isOpen('title') &&
    !(ui.loadingEl && ui.loadingEl.classList.contains('sw-open'));
  const onTitle = () => titleOnly() && !ui.dialogOpen;
  // her friends are waiting (a "Keep playing" / "Join" chip): that comes first
  const friendsFirst = () => {
    const net = game.net;
    if (!net) return false;
    if (net.active) return true;
    try {
      return !!(net.ui && typeof net.ui.resumeChips === 'function' && net.ui.resumeChips().length);
    } catch {
      return false;
    }
  };

  /** Show the card if it is due now. Resolves true when it was shown. */
  async function remind({ force = false } = {}) {
    if (asking || (shownThisSession && !force) || !ks.active) return false;
    asking = true;
    try {
      await ks.ready;
      if (!onTitle() || friendsFirst()) return false;
      const worlds = await game.store.listWorlds();
      if (!ks.backupDue(worlds) || !onTitle()) return false;
      shownThisSession = true;
      ks.noteReminded();
      const shots = worlds.slice(0, 3).map((w) => w.thumbnail || null);
      const body = el('div');
      const art = el('div', 'ks-art');
      art.innerHTML = artHtml(shots);
      body.append(art, el('h3', '', 'It\'s been a while!'), el('p', 'ks-ask', 'Save a copy of your worlds?'));
      const n = worlds.length;
      // the card belongs to the title: if a world starts loading (a Play tapped just before it
      // came up, friends arriving...) it goes away unanswered and may come back next time
      const leave = new AbortController();
      const watch = setInterval(() => { if (!titleOnly()) leave.abort(); }, 150);
      const answer = await choiceDialog(ui, {
        signal: leave.signal,
        body,
        choices: [
          { value: 'later', label: 'Not now', variant: 'white', icon: 'clock', className: 'ks-later' },
          { value: 'save', label: 'Save a copy', variant: 'pink', icon: 'download', className: 'ks-save' },
        ],
        note: `Grown-ups: on this website your child's worlds live only in this browser, which can clear them. One file keeps ${n === 1 ? 'the world' : n === 2 ? 'both worlds' : `all ${n} worlds`}, the look and stickers. To bring them back: My\u00A0Worlds\u00A0\u2192\u00A0Open\u00A0a\u00A0file.`,
        cancelValue: 'later',
        focus: 1,
        className: 'ks-card',
        makeButton: (o) => button2(ui, o),
      });
      clearInterval(watch);
      if (leave.signal.aborted) {
        shownThisSession = false;
        return false;
      }
      if (answer === 'save') {
        const res = await saveAllWorlds(game);
        if (res !== 'saved') ks.snooze(res === 'declined' ? undefined : 86400000);
      } else {
        ks.snooze();
      }
      return true;
    } catch (err) {
      console.warn('[keepsafe] reminder failed', err);
      return false;
    } finally {
      asking = false;
    }
  }
  ks.remind = remind;

  game.events.on('ui:open', ({ panel }) => {
    if (panel !== 'title' || shownThisSession || !ks.active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { remind(); }, REMIND_DELAY_MS);
  });
}
