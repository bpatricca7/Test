// Blocky furniture models (the whole canonical catalog). Each builder returns a THREE.Group
// in block units whose footprint spans [0,w] x [0,h] x [0,d] (origin = footprint min corner)
// with the front facing +Z. Static sub-meshes are merged per material by the Kit
// (src/things/furniture/kit.js); moving bits are named parts: model.userData.parts[name].

export {
  bedSingle, bedDouble, bedCanopy, bedBunk, bedHeart, bedCloud, crib, petBed, wardrobe, dresser,
  vanity, nightstand, toyChest, bookshelf, bookshelfTall, desk, mirror,
} from './furniture/models-bedroom.js';
export {
  sofa, armchair, beanbag, coffeeTable, tv, fireplace, piano, rugRound, rugHeart, floorLamp,
  tableLamp, plantPot, pictureFrame, clock,
} from './furniture/models-living.js';
export {
  stove, oven, fridge, counter, sinkKitchen, tableRound, tableLong, chair, stool, cakeStand,
  fruitBowl, bathtub, shower, toilet, sinkBath, towelRack, bathMat,
} from './furniture/models-kitchen.js';
export {
  door, doorPink, doorGlass, windowFrame, stairs, fence, gate, ladder, treeHouseLadder,
  lampCeiling, fairyLights, lanternPost, candle, DOOR_OPEN_ANGLE,
} from './furniture/models-structure.js';
export {
  swing, slide, trampoline, bench, mailbox, well, fountain, poolFloat, picnicBlanket, birdHouse,
  flowerBox, easel, dollhouse, teddyBear, balloonBunch, SWING_PIVOT, SWING_ROPE, SLIDE_TOP,
  SLIDE_END, EASEL_COLORS, DEFAULT_PIC,
} from './furniture/models-garden.js';
export { Kit, partsOf } from './furniture/kit.js';
