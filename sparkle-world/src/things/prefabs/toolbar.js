// The little "placing a house" bar above the hotbar: the house's picture and name, a tip,
// and big Turn and Build! buttons (touch friendly, >= 58 px). Shown only while a Magic House
// is in the selected hotbar slot with the Build tool.

const TURN_ICON = `<svg class="sw-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path fill="currentColor" d="M21.6 3.2 21 10.4l-6.9-2.1Z"/></svg>`;
const WAND_ICON = `<svg class="sw-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.2 18.9 14.6 7.5l1.9 1.9L5.1 20.8a1.35 1.35 0 0 1-1.9-1.9Z"/><path fill="currentColor" d="M16.6 1.8c.3 2.1 1.1 2.9 3.2 3.2-2.1.3-2.9 1.1-3.2 3.2-.3-2.1-1.1-2.9-3.2-3.2 2.1-.3 2.9-1.1 3.2-3.2Z"/><path fill="currentColor" opacity=".8" d="M20.4 9.6c.2 1.2.7 1.7 1.9 1.9-1.2.2-1.7.7-1.9 1.9-.2-1.2-.7-1.7-1.9-1.9 1.2-.2 1.7-.7 1.9-1.9ZM9.6 2.2c.2 1.1.6 1.5 1.7 1.7-1.1.2-1.5.6-1.7 1.7-.2-1.1-.6-1.5-1.7-1.7 1.1-.2 1.5-.6 1.7-1.7Z"/></svg>`;

const CSS = /* css */ `
.sw-pf-bar { position: absolute; left: 50%; bottom: calc(122px + var(--sw-safe-b)); transform: translateX(-50%); display: flex; align-items: flex-end; gap: 12px; pointer-events: none !important; z-index: 2; }
.sw-pf-bar > * { animation: sw-pop .3s var(--sw-bounce); }
.sw-pf-bar[hidden] { display: none; }
.sw-pf-bar > * { pointer-events: auto; }
.sw-pf-card { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 6px 18px 6px 8px; border-radius: 999px; background: rgba(255,255,255,.94); border: 4px solid #fff; box-shadow: 0 0 0 3px var(--sw-pink-soft), 0 8px 20px var(--sw-shadow); }
.sw-pf-card img { width: 52px; height: 52px; border-radius: 50%; background: radial-gradient(circle at 50% 40%, #FFF6FB 0%, #FFD1E6 100%); flex: none; }
.sw-pf-words { display: flex; flex-direction: column; line-height: 1.1; }
.sw-pf-name { font-size: 20px; font-weight: 700; color: var(--sw-pink); white-space: nowrap; }
.sw-pf-tip { font-size: 15px; font-weight: 600; color: var(--sw-lav); white-space: nowrap; }
.sw-pf-bar .sw-round-face { width: 62px; height: 62px; }
.sw-pf-bar .sw-round-face svg { width: 34px; height: 34px; }
.sw-pf-go .sw-round-face { animation: sw-pf-glow 1.6s ease-in-out infinite; }
@keyframes sw-pf-glow { 0%, 100% { box-shadow: 0 5px 0 rgba(58,31,77,.14), 0 8px 18px var(--sw-shadow), 0 0 0 0 rgba(255,201,77,.0); } 50% { box-shadow: 0 5px 0 rgba(58,31,77,.14), 0 8px 18px var(--sw-shadow), 0 0 0 7px rgba(255,201,77,.55); } }
.sw-pf-turn.sw-spin .sw-round-face svg { animation: sw-pf-spin .35s ease-out; }
@keyframes sw-pf-spin { from { transform: rotate(-90deg); } to { transform: rotate(0); } }
@media (max-width: 760px), (max-height: 520px) {
  .sw-pf-bar { bottom: calc(100px + var(--sw-safe-b)); gap: 8px; }
  .sw-pf-card { min-height: 54px; padding: 4px 12px 4px 6px; }
  .sw-pf-card img { width: 42px; height: 42px; }
  .sw-pf-name { font-size: 17px; }
  .sw-pf-tip { font-size: 13px; }
  .sw-pf-bar .sw-round-face { width: 54px; height: 54px; }
  .sw-pf-bar .sw-round-face svg { width: 30px; height: 30px; }
}
/* portrait tablets and phones: the joystick and Jump live at the bottom, so the bar sits
   under the world name instead */
@media (max-width: 820px) and (orientation: portrait) {
  .sw-pf-bar { top: calc(112px + var(--sw-safe-t)); bottom: auto; align-items: center; }
}
/* phones: only the two big buttons, in the free strip between the left pills and the tool
   column (the hotbar slot already shows the house, the ghost says "Tap to build!") */
@media (max-width: 480px) {
  .sw-pf-bar { left: 50%; right: auto; transform: translateX(-50%); gap: 10px; }
  .sw-pf-card { display: none; }
}
`;

function roundButton(ui, { icon, label, color, className, onClick }) {
  const b = ui.el('button', `sw-round ${className}`);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  const face = ui.el('span', 'sw-round-face');
  face.style.setProperty('--c', color);
  face.innerHTML = icon;
  b.append(face, ui.el('span', 'sw-round-label', label));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export function createToolbar(game, { onTurn, onBuild }) {
  const ui = game.ui;
  ui.addStyles(CSS);
  const bar = ui.el('div', 'sw-pf-bar');
  bar.hidden = true;
  const card = ui.el('div', 'sw-pf-card');
  const img = ui.el('img');
  img.alt = '';
  img.draggable = false;
  const words = ui.el('div', 'sw-pf-words');
  const name = ui.el('span', 'sw-pf-name', '');
  const tip = ui.el('span', 'sw-pf-tip', '');
  words.append(name, tip);
  card.append(img, words);
  const turn = roundButton(ui, {
    icon: TURN_ICON, label: 'Turn', color: 'var(--sw-lav)', className: 'sw-pf-turn',
    onClick: () => {
      turn.classList.remove('sw-spin');
      void turn.offsetWidth;
      turn.classList.add('sw-spin');
      onTurn();
    },
  });
  const build = roundButton(ui, { icon: WAND_ICON, label: 'Build!', color: 'var(--sw-pink)', className: 'sw-pf-go', onClick: () => onBuild() });
  bar.append(card, turn, build);
  ui.hudLayer.appendChild(bar);

  let shownKey = null, tipText = '';
  return {
    el: bar,
    show(item, tipNow) {
      if (shownKey !== item.key) {
        shownKey = item.key;
        name.textContent = item.name;
        img.style.visibility = 'hidden';
        game.registry.items.iconFor(item.key).then((url) => {
          if (shownKey === item.key && url) { img.src = url; img.style.visibility = 'visible'; }
        });
      }
      if (tipNow !== tipText) {
        tipText = tipNow;
        tip.textContent = tipNow;
      }
      if (bar.hidden) bar.hidden = false;
    },
    hide() {
      if (!bar.hidden) bar.hidden = true;
    },
    get visible() {
      return !bar.hidden;
    },
  };
}
