// The Bag's "Squish Toys" tab, spliced in right after Fun & Toys (the way camping and vehicles add
// theirs), once, however often install runs. Squish installs after outdoor, so the tab lands
// between Fun & Toys and Camping.

import { ITEM_CATEGORIES } from '../../core/registry.js';
import { STRINGS } from './data.js';

export const TAB = 'squish';

export function addSquishTab() {
  if (ITEM_CATEGORIES.some(([id]) => id === TAB)) return;
  const at = ITEM_CATEGORIES.findIndex(([id]) => id === 'fun');
  ITEM_CATEGORIES.splice(at >= 0 ? at + 1 : ITEM_CATEGORIES.length, 0, [TAB, STRINGS.bagTab]);
}
