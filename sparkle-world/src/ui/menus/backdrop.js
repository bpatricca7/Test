// Title screen backdrop: a tiny meadow island diorama (NOT a saved world) with a cottage,
// cherry trees, flowers, butterflies and drifting voxel clouds, the player's avatar waving in
// front, and a slow swinging "orbit" camera. Built from the real block renderer (World +
// ChunkRenderer) so it looks exactly like the game. Everything is disposed when a world starts.

import * as THREE from 'three';
import { World } from '../../world/world.js';
import { ChunkRenderer } from '../../world/chunks.js';
import { growTree, put, peek } from '../../world/worldgen.js';
import { mulberry32, clamp, smoothstep, lerp, angleDelta } from '../../core/util.js';
import { Noise } from '../../core/noise.js';
import { disposeObject } from '../../core/models.js';

const SIZE = { x: 48, y: 32, z: 48 };
const GROUND = 12; // top grass layer
const SEA = 9;
const CX = 24, CZ = 24;
const HOUSE = { x0: 20, x1: 28, z0: 14, z1: 20 };
const AVATAR_POS = [24.5, GROUND + 1, 30.6];
const PIVOT = new THREE.Vector3(24.5, GROUND + 3.4, 27.4);
const EMOTES = ['wave', 'twirl', 'heart', 'jump', 'dance', 'wave', 'heart'];

/** First registered block key of a list (null when none is registered). */
function firstKey(reg, keys) {
  for (const k of keys) if (reg.has(k)) return k;
  return null;
}

