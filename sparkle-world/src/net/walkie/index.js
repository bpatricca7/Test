// The walkie-talkie (docs/MULTIPLAYER.md Addendum C, docs/teams/walkie.md).
//
// The family asked: "only to be used with a code for multiplayer and only used when pressed,
// it has to be confirmed by a parent with a multiplication problem". So it exists only:
//   - on the Railway site (WsTransport; inside claude.ai the microphone is blocked: hidden),
//   - while playing together (a code), for the players of that one game,
//   - on a device whose grown-up passed the check (profile.settings.walkie = {on, at}); a
//     device without it neither talks nor hears (the server sends it no voice at all),
//   - while the button is held (mic opened on press, every track stopped on release), at most
//     15 s per press, one talker at a time,
//   - unless the host said "Mute everyone" or muted that player; each child can also mute
//     anyone for herself. Nothing is recorded or stored anywhere.
//
// install: src/net/index.js calls installWalkie(game, net) -> net.walkie.

import { W, F_START, F_END, packFrame, isPeerId } from './wire.js';
import { AdpcmEncoder } from './adpcm.js';
import { Mic } from './capture.js';
import { VoicePlayer } from './player.js';
import { WalkieUI } from './ui.js';
import { seatColor } from '../remote-players.js';
import { sanitizeName } from '../names.js';

const LIVE = new Set(['h.live', 'g.live', 'g.waiting']);
const MAX_PENDING = 16; // frames captured before the server said "go" (about 1.3 s)

export function installWalkie(game, net) {
  const wk = new Walkie(game, net);
  return wk;
}

class Walkie {
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.t = null; // the attached WsTransport
    this.declared = null; // the host peer we said "on" for (null = off)
    this.inGame = false;
    this.floorBy = null; // who talks now (from the server)
    this.talk = 'idle'; // idle | asking | talking | capped
    this.holds = new Set(); // what holds the button: 'pointer', 'key', ...
    this.pending = [];
    this.enc = null;
    this.seq = 0;
    this.first = true;
    this.acc = new Int16Array(W.FRAME_SAMPLES);
    this.accN = 0;
    this.sentSamples = 0;
    this.goAt = 0;
    this.retryTimer = null;
    this.localMutes = new Set(); // 'u:<uid>' or 'p:<peer>'
    this.hostMutes = new Set(); // host: 'u:<uid>' or 'p:<peer>'
    this.muteAll = false; // host
    this.sent = { wk: undefined, wm: undefined, mutes: undefined };
    this.micState = 'unknown'; // unknown | ready | denied | none
    this.mic = new Mic(game.audio);
    this.mic.onPcm = (pcm) => this._onPcm(pcm);
    this.player = new VoicePlayer(game.audio);
    this.stats = {
      tx: { presses: 0, grants: 0, frames: 0, bytes: 0, samples: 0, busy: 0, denied: 0, cuts: 0, caps: 0 },
      rx: { frames: 0, bytes: 0, played: 0, droppedMuted: 0, droppedUnknown: 0, droppedOff: 0, ctl: 0 },
      busyHeard: 0,
    };
    this.ui = new WalkieUI(game, this);

