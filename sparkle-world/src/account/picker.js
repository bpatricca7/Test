// "Who's playing?" (docs/ACCOUNTS.md §7.1 step 6): full screen, one big card per player (her
// head portrait, or a colored bubble with her first letter) and her nickname, the last player
// first. A small Grown-ups button in the corner. Resolves the chosen player, or null (Back,
// only when opened from the title to switch players).

export const COLORS = ['#FF6FAE', '#A78BFA', '#22BF95', '#3AAEF0', '#F5A300', '#FF7A6B', '#14B8A6', '#E879F9'];

const CSS = /* css */ `.sw-acct-pick{position:absolute;inset:0;z-index:65;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:20px 16px;overflow:auto;background:radial-gradient(circle at 50% 30%,#FFF1F8,#FFD1E6 50%,#C9B8FF)}
.sw-acct-pick h2{margin:0;font-size:clamp(32px,6vw,52px);color:var(--sw-pink);-webkit-text-stroke:6px #fff;paint-order:stroke fill}
.sw-acct-cards{display:flex;flex-wrap:wrap;gap:18px;justify-content:center;max-width:820px}
.sw-acct-card{width:150px;min-height:176px;border:5px solid #fff;border-radius:30px;background:#fff;box-shadow:0 8px 20px var(--sw-shadow);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px 8px;cursor:pointer;font:700 22px var(--sw-font);color:var(--sw-ink)}
.sw-acct-card:active{transform:scale(.94)}
.sw-acct-face{width:120px;height:120px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--c);color:#fff;font-size:60px}
.sw-acct-face img{width:100%;height:100%}
.sw-acct-name{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.sw-acct-corner{position:absolute;top:calc(12px + var(--sw-safe-t));right:12px;display:flex;gap:8px}`;

let styled = false;

/** Her face: the portrait, or a bubble with her first letter (also when the picture fails). */
export function face(ui, p) {
  const f = ui.el('span', 'sw-acct-face', (p.nickname || '?').slice(0, 1).toUpperCase());
  f.style.setProperty('--c', COLORS[(p.color | 0) % COLORS.length]);
  if (p.portrait && typeof navigator !== 'undefined' && navigator.onLine !== false) {
    const img = ui.el('img');
    img.alt = '';
    img.onload = () => {
      f.textContent = '';
      f.appendChild(img);
    };
    img.src = p.portrait;
  }
  return f;
}

/**
 * @param {object} game
 * @param {{ players: object[], last?: string, onGrownups?: Function, back?: boolean }} o
 */
export function pickPlayer(game, o) {
  const ui = game.ui;
  if (!styled) {
    ui.addStyles(CSS);
    styled = true;
  }
  return new Promise((resolve) => {
    const wrap = ui.el('div', 'sw-acct-pick');
    const cards = ui.el('div', 'sw-acct-cards');
    const list = [...o.players].sort((a, b) => (b.id === o.last) - (a.id === o.last));
    const done = (v) => {
      wrap.remove();
      resolve(v);
    };
    for (const p of list) {
      const c = ui.el('button', 'sw-acct-card');
      c.type = 'button';
      c.dataset.player = p.id;
      c.append(face(ui, p), ui.el('span', 'sw-acct-name', p.nickname));
      c.addEventListener('click', () => {
        game.audio.play('pop');
        done(p);
      });
      cards.appendChild(c);
    }
    const corner = ui.el('div', 'sw-acct-corner');
    if (o.back) corner.appendChild(ui.button({ icon: 'back', label: 'Back', variant: 'white', size: 'small', onClick: () => done(null) }));
    if (o.onGrownups) corner.appendChild(ui.button({ icon: 'home', label: 'Grown-ups', variant: 'white', size: 'small', className: 'sw-acct-grownups', onClick: () => o.onGrownups() }));
    wrap.append(corner, ui.el('h2', '', "Who's playing?"), cards);
    ui.dialogLayer.appendChild(wrap);
  });
}
