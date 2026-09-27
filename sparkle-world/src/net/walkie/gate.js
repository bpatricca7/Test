// The grown-up check for the walkie-talkie (Settings -> "Walkie-talkie (grown-ups)").
//
// A random 2-digit x 1-digit multiplication (13-19 x 6-9, answers 78..171) on a big number
// pad. A wrong answer brings a new problem; three wrong answers lock the check for 60 s, and
// each further lock (without a right answer in between) is twice as long, up to 10 minutes.
// Both the wrong answers (profile.settings.walkieWrong = {n, at, locks}, forgotten after 10
// quiet minutes or a right answer) and the lock (profile.settings.walkieLock) are saved at
// once, so neither closing the check nor a reload skips the wait. Resolves true when a
// grown-up answered right; false when cancelled.

import { icon2 } from '../../ui/menus/icons2.js';
import { walkieSvg } from './art.js';

export const GATE_NOTE = 'Voices go live only to friends in this game, are never recorded, and stop when the button is let go.';
const LOCK_MS = 60000;
const LOCK_MAX_MS = 10 * 60000;
const MAX_WRONG = 3;
const FORGET_MS = 10 * 60000; // wrong answers this old no longer count

/** The saved wrong answers (a fresh record when there are none or they are old). */
export function wrongRecord(S, now = Date.now()) {
  const w = S && S.walkieWrong;
  if (!w || typeof w !== 'object' || !(now - (Number(w.at) || 0) < FORGET_MS) || Number(w.at) > now + 60000) return { n: 0, at: 0, locks: 0 };
  return { n: Math.max(0, Number(w.n) | 0), at: Number(w.at), locks: Math.max(0, Number(w.locks) | 0) };
}

/** Count one wrong answer; returns the lock end (ms) when it locks the check, else 0. */
export function noteWrong(S, now = Date.now()) {
  const w = wrongRecord(S, now);
  w.n++;
  w.at = now;
  let until = 0;
  if (w.n >= MAX_WRONG) {
    w.n = 0;
    w.locks++;
    until = now + Math.min(LOCK_MAX_MS, LOCK_MS * 2 ** (w.locks - 1));
    S.walkieLock = until;
  }
  S.walkieWrong = w;
  return until;
}

const CSS = /* css */ `
.sw-gate.sw-dialog { width: min(440px, 100%); padding: 18px 18px 16px; border-color: var(--sw-lav-soft); max-height: calc(100% - 8px); overflow: auto; }
.sw-gate-top { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 4px; }
.sw-gate-top .sw-wk-art { width: 46px; height: 46px; }
.sw-gate h3 { margin: 0; font-size: 26px; color: var(--sw-lav); }
.sw-gate-ask { font-size: 17px; font-weight: 600; color: var(--sw-ink); margin: 2px 0 10px; }
.sw-gate-q { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 40px; font-weight: 700; color: var(--sw-ink); margin-bottom: 10px; font-variant-numeric: tabular-nums; }
.sw-gate-a { min-width: 104px; height: 60px; padding: 0 10px; border-radius: 18px; border: 4px dashed var(--sw-lav); background: var(--sw-cream); display: grid; place-items: center; color: var(--sw-pink); }
.sw-gate-a.sw-has { border-style: solid; }
.sw-gate-pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-width: 300px; margin: 0 auto; }
.sw-gate-key { height: 62px; border-radius: 18px; border: 4px solid #fff; background: var(--sw-lav-soft); color: var(--sw-ink); font-family: var(--sw-font); font-size: 28px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 0 rgba(58,31,77,.12); touch-action: manipulation; display: grid; place-items: center; }
.sw-gate-key:active { transform: scale(.92); }
.sw-gate-key svg { width: 28px; height: 28px; }
.sw-gate-key.sw-gate-ok { background: var(--sw-mint); color: #fff; }
.sw-gate-key.sw-gate-del { background: #FFE3F0; color: var(--sw-pink); }
.sw-gate-key:disabled { opacity: .4; cursor: default; transform: none; }
.sw-gate-msg { min-height: 26px; margin: 10px 0 4px; font-size: 18px; font-weight: 700; color: var(--sw-pink); }
.sw-gate-msg.sw-good { color: #14A37C; }
.sw-gate-note { font-size: 14px; font-weight: 600; color: var(--sw-lav); line-height: 1.3; margin: 4px 0 12px; }
.sw-gate.sw-shake { animation: sw-gate-shake .4s ease-in-out; }
@keyframes sw-gate-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-10px); } 40% { transform: translateX(10px); } 60% { transform: translateX(-6px); } 80% { transform: translateX(6px); } }
@media (max-height: 640px) {
  .sw-gate-top .sw-wk-art { width: 34px; height: 34px; }
  .sw-gate h3 { font-size: 22px; }
  .sw-gate-q { font-size: 32px; margin-bottom: 6px; }
  .sw-gate-a { height: 50px; }
  .sw-gate-key { height: 50px; font-size: 24px; }
  .sw-gate-note { margin: 2px 0 8px; }
}
`;

let styled = false;

/** A new problem: [a, b] with a in 13..19, b in 6..9. */
export function newProblem(rand = Math.random) {
  return [13 + Math.floor(rand() * 7), 6 + Math.floor(rand() * 4)];
}

/**
 * Open the grown-up check. Resolves true when answered right, false when cancelled.
 * @param {object} game
 */
