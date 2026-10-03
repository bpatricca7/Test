// The Piano panel: a big friendly two-octave keyboard (C4..C6) with rainbow keys and note
// names, three songs to listen to ("Listen") or to play by following the glowing keys ("My
// turn"). Every note plays game.audio 'note:<midi>', floats a note particle out of the piano
// and emits 'piano:note' { note }.

import { icon } from '../../ui/icons.js';

const WHITE = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const KEY_COLORS = ['#FF8FA3', '#FFB870', '#FFE070', '#9BE38A', '#7CC8FF', '#9C8BFF', '#D69BFF'];
const BLACK = [[61, 0], [63, 1], [66, 3], [68, 4], [70, 5], [73, 7], [75, 8], [78, 10], [80, 11], [82, 12]];
// computer keys for the white and black keys
const KEYMAP = {
  KeyA: 60, KeyS: 62, KeyD: 64, KeyF: 65, KeyG: 67, KeyH: 69, KeyJ: 71, KeyK: 72, KeyL: 74, Semicolon: 76, Quote: 77,
  KeyW: 61, KeyE: 63, KeyT: 66, KeyY: 68, KeyU: 70, KeyO: 73, KeyP: 75,
};

export const SONGS = [
  {
    key: 'twinkle', name: 'Twinkle Twinkle', icon: 'star',
    notes: [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
      [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2], [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
      [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]],
  },
  {
    key: 'lamb', name: 'Mary\'s Lamb', icon: 'heart',
    notes: [[64, 1.5], [62, 0.5], [60, 1], [62, 1], [64, 1], [64, 1], [64, 2], [62, 1], [62, 1], [62, 2], [64, 1], [67, 1], [67, 2],
      [64, 1.5], [62, 0.5], [60, 1], [62, 1], [64, 1], [64, 1], [64, 1], [64, 1], [62, 1], [62, 1], [64, 1], [62, 1], [60, 3]],
  },
  {
    key: 'birthday', name: 'Happy Birthday', icon: 'sparkle',
    notes: [[67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2], [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
      [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 2], [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 3]],
  },
];

const CSS = /* css */ `
.sw-piano { display: flex; flex-direction: column; gap: 14px; align-items: stretch; }
.sw-piano-keys { position: relative; display: flex; height: min(250px, 38vh); padding: 10px 10px 12px; border-radius: 22px; background: linear-gradient(#FFB8D6, #FF8FC0); box-shadow: inset 0 -6px 0 rgba(0,0,0,.08), 0 8px 18px var(--sw-shadow); touch-action: none; }
.sw-wkey { position: relative; flex: 1; margin: 0 2px; border-radius: 0 0 14px 14px; background: #fff; border: 3px solid #fff; box-shadow: inset 0 -10px 0 var(--kc), 0 4px 0 rgba(58,31,77,.18); display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding-bottom: 16px; font: 700 20px var(--sw-font); color: var(--sw-ink); cursor: pointer; -webkit-user-select: none; user-select: none; transition: transform .08s, box-shadow .08s, background .08s; }
.sw-wkey .sw-dot { width: 16px; height: 16px; border-radius: 50%; background: var(--kc); margin-bottom: 6px; border: 2px solid rgba(255,255,255,.9); }
.sw-wkey.sw-down { transform: translateY(4px); background: color-mix(in srgb, var(--kc) 35%, #fff); box-shadow: inset 0 -5px 0 var(--kc), 0 1px 0 rgba(58,31,77,.18); }
.sw-bkey { position: absolute; top: 10px; width: calc((100% - 20px) / 15 * 0.62); height: 58%; margin-left: calc((100% - 20px) / 15 * -0.31); border-radius: 0 0 10px 10px; background: linear-gradient(#5E4E8A, #3A2F5A); border: 3px solid #fff; box-shadow: 0 4px 0 rgba(58,31,77,.3); cursor: pointer; z-index: 2; transition: transform .08s; }
.sw-bkey.sw-down { transform: translateY(3px); background: linear-gradient(#9C7BFF, #6E5AB8); }
.sw-wkey.sw-next, .sw-bkey.sw-next { animation: sw-keyglow .7s ease-in-out infinite alternate; }
.sw-wkey.sw-next::after { content: ''; position: absolute; top: 12px; width: 22px; height: 22px; background: var(--sw-sun); clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%); }
@keyframes sw-keyglow { from { box-shadow: inset 0 -10px 0 var(--kc), 0 0 0 4px var(--sw-sun), 0 0 16px 6px rgba(255,201,77,.8); } to { box-shadow: inset 0 -10px 0 var(--kc), 0 0 0 7px var(--sw-sun), 0 0 26px 10px rgba(255,201,77,.9); } }
.sw-piano-songs { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.sw-song { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 22px; background: #fff; border: 4px solid var(--sw-lav-soft); box-shadow: 0 5px 12px var(--sw-shadow); min-width: 190px; }
.sw-song-name { font-size: 19px; font-weight: 700; color: var(--sw-lav); display: flex; align-items: center; gap: 6px; }
.sw-song-name svg { width: 24px; height: 24px; color: var(--sw-pink); }
.sw-song-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.sw-piano-status { text-align: center; font-size: 20px; font-weight: 700; color: var(--sw-pink); min-height: 28px; }
@media (max-width: 600px) {
  .sw-wkey { font-size: 13px; margin: 0 1px; border-width: 2px; padding-bottom: 10px; }
  .sw-wkey .sw-dot { width: 10px; height: 10px; }
  /* one song per row: its Listen and My turn buttons sit side by side inside its card */
  .sw-piano-songs { gap: 8px; }
  .sw-song { min-width: 0; flex: 1 1 100%; padding: 8px 10px; gap: 6px; }
  .sw-song-name { font-size: 17px; }
  .sw-song-btns .sw-btn { padding-left: 12px; padding-right: 12px; gap: 6px; }
}
`;

export function installPiano(game, fx) {
  const ui = game.ui;
  ui.addStyles(CSS);
  let entity = null;
  const keyEls = new Map();
  let statusEl = null;
  let playing = null; // { timers: [] } while a song plays by itself
  let follow = null; // { song, i } while the kid plays along with glowing keys
  const onKeyDown = (e) => {
    if (!ui.isOpen('piano') || e.repeat || ui.dialogOpen) return;
    const m = KEYMAP[e.code];
    if (m) {
      e.preventDefault();
      press(m, true);
    }
  };

  function flash(midi) {
    const el = keyEls.get(midi);
    if (!el) return;
    el.classList.add('sw-down');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('sw-down'), 180);
  }

  function note(midi) {
    game.audio.play('note:' + midi, { volume: 0.9 });
    game.events.emit('piano:note', { note: midi });
    flash(midi);
    if (entity && game.entities && game.entities.byUid(entity.uid)) {
      const i = WHITE.indexOf(midi);
      const color = KEY_COLORS[(i >= 0 ? i : WHITE.indexOf(midi - 1)) % 7] || '#FF9CCB';
      const p = game.entities.localToWorld(entity, 0.2 + ((midi - 60) / 24) * 1.6, 1.5, 0.6);
      if (game.particles) game.particles.emit('note', p, { count: 1, color, spread: 0.2 });
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function clearNext() {
    for (const el of keyEls.values()) el.classList.remove('sw-next');
  }

  function showNext() {
    clearNext();
    if (!follow) return;
    const n = follow.song.notes[follow.i];
    const el = n && keyEls.get(n[0]);
    if (el) el.classList.add('sw-next');
  }

  function press(midi, byHand) {
    note(midi);
    if (byHand && follow) {
      const want = follow.song.notes[follow.i];
      if (want && want[0] === midi) {
        follow.i++;
        if (follow.i >= follow.song.notes.length) {
          const name = follow.song.name;
          follow = null;
          clearNext();
          setStatus(`You played ${name}!`);
          game.toast('You played the whole song!', { icon: 'music', big: true });
          game.audio.play('success');
          if (entity && game.particles) game.celebrate(game.entities.localToWorld(entity, 1, 1.6, 0.6), 'confetti', { quiet: true });
          return;
        }
        showNext();
      }
    }
  }

  function stopSong() {
    if (playing) for (const t of playing.timers) clearTimeout(t);
    playing = null;
    follow = null;
    clearNext();
  }

  function listen(song) {
    stopSong();
    setStatus(`Listen: ${song.name}`);
    playing = { timers: [] };
    const beat = 0.42;
    let t = 0;
    for (const [m, len] of song.notes) {
      const at = t;
      playing.timers.push(setTimeout(() => note(m), at * 1000));
      t += len * beat;
    }
    playing.timers.push(setTimeout(() => {
      playing = null;
      setStatus('Your turn! Tap "My turn" to play it.');
    }, t * 1000 + 300));
  }

  function myTurn(song) {
    stopSong();
    follow = { song, i: 0 };
    setStatus('Tap the glowing key!');
    showNext();
  }

  ui.registerPanel('piano', {
    title: 'Piano',
    icon: 'music',
    width: 900,
    build(container) {
      const wrap = ui.el('div', 'sw-piano');
      statusEl = ui.el('div', 'sw-piano-status', 'Tap the keys to play music!');
      const keys = ui.el('div', 'sw-piano-keys');
      WHITE.forEach((m, i) => {
        const k = ui.el('div', 'sw-wkey');
        k.style.setProperty('--kc', KEY_COLORS[i % 7]);
        k.dataset.note = m;
        const dot = ui.el('span', 'sw-dot');
        k.append(dot, ui.el('span', '', NAMES[i % 7]));
        keys.appendChild(k);
        keyEls.set(m, k);
      });
      for (const [m, after] of BLACK) {
        const k = ui.el('div', 'sw-bkey');
        k.dataset.note = m;
        k.style.left = `calc(10px + (100% - 20px) / 15 * ${after + 1})`;
        keys.appendChild(k);
        keyEls.set(m, k);
      }
      // pointer play with glissando: release the implicit touch capture so sliding a
      // finger across the keys plays each one
      let down = false;
      const keyOf = (el) => (el && el.dataset && el.dataset.note ? Number(el.dataset.note) : null);
      keys.addEventListener('pointerdown', (e) => {
        const m = keyOf(e.target.closest('[data-note]'));
        if (m === null) return;
        e.preventDefault();
        down = true;
        if (e.target.releasePointerCapture) try { e.target.releasePointerCapture(e.pointerId); } catch (_) { /* not captured */ }
        game.audio.unlock();
        press(m, true);
      });
      keys.addEventListener('pointerover', (e) => {
        if (!down || e.buttons === 0) return;
        const m = keyOf(e.target.closest('[data-note]'));
        if (m !== null) press(m, true);
      });
      const up = () => { down = false; };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      const songs = ui.el('div', 'sw-piano-songs');
      for (const song of SONGS) {
        const card = ui.el('div', 'sw-song');
        const name = ui.el('div', 'sw-song-name');
        name.innerHTML = icon(song.icon);
        name.appendChild(ui.el('span', '', song.name));
        const btns = ui.el('div', 'sw-song-btns');
        btns.append(
          ui.button({ icon: 'play', label: 'Listen', variant: 'lav', size: 'small', className: 'sw-song-listen', onClick: () => listen(song) }),
          ui.button({ icon: 'hand', label: 'My turn', variant: 'mint', size: 'small', className: 'sw-song-turn', onClick: () => myTurn(song) }),
        );
        btns.children[0].dataset.song = song.key;
        btns.children[1].dataset.song = song.key;
        card.append(name, btns);
        songs.appendChild(card);
      }
      wrap.append(statusEl, keys, songs);
      container.appendChild(wrap);
    },
    onOpen(args) {
      entity = (args && args.entity) || null;
      setStatus('Tap the keys to play music!');
      window.addEventListener('keydown', onKeyDown);
    },
    onClose() {
      stopSong();
      window.removeEventListener('keydown', onKeyDown);
      entity = null;
    },
  });

  return { note, listen, myTurn, stop: stopSong };
}
