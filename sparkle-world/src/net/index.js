// Playing with friends: the module src/main.js installs (docs/MULTIPLAYER.md §3, §9.1, §9.13).
//
// install(game):
//   - game.net: the facade (src/net/facade.js: session, transport choice, hooks' flags,
//     mayEdit, intents, frame ticks, visibility, pagehide), given the reviewed name filter
//     (src/net/names.js) and told that the UI shows its own message cards;
//   - the 'net' system: friends' avatars (remote-players.js), the treat in her hand (presence
//     `hi`), the UI's per-frame work;
//   - the screens (ui.js): panels mp-start, mp-join, mp-players, mp-say; actions mp-start,
//     mp-players, mp-say (key T); knock and message cards;
//   - availability: detectTransportKind() at start (claude.ai room, Railway ws, ?net=loop, or
//     none: every "Play with Friends" button stays hidden).
//
// Single player is unchanged: nothing here sends anything until she makes or joins a code.

import { install as installFacade } from './facade.js';
import { sanitizeName } from './names.js';
import { RemotePlayers } from './remote-players.js';
import { installNetUI } from './ui.js';

const HELD_RE = /^[a-z0-9_:.-]{1,48}$/;

/** The treat she holds (Shops team: game.treats.held, a key or { key }), or null. */
function heldKey(game) {
  const t = game.treats;
  if (!t) return null;
  let h = null;
  try {
    h = typeof t.held === 'function' ? t.held() : t.held;
  } catch {
    return null;
  }
  const key = typeof h === 'string' ? h : h && typeof h.key === 'string' ? h.key : null;
  return key && HELD_RE.test(key) ? key : null;
}

export function install(game, opts = {}) {
  const net = installFacade(game, { sanitizeName, toastMessages: false, ...opts });
  const remote = new RemotePlayers(game, net);
  net.remote = remote;
  const ui = installNetUI(game, net, remote);
  net.ui = ui;

  // held treat -> presence `hi` (sent again on every new session / transport)
  let hiT = null;
  let hiKey = null;
  const syncHeld = () => {
    const t = net.session.transport;
    if (!t || !net.active) {
      hiT = null;
      hiKey = null;
      return;
    }
    const key = heldKey(game);
    if (t === hiT && key === hiKey) return;
    try {
      t.setState({ hi: key });
      hiT = t;
      hiKey = key;
    } catch {
      // presence full (a big outbox): try again next frame
    }
  };

  game.addSystem({
    name: 'net',
    update(dt) {
      if (net.active) syncHeld();
      remote.update(dt);
      ui.update(dt);
    },
  });

  // is playing together possible here? (the title's "Play with Friends" waits for this)
  game.events.on('game:ready', () => {
    Promise.resolve(net.detect ? net.detect() : false).catch(() => false);
  });

  // debug / tests
  if (game.debug) {
    const d = game.debug.net || (game.debug.net = {});
    d.remote = () => remote.list();
    d.drawCalls = () => remote.drawCalls();
    d.say = (id) => {
      const ok = net.say(id);
      if (ok) remote.sayMine(id);
      return ok;
    };
    d.knockCards = () => ui.knocks.map((k) => ({ peer: k.peer, name: k.name }));
    d.available = () => net.available;
    d.kind = () => net.kind;
  }
  return net;
}
