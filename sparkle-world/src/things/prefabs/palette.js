// Shared bits for Magic House designs: rotations, pastel furniture colors, flower lists and
// furniture key lists with sensible stand-ins (first registered key wins).

import { ROT } from './kit.js';

export const F = ROT.FRONT; // faces the house front (+z)
export const R = ROT.RIGHT; // faces +x
export const B = ROT.BACK; // faces the back (-z)
export const L = ROT.LEFT; // faces -x

export const C = {
  pink: '#FF9CCB',
  rose: '#FFB8C8',
  hot: '#FF6FB0',
  lav: '#C8B4FF',
  sky: '#A6D8FF',
  mint: '#9BE8CF',
  sun: '#FFE38F',
  peach: '#FFBFA0',
  white: '#FFFFFF',
  cream: '#FFF6E8',
  wood: '#E0B07A',
  gold: '#FFD66B',
  red: '#FF8A8A',
};

export const FLOWERS = ['flower_rose', 'flower_tulip', 'flower_daisy', 'flower_sunflower', 'flower_lavender', 'flower_poppy'];
export const PINK_FLOWERS = ['flower_rose', 'flower_tulip', 'flower_rose', 'flower_daisy'];

// furniture with stand-ins, so a home always has a bed, a seat and a light
export const BED_BIG = 'bed_double|bed_single';
export const BED_PRINCESS = 'bed_canopy|bed_double|bed_single';
export const BED_HEART = 'bed_heart|bed_double|bed_single';
export const BED_CLOUD = 'bed_cloud|bed_double|bed_single';
export const BED_BUNK = 'bed_bunk|bed_single';
export const SOFA = 'sofa|chair';
export const ARMCHAIR = 'armchair|chair';
export const COMFY = 'beanbag|armchair|chair';
export const STOOL = 'stool|chair';
export const TABLE = 'table_round';
export const TABLE_LONG = 'table_long|table_round';
export const FLOOR_LAMP = 'floor_lamp|table_lamp';
export const LANTERN = 'lantern_post|floor_lamp|table_lamp';
export const CEIL_LAMP = 'lamp_ceiling';
export const BENCH = 'bench|chair';
