// Colors tab: 16 wool colors, a carpet for each, and smooth pastel paint blocks.

import { knit, natural, ramp } from './kit.js';

/** Pastel wool palette. Order = Bag order (pink first, then the rainbow, then neutrals). */
export const WOOL = [
  ['pink', '#FFA9CB', 'Pink'],
  ['red', '#FF8A8A', 'Red'],
  ['orange', '#FFB67A', 'Orange'],
  ['yellow', '#FFE38A', 'Yellow'],
  ['lime', '#B6EC8C', 'Lime'],
  ['green', '#7FD49B', 'Green'],
  ['cyan', '#86E1DE', 'Aqua'],
  ['sky', '#9FD8FF', 'Sky Blue'],
  ['blue', '#8CA6FF', 'Blue'],
  ['purple', '#C3A6FF', 'Purple'],
  ['magenta', '#F58FE0', 'Hot Pink'],
  ['brown', '#C99B7B', 'Brown'],
  ['white', '#FAF6F4', 'White'],
  ['lightgray', '#D9D4E1', 'Light Gray'],
  ['gray', '#A8A2B6', 'Gray'],
  ['black', '#5F5772', 'Black'],
];

export const PASTEL = [
  ['concrete_pink', '#FFC3D9', 'Pastel Pink'],
  ['concrete_peach', '#FFD4B8', 'Pastel Peach'],
  ['concrete_yellow', '#FFF0A9', 'Pastel Yellow'],
  ['concrete_mint', '#BEF1D9', 'Pastel Mint'],
  ['concrete_sky', '#C0E2FF', 'Pastel Blue'],
  ['concrete_lavender', '#DCCBFF', 'Pastel Purple'],
];

export function install(L) {
  const { tile, block } = L;
  for (const [name, color] of WOOL) tile('wool_' + name, (p, r) => knit(p, r, color));
  for (const [key, color] of PASTEL) {
    tile(key, (p, r) => natural(p, r, ramp(color, [-0.04, -0.015, 0.01, 0.035]), { dither: 0.5, oct: [[2, 0.5], [4, 0.5]] }));
  }
  for (const [name, color, label] of WOOL) block({ key: 'wool_' + name, name: label + ' Wool', category: 'colors', color });
  for (const [name, color, label] of WOOL) {
    block({ key: 'carpet_' + name, name: label + ' Carpet', category: 'colors', shape: 'carpet', tiles: { all: 'wool_' + name }, color });
  }
  for (const [key, color, label] of PASTEL) block({ key, name: label, category: 'colors', color });
}
