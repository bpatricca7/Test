// Boot: create the Game, install every module in the documented order (registries before
// world load), then start (builds the block texture atlas and opens the title screen).

import { Game } from './core/game.js';
import * as theme from './ui/theme.js';
import * as ui from './ui/ui.js';
// family accounts (docs/ACCOUNTS.md §7): nothing happens unless this site has them
import * as account from './account/index.js';
import * as blocks from './world/blocks.js';
import * as worldgen from './world/worldgen.js';
import * as avatar from './player/avatar.js';
import * as player from './player/player.js';
import * as emotes from './player/emotes.js';
import * as entities from './things/entities.js';
import * as furniture from './things/furniture.js';
import * as prefabs from './things/prefabs.js';
import * as pets from './things/pets.js';
import * as garden from './things/garden.js';
import * as cooking from './things/cooking.js';
// wave 3: cars, vans and boats she can drive (docs/teams/vehicles.md)
import * as vehicles from './things/vehicles/index.js';
import * as daynight from './life/daynight.js';
import * as weather from './life/weather.js';
import * as particles from './life/particles.js';
import * as collectibles from './life/collectibles.js';
import * as stickers from './life/stickers.js';
// wave 4: a mermaid tail or a sea dragon form in deep water (docs/teams/merfolk.md)
import * as merfolk from './player/merfolk/index.js';
// playing with friends (docs/MULTIPLAYER.md): the facade, friends' avatars and the screens
import * as net from './net/index.js';
import * as hud from './ui/hud.js';
import * as inventory from './ui/inventory.js';
import * as dressup from './ui/dressup.js';
import * as touch from './ui/touch.js';
import * as settings from './ui/settings.js';
import * as photo from './ui/photo.js';
import * as stickerbook from './ui/stickerbook.js';
import * as menus from './ui/menus.js';
// keeping her worlds safe on the website: storage the browser keeps, a copy in a file
import * as keepsafe from './ui/keepsafe.js';

function boot() {
  const app = document.getElementById('app');
  let game;
  try {
    game = new Game(app);
  } catch (err) {
    console.error('[boot] could not start (WebGL2 needed)', err);
    app.innerHTML = '<div style="font:600 22px system-ui;padding:40px;text-align:center;color:#3A1F4D">' +
      'Glimmer World needs a browser with WebGL2. Please try another browser.</div>';
    return;
  }
  // one module per line (wave 4 inserts its modules as pure line additions; docs/teams/wave4-integration.md §5.2)
  const modules = [
    theme,
    ui,
    account,
    blocks,
    worldgen,
    avatar,
    player,
    emotes,
    entities,
    furniture,
    prefabs,
    pets,
    garden,
    cooking,
    vehicles,
    daynight,
    weather,
    particles,
    collectibles,
    stickers,
    merfolk,       // wave 4: after stickers
    net,
    hud,
    inventory,
    dressup,
    touch,
    settings,
    photo,
    stickerbook,
    menus,
    keepsafe,
  ];
  for (const m of modules) m.install(game);
  game.start().catch((err) => console.error('[boot] start failed', err));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
