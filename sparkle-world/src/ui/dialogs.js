// In-page dialogs (confirm() and prompt() do nothing inside the claude.ai Artifact frame).

import { icon } from './icons.js';

function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Shared shell: a centered card over a dim layer; resolves with close(value). */
function openDialog(ui, build) {
  return new Promise((resolve) => {
    const wrap = make('div', 'sw-dialog-wrap');
    const dim = make('div', 'sw-backdrop');
    const card = make('div', 'sw-dialog');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    wrap.append(dim, card);
    ui.dialogLayer.appendChild(wrap);
    ui.dialogOpen = true;
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      wrap.remove();
      ui.dialogOpen = ui.dialogLayer.childElementCount > 0;
      resolve(value);
    };
    const handlers = build(card, close);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(handlers.cancelValue); }
      else if (e.key === 'Enter' && handlers.onEnter) { e.stopPropagation(); handlers.onEnter(); }
    };
    window.addEventListener('keydown', onKey, true);
    dim.addEventListener('pointerdown', () => close(handlers.cancelValue));
    if (handlers.focus) setTimeout(() => handlers.focus.focus(), 30);
  });
}

/** Yes/No question. Resolves true for yes. */
export function confirmDialog(ui, { title = 'Are you sure?', text = '', yes = 'Yes', no = 'No', yesVariant = 'pink', icon: ic = null } = {}) {
  return openDialog(ui, (card, close) => {
    const h = make('h3');
    if (ic) h.innerHTML = icon(ic, { size: 30 }) + ' ';
    h.appendChild(document.createTextNode(title));
    card.appendChild(h);
    if (text) card.appendChild(make('p', '', text));
    const row = make('div', 'sw-dialog-buttons');
    const noBtn = ui.button({ label: no, variant: 'white', icon: 'close', onClick: () => close(false) });
    const yesBtn = ui.button({ label: yes, variant: yesVariant, icon: 'check', onClick: () => close(true) });
    row.append(noBtn, yesBtn);
    card.appendChild(row);
    return { cancelValue: false, onEnter: () => close(true), focus: noBtn };
  });
}

/** Ask for a short text. Resolves the trimmed string, or null when cancelled. */
export function textInputDialog(ui, { title = 'Name', value = '', placeholder = '', suggestions = [], ok = 'OK', maxLength = 40 } = {}) {
  return openDialog(ui, (card, close) => {
    card.appendChild(make('h3', '', title));
    const input = make('input', 'sw-input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    card.appendChild(input);
    const chips = make('div', 'sw-chips');
    for (const s of suggestions) {
      const c = make('button', 'sw-chip', s);
      c.type = 'button';
      c.addEventListener('click', () => { input.value = s; input.focus(); ui.game.audio.play('click'); });
      chips.appendChild(c);
    }
    card.appendChild(chips);
    const submit = () => {
      const v = input.value.trim();
      if (v) close(v);
      else input.focus();
    };
    const row = make('div', 'sw-dialog-buttons');
    row.append(
      ui.button({ label: 'Cancel', variant: 'white', icon: 'close', onClick: () => close(null) }),
      ui.button({ label: ok, variant: 'mint', icon: 'check', onClick: submit }),
    );
    card.appendChild(row);
    return { cancelValue: null, onEnter: submit, focus: input };
  });
}
