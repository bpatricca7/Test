// Family accounts in the game (docs/ACCOUNTS.md §7): src/main.js installs this right after
// `ui`. install(game) sets game.account and adds a start hook; Game.start() awaits it after the
// texture build and before store.init(). Meanwhile install() has already asked GET /api/net
// and, only when that answers `accounts` on, GET /api/me (both run during the texture build).
//
// prepare() decides the mode:
//   local    inside claude.ai (window.claude.use), not http(s) (file://), ?net=loop, or no
//            `accounts` in /api/net: nothing changes, and no /api request is made at all
//            (file://, claude.ai, ?net=loop) or only today's GET /api/net (a site without them);
//   account  a player picked (Who's playing? / locked device / the only one): her saves live
//            under 'sparkle-world@p-<uuid>' with the server's HttpCloudBackend; without a good
//            plan (`optional`) the cloud is only read and saves stay on the device;
//   visitor  (SW_FRIENDS_MODE=free-join, no plan, friends on) join friends only, no cloud;
//   blocked  (`required`) signed out, no plan, or no player: a card over the title.
// Signed out in `optional` mode stays local, with a Grown-ups tile. A network failure (never
// a 401) boots from the cache 'sparkle-world:acct' until its playUntil (§7.8); 410
// family_gone wipes every player copy it lists.
//
// game.account: { mode, server, me, player, playerId, active, offline, grownups, canHost,
// walkieAllowed, why, canSwitch, openGrownups(), switchPlayer(), setWalkie(on), api }

import { createApi } from './api.js';
import { HttpCloudBackend } from './cloud.js';
import { mergeProfile } from './merge.js';
import { importLegacy } from './legacy.js';
import { pickPlayer } from './picker.js';
import { watchPortrait } from './portrait.js';
import { ask, grownupCard, blockingCard, askLegacy } from './cards.js';
import { SaveStore } from '../core/storage.js';
import { fetchNetInfo } from '../net/transport.js';
import { openGate } from '../net/walkie/gate.js';
import { hostKind } from '../core/keepsafe.js';

const CACHE = 'sparkle-world:acct';

/** Pages where accounts never run (and nothing is asked): claude.ai, file://, ?net=loop. */
const localPage = () => hostKind() !== 'web' || /[?&]net=loop\b/.test(location.search);

export class Account {
  constructor(game) {
    this.game = game;
    this.mode = 'local';
    this.server = null; // 'optional' | 'required' when this site has accounts
    this.me = null;
    this.player = null;
    this.offline = false;
    this.hasLegacy = false;
    this.api = createApi();
    try {
      this.cache = JSON.parse(localStorage.getItem(CACHE)) || {};
    } catch {
      this.cache = {};
    }
    this.cache.used = this.cache.used || [];
    this._boot = localPage() ? null : this._ask();
  }

  get playerId() { return this.player && this.player.id; }
  /** A player is picked (account or visitor mode). */
  get active() { return !!this.player; }
  /** The site has accounts: Grown-ups entry points on the title and in Settings. */
  get grownups() { return !!this.server; }
  get canHost() { return !this.player || this.player.canHost !== false; }
  get walkieAllowed() { return !!(this.player && this.player.walkieOk); }
  /** Why she cannot play with friends now (null = she can): not_entitled | friends_locked | friends_off */
  get why() { return (this.player && this.player.why) || null; }
  get canSwitch() { return this.mode === 'account' && !this.me.lockPlayer && !this.me.locked && this.me.players.length > 1; }

  async _ask() {
    const net = await fetchNetInfo(globalThis);
    if (!net) return this.cache.accounts ? { err: { status: 0 }, server: this.cache.accounts } : {};
    if (!net.accounts || net.accounts === 'off') return {};
    try {
      return { me: (await this.api.call('GET', '/api/me', { timeout: 3000 })).json, server: net.accounts };
    } catch (err) {
      return { err, server: net.accounts };
    }
  }

  _write() {
    try {
      localStorage.setItem(CACHE, JSON.stringify(this.cache));
    } catch {}
  }

