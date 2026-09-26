// Starter furniture (bed, chair, round table, table lamp) and the core furniture actions:
// 'sit', 'sleep' and 'lamp'. The Furniture team adds the rest of the catalog and actions.

import { bedSingle, chair, tableRound, tableLamp } from './furniture-models.js';

const SOFT = ['#FF8CC6', '#9C7BFF', '#6CC6FF', '#3FD8B0', '#FFC94D', '#FFFFFF'];

function installActions(game) {
  const E = game.entities;
  const frontYaw = (entity) => entity.rot * (Math.PI / 2);

  E.registerAction('sit', {
    run(g, entity) {
      const p = g.player;
      if (!p) return false;
      if (p.state === 'sit' && p.seatEntity === entity) {
        p.stand();
        return true;
      }
      const s = entity.def.seat || [0.5, 0.5, 0.5];
      p.sitOn(entity, E.localToWorld(entity, s[0], s[1], s[2]), frontYaw(entity));
      g.audio.play('pop', { pitch: 0.9 });
      return true;
    },
    hint: (g, entity) => (g.player && g.player.seatEntity === entity ? 'Tap to stand up' : 'Tap to sit'),
  });

  let sleeping = false;
  const inThisBed = (g, entity) => !!g.player && g.player.state === 'sleep' && g.player.seatEntity === entity;
  E.registerAction('sleep', {
    run(g, entity) {
      const p = g.player;
      if (!p || sleeping) return false;
      if (inThisBed(g, entity)) {
        // already awake in bed after the night: tapping the bed again gets up
        p.stand();
        return true;
      }
      const s = entity.def.sleepPos || [0.5, 0.55, 1];
      p.sleepIn(entity, E.localToWorld(entity, s[0], s[1], s[2]), frontYaw(entity));
      g.audio.play('chime');
      sleeping = true;
      const wake = () => {
        sleeping = false;
        const name = g.profile.look && g.profile.look.name ? g.profile.look.name : 'friend';
        g.toast(`Good morning, ${name}!`, { icon: 'sun', big: true });
        g.audio.play('success');
        g.award('sweet_dreams');
      };
      if (g.ui && g.ui.transition) {
        g.ui.transition({ text: 'Zzz…', stars: true, hold: 1600 }, () => g.skipToMorning()).then(wake);
      } else {
        g.skipToMorning();
        wake();
      }
      return true;
    },
    hint: (g, entity) => (sleeping ? null : inThisBed(g, entity) ? 'Tap to get up' : 'Tap to sleep'),
  });

  E.registerAction('lamp', {
    run(g, entity) {
      const on = entity.data.on === false;
      E.setData(entity, { on });
      g.audio.play(on ? 'chime' : 'click');
      return true;
    },
    hint: (g, entity) => (entity.data.on === false ? 'Tap to turn on' : 'Tap to turn off'),
  });
}

export function install(game) {
  const E = game.entities;
  if (!E) return;
  installActions(game);

  E.define({
    key: 'bed_single',
    name: 'Cozy Bed',
    category: 'bedroom',
    size: [1, 1, 2],
    colors: SOFT,
    build: (color) => bedSingle(color),
    colliders: [[0, 0, 0, 1, 0.5, 2]],
    actions: ['sleep'],
    sleepPos: [0.5, 0.52, 1.0],
  });
  E.define({
    key: 'chair',
    name: 'Chair',
    category: 'kitchen',
    size: [1, 1, 1],
    colors: ['#FFB7D2', '#C3A6FF', '#9FD8FF', '#B6EC8C', '#FFE38A', '#FFFFFF'],
    build: (color) => chair(color),
    colliders: [[0.15, 0, 0.15, 0.85, 0.55, 0.85]],
    actions: ['sit'],
    seat: [0.5, 0.58, 0.52],
  });
  E.define({
    key: 'table_round',
    name: 'Round Table',
    category: 'kitchen',
    size: [1, 1, 1],
    colors: ['#E0B07A', '#FFFFFF', '#FFB7D2', '#C3A6FF'],
    build: (color) => tableRound(color),
    colliders: [[0.05, 0, 0.05, 0.95, 0.82, 0.95]],
    surface: 0.82, // lamps, cakes and bowls (placeOn: 'table') stand on this top
  });
  E.define({
    key: 'table_lamp',
    name: 'Table Lamp',
    category: 'lights',
    size: [1, 1, 1],
    colors: ['#FF8CC6', '#FFC94D', '#9C7BFF', '#6CC6FF', '#3FD8B0'],
    build: (color, data) => tableLamp(color, data),
    colliders: [[0.3, 0, 0.3, 0.7, 0.66, 0.7]],
    light: 13,
    lightPos: [0.5, 0.5, 0.5],
    actions: ['lamp'],
    defaultData: { on: true },
    placeOn: 'table',
  });
}
