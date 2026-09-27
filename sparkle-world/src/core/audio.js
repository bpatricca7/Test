// Synthesized sound effects and a gentle generative music-box loop (WebAudio, no files).
// The AudioContext is created on the first user gesture (unlock()), as browsers require.
// Every one-shot voice is disconnected, with the nodes that only served it, when it ends
// (track()), so nothing piles up in the audio graph over a long session (older iPads). A
// context that iOS left 'suspended' or 'interrupted' (a call, Siri, an alarm) is resumed on
// the next tap.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic steps
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const ARP8 = [0, 1, 2, 1, 3, 2, 1, 2]; // arpeggio patterns: chord tone index (3 = root up an octave)
const ARP3 = [0, 1, 2, 3, 2, 1];
const MOOD_GAIN = 1.35; // level of the playing mood's bus (the others fade to silence)
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.musicOn = false;
    this.night = false;
    this._noise = null;
    this._musicTimer = null;
    this._nextNoteTime = 0;
    this._step = 0;
    this._song = null;
    this._playing = null;
    this.forcedMood = null;
    this.muted = false;
    this._hiddenPause = false; // suspend(true) while the tab is hidden
    this._lastPlay = new Map();
    this._stats = { started: 0, ended: 0 };
  }

  /** Create/resume the context. Safe to call on every gesture. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.ratio.value = 4;
        comp.connect(this.ctx.destination);
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(comp);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.connect(this.master);
        this._applyVolumes();
        if (this.muted) this.master.gain.value = 0;
        if (this.musicOn) this._startMusic();
      }
      // 'suspended' (autoplay rules) or 'interrupted' (iOS: a call, Siri, an alarm): every
      // gesture retries, since iOS ignores a resume() that does not come from one. A context we
      // paused ourselves for a hidden tab waits for the tab to come back.
      const st = this.ctx.state;
      if (st !== 'running' && st !== 'closed' && !this._hiddenPause) this.ctx.resume().catch(() => {});
    } catch (err) {
      console.warn('[audio] unavailable', err);
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * A one-shot source: when it ends, disconnect it and the nodes that only served it (gains,
   * filters). Modules that make their own sources on this context should use it too.
   */
  track(src, ...nodes) {
    this._stats.started++;
    src.onended = () => {
      this._stats.ended++;
      src.onended = null;
      try { src.disconnect(); } catch { /* already */ }
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already */ }
      }
    };
    return src;
  }

  /** Numbers for diagnostics and tests. */
  stats() {
    return { state: this.ctx ? this.ctx.state : 'none', live: this._stats.started - this._stats.ended, ...this._stats };
  }

  setVolumes({ music, sfx } = {}) {
    if (typeof music === 'number') this.musicVolume = music;
    if (typeof sfx === 'number') this.sfxVolume = sfx;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxVolume * 0.6, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.28, t, 0.3);
  }

  /** Pause/resume all sound (e.g. hidden tab). A resume iOS refuses is retried on the next tap. */
  suspend(on) {
    this._hiddenPause = !!on;
    if (!this.ctx || this.ctx.state === 'closed') return;
    if (on) this.ctx.suspend().catch(() => {});
    else this.ctx.resume().catch(() => {});
  }

  // ---------- building blocks ----------

  _noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  _env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** One oscillator note with an envelope; f1 makes it glide. */
  _tone({ f0, f1 = null, type = 'sine', t = 0, attack = 0.005, decay = 0.2, vol = 0.5, out = null }) {
    const ctx = this.ctx;
    const when = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    if (f1) osc.frequency.exponentialRampToValueAtTime(f1, when + attack + decay);
    this._env(g, when, attack, vol, decay);
    osc.connect(g).connect(out || this.sfxGain);
    this.track(osc, g);
    osc.start(when);
    osc.stop(when + attack + decay + 0.05);
    return osc;
  }

  _noiseHit({ t = 0, decay = 0.1, vol = 0.3, filter = 'lowpass', freq = 1200, freq1 = null, q = 0.7 }) {
    const ctx = this.ctx;
    const when = ctx.currentTime + t;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, when);
    if (freq1) f.frequency.exponentialRampToValueAtTime(freq1, when + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, when, 0.004, vol, decay);
    src.connect(f).connect(g).connect(this.sfxGain);
    this.track(src, f, g);
    src.start(when, Math.random() * 0.5);
    src.stop(when + decay + 0.05);
  }

  _bell(midi, t, vol, decay = 1.1, out = null) {
    const f = midiToHz(midi);
    this._tone({ f0: f, t, attack: 0.004, decay, vol, out });
    this._tone({ f0: f * 2.01, t, attack: 0.002, decay: decay * 0.5, vol: vol * 0.3, out });
    this._tone({ f0: f * 3.98, t, attack: 0.002, decay: decay * 0.25, vol: vol * 0.12, out });
  }

  // ---------- public ----------

  /**
   * Play a named effect: pop place remove click sparkle chime whoosh splash jump step eat pet
   * bark meow neigh magic success page camera, or 'note:<midi>'.
   */
  play(name, { volume = 1, pitch = 1 } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // avoid machine-gun repeats of the same sound in one frame
    const now = performance.now();
    const last = this._lastPlay.get(name) || 0;
    if (now - last < 30) return;
    this._lastPlay.set(name, now);
    const v = volume;
    const p = pitch;
    try {
      if (name.startsWith('note:')) {
        this._bell(Number(name.slice(5)) || 60, 0, 0.5 * v, 1.4);
        return;
      }
      switch (name) {
        case 'pop':
          this._tone({ f0: 420 * p, f1: 980 * p, decay: 0.09, vol: 0.45 * v });
          break;
        case 'place':
          this._tone({ f0: 260 * p, f1: 150 * p, type: 'triangle', decay: 0.1, vol: 0.55 * v });
          this._noiseHit({ decay: 0.05, vol: 0.18 * v, freq: 1800 * p });
          this._tone({ f0: 1560 * p, t: 0.02, decay: 0.12, vol: 0.08 * v });
          break;
        case 'remove':
          this._tone({ f0: 900 * p, f1: 320 * p, decay: 0.16, vol: 0.32 * v });
          this._noiseHit({ decay: 0.14, vol: 0.12 * v, filter: 'highpass', freq: 3000 });
          break;
        case 'click':
          this._tone({ f0: 1250 * p, decay: 0.035, vol: 0.25 * v });
          break;
        case 'sparkle':
          for (let i = 0; i < 4; i++) {
            const m = 84 + PENTA[Math.floor(Math.random() * 5)] + (i % 2) * 12;
            this._tone({ f0: midiToHz(m) * p, t: i * 0.045, decay: 0.18, vol: 0.12 * v });
          }
          break;
        case 'chime':
          this._bell(88, 0, 0.25 * v, 0.9);
          this._bell(95, 0.07, 0.18 * v, 0.9);
          break;
        case 'whoosh':
          this._noiseHit({ decay: 0.35, vol: 0.3 * v, filter: 'bandpass', freq: 400, freq1: 2400, q: 1.2 });
          break;
        case 'splash':
          this._noiseHit({ decay: 0.4, vol: 0.4 * v, freq: 2200, freq1: 400 });
          for (let i = 0; i < 3; i++) this._tone({ f0: 500 + Math.random() * 500, f1: 900 + Math.random() * 600, t: 0.05 + i * 0.07, decay: 0.06, vol: 0.12 * v });
          break;
        case 'jump':
          this._tone({ f0: 300 * p, f1: 620 * p, type: 'triangle', decay: 0.13, vol: 0.3 * v });
          break;
        case 'step':
          this._noiseHit({ decay: 0.045, vol: 0.08 * v, freq: 700 * p });
          break;
        case 'eat':
          for (let i = 0; i < 3; i++) this._noiseHit({ t: i * 0.12, decay: 0.07, vol: 0.3 * v, filter: 'bandpass', freq: 1500 + Math.random() * 800, q: 1.5 });
          break;
        case 'pet':
          this._tone({ f0: 520 * p, f1: 700 * p, decay: 0.18, vol: 0.2 * v });
          this._tone({ f0: 700 * p, f1: 880 * p, t: 0.16, decay: 0.22, vol: 0.2 * v });
          break;
        case 'bark':
          for (let i = 0; i < 2; i++) {
            this._tone({ f0: 480 * p, f1: 260 * p, type: 'square', t: i * 0.2, attack: 0.01, decay: 0.09, vol: 0.12 * v });
            this._noiseHit({ t: i * 0.2, decay: 0.08, vol: 0.12 * v, filter: 'bandpass', freq: 900, q: 2 });
          }
          break;
        case 'meow':
          this._tone({ f0: 650 * p, f1: 1000 * p, type: 'triangle', attack: 0.05, decay: 0.2, vol: 0.2 * v });
          this._tone({ f0: 1000 * p, f1: 560 * p, type: 'triangle', t: 0.22, decay: 0.25, vol: 0.18 * v });
          break;
        case 'neigh':
          for (let i = 0; i < 5; i++) this._tone({ f0: (900 - i * 70) * p, f1: (800 - i * 70) * p, type: 'sawtooth', t: i * 0.08, decay: 0.07, vol: 0.06 * v });
          break;
        case 'magic':
          for (let i = 0; i < 7; i++) {
            const m = 72 + PENTA[i % 5] + Math.floor(i / 5) * 12;
            this._bell(m + 12, i * 0.06, 0.13 * v, 0.6);
          }
          this._noiseHit({ decay: 0.6, vol: 0.06 * v, filter: 'highpass', freq: 5000 });
          break;
        case 'success':
          [72, 76, 79, 84].forEach((m, i) => this._bell(m, i * 0.1, 0.22 * v, 0.9));
          break;
        case 'page':
          this._noiseHit({ decay: 0.16, vol: 0.18 * v, filter: 'highpass', freq: 2500, freq1: 6000 });
          break;
        case 'camera':
          this._noiseHit({ decay: 0.03, vol: 0.4 * v, filter: 'highpass', freq: 3000 });
          this._noiseHit({ t: 0.09, decay: 0.05, vol: 0.3 * v, filter: 'bandpass', freq: 1800 });
          break;
        default:
          this._tone({ f0: 660 * p, decay: 0.08, vol: 0.2 * v });
      }
    } catch (err) {
      console.warn('[audio] play failed', name, err);
    }
  }

  // ---------- music ----------
  //
  // A generative music box in moods that crossfade smoothly:
  //   day          bright 4/4 music box: bass + arpeggio + a melody built from repeating phrases
  //   night        slow 3/4 lullaby: soft pad chords, a sparse lower melody
  //   menu / cozy  warm and gentle (title screen, indoors): pad + slow arpeggio + melody
  // Each mood plays into its own gain node, so a change fades one out while the next fades in.
  // setNight(bool) picks day/night by the clock; setMood('menu'|'cozy'|null) overrides it.

  /** Turn the music-box loop on/off. */
  music(on) {
    this.musicOn = !!on;
    if (!this.ctx) return;
    if (this.musicOn) this._startMusic();
    else this._stopMusic();
  }

  /** Night theme: slower, lower, softer (daynight calls this every frame; it is cheap). */
  setNight(night) {
    this.night = !!night;
  }

  /** Force a mood: 'menu' (title), 'cozy' (indoors) or null (day / night by the clock). */
  setMood(mood) {
    this.forcedMood = mood || null;
  }

  /** The mood the music plays (or would play). */
  get mood() {
    return this.forcedMood || (this.night ? 'night' : 'day');
  }

  /** Silence everything (music and effects) without touching the volume settings. */
  setMuted(on) {
    this.muted = !!on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.08);
  }

  _musicBus() {
    if (this._musicBusReady) return;
    const ctx = this.ctx;
    this._musicBusReady = true;
    this._moodGains = new Map();
    // a soft echo-hall makes the music box dreamy: two feedback delays through a lowpass
    // (much cheaper than a convolution reverb, which matters on older tablets)
    try {
      const input = ctx.createGain();
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2600;
      input.connect(tone);
      const wet = ctx.createGain();
      wet.gain.value = 0.34;
      for (const [time, fb] of [[0.137, 0.42], [0.229, 0.36]]) {
        const d = ctx.createDelay(1);
        d.delayTime.value = time;
        const g = ctx.createGain();
        g.gain.value = fb;
        tone.connect(d);
        d.connect(g).connect(d);
        d.connect(wet);
      }
      wet.connect(this.musicGain);
      this._verb = input;
    } catch {
      this._verb = null;
    }
  }

  _moodOut(mood) {
    let g = this._moodGains.get(mood);
    if (!g) {
      g = this.ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(this.musicGain);
      if (this._verb) g.connect(this._verb);
      this._moodGains.set(mood, g);
    }
    return g;
  }

  _startMusic() {
    if (this._musicTimer || !this.ctx) return;
    this._musicBus();
    this._nextNoteTime = this.ctx.currentTime + 0.25;
    this._playing = null; // start fresh in the current mood
    this._musicTimer = setInterval(() => this._scheduleMusic(), 90);
  }

  _stopMusic() {
    if (this._musicTimer) clearInterval(this._musicTimer);
    this._musicTimer = null;
    if (this.ctx && this._moodGains) {
      const t = this.ctx.currentTime;
      for (const g of this._moodGains.values()) {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.3);
      }
    }
    this._playing = null;
  }

  /** Switch to a mood: fade its bus in and the others out, and start a new tune. */
  _enterMood(mood) {
    const t = this.ctx.currentTime;
    this._moodOut(mood);
    for (const [m, g] of this._moodGains) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(m === mood ? MOOD_GAIN : 0.0001, t, m === mood ? 0.9 : 0.6);
    }
    this._playing = mood;
    this._step = 0;
    this._song = this._newSong(mood);
    this._nextNoteTime = Math.max(this._nextNoteTime, t + 0.12);
  }

  /** A little song: key, chord progression (scale degrees) and two melody phrases A and B. */
  _newSong(mood, keepKey = null) {
    const r = Math.random;
    const cfgs = {
      day: { beat: 0.3, perBar: 8, keys: [60, 62, 65, 67], progs: [[0, 5, 3, 4], [0, 3, 4, 3], [0, 5, 1, 4], [3, 4, 0, 0]], shift: 0, density: [0.9, 0.55, 0.25], pad: 0, arp: 0.075, bass: 0.2, bell: 0.15, ring: 1.3 },
      night: { beat: 0.46, perBar: 6, keys: [55, 57, 53], progs: [[0, 3, 0, 4], [0, 5, 3, 4], [0, 3, 5, 4]], shift: -5, density: [0.7, 0.3, 0.08], pad: 0.05, arp: 0.045, bass: 0.14, bell: 0.12, ring: 1.8 },
      menu: { beat: 0.36, perBar: 8, keys: [65, 60, 62], progs: [[0, 2, 3, 4], [0, 5, 3, 4], [3, 4, 2, 5]], shift: 0, density: [0.8, 0.4, 0.12], pad: 0.045, arp: 0.06, bass: 0.16, bell: 0.14, ring: 1.5 },
      cozy: { beat: 0.4, perBar: 8, keys: [65, 67, 62], progs: [[0, 3, 0, 4], [0, 5, 3, 4]], shift: 0, density: [0.7, 0.35, 0.1], pad: 0.045, arp: 0.05, bass: 0.15, bell: 0.13, ring: 1.5 },
    };
    const c = cfgs[mood] || cfgs.day;
    const key = keepKey ?? c.keys[Math.floor(r() * c.keys.length)] - 12;
    const prog = c.progs[Math.floor(r() * c.progs.length)];
    const scaleMidi = (deg) => key + 12 * Math.floor(deg / 7) + MAJOR[((deg % 7) + 7) % 7];
    const chordDegs = (root) => [root, root + 2, root + 4];
    const beatEvery = c.perBar === 6 ? 3 : 4;
    const phrase = (barRoots) => {
      const notes = [];
      let deg = 9;
      for (let s = 0; s < c.perBar * 2; s++) {
        const strong = s % beatEvery === 0;
        const p = strong ? c.density[0] : s % 2 === 0 ? c.density[1] : c.density[2];
        if (r() > p) continue;
        const root = barRoots[Math.floor(s / c.perBar) % barRoots.length];
        if (strong) {
          // strong beats land on the nearest chord tone
          let best = deg, bestD = 99;
          for (const d0 of chordDegs(root)) for (const d of [d0 + 7, d0 + 14]) if (Math.abs(d - deg) < bestD) { bestD = Math.abs(d - deg); best = d; }
          deg = best;
        } else {
          deg += [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)];
        }
        deg = Math.max(5, Math.min(15, deg));
        notes.push([s, deg]);
      }
      if (!notes.length) notes.push([0, 7]);
      return notes;
    };
    return { ...c, key, prog, scaleMidi, chordDegs, A: phrase([prog[0], prog[1]]), B: phrase([prog[2], prog[3]]) };
  }

  /** Soft sustained chord voice (two detuned oscillators through a lowpass). */
  _pad(midi, t, dur, vol, out) {
    const ctx = this.ctx;
    const when = ctx.currentTime + t;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o1.type = 'triangle';
    o2.type = 'sine';
    const hz = midiToHz(midi);
    o1.frequency.value = hz;
    o2.frequency.value = hz * 1.004;
    f.type = 'lowpass';
    f.frequency.value = 1300;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + Math.min(0.6, dur * 0.3));
    g.gain.setTargetAtTime(0.0001, when + dur * 0.7, dur * 0.25);
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(out);
    // both stop together: the first one's end also lets go of the shared filter and gain
    this.track(o1, f, g);
    this.track(o2);
    o1.start(when);
    o2.start(when);
    o1.stop(when + dur + 0.8);
    o2.stop(when + dur + 0.8);
  }

  _scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // after a pause (hidden tab, a busy moment) pick up from now instead of rushing to catch up
    if (this._nextNoteTime < ctx.currentTime - 0.3) this._nextNoteTime = ctx.currentTime + 0.1;
    const mood = this.mood;
    if (mood !== this._playing) this._enterMood(mood);
    const out = this._moodOut(mood);
    while (this._nextNoteTime < ctx.currentTime + 0.35) {
      const song = this._song;
      const t = Math.max(0, this._nextNoteTime - ctx.currentTime);
      const step = this._step++;
      const inBar = step % song.perBar;
      const bar = Math.floor(step / song.perBar);
      const root = song.prog[bar % 4];
      const c0 = song.scaleMidi(root), c1 = song.scaleMidi(root + 2), c2 = song.scaleMidi(root + 4);
      const barLen = song.beat * song.perBar;
      // pad chord and bass on the downbeat
      if (inBar === 0) {
        if (song.pad > 0) { this._pad(c0, t, barLen, song.pad, out); this._pad(c1, t, barLen, song.pad, out); this._pad(c2, t, barLen, song.pad * 0.8, out); }
        this._bell(c0 - 12, t, song.bass, 2.2, out);
      } else if (song.perBar === 8 && inBar === 4 && mood !== 'night') {
        this._bell(c2 - 12, t, song.bass * 0.6, 1.6, out);
      }
      // arpeggio
      if (mood !== 'night' || inBar % 2 === 0) {
        const k = (song.perBar === 6 ? ARP3 : ARP8)[inBar];
        const m = k === 0 ? c0 : k === 1 ? c1 : k === 2 ? c2 : c0 + 12;
        this._bell(m, t, song.arp * (inBar === 0 ? 1.2 : 1), 0.9, out);
      }
      // melody: phrases A A B A (the last A ends on the home note)
      const section = Math.floor(bar / 2) % 4;
      const phrase = section === 2 ? song.B : song.A;
      const s2 = step % (song.perBar * 2);
      for (let i = 0; i < phrase.length; i++) {
        if (phrase[i][0] !== s2) continue;
        const home = section === 3 && i === phrase.length - 1;
        this._bell(song.scaleMidi(home ? 14 : phrase[i][1]) + song.shift, t, song.bell, song.ring, out);
      }
      // a twinkle now and then
      if (inBar === song.perBar - 1 && bar % 4 === 3 && mood !== 'night') {
        this._bell(c2 + 24, t + song.beat * 0.5, 0.05, 0.6, out);
        this._bell(c0 + 36, t + song.beat * 0.75, 0.04, 0.5, out);
      }
      // gentle swing on the day tune
      this._nextNoteTime += song.beat * (mood === 'day' ? (inBar % 2 === 0 ? 1.06 : 0.94) : 1);
      if (bar === 7 && inBar === song.perBar - 1) {
        // after 8 bars a new tune in the same key, so it flows on
        this._song = this._newSong(mood, song.key);
        this._step = 0;
      }
    }
  }
}