  /** The start hook: decide the mode, pick the player, configure the store. */
  async prepare() {
    let b = this._boot && (await this._boot);
    if (!b || !b.server) return;
    const g = this.game;
    const c = this.cache;
    this.server = b.server;
    while (b.err) {
      const e = b.err;
      if (e.code === 'family_gone') {
        await this._wipe(c.used);
        this.cache = { used: [] };
        this._write();
        b = { me: {} };
      } else if (e.status === 401) b = { me: {} };
      else if (c.me && Date.now() < c.me.playUntil) {
        this.offline = true; // offline boot (§7.8): pushes wait and retry
        b = { me: c.me };
      } else if (this.server === 'required') {
        await ask(g, "Can't reach Glimmer World", [['again', 'Try again', 'mint', 'again']], { text: 'Check the internet, then try again.', cancel: 'again' });
        b = await this._ask();
        if (!b.server) return;
      } else return; // optional: play on this device as today
    }
    const me = (this.me = b.me || {});
    const players = (me.players = me.players || []);
    if (!me.signedIn) {
      // signed out (a 401 too): this device boots nobody from the cache any more
      delete c.me;
      this._write();
      return this.server === 'required' && this._block('signin');
    }
    if (!this.offline) {
      c.me = me;
      c.accounts = this.server;
      this._write();
      // a player deleted on the Family page: her copy on this device goes too (410, §3.4)
      for (const id of c.used.filter((x) => !players.some((p) => p.id === x))) {
        this.api.call('GET', `/api/players/${id}/profile`).catch(async (e) => {
          if (e.status !== 404 && e.status !== 410) return;
          if (e.status === 410) await SaveStore.wipe('p-' + id);
          this.cache.used = this.cache.used.filter((x) => x !== id);
          this._write();
        });
      }
    }
    const entitled = !!(me.plan && me.plan.entitled);
    const free = me.friendsMode === 'free-join';
    if (!entitled && !free && this.server === 'required') return this._block('resting');
    if (!players.length) return (entitled || this.server === 'required') && this._block('noplayers');
    const next = c.next;
    delete c.next;
    const p = players.find((x) => x.id === me.lockPlayer) || (players.length === 1 ? players[0] : players.find((x) => x.id === next)) ||
      (await pickPlayer(g, { players, last: c.last, onGrownups: () => this.openGrownups() }));
    const visitor = !entitled && free && p.friends;
    if (!entitled && !visitor && this.server === 'required') return this._block('resting');
    this.player = p;
    this.mode = visitor ? 'visitor' : 'account';
    c.last = p.id;
    if (!c.used.includes(p.id)) c.used.push(p.id);
    this._write();
    g.store.configure({
      ns: 'p-' + p.id, mergeProfile, readOnly: !entitled,
      cloud: visitor ? null : new HttpCloudBackend(p.id, { api: this.api, offline: this.offline, onGone: (code) => this._gone(code) }),
    });
    // another device's profile merged in after a conflict (§7.4)
    g.store.onProfile((merged) => {
      Object.assign(g.profile, mergeProfile(g.profile, merged));
      this._name();
    });
    g.events.on('game:ready', () => {
      this._name();
      if (this.mode !== 'account') return;
      watchPortrait(g, this);
      // the worlds from before: asked on the title (never over her game)
      const later = () => setTimeout(() => (g.mode === 'title' && !g.loading ? askLegacy(g, this).catch(() => {}) : later()), 1500);
      if (!this.offline) later();
    });
    // her nickname is the family's (a file or a merge never renames her)
    g.events.on('profile:changed', () => this._name());
    g.events.on('net:message', (m) => m && m.code === 'player_gone' && this._gone(m.code));
  }

  /** The card of §7.1 over the title: it stays in `required`; in `optional` she may close it. */
  _block(why) {
    const soft = this.server !== 'required';
    if (!soft) this.mode = 'blocked';
    this.game.events.on('game:ready', () => setTimeout(() => blockingCard(this.game, this, why, soft), 0));
  }

  /** profile.playerName / nameSet / look.name = her nickname (§7.1). */
  _name() {
    const p = this.game.profile;
    const n = this.player && this.player.nickname;
    if (!n || (p.playerName === n && p.nameSet && (!p.look || p.look.name === n))) return;
    p.playerName = n;
    p.nameSet = true;
    if (p.look) p.look.name = n;
    this.game.saveProfile();
    this.game.events.emit('profile:changed', { profile: p });
  }

  async _wipe(ids) {
    this.game.store.close();
    for (const id of ids) await SaveStore.wipe('p-' + id);
  }

  /** 410 player_gone / family_gone: this device's copies go, back to the start (§7.2). */
  async _gone(code) {
    if (this._going) return;
    this._going = true;
    const c = this.cache;
    const id = this.playerId;
    await this._wipe(code === 'family_gone' ? c.used : [id]);
    if (code === 'family_gone') this.cache = { used: [] };
    else {
      c.used = c.used.filter((x) => x !== id);
      if (c.me) c.me.players = (c.me.players || []).filter((x) => x.id !== id);
      c.last = null;
    }
    this._write();
    location.reload();
  }

  /** The grown-up check (its own title), for the Grown-ups buttons. */
  gate() {
    return openGate(this.game, { purpose: 'grownups', settings: (this.cache.gate = this.cache.gate || {}), save: () => this._write() });
  }

  async openGrownups() {
    if (await this.gate()) await grownupCard(this.game, this);
  }

  /** "Not Lily?": pick another player; the page starts again as her. */
  async switchPlayer() {
    const p = await pickPlayer(this.game, { players: this.me.players, last: this.playerId, back: true });
    if (!p || p.id === this.playerId) return;
    this.game.flushSave();
    await this.game.store.flush();
    this.cache.next = p.id;
    this._write();
    location.reload();
  }

  /** The server's `perm` frame (§8.3): the walkie switched on or off for her. */
  setWalkie(on) {
    if (!this.player || this.player.walkieOk === on) return;
    this.player.walkieOk = on;
    this.game.events.emit('account:changed', {});
  }

  notePortrait(url) {
    this.player.portrait = url; // (the same object as in the cache's me)
    this._write();
  }

  /** The worlds from before into player p (§7.5): her own store, or another player's. */
  async importTo(p, legacy) {
    const g = this.game;
    const own = p.id === this.playerId;
    const s = own ? g.store : new SaveStore().configure({ ns: 'p-' + p.id, cloud: new HttpCloudBackend(p.id, { api: this.api }), mergeProfile });
    const prof = own ? g.profile : (await s.loadProfile()) || { stickers: {}, stats: {}, look: {} };
    const r = await importLegacy(legacy, s, prof);
    prof.playerName = p.nickname;
    prof.nameSet = true;
    if (prof.look) prof.look.name = p.nickname;
    if (own) {
      await g.saveProfile(true);
      g.events.emit('profile:changed', { profile: prof });
    } else {
      prof.updatedAt = Date.now();
      await s.saveProfile(prof);
      await s.flush();
      s.close();
      if (!this.cache.used.includes(p.id)) this.cache.used.push(p.id);
      this._write();
    }
    return r;
  }
}

export function install(game) {
  const acct = new Account(game);
  game.account = acct;
  game.startHooks.push(() => acct.prepare());
  return acct;
}
