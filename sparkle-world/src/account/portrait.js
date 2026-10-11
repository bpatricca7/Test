// Her head portrait for the picker and the Family page (docs/ACCOUNTS.md §7.6): drawn with the
// Dress Up stage the net UI already uses, once when she has none and after each look change
// (10 s after the last), then PUT /api/players/:pid/portrait (a PNG of at most 32 KB).

import { getStage } from '../ui/dressup/stage.js';

const WAIT_MS = 10000;
const MAX_B64 = Math.floor((32 * 1024) / 3) * 4; // base64 length of 32 KB

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function render(look) {
  const c = await getStage().snapshot('acct-head:' + hash(JSON.stringify(look)), look, { frame: 'head', size: 160 });
  if (!c) return null;
  let url = c.toDataURL('image/png');
  if (url.length - 22 > MAX_B64) {
    // too big: a smaller one (the picker shows 120 px)
    const s = document.createElement('canvas');
    s.width = s.height = 112;
    s.getContext('2d').drawImage(c, 0, 0, 112, 112);
    url = s.toDataURL('image/png');
  }
  return url.length - 22 <= MAX_B64 ? url : null;
}

/** Keep the player's portrait on the server in step with her look. */
export function watchPortrait(game, acct) {
  let timer = 0;
  let last = null;
  const send = async () => {
    timer = 0;
    const p = acct.player;
    if (!p || acct.offline || acct.mode !== 'account') return;
    const look = game.profile && game.profile.look;
    const key = JSON.stringify({ ...(look || {}), sea: null }); // a tail choice never re-uploads the head picture
    if (!look || key === last) return;
    try {
      const png = await render(look);
      if (!png) return;
      const r = await acct.api.call('PUT', `/api/players/${p.id}/portrait`, { json: { png } });
      last = key;
      if (r.json && r.json.rev) acct.notePortrait(`/api/players/${p.id}/portrait?v=${r.json.rev}`);
    } catch {
      // next look change tries again
    }
  };
  const soon = (ms = WAIT_MS) => {
    clearTimeout(timer);
    timer = setTimeout(send, ms);
  };
  game.events.on('avatar:changed', () => soon());
  game.events.on('outfit:changed', () => soon());
  if (acct.player && !acct.player.portrait) soon(3000);
}
