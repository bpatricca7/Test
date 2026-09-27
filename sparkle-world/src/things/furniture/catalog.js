// Every canonical furniture key (DESIGN.md) as an entity def: model, swatches, size,
// colliders, surfaces, placeOn, seats / sleep spots, lights and the Hand-tool action.
// Per-frame animations live in anim.js (attached as def.update).

import * as THREE from 'three';
import * as M from '../furniture-models.js';
import { SW } from './palette.js';
import { TV_W, TV_H } from './tv.js';

const DOOR_OPEN = [[0, 0, 0, 0.16, 2, 1]];
const DOOR_SHUT = [[0, 0, 0, 1, 2, 0.16]];

/** A TV model with a per-entity canvas screen while it is on (data.ch > 0). */
function buildTv(color, data) {
  if (!(data && data.ch > 0) || typeof document === 'undefined') return M.tv(color, data || {});
  const canvas = document.createElement('canvas');
  canvas.width = TV_W;
  canvas.height = TV_H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  mat.userData.uvFit = true;
  const g = M.tv(color, data, mat);
  g.userData.screen = { canvas, ctx, tex, t: 0, acc: 1 };
  return g;
}

function fenceColliders(data) {
  const c = data.conn | 0 || 3;
  const out = [[0.38, 0, 0.38, 0.62, 1, 0.62]];
  if (c & 1) out.push([0.62, 0, 0.44, 1, 1, 0.56]);
  if (c & 2) out.push([0, 0, 0.44, 0.38, 1, 0.56]);
  if (c & 4) out.push([0.44, 0, 0.62, 0.56, 1, 1]);
  if (c & 8) out.push([0.44, 0, 0, 0.56, 1, 0.38]);
  return out;
}