export function openGate(game) {
  const ui = game.ui;
  if (!styled) {
    ui.addStyles(CSS);
    styled = true;
  }
  const S = game.profile.settings;
  return new Promise((resolve) => {
    const wrap = ui.el('div', 'sw-dialog-wrap sw-gate-wrap');
    const dim = ui.el('div', 'sw-backdrop');
    const card = ui.el('div', 'sw-dialog sw-gate');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Grown-up check');
    wrap.append(dim, card);

    const top = ui.el('div', 'sw-gate-top');
    top.insertAdjacentHTML('afterbegin', walkieSvg());
    top.appendChild(ui.el('h3', '', 'Grown-up check'));
    const ask = ui.el('div', 'sw-gate-ask', 'Please ask a grown-up to answer:');
    const q = ui.el('div', 'sw-gate-q');
    const qText = ui.el('span', 'sw-gate-qtext', '');
    const eq = ui.el('span', '', '=');
    const ans = ui.el('span', 'sw-gate-a', '?');
    q.append(qText, eq, ans);
    const pad = ui.el('div', 'sw-gate-pad');
    const msg = ui.el('div', 'sw-gate-msg', '');
    const note = ui.el('div', 'sw-gate-note', GATE_NOTE);
    const btns = ui.el('div', 'sw-dialog-buttons');
    const cancel = ui.button({ label: 'Cancel', variant: 'white', icon: 'close', className: 'sw-gate-cancel', onClick: () => close(false) });
    btns.appendChild(cancel);
    card.append(top, ask, q, pad, msg, note, btns);

    let problem = newProblem();
    let typed = '';
    let lockTimer = null;
    const keys = [];
    const showProblem = () => {
      qText.textContent = `${problem[0]} × ${problem[1]}`;
      typed = '';
      paintAnswer();
    };
    const paintAnswer = () => {
      ans.textContent = typed || '?';
      ans.classList.toggle('sw-has', !!typed);
    };
    const key = (label, cls, onTap, html = null) => {
      const b = ui.el('button', 'sw-gate-key' + (cls ? ' ' + cls : ''));
      b.type = 'button';
      if (html) b.innerHTML = html;
      else b.textContent = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => {
        game.audio.play('click');
        onTap();
      });
      keys.push(b);
      pad.appendChild(b);
      return b;
    };
    const digit = (d) => {
      if (typed.length >= 3) return;
      typed += String(d);
      msg.textContent = '';
      msg.classList.remove('sw-good');
      paintAnswer();
    };
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) key(String(d), 'sw-gate-digit', () => digit(d)).dataset.d = String(d);
    key('Back', 'sw-gate-del', () => {
      typed = typed.slice(0, -1);
      paintAnswer();
    }, icon2('undo'));
    key('0', 'sw-gate-digit', () => digit(0)).dataset.d = '0';
    key('OK', 'sw-gate-ok', () => submit(), icon2('check'));

    const setLocked = (on) => {
      for (const k of keys) k.disabled = on;
    };
    const lockTick = () => {
      const left = Math.ceil(((S.walkieLock || 0) - Date.now()) / 1000);
      if (left <= 0) {
        S.walkieLock = 0;
        game.saveProfile(true);
        setLocked(false);
        msg.textContent = 'Ready for a new one!';
        msg.classList.add('sw-good');
        problem = newProblem();
        showProblem();
        lockTimer = null;
        return;
      }
      msg.classList.remove('sw-good');
      msg.textContent = `${left > 60 ? "Let's wait a little…" : "Let's wait a minute…"} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      lockTimer = setTimeout(lockTick, 250);
    };
    const submit = () => {
      if (!typed) return;
      if (Number(typed) === problem[0] * problem[1]) {
        delete S.walkieWrong;
        game.saveProfile(true);
        msg.textContent = 'Thank you!';
        msg.classList.add('sw-good');
        game.audio.play('magic');
        setLocked(true);
        setTimeout(() => close(true), 450);
        return;
      }
      // saved at once: a reload (or closing the check) never skips the wait
      const locked = noteWrong(S);
      game.saveProfile(true);
      game.audio.play('pop', { pitch: 0.6 });
      card.classList.remove('sw-shake');
      void card.offsetWidth;
      card.classList.add('sw-shake');
      problem = newProblem();
      showProblem();
      if (locked) {
        setLocked(true);
        lockTick();
      } else {
        msg.textContent = 'Not quite! Here is a new one.';
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      } else if (/^[0-9]$/.test(e.key) && !keys[0].disabled) {
        e.stopPropagation();
        digit(Number(e.key));
      } else if (e.key === 'Backspace') {
        e.stopPropagation();
        typed = typed.slice(0, -1);
        paintAnswer();
      } else if (e.key === 'Enter' && !keys[0].disabled) {
        e.stopPropagation();
        e.preventDefault();
        submit();
      }
    };
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      if (lockTimer) clearTimeout(lockTimer);
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      ui.dialogOpen = ui.dialogLayer.childElementCount > 0;
      resolve(value);
    };
    dim.addEventListener('pointerdown', () => close(false));
    window.addEventListener('keydown', onKey, true);
    ui.dialogLayer.appendChild(wrap);
    ui.dialogOpen = true;
    showProblem();
    if ((S.walkieLock || 0) > Date.now()) {
      setLocked(true);
      lockTick();
    }
  });
}