    game.addSystem({ name: 'walkie', update: (dt) => this.update(dt) });
    game.events.on('net:state', () => this._sync());
    game.events.on('world:unload', () => this._letGo());
    // Settings -> "Walkie-talkie (grown-ups)" (src/ui/settings.js calls game.settingsRows)
    (game.settingsRows || (game.settingsRows = [])).push((list) => this.ui.settingsRow(list));
    // hold M to talk (free in play: see src/core/game.js and src/core/input.js)
    game.input.on('key', (e) => {
      if (e.code !== 'KeyM') return;
      if (e.down) {
        if (e.repeat || game.mode !== 'play' || game.ui.dialogOpen) return;
        if (this.view().show === 'button') this.press('key');
      } else this.release('key');
    });
    game.input.on('reset', () => this._letGo());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this._letGo();
          this.player.stop();
        }
      });
    }
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this._letGo());
    this._installDebug();
  }

  // ---------- facts ----------

  /** The walkie exists only on the Railway site (WsTransport). */
  get exists() {
    return this.net.kind === 'ws';
  }

  /** This device's grown-up said yes. */
  get enabled() {
    const w = this.game.profile && this.game.profile.settings && this.game.profile.settings.walkie;
    return !!(w && w.on === true);
  }

  /** The child saw (and said OK to) the microphone card on this device. */
  get micSeen() {
    const w = this.game.profile && this.game.profile.settings && this.game.profile.settings.walkie;
    return !!(w && w.mic === true);
  }

  get live() {
    return !!this.t && LIVE.has(this.net.state);
  }

  get me() {
    return this.t ? this.t.selfId() : null;
  }

  setEnabled(on) {
    const s = this.game.profile.settings;
    s.walkie = { on: !!on, at: Date.now() };
    this.game.saveProfile();
    if (!on) {
      this._letGo();
      this.player.stop();
    }
    this._sync();
  }

  /** The players of this game (cached for a moment: the HUD asks every frame). */
  players() {
    if (!this.net.active) return [];
    const now = performance.now();
    if (!this._pl || now - this._plAt > 50) {
      this._pl = this.net.players();
      this._plAt = now;
    }
    return this._pl;
  }

  _keyOf(pl) {
    return pl.uid ? 'u:' + pl.uid : 'p:' + pl.peer;
  }

  _playerByPeer(peer) {
    return this.players().find((p) => p.peer === peer) || null;
  }

  /** The host's walkie mutes (presence wm = [all, [peers]]), as every page reads them. */
  hostWm() {
    const t = this.t;
    let st = null;
    if (t) {
      if (this.net.isHost) st = t.myState();
      else {
        const hp = this._hostPeer();
        const p = hp ? t.peers().find((x) => x.id === hp) : null;
        st = p ? p.state : null;
      }
    }
    const wm = st && st.wm;
    const all = Array.isArray(wm) && wm[0] === 1;
    const list = Array.isArray(wm) && Array.isArray(wm[1]) ? wm[1].filter((x) => typeof x === 'string') : [];
    return { all, list };
  }

  hostName() {
    const h = this.players().find((p) => p.host);
    return h ? sanitizeName(h.name || '', 'Your friend') : 'Your friend';
  }

  isHostMuted(pl) {
    if (this.net.isHost) return this.hostMutes.has(this._keyOf(pl));
    return this.hostWm().list.includes(pl.peer);
  }

  isLocalMuted(pl) {
    return this.localMutes.has(this._keyOf(pl));
  }

  _localMutedPeer(peer) {
    const pl = this._playerByPeer(peer);
    return pl ? this.isLocalMuted(pl) : false;
  }

  /** May I hear `peer` now? */
  canHear(peer) {
    if (!this.enabled || !this.live || !peer || peer === this.me) return false;
    const pl = this._playerByPeer(peer);
    if (!pl) return false;
    const wm = this.hostWm();
    if (wm.all || wm.list.includes(peer)) return false;
    return !this.isLocalMuted(pl);
  }

  /** Why I may not talk now (null = I may). */
  talkBlock() {
    if (!this.exists || !this.live) return 'none';
    if (!this.enabled) return 'off';
    const wm = this.hostWm();
    if (wm.all) return 'quiet';
    if (wm.list.includes(this.me)) return 'muted';
    return null;
  }

  // ---------- host controls ----------

  toggleHostMute(pl) {
    if (!this.net.isHost) return;
    const k = this._keyOf(pl);
    if (this.hostMutes.has(k)) this.hostMutes.delete(k);
    else this.hostMutes.add(k);
    this._pl = null;
    this._sync();
  }

  setMuteAll(on) {
    if (!this.net.isHost) return;
    this.muteAll = !!on;
    this._sync();
  }

  toggleLocalMute(pl) {
    const k = this._keyOf(pl);
    if (this.localMutes.has(k)) this.localMutes.delete(k);
    else {
      this.localMutes.add(k);
      this.player.stop(pl.peer);
    }
    this._sync();
  }

  // ---------- the link (WsTransport hooks) ----------

  _hostPeer() {
    const s = this.net.session;
    if (!this.t) return null;
    if (this.net.isHost) return this.t.selfId();
    const g = s && s.guestCore;
    return g && isPeerId(g.hostPeer) ? g.hostPeer : null;
  }

  _attach(t) {
    this.t = t;
    this.declared = null;
    this.inGame = false;
    this.floorBy = null;
    this.sent = { wk: undefined, wm: undefined, mutes: undefined };
    this._pl = null;
    t.voiceIn = (m) => this._in(m);
    t.voiceUp = () => {
      // a reconnect: the server forgot this connection's walkie; say it again
      this.declared = null;
      this.sent.mutes = undefined;
      this.floorBy = null;
      if (this.talk !== 'idle') this._finish('drop');
      this._sync();
    };
    this.mic.permission().then((p) => {
      if (p === 'granted') this.micState = 'ready';
      else if (p === 'denied') this.micState = 'denied';
    });
  }

  _detach() {
    this._letGo();
    this.player.stop();
    const t = this.t;
    if (t) {
      if (t.voiceIn) t.voiceIn = null;
      if (t.voiceUp) t.voiceUp = null;
    }
    this.t = null;
    this.declared = null;
    this.inGame = false;
    this.floorBy = null;
    this.ui.clearSpeak();
  }

  _send(obj) {
    return !!(this.t && typeof this.t.sendVoice === 'function' && this.t.sendVoice(obj));
  }

  /** Keep the link, presence and mutes in step with the session and the settings. */
  _sync() {
    const s = this.net.session;
    const t = this.exists && s && LIVE.has(s.state) && s.transport && s.transport.kind === 'ws' && typeof s.transport.sendVoice === 'function' ? s.transport : null;
    if (t !== this.t) {
      this._detach();
      if (t) this._attach(t);
    }
    if (!this.t) return;
    const hp = this._hostPeer();
    const want = this.enabled && hp && this.t.connected() ? hp : null;
    if (want !== this.declared) {
      if (want) {
        if (this._send({ t: 'v', k: 'on', h: want })) this.declared = want;
      } else {
        this._send({ t: 'v', k: 'off' });
        this.declared = null;
        this.inGame = false;
        this.floorBy = null;
      }
    }
    // presence: wk (my walkie is on), and the host's wm (mutes for everyone)
    const wkv = this.enabled ? 1 : null;
    const patch = {};
    if (wkv !== this.sent.wk) patch.wk = wkv;
    if (this.net.isHost) {
      const peers = [];
      for (const pl of this.players()) if (!pl.you && this.hostMutes.has(this._keyOf(pl))) peers.push(pl.peer);
      const wm = this.muteAll || peers.length ? [this.muteAll ? 1 : 0, peers.slice(0, 8)] : null;
      if (JSON.stringify(wm) !== JSON.stringify(this.sent.wm)) patch.wm = wm;
    }
    if (Object.keys(patch).length) {
      try {
        this.t.setState(patch);
        if ('wk' in patch) this.sent.wk = patch.wk;
        if ('wm' in patch) this.sent.wm = patch.wm;
        this.t.flushState();
      } catch (err) {
        console.warn('[walkie] presence', err);
      }
    }
    // my own mutes: the server does not even send me those voices
    if (this.declared) {
      const peers = [];
      for (const pl of this.players()) if (!pl.you && this.isLocalMuted(pl)) peers.push(pl.peer);
      const key = peers.sort().join(',');
      if (key !== this.sent.mutes && this._send({ t: 'v', k: 'mute', p: peers.slice(0, W.MAX_MUTES) })) this.sent.mutes = key;
    }
    // things that must stop right now
    if (this.talk === 'asking' || this.talk === 'talking') {
      const why = this.talkBlock();
      if (why) this._finish(why === 'off' || why === 'none' ? 'end' : why);
    }
    if (this.floorBy && this.player.playing(this.floorBy) && !this.canHear(this.floorBy)) this.player.stop(this.floorBy);
    if (!this.enabled && this.player.playing()) this.player.stop();
  }

  // ---------- press / release ----------

  press(src = 'pointer') {
    const had = this.holds.size > 0;
    this.holds.add(src);
    if (had || this.talk !== 'idle') return;
    const g = this.game;
    g.audio.unlock(); // iOS: resume the AudioContext inside the gesture
    const why = this.talkBlock();
    if (why === 'none' || why === 'off') return;
    if (why === 'quiet') return this._nudge('Walkies are resting', 'busy');
    if (why === 'muted') return this._nudge(`${this.hostName()} turned your walkie off for now`, 'busy');
    if (this.floorBy && this.floorBy !== this.me) {
      this.stats.tx.busy++;
      return this._nudge(`${this._name(this.floorBy)} is talking`, 'busy');
    }
    // the first press on this device explains the microphone (and the browser asks, if it
    // still has to); afterwards a press just talks
    if (this.micState !== 'ready' || !this.micSeen) {
      this.holds.clear();
      this._askMic();
      return;
    }
    this._begin();
  }

  release(src = 'pointer') {
    this.holds.delete(src);
    if (this.holds.size > 0) return;
    if (this.talk === 'capped') {
      this.talk = 'idle';
      return;
    }
    if (this.talk === 'asking' || this.talk === 'talking') this._finish('end');
  }

  /** Everything off now (leaving, hidden page, blur). */
  _letGo() {
    this.holds.clear();
    if (this.talk === 'asking' || this.talk === 'talking') this._finish('end');
    this.talk = 'idle';
    this.mic.stop();
  }

  _begin() {
    this.stats.tx.presses++;
    this.talk = 'asking';
    this.pending = [];
    this.enc = new AdpcmEncoder();
    this.seq = 0;
    this.first = true;
    this.accN = 0;
    this.sentSamples = 0;
    this._send({ t: 'v', k: 'req' });
    this.mic.start().then((ok) => {
      if (ok || (this.talk !== 'asking' && this.talk !== 'talking')) return;
      const err = this.mic.error;
      this._finish('mic');
      if (err === 'NotAllowedError' || err === 'SecurityError') {
        this.micState = 'denied';
        this.ui.micCard('denied').then((again) => { if (again) this._probe(); });
      } else this._nudge("The microphone didn't work", 'busy');
    });
  }

  /**
   * End this press. The microphone is stopped FIRST (every track), then the last frame goes
   * out with the end flag. why: end | cap | quiet | muted | group | cut | mic | drop
   */
  _finish(why) {
    const was = this.talk;
    this.mic.stop();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (was === 'talking') {
      const rest = this.acc.slice(0, this.accN);
      this.accN = 0;
      this._frame(rest, true);
      this.player.cue(why === 'cap' ? 'cap' : 'done');
    } else if (was === 'asking') {
      this._send({ t: 'v', k: 'end' });
    }
    this.pending = [];
    this.talk = why === 'cap' && this.holds.size > 0 ? 'capped' : 'idle';
    if (why === 'cap') {
      this.stats.tx.caps++;
      this.ui.nudge("That's 15 seconds!", 2200);
    } else if (why === 'quiet') this.ui.nudge('Walkies are resting');
    else if (why === 'muted') this.ui.nudge('Walkie resting');
  }

  _nudge(text, cue) {
    this.holds.clear();
    if (cue) this.player.cue(cue);
    this.ui.nudge(text);
  }

  async _askMic() {
    const again = await this.ui.micCard(this.micState === 'denied' ? 'denied' : 'ask');
    if (again) await this._probe();
  }

  async _probe() {
    this.game.audio.unlock();
    const r = await this.mic.probe();
    if (r === 'ok') {
      this.micState = 'ready';
      const w = this.game.profile.settings.walkie;
      if (w && w.on) {
        w.mic = true;
        this.game.saveProfile();
      }
      this.game.toast('Ready! Hold the walkie button and talk.', { icon: 'sound', color: 'mint', key: 'walkie-ready' });
    } else if (r === 'denied') {
      this.micState = 'denied';
      const again = await this.ui.micCard('denied');
      if (again) await this._probe();
    } else {
      this.micState = r === 'none' ? 'none' : 'unknown';
      // browsers only offer the microphone on https (or localhost), not on http://192.168...
      const insecure = typeof window !== 'undefined' && window.isSecureContext === false;
      const text = insecure ? "The walkie works on the game's https address." : r === 'none' ? 'No microphone found on this device.' : "The microphone didn't work. Try again!";
      this.game.toast(text, { icon: 'mute' });
    }
  }

  // ---------- audio out ----------

  _onPcm(pcm) {
    if (this.talk !== 'asking' && this.talk !== 'talking') return;
    let i = 0;
    while (i < pcm.length) {
      const n = Math.min(W.FRAME_SAMPLES - this.accN, pcm.length - i);
      this.acc.set(pcm.subarray(i, i + n), this.accN);
      this.accN += n;
      i += n;
      if (this.accN === W.FRAME_SAMPLES) {
        const block = this.acc.slice(0);
        this.accN = 0;
        this._frame(block, false);
        if (this.talk !== 'asking' && this.talk !== 'talking') return;
      }
    }
  }

  /** Encode one block into a frame and send it (or keep it until "go"). */
  _frame(block, last) {
    if (!this.enc) return;
    // 15 s of audio per press: the frame that would pass it ends the press instead
    if (!last && this.sentSamples + this._pendingSamples() + block.length > W.BURST_SAMPLES) {
      this._finish('cap');
      return;
    }
    const e = this.enc.encode(block);
    let flags = 0;
    if (this.first) flags |= F_START;
    if (last) flags |= F_END;
    this.first = false;
    const f = packFrame(flags, this.seq++ & 0xffff, e.pred, e.index, e.data);
    if (this.talk === 'talking' || (last && this.talk !== 'asking')) this._out(f, block.length);
    else {
      this.pending.push([f, block.length]);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
    }
  }

  _pendingSamples() {
    let n = 0;
    for (const p of this.pending) n += p[1];
    return n;
  }

  _out(f, samples) {
    if (!this._send(f)) return;
    this.stats.tx.frames++;
    this.stats.tx.bytes += f.length;
    this.stats.tx.samples += samples;
    this.sentSamples += samples;
  }

  // ---------- from the server ----------

  _in(m) {
    if (m instanceof ArrayBuffer || ArrayBuffer.isView(m)) return this._rx(m);
    if (!m || typeof m !== 'object') return;
    this.stats.rx.ctl++;
    switch (m.k) {
      case 'hi':
        this.inGame = m.ok === true;
        this._setFloor(isPeerId(m.talk) ? m.talk : null);
        break;
      case 'go':
        if (this.talk === 'asking') {
          this.talk = 'talking';
          this.goAt = performance.now();
          this.stats.tx.grants++;
          this.player.cue('live');
          const q = this.pending;
          this.pending = [];
          for (const [f, n] of q) this._out(f, n);
        } else if (this.talk === 'idle' || this.talk === 'capped') this._send({ t: 'v', k: 'end' });
        break;
      case 'busy':
        if (isPeerId(m.by)) this._setFloor(m.by);
        if (this.talk === 'asking') {
          this.stats.tx.busy++;
          this.mic.stop();
          this.pending = [];
          this.talk = 'idle';
          this._nudge(`${this._name(m.by)} is talking`, 'busy');
        }
        break;
      case 'no':
        if (this.talk !== 'asking') break;
        if (m.why === 'wait' && this.holds.size) {
          // pressed again right after letting go: ask once more in a moment (mic keeps going)
          if (!this.retryTimer) this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.talk === 'asking') this._send({ t: 'v', k: 'req' });
          }, W.COOLDOWN_MS);
          break;
        }
        this.stats.tx.denied++;
        this._finish(m.why === 'quiet' || m.why === 'muted' ? m.why : 'end');
        break;
      case 'talk':
        this._setFloor(isPeerId(m.by) ? m.by : null);
        break;
      case 'cut':
        if (this.talk === 'asking' || this.talk === 'talking') {
          this.stats.tx.cuts++;
          this._finish(m.why === 'cap' ? 'cap' : m.why === 'quiet' || m.why === 'muted' ? m.why : 'cut');
        }
        break;
      default:
    }
  }

  _setFloor(by) {
    const prev = this.floorBy;
    if (prev === by) return;
    this.floorBy = by;
    if (prev && prev !== this.me) this.player.end(prev);
    if (by && by !== this.me) this.stats.busyHeard++;
  }

  _rx(buf) {
    const len = buf.byteLength;
    this.stats.rx.frames++;
    this.stats.rx.bytes += len;
    const who = this.floorBy;
    if (!this.enabled) {
      this.stats.rx.droppedOff++;
      return;
    }
    if (!who || who === this.me) {
      this.stats.rx.droppedUnknown++;
      return;
    }
    if (!this.canHear(who)) {
      this.stats.rx.droppedMuted++;
      return;
    }
    if (this.player.frame(who, buf)) this.stats.rx.played++;
  }

  // ---------- what the UI shows ----------

  _name(peer) {
    const pl = this._playerByPeer(peer);
    return pl ? sanitizeName(pl.name || '', 'A friend') : 'A friend';
  }

  /** { show: 'button'|'badge'|null, state, who, left, speaking } */
  view() {
    const g = this.game;
    const inWorld = g.mode === 'play' && !!g.world && !g.loading;
    if (!this.exists || !this.live || !inWorld) return { show: null, state: 'idle', speaking: [] };
    if (!this.enabled) {
      const others = this.players().some((p) => !p.you && p.state && p.state.wk === 1);
      return { show: others ? 'badge' : null, state: 'off', speaking: [] };
    }
    const talker = this.floorBy && this.floorBy !== this.me && this.canHear(this.floorBy) ? this.floorBy : null;
    const speaking = talker ? [talker] : [];
    let state = 'idle';
    let who = null;
    let left = W.BURST_MS / 1000;
    const block = this.talkBlock();
    if (this.talk === 'talking') {
      state = 'talking';
      left = Math.max(0, W.BURST_MS - (performance.now() - this.goAt)) / 1000;
      left = Math.min(left, Math.max(0, W.BURST_SAMPLES - this.sentSamples) / W.RATE);
    } else if (this.talk === 'asking') state = 'asking';
    else if (this.talk === 'capped') state = 'capped';
    else if (block === 'quiet') state = 'quiet';
    else if (block === 'muted') state = 'muted';
    else if (talker) state = 'busy';
    else if (this.micState === 'denied') state = 'nomic';
    if (talker) {
      const pl = this._playerByPeer(talker);
      who = { peer: talker, name: this._name(talker), color: seatColor(pl ? pl.seat : 0) };
    }
    return { show: 'button', state, who, left, speaking };
  }

  // ---------- per frame ----------

  update() {
    const now = performance.now();
    if ((this.exists || this.t) && now - (this._syncAt || 0) >= 100) {
      this._syncAt = now;
      this._sync();
    }
    if (this.talk === 'talking' && performance.now() - this.goAt >= W.BURST_MS) this._finish('cap');
    this.ui.update();
  }

  // ---------- panels (src/net/ui.js calls these) ----------

  decorateRow(row, pl, isHostView) {
    this.ui.decorateRow(row, pl, isHostView);
  }

  decoratePanel(col, isHost) {
    this.ui.decoratePanel(col, isHost);
  }

  /** Part of the Players panel's refresh key: what the walkie controls show. */
  panelKey() {
    if (!this.exists) return '';
    const wm = this.hostWm();
    return JSON.stringify([
      this.enabled, this.floorBy, this.muteAll, [...this.hostMutes], [...this.localMutes], wm.all, wm.list,
      this.players().map((p) => (p.state && p.state.wk === 1 ? 1 : 0)),
    ]);
  }

  // ---------- tests ----------

  _installDebug() {
    const g = this.game;
    if (!g.debug) return;
    g.debug.walkie = {
      state: () => ({
        exists: this.exists, enabled: this.enabled, live: this.live, declared: this.declared, inGame: this.inGame,
        talk: this.talk, floorBy: this.floorBy, me: this.me, micState: this.micState, micSeen: this.micSeen, micLive: this.mic.live,
        micTracks: this.mic.trackStates(), wm: this.hostWm(), view: this.view(), localMutes: [...this.localMutes],
        hostMutes: [...this.hostMutes], muteAll: this.muteAll,
      }),
      stats: () => ({ ...this.stats, tx: { ...this.stats.tx }, rx: { ...this.stats.rx }, player: { ...this.player.stats }, mic: { ...this.mic.stats } }),
      press: (src = 'debug') => this.press(src),
      release: (src = 'debug') => this.release(src),
      setEnabled: (on) => this.setEnabled(on),
    };
  }
}
