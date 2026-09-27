// Playing with friends: the module src/main.js installs (docs/MULTIPLAYER.md §3, §9.1, §9.13).
//
// install(game):
//   - game.net: the facade (src/net/facade.js: session, transport choice, hooks' flags,
//     mayEdit, intents, frame ticks, visibility, pagehide), given the reviewed name filter
//     (src/net/names.js) and told that the UI shows its own message cards;
//   - the 'net' system: friends' avatars (remote-players.js, with the treat in each friend's
//     hand from presence `hi`, which the core's avatarFields sends from adapter.local()), the
//     UI's per-frame work;
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
import { installWalkie } from './walkie/index.js';

export function install(game, opts = {}) {
  const net = installFacade(game, { sanitizeName, toastMessages: false, ...opts });
  const remote = new RemotePlayers(game, net);
  net.remote = remote;
  const ui = installNetUI(game, net, remote);
  net.ui = ui;
  // the walkie-talkie (Railway only, parent-gated per device): src/net/walkie/index.js
  net.walkie = installWalkie(game, net);

  game.addSystem({
    name: 'net',
    update(dt) {
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
