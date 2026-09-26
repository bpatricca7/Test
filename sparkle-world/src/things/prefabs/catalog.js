// Every Magic House / Magic Build shipped with the game, in Bag order: the ten houses, then
// the other Magic Builds, then the wave 2 campers and treehouses.

import { cottage, princessCastle } from './houses-1.js';
import { treehouse, candyHouse, beachHut, igloo } from './houses-2.js';
import { bakery, petShop, modernHouse, barn } from './houses-3.js';
import { rainbowBridge, flowerGarden, playground } from './builds.js';
import { sparkleCamper, retroTrailer, camperVan } from './camp.js';
import { friendshipTreehouse, fairyTreehouse } from './trees.js';

export const PREFABS = [
  cottage, princessCastle, treehouse, candyHouse, beachHut, igloo, bakery, petShop, modernHouse, barn,
  rainbowBridge, flowerGarden, playground,
  sparkleCamper, retroTrailer, camperVan, friendshipTreehouse, fairyTreehouse,
];