/** All defs, in Bag order within each tab. */
export function furnitureDefs() {
  return [
    // ---------------- bedroom ----------------
    { key: 'bed_single', name: 'Cozy Bed', category: 'bedroom', size: [1, 1, 2], colors: SW.bedding, build: (c) => M.bedSingle(c),
      colliders: [[0, 0, 0, 1, 0.52, 2]], actions: ['sleep'], sleepPos: [0.5, 0.4, 1.0] },
    { key: 'bed_double', name: 'Big Bed', category: 'bedroom', size: [2, 1, 2], colors: SW.bedding, build: (c) => M.bedDouble(c),
      colliders: [[0, 0, 0, 2, 0.52, 2]], actions: ['sleep'], sleepPos: [1.0, 0.4, 1.0] },
    { key: 'bed_canopy', name: 'Princess Bed', category: 'bedroom', size: [2, 3, 2], colors: SW.bedding, build: (c) => M.bedCanopy(c),
      colliders: [[0, 0, 0, 2, 0.55, 2]], actions: ['sleep'], sleepPos: [1.0, 0.42, 1.0] },
    { key: 'bed_bunk', name: 'Bunk Bed', category: 'bedroom', size: [1, 3, 2], colors: SW.bedding, build: (c) => M.bedBunk(c),
      colliders: [[0, 0, 0, 1, 0.47, 2], [0, 1.3, 0, 1, 1.64, 2]], actions: ['sleep'],
      sleepSpots: [[0.5, 0.38, 1.0], [0.5, 1.54, 1.0]] },
    { key: 'bed_heart', name: 'Heart Bed', category: 'bedroom', size: [2, 2, 2], colors: SW.bedding, build: (c) => M.bedHeart(c),
      colliders: [[0, 0, 0, 2, 0.55, 2], [0, 0, 0, 2, 1.7, 0.14]], actions: ['sleep'], sleepPos: [1.0, 0.42, 1.05] },
    { key: 'bed_cloud', name: 'Cloud Bed', category: 'bedroom', size: [2, 2, 2], colors: SW.bedding, build: (c) => M.bedCloud(c),
      colliders: [[0, 0, 0, 2, 0.6, 2]], actions: ['sleep'], sleepPos: [1.0, 0.52, 1.05] },
    { key: 'crib', name: 'Baby Crib', category: 'bedroom', size: [1, 2, 2], colors: SW.bedding, build: (c) => M.crib(c),
      colliders: [[0, 0, 0, 1, 1.0, 2]], actions: ['sleep'], sleepPos: [0.5, 0.44, 1.0] },
    { key: 'pet_bed', name: 'Pet Bed', category: 'bedroom', size: [1, 1, 1], colors: SW.bedding, build: (c) => M.petBed(c),
      colliders: 'none', actions: ['pet_bed'], petSpot: [0.5, 0.16, 0.5] },
    { key: 'wardrobe', name: 'Wardrobe', category: 'bedroom', size: [2, 2, 1], colors: SW.wood.slice(1).concat(SW.wood[0]), build: (c) => M.wardrobe(c),
      colliders: 'full', actions: ['wardrobe'] },
    { key: 'dresser', name: 'Dresser', category: 'bedroom', size: [2, 1, 1], colors: SW.wood, build: (c) => M.dresser(c),
      colliders: [[0, 0, 0, 2, 0.92, 1]], surface: 0.92, actions: ['wardrobe'] },
    { key: 'vanity', name: 'Vanity', category: 'bedroom', size: [2, 2, 1], colors: [SW.wood[2], SW.wood[1], SW.wood[3], SW.wood[4], SW.wood[5], SW.wood[0]], build: (c) => M.vanity(c),
      colliders: [[0, 0, 0.05, 2, 0.82, 0.8], [0.38, 0.8, 0.05, 1.62, 1.9, 0.2]], actions: ['wardrobe'] },
    { key: 'nightstand', name: 'Nightstand', category: 'bedroom', size: [1, 1, 1], colors: SW.wood, build: (c) => M.nightstand(c),
      colliders: [[0.1, 0, 0.1, 0.9, 0.63, 0.9]], surface: 0.63 },
    { key: 'toy_chest', name: 'Toy Chest', category: 'bedroom', size: [1, 1, 1], colors: SW.bright, build: (c) => M.toyChest(c),
      colliders: [[0.05, 0, 0.15, 0.95, 0.58, 0.85]], actions: ['toy_chest'] },
    { key: 'bookshelf', name: 'Bookshelf', category: 'bedroom', size: [1, 1, 1], colors: SW.wood, build: (c) => M.bookshelf(c),
      colliders: [[0, 0, 0.25, 1, 0.98, 1]], surface: 0.98, actions: ['book'] },
    { key: 'desk', name: 'Desk', category: 'bedroom', size: [2, 1, 1], colors: SW.wood.slice(1).concat(SW.wood[0]), build: (c) => M.desk(c),
      colliders: [[0, 0, 0.05, 2, 0.8, 0.95]], surface: 0.8 },
    { key: 'mirror', name: 'Mirror', category: 'bedroom', size: [1, 2, 1], colors: SW.bright, build: (c) => M.mirror(c),
      colliders: 'none', placeOn: 'wall', actions: ['wardrobe'] },

    // ---------------- living room ----------------
    { key: 'sofa', name: 'Sofa', category: 'living', size: [2, 1, 1], colors: SW.fabric, build: (c) => M.sofa(c),
      colliders: [[0, 0, 0.05, 2, 0.45, 1], [0, 0, 0.05, 2, 0.82, 0.32]], actions: ['sit'], seats: [[0.55, 0.45, 0.52], [1.45, 0.45, 0.52]] },
    { key: 'armchair', name: 'Armchair', category: 'living', size: [1, 1, 1], colors: SW.fabric.slice(1).concat(SW.fabric[0]), build: (c) => M.armchair(c),
      colliders: [[0, 0, 0.05, 1, 0.45, 1], [0, 0, 0.05, 1, 1.0, 0.3]], actions: ['sit'], seat: [0.5, 0.45, 0.52] },
    { key: 'beanbag', name: 'Beanbag', category: 'living', size: [1, 1, 1], colors: SW.fabric.slice(2).concat(SW.fabric.slice(0, 2)), build: (c) => M.beanbag(c),
      colliders: [[0.1, 0, 0.1, 0.9, 0.34, 0.9]], actions: ['sit'], seat: [0.5, 0.36, 0.6] },
    { key: 'coffee_table', name: 'Coffee Table', category: 'living', size: [2, 1, 1], colors: SW.wood, build: (c) => M.coffeeTable(c),
      colliders: [[0.05, 0, 0.05, 1.95, 0.47, 0.95]], surface: 0.47 },
    { key: 'tv', name: 'TV', category: 'living', size: [2, 2, 1], colors: SW.bright, build: buildTv,
      colliders: [[0, 0, 0.1, 2, 1.75, 0.9]], actions: ['tv'], defaultData: { ch: 0, on: false }, light: 6, lightPos: [1, 1.2, 0.8] },
    { key: 'fireplace', name: 'Fireplace', category: 'living', size: [2, 2, 1], colors: ['#FFB8C8', '#C8B4FF', '#A6D8FF', '#FFE38F', '#FFFFFF', '#9BE8CF'], build: (c, d) => M.fireplace(c, d),
      colliders: 'full', surface: 1.38, actions: ['fireplace'], defaultData: { on: true }, light: 13, lightPos: [1, 0.5, 0.75] },
    { key: 'piano', name: 'Piano', category: 'living', size: [2, 2, 1], colors: SW.metal, build: (c) => M.piano(c),
      colliders: 'full', surface: 1.26, actions: ['piano'] },
    { key: 'rug_round', name: 'Round Rug', category: 'living', size: [2, 1, 2], colors: SW.fabric, build: (c) => M.rugRound(c),
      colliders: 'none', flat: true },
    { key: 'rug_heart', name: 'Heart Rug', category: 'living', size: [2, 1, 2], colors: SW.fabric, build: (c) => M.rugHeart(c),
      colliders: 'none', flat: true },
    { key: 'plant_pot', name: 'Plant', category: 'living', size: [1, 1, 1], colors: SW.bright, build: (c, d) => M.plantPot(c, d),
      colliders: [[0.28, 0, 0.28, 0.72, 0.6, 0.72]], placeOn: 'table', actions: ['plant'], defaultData: { bloom: false } },
    { key: 'picture_frame', name: 'Picture', category: 'living', size: [1, 1, 1], colors: SW.wood, build: (c, d) => M.pictureFrame(c, d),
      colliders: 'none', placeOn: 'wall', actions: ['picture'] },
    { key: 'clock', name: 'Kitty Clock', category: 'living', size: [1, 1, 1], colors: SW.bright, build: (c) => M.clock(c),
      colliders: 'none', placeOn: 'wall', actions: ['clock'] },
    { key: 'bookshelf_tall', name: 'Big Bookshelf', category: 'living', size: [2, 2, 1], colors: SW.wood, build: (c) => M.bookshelfTall(c),
      colliders: [[0, 0, 0.2, 2, 1.98, 1]], surface: 1.98, actions: ['book'] },

    // ---------------- lights ----------------
    { key: 'table_lamp', name: 'Table Lamp', category: 'lights', size: [1, 1, 1], colors: SW.shades, build: (c, d) => M.tableLamp(c, d),
      colliders: [[0.3, 0, 0.3, 0.7, 0.62, 0.7]], light: 13, lightPos: [0.5, 0.5, 0.5], actions: ['lamp'], defaultData: { on: true }, placeOn: 'table' },
    { key: 'floor_lamp', name: 'Floor Lamp', category: 'lights', size: [1, 2, 1], colors: SW.shades, build: (c, d) => M.floorLamp(c, d),
      colliders: [[0.3, 0, 0.3, 0.7, 1.8, 0.7]], light: 14, lightPos: [0.5, 1.5, 0.5], actions: ['lamp'], defaultData: { on: true } },
    { key: 'lamp_ceiling', name: 'Ceiling Lamp', category: 'lights', size: [1, 1, 1], colors: SW.shades, build: (c, d) => M.lampCeiling(c, d),
      colliders: 'none', light: 15, lightPos: [0.5, 0.42, 0.5], actions: ['lamp'], defaultData: { on: true }, placeOn: 'ceiling' },
    { key: 'fairy_lights', name: 'Fairy Lights', category: 'lights', size: [1, 1, 1], colors: SW.shades, build: (c, d) => M.fairyLights(c, d),
      colliders: 'none', light: 10, lightPos: [0.5, 0.75, 0.5], actions: ['lamp'], defaultData: { on: true }, placeOn: 'ceiling' },
    { key: 'lantern_post', name: 'Lamp Post', category: 'lights', size: [1, 2, 1], colors: SW.shades.slice(2).concat(SW.shades.slice(0, 2)), build: (c, d) => M.lanternPost(c, d),
      colliders: [[0.3, 0, 0.3, 0.7, 1.9, 0.7]], light: 14, lightPos: [0.5, 1.58, 0.5], actions: ['lamp'], defaultData: { on: true } },
    { key: 'candle', name: 'Candle', category: 'lights', size: [1, 1, 1], colors: SW.shades, build: (c, d) => M.candle(c, d),
      colliders: 'none', light: 9, lightPos: [0.5, 0.4, 0.5], actions: ['lamp'], defaultData: { on: true }, placeOn: 'table' },

    // ---------------- kitchen ----------------
    { key: 'stove', name: 'Stove', category: 'kitchen', size: [1, 1, 1], colors: SW.appliance, build: (c) => M.stove(c),
      colliders: [[0, 0, 0.05, 1, 0.92, 1]], actions: ['cook'], station: 'stove' },
    { key: 'oven', name: 'Oven', category: 'kitchen', size: [1, 1, 1], colors: SW.appliance.slice(1).concat(SW.appliance[0]), build: (c) => M.oven(c),
      colliders: [[0, 0, 0.05, 1, 0.94, 1]], surface: 0.94, actions: ['cook'], station: 'oven' },
    { key: 'fridge', name: 'Fridge', category: 'kitchen', size: [1, 2, 1], colors: SW.appliance.slice(2).concat(SW.appliance.slice(0, 2)), build: (c) => M.fridge(c),
      colliders: 'full', actions: ['cook'], station: 'fridge' },
    { key: 'counter', name: 'Counter', category: 'kitchen', size: [1, 1, 1], colors: SW.wood.slice(1).concat(SW.wood[0]), build: (c) => M.counter(c),
      colliders: [[0, 0, 0.04, 1, 0.91, 1]], surface: 0.91, actions: ['cook'], station: 'counter' },
    { key: 'sink_kitchen', name: 'Kitchen Sink', category: 'kitchen', size: [1, 1, 1], colors: SW.wood.slice(1).concat(SW.wood[0]), build: (c) => M.sinkKitchen(c),
      colliders: [[0, 0, 0.04, 1, 0.91, 1]], actions: ['sink'] },
    { key: 'table_round', name: 'Round Table', category: 'kitchen', size: [1, 1, 1], colors: SW.wood, build: (c) => M.tableRound(c),
      colliders: [[0.05, 0, 0.05, 0.95, 0.82, 0.95]], surface: 0.82 },
    { key: 'table_long', name: 'Long Table', category: 'kitchen', size: [2, 1, 1], colors: SW.bedding, build: (c) => M.tableLong(c),
      colliders: [[0, 0, 0, 2, 0.82, 1]], surface: 0.82 },
    { key: 'chair', name: 'Chair', category: 'kitchen', size: [1, 1, 1], colors: SW.fabric, build: (c) => M.chair(c),
      colliders: [[0.15, 0, 0.15, 0.85, 0.55, 0.85]], actions: ['sit'], seat: [0.5, 0.58, 0.52] },
    { key: 'stool', name: 'Stool', category: 'kitchen', size: [1, 1, 1], colors: SW.fabric.slice(3).concat(SW.fabric.slice(0, 3)), build: (c) => M.stool(c),
      colliders: [[0.22, 0, 0.22, 0.78, 0.66, 0.78]], actions: ['sit'], seat: [0.5, 0.67, 0.5] },
    { key: 'cake_stand', name: 'Cake', category: 'kitchen', size: [1, 1, 1], colors: SW.bedding, build: (c) => M.cakeStand(c),
      colliders: 'none', placeOn: 'table', actions: ['yum'] },
    { key: 'fruit_bowl', name: 'Fruit Bowl', category: 'kitchen', size: [1, 1, 1], colors: SW.bright.slice(1).concat(SW.bright[0]), build: (c) => M.fruitBowl(c),
      colliders: 'none', placeOn: 'table', actions: ['yum'] },

    // ---------------- bathroom ----------------
    { key: 'bathtub', name: 'Bathtub', category: 'bathroom', size: [1, 1, 2], colors: SW.bright, build: (c) => M.bathtub(c),
      colliders: [[0, 0, 0, 1, 0.66, 2]], actions: ['bath'], seat: [0.5, 0.22, 1.05] },
    { key: 'shower', name: 'Shower', category: 'bathroom', size: [1, 2, 1], colors: SW.bright.slice(1).concat(SW.bright[0]), build: (c) => M.shower(c),
      colliders: [[0, 0, 0, 1, 1.9, 0.08], [0, 0, 0, 0.06, 1.9, 1], [0.94, 0, 0, 1, 1.9, 1], [0.06, 0, 0.08, 0.94, 0.08, 1]], actions: ['shower'] },
    { key: 'toilet', name: 'Toilet', category: 'bathroom', size: [1, 1, 1], colors: SW.bright, build: (c) => M.toilet(c),
      colliders: [[0.2, 0, 0.05, 0.8, 0.5, 0.85]], actions: ['toilet'] },
    { key: 'sink_bath', name: 'Bath Sink', category: 'bathroom', size: [1, 1, 1], colors: SW.bright.slice(2).concat(SW.bright.slice(0, 2)), build: (c) => M.sinkBath(c),
      colliders: [[0.15, 0, 0.12, 0.85, 1.0, 0.75]], actions: ['sink'] },
    { key: 'towel_rack', name: 'Towels', category: 'bathroom', size: [1, 1, 1], colors: SW.bedding, build: (c) => M.towelRack(c),
      colliders: 'none', placeOn: 'wall', actions: ['towel'] },
    { key: 'bath_mat', name: 'Bath Mat', category: 'bathroom', size: [1, 1, 1], colors: SW.bedding.slice(2).concat(SW.bedding.slice(0, 2)), build: (c) => M.bathMat(c),
      colliders: 'none', flat: true },

    // ---------------- doors & structure ----------------
    { key: 'door', name: 'Door', category: 'building', size: [1, 2, 1], colors: SW.door, build: (c) => M.door(c),
      colliders: (d) => (d.open ? DOOR_OPEN : DOOR_SHUT), actions: ['door'], defaultData: { open: false } },
    { key: 'door_pink', name: 'Pink Door', category: 'building', size: [1, 2, 1], colors: SW.doorPink, build: (c) => M.doorPink(c),
      colliders: (d) => (d.open ? DOOR_OPEN : DOOR_SHUT), actions: ['door'], defaultData: { open: false } },
    { key: 'door_glass', name: 'Glass Door', category: 'building', size: [1, 2, 1], colors: SW.door.slice(1).concat(SW.door[0]), build: (c) => M.doorGlass(c),
      colliders: (d) => (d.open ? DOOR_OPEN : DOOR_SHUT), actions: ['door'], defaultData: { open: false } },
    { key: 'window_frame', name: 'Window', category: 'building', size: [1, 1, 1], colors: SW.door.slice(1).concat(SW.door[0]), build: (c, d) => M.windowFrame(c, d),
      colliders: [[0, 0, 0, 1, 1, 0.22]], placeOn: 'wall', actions: ['window'], defaultData: { open: true } },
    { key: 'stairs', name: 'Stairs', category: 'building', size: [1, 1, 1], colors: SW.fabric, build: (c) => M.stairs(c),
      colliders: [[0, 0, 0, 1, 0.25, 1], [0, 0.25, 0, 1, 0.5, 0.75], [0, 0.5, 0, 1, 0.75, 0.5], [0, 0.75, 0, 1, 1, 0.25]] },
    { key: 'fence', name: 'Fence', category: 'building', size: [1, 1, 1], colors: SW.door.slice(1).concat(SW.door[0]), build: (c, d) => M.fence(c, d),
      colliders: fenceColliders, defaultData: { conn: 0 } },
    { key: 'gate', name: 'Gate', category: 'building', size: [1, 1, 1], colors: SW.door.slice(1).concat(SW.door[0]), build: (c) => M.gate(c),
      colliders: (d) => (d.open ? [[0, 0, 0.4, 0.18, 1.1, 1], [0.9, 0, 0.4, 1, 1.1, 0.6]] : [[0, 0, 0.4, 1, 1.1, 0.6]]), actions: ['door'], defaultData: { open: false } },
    { key: 'ladder', name: 'Ladder', category: 'building', size: [1, 1, 1], colors: SW.door, build: (c) => M.ladder(c),
      colliders: 'none', placeOn: 'wall', actions: ['climb'], climb: true },

    // ---------------- garden ----------------
    { key: 'bench', name: 'Bench', category: 'garden', size: [2, 1, 1], colors: SW.bright.slice(2).concat(SW.bright.slice(0, 2)), build: (c) => M.bench(c),
      colliders: [[0.05, 0, 0.2, 1.95, 0.46, 0.9]], actions: ['sit'], seats: [[0.55, 0.47, 0.56], [1.45, 0.47, 0.56]] },
    { key: 'mailbox', name: 'Mailbox', category: 'garden', size: [1, 1, 1], colors: SW.bright, build: (c, d) => M.mailbox(c, d),
      colliders: [[0.3, 0, 0.2, 0.7, 0.96, 0.8]], actions: ['mailbox'], defaultData: { mail: true } },
    { key: 'well', name: 'Wishing Well', category: 'garden', size: [2, 2, 2], colors: SW.bright, build: (c) => M.well(c),
      colliders: [[0.15, 0, 0.15, 1.85, 0.72, 1.85]], actions: ['wish'] },
    { key: 'fountain', name: 'Fountain', category: 'garden', size: [2, 1, 2], colors: ['#E6E0F5', '#FFE3F0', '#DDF3FF', '#FFF6D8', '#E2FBF0'], build: (c) => M.fountain(c),
      colliders: [[0.1, 0, 0.1, 1.9, 0.35, 1.9], [0.85, 0, 0.85, 1.15, 0.9, 1.15]], actions: ['wish'] },
    { key: 'picnic_blanket', name: 'Picnic', category: 'garden', size: [2, 1, 2], colors: SW.bedding, build: (c) => M.picnicBlanket(c),
      colliders: 'none', flat: true, actions: ['sit'], seats: [[0.7, 0.03, 1.35], [1.4, 0.03, 1.3]] },
    { key: 'bird_house', name: 'Bird House', category: 'garden', size: [1, 2, 1], colors: SW.bright.slice(1).concat(SW.bright[0]), build: (c) => M.birdHouse(c),
      colliders: [[0.35, 0, 0.35, 0.65, 1.8, 0.65]], actions: ['bird'] },
    { key: 'flower_box', name: 'Flower Box', category: 'garden', size: [1, 1, 1], colors: SW.wood, build: (c) => M.flowerBox(c),
      colliders: 'none', placeOn: 'wall', actions: ['plant'] },

    // ---------------- fun & toys ----------------
    { key: 'swing', name: 'Swing', category: 'fun', size: [2, 2, 1], colors: SW.bright, build: (c) => M.swing(c),
      colliders: [[0, 0, 0, 0.2, 2, 1], [1.8, 0, 0, 2, 2, 1]], actions: ['swing'] },
    { key: 'slide', name: 'Slide', category: 'fun', size: [1, 2, 3], colors: SW.bright, build: (c) => M.slide(c),
      colliders: [[0, 0, 0, 1, 1.43, 0.85], [0.1, 0, 0.85, 0.9, 0.75, 1.9], [0.1, 0, 1.9, 0.9, 0.32, 3]], actions: ['slide'] },
    { key: 'trampoline', name: 'Trampoline', category: 'fun', size: [2, 1, 2], colors: SW.bright, build: (c) => M.trampoline(c),
      colliders: [[0.1, 0, 0.1, 1.9, 0.45, 1.9]], actions: ['trampoline'], bounce: true },
    { key: 'pool_float', name: 'Pool Float', category: 'fun', size: [1, 1, 1], colors: SW.bright, build: (c, d) => M.poolFloat(c, d),
      colliders: 'none', actions: ['float'], defaultData: { water: false } },
    { key: 'tree_house_ladder', name: 'Rope Ladder', category: 'fun', size: [1, 3, 1], colors: SW.door, build: (c) => M.treeHouseLadder(c),
      colliders: 'none', placeOn: 'wall', actions: ['climb'], climb: true },
    { key: 'easel', name: 'Easel', category: 'fun', size: [1, 2, 1], colors: SW.wood, build: (c, d) => M.easel(c, d),
      colliders: [[0.15, 0, 0.1, 0.85, 1.7, 0.8]], actions: ['easel'], defaultData: {} },
    { key: 'dollhouse', name: 'Dollhouse', category: 'fun', size: [2, 2, 1], colors: SW.bright, build: (c) => M.dollhouse(c),
      colliders: 'full', actions: ['dollhouse'], defaultData: { open: false } },
    { key: 'teddy_bear', name: 'Teddy Bear', category: 'fun', size: [1, 1, 1], colors: SW.teddy, build: (c) => M.teddyBear(c),
      colliders: 'none', placeOn: 'table', actions: ['hug'] },
    { key: 'balloon_bunch', name: 'Balloons', category: 'fun', size: [1, 2, 1], colors: ['#FF9CCB', '#A6D8FF', '#FFE38F', '#9BE8CF', '#C8B4FF', '#FFBFA0'], build: (c) => M.balloonBunch(c),
      colliders: 'none', actions: ['balloon'] },
  ];
}