function wingTexture(color, spot) {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(14, 11, 13, 10, -0.3, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(12, 24, 9, 7, 0.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = spot;
  g.beginPath();
  g.arc(15, 10, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(16, 9, 1.6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TitleBackdrop {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'title-backdrop';
    this.t = 0;
    this.disposed = false;
    this.layout = 'wide';
    this._emoteAt = 0.9;
    this._emoteIdx = 0;
    this._petalAt = 0;
    this._smokeAt = 0;
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._head = new THREE.Vector3();
    this.cherries = [];
    this.props = [];
    this.butterflies = [];
    this.clouds = [];
    this._buildWorld();
    this._buildProps();
    this._buildAvatar();
    this._buildButterflies();
    this._buildClouds();
    game.scene.add(this.group);
  }

  // ---------- island ----------

  _buildWorld() {
    const game = this.game;
    const reg = game.registry.blocks;
    const w = new World(SIZE, reg);
    this.world = w;
    const rand = mulberry32(20260926);
    const noise = new Noise(7);
    const id = (keys) => {
      const k = firstKey(reg, Array.isArray(keys) ? keys : [keys]);
      return k ? reg.idOf(k) : 0;
    };
    const G = id('grass'), D = id('dirt'), S = id('stone'), SAND = id('sand'), W = id('water');
    const heights = new Int16Array(SIZE.x * SIZE.z);
    this.heights = heights;

    for (let z = 0; z < SIZE.z; z++) {
      for (let x = 0; x < SIZE.x; x++) {
        const dx = x + 0.5 - CX, dz = z + 0.5 - CZ;
        const ang = Math.atan2(dz, dx);
        const R = 17.2 + noise.fbm2(Math.cos(ang) * 1.4 + 3, Math.sin(ang) * 1.4 + 3, 2) * 2.4;
        const d = Math.hypot(dx, dz) / R;
        let h;
        if (d < 0.8) {
          h = GROUND;
          // a soft mound behind-left and a little rise behind-right
          const m1 = 1 - Math.hypot(x - 13, z - 12) / 8;
          const m2 = 1 - Math.hypot(x - 35, z - 11) / 6;
          if (m1 > 0) h += Math.round(smoothstep(0, 1, m1) * 2.6);
          if (m2 > 0) h += Math.round(smoothstep(0, 1, m2) * 1.4);
        } else if (d < 1) {
          h = Math.round(lerp(GROUND, SEA - 0.4, smoothstep(0.8, 1, d)));
        } else {
          h = Math.round(clamp(SEA - 2 - (d - 1) * 8, 3, SEA - 2));
        }
        heights[z * SIZE.x + x] = h;
        const beach = h <= SEA + 1;
        for (let y = 0; y <= h; y++) {
          const idb = y === h ? (beach ? SAND : G) : y >= h - 3 ? (beach ? SAND : D) : S;
          put(w, x, y, z, idb);
        }
        for (let y = h + 1; y <= SEA; y++) put(w, x, y, z, W);
      }
    }
    w.waterLevel = SEA;
    w.outside = { block: 'water', surface: SEA + 0.875 };

    this._buildHouse(id);

    // doorstep + stepping-stone path toward the camera
    const planks = id(['planks_oak']);
    const cob = id(['cobble', 'stone']);
    for (let x = 23; x <= 25; x++) put(w, x, GROUND, HOUSE.z1 + 1, planks);
    for (let z = HOUSE.z1 + 2; z <= 34; z++) {
      put(w, 24, GROUND, z, cob);
      if (rand() < 0.5) put(w, 23 + (rand() < 0.5 ? 0 : 2), GROUND, z, cob);
    }
    // lantern posts beside the path
    const lamp = id(['lantern', 'lamp_block']);
    const log = id(['log_oak']);
    for (const lx of [21, 27]) {
      put(w, lx, GROUND + 1, 23, log);
      put(w, lx, GROUND + 2, 23, lamp);
    }

    // trees (x, z, cherry?)
    const trees = [[13, 21, true], [36, 23, true], [31, 10, true], [15, 9, false], [10, 28, false], [38, 30, true]];
    for (const [tx, tz, cherry] of trees) {
      const ty = heights[tz * SIZE.x + tx] + 1;
      const height = 4 + Math.floor(rand() * 2);
      if (cherry) {
        growTree(w, tx, ty, tz, { log: 'log_oak', leaves: firstKey(reg, ['leaves_cherry', 'leaves_oak']), height, radii: [2.9, 2.9, 2.2, 1.2], rand });
        this.cherries.push([tx + 0.5, ty + height - 0.5, tz + 0.5]);
      } else {
        growTree(w, tx, ty, tz, { log: 'log_oak', leaves: 'leaves_oak', height: height + 1, radii: [2.5, 2.5, 1.9, 1.1], rand });
      }
    }

    // flower drifts (keep the path, the doorstep and the avatar's spot clear)
    const flowerKeys = ['flower_rose', 'flower_tulip', 'flower_daisy', 'flower_sunflower', 'flower_lavender', 'flower_poppy']
      .filter((k) => reg.has(k)).map((k) => reg.idOf(k));
    const tall = id(['grass_tall']);
    for (let z = 1; z < SIZE.z - 1; z++) {
      for (let x = 1; x < SIZE.x - 1; x++) {
        const h = heights[z * SIZE.x + x];
        if (peek(w, x, h, z) !== G || peek(w, x, h + 1, z) !== 0) continue;
        if (x >= 22 && x <= 26 && z >= HOUSE.z1 && z <= 35) continue;
        if (x >= HOUSE.x0 - 1 && x <= HOUSE.x1 + 1 && z >= HOUSE.z0 - 1 && z <= HOUSE.z1 + 1) continue;
        const field = noise.fbm2(x / 9 + 11, z / 9 - 4, 2);
        const r = rand();
        if (flowerKeys.length && r < (field > 0.05 ? 0.34 : 0.12)) {
          const kind = Math.floor(((noise.n2(x / 6, z / 6) + 1) / 2) * flowerKeys.length) % flowerKeys.length;
          put(w, x, h + 1, z, rand() < 0.8 ? flowerKeys[kind] : flowerKeys[Math.floor(rand() * flowerKeys.length)]);
        } else if (r < 0.46 && tall) {
          put(w, x, h + 1, z, tall);
        }
      }
    }

    w.computeAllLight();
    this.chunks = new ChunkRenderer(w, game.blockMaterials);
    // mesh it all now (9 small chunks), so the very first frame shows the whole island
    let guard = 0;
    while (this.chunks.pending > 0 && guard++ < 64) this.chunks.update(1000, CX, CZ + 30);
    this.group.add(this.chunks.group);
  }

  _buildHouse(id) {
    const w = this.world;
    const { x0, x1, z0, z1 } = HOUSE;
    const floor = id(['planks_oak']);
    const wall = id(['planks_pink', 'wool_pink']);
    const trim = id(['planks_white', 'wool_white']);
    const corner = id(['log_birch', 'log_oak']);
    const winFront = id(['glass_heart', 'glass_pink', 'glass']);
    const winSide = id(['glass_pink', 'glass']);
    const roof = id(['roof_pink', 'wool_magenta', 'wool_purple']);
    const chimney = id(['brick_red', 'cobble']);
    const ridge = id(['roof_red', 'wool_pink', 'planks_pink']);
    const top = GROUND + 4;
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        put(w, x, GROUND, z, floor);
        const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
        if (!edgeX && !edgeZ) continue;
        for (let y = GROUND + 1; y <= top; y++) {
          let b = edgeX && edgeZ ? corner : y === top ? trim : wall;
          put(w, x, y, z, b);
        }
      }
    }
    // windows: two on the front, one on each side, two on the back
    const win = (x, z, b) => { put(w, x, GROUND + 2, z, b); put(w, x, GROUND + 3, z, b); };
    for (const x of [21, 22, 26, 27]) { win(x, z1, winFront); win(x, z0, winSide); }
    for (const z of [16, 17, 18]) { win(x0, z, winSide); win(x1, z, winSide); }
    // doorway (a door model goes in when the furniture team's door exists)
    put(w, 24, GROUND + 1, z1, 0);
    put(w, 24, GROUND + 2, z1, 0);
    this.doorCell = [24, GROUND + 1, z1];
    // gable roof along x, one block of overhang all around
    for (let k = 0; k < 4; k++) {
      const y = top + 1 + k;
      const za = z0 - 1 + k, zb = z1 + 1 - k;
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        // white eaves at the bottom edge, a pink ridge on top
        const b = k === 0 ? trim : roof;
        put(w, x, y, za, b);
        put(w, x, y, zb, b);
        if (k === 3) for (let z = za; z <= zb; z++) put(w, x, y, z, z === za + 1 ? ridge : roof);
      }
      // gable ends
      for (let z = za + 1; z < zb; z++) {
        put(w, x0, y, z, trim);
        put(w, x1, y, z, trim);
      }
    }
    // chimney through the back slope
    for (let y = top + 2; y <= top + 6; y++) put(w, 26, y, z0 + 1, chimney);
    this.chimneyTop = [26.5, top + 7, z0 + 1.5];
    // a lamp inside so the windows glow a little
    put(w, 24, top, 17, id(['lamp_block']));
  }

  // ---------- furniture props (only the ones another team has registered) ----------

  _buildProps() {
    const game = this.game;
    const furn = game.registry.furniture;
    if (!furn) return;
    const place = (key, x, y, z, rot = 0) => {
      const def = furn.get(key);
      if (!def || typeof def.build !== 'function') return false;
      try {
        const color = def.colors && def.colors.length ? def.colors[0] : null;
        const data = def.defaultData ? JSON.parse(JSON.stringify(def.defaultData)) : {};
        const obj = def.build(color, data);
        if (!obj) return false;
        // turn around the anchor cell's centre; the model spans [0,w]x[0,h]x[0,d] from its corner
        const pivot = new THREE.Group();
        pivot.position.set(x + 0.5, y, z + 0.5);
        pivot.rotation.y = (rot * Math.PI) / 2;
        obj.position.set(-0.5, 0, -0.5);
        pivot.add(obj);
        this.group.add(pivot);
        this.props.push(pivot);
        return true;
      } catch (err) {
        console.warn('[title] prop failed', key, err);
        return false;
      }
    };
    const [dx, dy, dz] = this.doorCell;
    if (!place('door_pink', dx, dy, dz) && !place('door', dx, dy, dz)) {
      // no door model yet: a wooden door made of blocks-looking boxes
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.12), new THREE.MeshLambertMaterial({ color: '#C98B5B' }));
      door.position.set(dx + 0.5, dy + 0.95, dz + 0.72);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshLambertMaterial({ color: '#FFD54A' }));
      knob.position.set(0.3, 0, 0.08);
      door.add(knob);
      const heart = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.05), new THREE.MeshLambertMaterial({ color: '#FF7EB6' }));
      heart.position.set(0, 0.5, 0.07);
      heart.rotation.z = Math.PI / 4;
      door.add(heart);
      this.group.add(door);
      this.props.push(door);
    }
    place('mailbox', 27, GROUND + 1, 26);
    place('bench', 17, GROUND + 1, 26, 1);
    place('picnic_blanket', 29, GROUND + 1, 28);
    place('balloon_bunch', 20, GROUND + 1, 27);
    place('flower_box', 21, GROUND + 1, 21);
  }

  // ---------- avatar ----------

  _buildAvatar() {
    const game = this.game;
    if (typeof game.createAvatar !== 'function') return;
    try {
      this.avatar = game.createAvatar(game.profile.look);
      const g = this.avatar.group;
      g.position.set(AVATAR_POS[0], AVATAR_POS[1], AVATAR_POS[2]);
      g.rotation.y = 0;
      this.group.add(g);
      // a soft round shadow under her feet
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const grd = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, 'rgba(58,31,77,0.35)');
      grd.addColorStop(1, 'rgba(58,31,77,0)');
      x.fillStyle = grd;
      x.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(AVATAR_POS[0], AVATAR_POS[1] + 0.02, AVATAR_POS[2]);
      this.shadow = shadow;
      this.group.add(shadow);
    } catch (err) {
      console.warn('[title] avatar failed', err);
      this.avatar = null;
    }
  }

  setLook(look) {
    if (this.avatar && this.avatar.setLook) {
      try { this.avatar.setLook(look); } catch (err) { console.warn('[title] setLook failed', err); }
    }
  }

  /** Make her do something cute right now (e.g. when the title opens). */
  cheer(name = 'wave') {
    if (this.avatar && this.avatar.playEmote) this._emoteAt = this.t + this.avatar.playEmote(name) + 4 + Math.random() * 3;
  }

  // ---------- butterflies & clouds ----------

  _buildButterflies() {
    const colors = [['#FFB8D6', '#FF5FA2'], ['#C9B8FF', '#9C7BFF'], ['#FFE38A', '#FFA43B'], ['#B8E1FF', '#6CC6FF']];
    this._wingGeo = new THREE.PlaneGeometry(0.34, 0.34);
    this._wingGeo.translate(0.17, 0, 0);
    colors.forEach(([base, spot], i) => {
      const mat = new THREE.MeshBasicMaterial({ map: wingTexture(base, spot), transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.1 });
      const b = new THREE.Group();
      const left = new THREE.Mesh(this._wingGeo, mat);
      const right = new THREE.Mesh(this._wingGeo, mat);
      right.scale.x = -1;
      left.rotation.x = right.rotation.x = -Math.PI / 2;
      b.add(left, right);
      b.userData = { left, right, phase: i * 1.7, cx: [15, 31, 19, 33][i], cz: [28, 27, 18, 16][i], r: 2.2 + i * 0.4 };
      this.butterflies.push(b);
      this.group.add(b);
    });
  }

  _buildClouds() {
    const mat = new THREE.MeshLambertMaterial({ color: '#FFFFFF', emissive: '#FFFFFF', emissiveIntensity: 0.55 });
    this._cloudMat = mat;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this._cloudGeo = geo;
    const rand = mulberry32(99);
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat);
        const w = 3 + rand() * 4, h = 1.2 + rand() * 1.2, d = 2.5 + rand() * 3;
        m.scale.set(w, h, d);
        m.position.set(k * 2.4 - n * 1.2 + rand(), rand() * 0.8, rand() * 2 - 1);
        c.add(m);
      }
      c.position.set(-20 + i * 16 + rand() * 6, 27 + rand() * 6, -14 + (i % 3) * 16 + rand() * 8);
      c.userData.speed = 0.35 + rand() * 0.3;
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  // ---------- per frame ----------

  /** layout: 'wide' (buttons on the left) or 'tall' (logo on top, buttons below). */
  setLayout(layout) {
    this.layout = layout;
  }

  update(dt) {
    if (this.disposed) return;
    const game = this.game;
    this.t += dt;
    const t = this.t;
    const cam = game.camera;
    const w = game.container.clientWidth || window.innerWidth;
    const h = game.container.clientHeight || window.innerHeight;
    const tall = this.layout === 'tall';

    // camera: a slow swing around the front of the island
    const theta = Math.sin(t * 0.075) * 0.95 + 0.12;
    // narrower screens (4:3 tablets) step back a little so the cottage fits
    const aspect = w / Math.max(1, h);
    const R = tall ? 13.5 : 13.5 * clamp(1.62 / aspect, 1, 1.3);
    const lift = tall ? 2.6 : 2.6;
    cam.position.set(PIVOT.x + Math.sin(theta) * R, PIVOT.y + lift + Math.sin(t * 0.11) * 0.5, PIVOT.z + Math.cos(theta) * R);
    this._look.copy(PIVOT);
    cam.lookAt(this._look);
    const fov = tall ? 56 : 44;
    if (cam.fov !== fov) cam.fov = fov;
    // shift the picture so she stands beside the buttons (wide) or between logo and buttons (tall)
    const ox = tall ? 0 : -w * 0.2;
    const oy = tall ? h * 0.08 : h * 0.02;
    const v = cam.view;
    if (!v || !v.enabled || v.fullWidth !== w || v.fullHeight !== h || v.offsetX !== ox || v.offsetY !== oy) {
      cam.setViewOffset(w, h, ox, oy, w, h);
    }
    cam.updateProjectionMatrix();

    // avatar: turn toward the camera a little, idle + emotes now and then
    const av = this.avatar;
    if (av) {
      const g = av.group;
      const want = clamp(Math.atan2(cam.position.x - g.position.x, cam.position.z - g.position.z), -0.7, 0.7);
      g.rotation.y += angleDelta(g.rotation.y, want) * Math.min(1, dt * 2.5);
      if (t >= this._emoteAt && av.playEmote) {
        const name = EMOTES[this._emoteIdx++ % EMOTES.length];
        const dur = av.playEmote(name) || 2;
        this._emoteAt = t + dur + 4.5 + Math.random() * 3;
      }
      av.update(dt, { speed: 0, onGround: true });
    }

    // butterflies flutter over the flowers
    for (const b of this.butterflies) {
      const u = b.userData;
      const a = t * 0.55 + u.phase;
      b.position.set(u.cx + Math.cos(a) * u.r, GROUND + 1.8 + Math.sin(a * 2.3) * 0.5, u.cz + Math.sin(a * 1.3) * u.r);
      b.rotation.y = -a;
      const flap = Math.sin(t * 16 + u.phase) * 0.9;
      u.left.rotation.y = flap;
      u.right.rotation.y = -flap;
    }
    // clouds drift and wrap around
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 80) c.position.x = -36;
    }
    // cherry petals and a puff from the chimney
    const P = game.particles;
    if (P) {
      this._petalAt -= dt;
      if (this._petalAt <= 0 && this.cherries.length) {
        this._petalAt = 0.45;
        const [px, py, pz] = this.cherries[Math.floor(Math.random() * this.cherries.length)];
        P.emit('petal', this._tmp.set(px + (Math.random() - 0.5) * 3, py, pz + (Math.random() - 0.5) * 3), { count: 2, spread: 1.2 });
      }
      this._smokeAt -= dt;
      if (this._smokeAt <= 0) {
        this._smokeAt = 1.6;
        const [sx, sy, sz] = this.chimneyTop;
        P.emit('smoke_puff', this._tmp.set(sx, sy, sz), { count: 2, spread: 0.2, scale: 0.8 });
      }
    }
    this.chunks.update(2, cam.position.x, cam.position.z);
  }

  /** Screen position (CSS px) of a point just above her head, or null. */
  headScreen(out) {
    if (!this.avatar) return null;
    const g = this.avatar.group;
    const cam = this.game.camera;
    const v = this._head.set(g.position.x, g.position.y + 2.05, g.position.z).project(cam);
    if (v.z > 1) return null;
    const w = this.game.container.clientWidth, h = this.game.container.clientHeight;
    out.x = ((v.x + 1) / 2) * w;
    out.y = ((1 - v.y) / 2) * h;
    return out;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const game = this.game;
    game.scene.remove(this.group);
    if (this.chunks) this.chunks.dispose();
    if (this.avatar) {
      this.group.remove(this.avatar.group);
      try { this.avatar.dispose(); } catch (err) { console.warn('[title] avatar dispose', err); }
    }
    for (const p of this.props) disposeObject(p);
    if (this.shadow) disposeObject(this.shadow);
    for (const b of this.butterflies) {
      const m = b.userData.left.material;
      if (m.map) m.map.dispose();
      m.dispose();
    }
    if (this._wingGeo) this._wingGeo.dispose();
    if (this._cloudGeo) this._cloudGeo.dispose();
    if (this._cloudMat) this._cloudMat.dispose();
    this.group.clear();
    this.world = null;
    // petals and chimney puffs belong to the island
    if (game.particles && game.particles.clear) game.particles.clear();
    const cam = game.camera;
    cam.clearViewOffset();
    if (typeof game._resize === 'function') game._resize();
    else cam.updateProjectionMatrix();
  }
}
