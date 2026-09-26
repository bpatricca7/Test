// Sound: pure Web Audio synthesis (no audio files) + speech synthesis for voice callouts.
// Owned by the IO agent.
//
// Contract: createAudio(game) -> { update(frame), resume() }
//
// What you hear
//   engines   DPS deep roar, APS sharper buzz, SPS heavy rumble — level/brightness follow the actual
//             thrust, with an ignition bang and a shutdown thud (voices.js)
//   RCS       every jet lighting up gives a thump, jets on a quad hiss while firing; in the cockpit
//             each quad is panned by where it is relative to your head
//   cabin     ECS fans, suit-loop air, glycol pump whine (LM louder than the CM)
//   headset   comm-loop hiss, master alarm tone (while vessel.cw.masterAlarm), Quindar tones
//             (2525 Hz intro / 2475 Hz outro, 250 ms) around CAPCOM transmissions
//   events    switch / DSKY clicks on crew actions, touchdown thud and footpad crunch, staging pyros,
//             docking-latch clank, crash, regolith hiss under the descent engine near the ground
//   voices    crew / Mission Control callouts spoken with speechSynthesis (settings.callouts)
// Sound in the cockpit is structure-borne and full-range. In exterior views everything the vessel
// makes goes through a steep low-pass at low level (there is no air to carry it) and fades with the
// camera distance; the headset (alarm, radio) stays audible.
//
// Settings: settings.audio (on/off; the MUTE action toggles it), settings.volume, settings.callouts.
// The AudioContext is created on the first user gesture (or resume()); if Web Audio or speech are
// unavailable everything silently no-ops — nothing here may throw into the main loop.

import { createNoiseBuffers, gainNode, biquad, glide, thump, noiseBurst, clank, tone, crunch } from './synth.js';
import { createEngineVoice, createQuadVoice, createAmbience, createRadioHiss, createAlarm, createDust } from './voices.js';
import { createSpeech, speechDuration, SPEAKERS } from './speech.js';
import * as THREE from 'three';

const TOGGLE_ACTIONS = new Set(['RCS_MODE_CYCLE', 'ATT_HOLD_TOGGLE', 'AUTO_TOGGLE', 'KILL_ROT', 'AUTOPILOT', 'UNDOCK', 'ROD_UP', 'ROD_DOWN']);
const PUSH_ACTIONS = new Set(['MASTER_ALARM_RESET', 'ENGINE_STOP', 'STAGE']);
const DSKY_ACTIONS = new Set(['PRO', 'PROGRAM']);
const DETENT_ACTIONS = new Set(['LPD']);

const QUINDAR_IN = 2525;
const QUINDAR_OUT = 2475;
const QUINDAR_DUR = 0.25;

/** User activation state (Chrome/Firefox/Safari 16+); unknown -> assume yes. */
function hasUserActivation() {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
    return ua ? !!ua.hasBeenActive : true;
  } catch {
    return true;
  }
}

export function createAudio(game) {
  let ac = null;
  let G = null; // graph
  let failed = false;
  const speech = createSpeech(game);
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  let mutedAt = -1;

  // ------------------------------------------------------------------ graph
  function build() {
    const noise = createNoiseBuffers(ac);
    const master = gainNode(ac, 0);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    master.connect(comp).connect(ac.destination);
    // structure-borne vessel sounds -> "medium" filter (cockpit: full range; exterior: muffled)
    const struct = gainNode(ac, 1);
    const medium = biquad(ac, 'lowpass', 16000, 0.5);
    const mediumG = gainNode(ac, 1);
    struct.connect(medium).connect(mediumG).connect(master);
    const cabin = gainNode(ac, 1);
    cabin.connect(master);
    const radio = gainNode(ac, 1);
    radio.connect(master);
    const engines = { DPS: createEngineVoice(ac, noise, struct, 'DPS'), APS: createEngineVoice(ac, noise, struct, 'APS'), SPS: createEngineVoice(ac, noise, struct, 'SPS') };
    const quads = { LM: [0, 1, 2, 3].map(() => createQuadVoice(ac, noise, struct)), CSM: [0, 1, 2, 3].map(() => createQuadVoice(ac, noise, struct)) };
    return {
      noise,
      master,
      struct,
      medium,
      mediumG,
      cabin,
      radio,
      engines,
      quads,
      ambience: createAmbience(ac, noise, cabin),
      hiss: createRadioHiss(ac, noise, radio),
      alarm: createAlarm(ac, radio),
      dust: createDust(ac, noise, struct),
      prevLevels: new Map(), // vessel -> Float32Array jet levels
      lastThump: new Map(), // key -> time
      squelchUntil: 0,
    };
  }

  function ensure(force = false) {
    if (ac || failed) return ac;
    if (!game.settings.audio) return null;
    if (!force && !hasUserActivation()) return null;
    try {
      const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
      if (!AC) {
        failed = true;
        return null;
      }
      ac = new AC({ latencyHint: 'interactive' });
      G = build();
    } catch (e) {
      console.warn('Audio unavailable:', e?.message || e);
      ac = null;
      G = null;
      failed = true;
    }
    return ac;
  }

  function resume(force = false) {
    try {
      if (!ensure(force)) return;
      if (ac.state === 'suspended' && game.settings.audio) {
        const p = ac.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  // first user gesture unlocks audio (browsers' autoplay policy)
  if (typeof window !== 'undefined') {
    const unlock = () => resume(true);
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  const live = () => !!(ac && G && game.settings.audio && ac.state !== 'closed');

  // ------------------------------------------------------------------ listening position
  /** Vessels whose sounds reach the listener, with an audibility factor. */
  function listeners() {
    const view = game.view;
    const out = [];
    const iva = view.mode === 'iva' && view.ivaVessel ? game.vessels[view.ivaVessel] : null;
    if (iva) {
      out.push({ v: iva, k: 1 });
      if (iva.docked && game.vessels[iva.dockedTo]) out.push({ v: game.vessels[iva.dockedTo], k: 0.75 });
      return out;
    }
    // exterior: fades with the camera distance (a cinematic nod — space is silent)
    for (const v of Object.values(game.vessels)) {
      const isActive = v === game.active || (game.active.docked && v.id === game.active.dockedTo);
      const d = v.pos.distanceTo(view.cameraMCI);
      let k = 1 / Math.sqrt(1 + (d / 60) ** 2);
      if (!isActive) k *= 0.7;
      if (k > 0.01) out.push({ v, k });
    }
    return out;
  }

  function inListeners(list, id) {
    const e = list.find((l) => l.v.id === id);
    return e ? e.k : 0;
  }

  /** Stereo pan (-1..1) of a body-frame point of vessel v relative to the camera. */
  function panOf(v, pBody) {
    _v.copy(pBody).applyQuaternion(v.quat).add(v.pos).sub(game.view.cameraMCI);
    _q.copy(game.view.quat).invert();
    _v.applyQuaternion(_q);
    const d = _v.length();
    return d > 1e-3 ? Math.max(-1, Math.min(1, (_v.x / (d + 0.4)) * 1.3)) : 0;
  }

  const quadCentres = new Map(); // vessel type -> [Vector3 x4]
  function quadIndex(v, j) {
    return v.type === 'LM' ? (j.quad | 0) - 1 : ['A', 'B', 'C', 'D'].indexOf(j.quad);
  }
  function centresOf(v) {
    let c = quadCentres.get(v.type);
    if (c) return c;
    c = [0, 1, 2, 3].map(() => new THREE.Vector3());
    const n = [0, 0, 0, 0];
    for (const j of v.rcs.jets) {
      const i = quadIndex(v, j);
      if (i < 0 || i > 3) continue;
      c[i].add(j.pos);
      n[i]++;
    }
    c.forEach((p, i) => n[i] && p.multiplyScalar(1 / n[i]));
    quadCentres.set(v.type, c);
    return c;
  }

  // ------------------------------------------------------------------ one-shot effects
  function click(kind) {
    if (!live()) return;
    const t = ac.currentTime + 0.005;
    const dest = G.struct;
    const w = G.noise.white;
    if (kind === 'toggle') {
      // toggle switch: a crisp snap and the lever hitting its stop
      noiseBurst(ac, dest, w, { t, type: 'highpass', freq: 2500, Q: 0.7, dur: 0.006, level: 0.22 });
      tone(ac, dest, { t, freq: 3300, dur: 0.02, level: 0.03, type: 'triangle' });
      noiseBurst(ac, dest, w, { t: t + 0.014, type: 'bandpass', freq: 1800, Q: 1.2, dur: 0.01, level: 0.1 });
    } else if (kind === 'push') {
      // pushbutton (master alarm light, engine stop): a softer, deeper click
      noiseBurst(ac, dest, w, { t, type: 'bandpass', freq: 1400, Q: 1, dur: 0.012, level: 0.18 });
      thump(ac, dest, { t, f0: 240, f1: 140, dur: 0.035, level: 0.1 });
    } else if (kind === 'dsky') {
      // DSKY key: short tactile click
      noiseBurst(ac, dest, w, { t, type: 'bandpass', freq: 2600, Q: 1.4, dur: 0.008, level: 0.16 });
      tone(ac, dest, { t, freq: 2200, dur: 0.015, level: 0.02, type: 'sine' });
    } else if (kind === 'detent') {
      noiseBurst(ac, dest, w, { t, type: 'bandpass', freq: 1100, Q: 1.5, dur: 0.01, level: 0.12 });
    }
  }

  function engineTransient(e, k) {
    if (!live() || k <= 0) return;
    const t = ac.currentTime + 0.01;
    const S = { DPS: 0.7, APS: 0.9, SPS: 1.1 }[e.engine] || 0.8;
    if (e.on) {
      // ignition: propellant valves bang open, chamber pressure builds
      clank(ac, G.struct, { t, partials: [180, 410, 820], decay: 0.25, level: 0.08 * k });
      thump(ac, G.struct, { t: t + 0.03, f0: 75, f1: 28, dur: 0.6, level: 0.6 * S * k });
      noiseBurst(ac, G.struct, G.noise.brown, { t: t + 0.03, type: 'lowpass', freq: 500, Q: 0.7, attack: 0.02, dur: 0.45, level: 0.5 * S * k });
    } else {
      // shutdown: thrust decay thud and the propellant purge hiss
      thump(ac, G.struct, { t, f0: 60, f1: 30, dur: 0.35, level: 0.35 * S * k });
      noiseBurst(ac, G.struct, G.noise.white, { t: t + 0.05, type: 'bandpass', freq: 3200, Q: 0.6, attack: 0.02, dur: 0.6, level: 0.05 * k });
    }
  }

  function touchdown(e, k) {
    if (!live() || k <= 0) return;
    const t = ac.currentTime + 0.01;
    const s = Math.min(1.5, 0.35 + Math.abs(e?.vSpeed || 0) / 2.2);
    thump(ac, G.struct, { t, f0: 55, f1: 24, dur: 0.6, level: 0.8 * s * k });
    crunch(ac, G.struct, G.noise.white, { t: t + 0.01, dur: 0.45, grains: 22, level: 0.3 * s * k, freq: 900 });
    clank(ac, G.struct, { t: t + 0.02, partials: [610, 1130, 1790], decay: 0.4, level: 0.05 * s * k });
  }

  function crashSound(k) {
    if (!live() || k <= 0) return;
    const t = ac.currentTime + 0.01;
    thump(ac, G.struct, { t, f0: 60, f1: 18, dur: 1.2, level: 1.2 * k });
    noiseBurst(ac, G.struct, G.noise.brown, { t, type: 'lowpass', freq: 1400, Q: 0.5, attack: 0.005, dur: 1.6, level: 0.9 * k });
    crunch(ac, G.struct, G.noise.white, { t, dur: 1.2, grains: 40, level: 0.5 * k, freq: 700 });
    clank(ac, G.struct, { t: t + 0.05, partials: [220, 530, 970, 1650, 2400], decay: 1.2, level: 0.12 * k });
  }

  function pyro(k) {
    if (!live() || k <= 0) return;
    const t = ac.currentTime + 0.01;
    // explosive nuts and the umbilical guillotine: sharp cracks, then the stages clanking apart
    noiseBurst(ac, G.struct, G.noise.white, { t, type: 'highpass', freq: 400, Q: 0.5, attack: 0.001, dur: 0.05, level: 0.8 * k });
    noiseBurst(ac, G.struct, G.noise.white, { t: t + 0.03, type: 'highpass', freq: 600, Q: 0.5, attack: 0.001, dur: 0.04, level: 0.6 * k });
    thump(ac, G.struct, { t, f0: 110, f1: 35, dur: 0.4, level: 0.9 * k });
    clank(ac, G.struct, { t: t + 0.06, partials: [420, 980, 1730], decay: 0.5, level: 0.15 * k });
  }

  function latch(k, capture = false) {
    if (!live() || k <= 0) return;
    const t = ac.currentTime + 0.01;
    if (capture) {
      thump(ac, G.struct, { t, f0: 90, f1: 40, dur: 0.3, level: 0.5 * k });
      clank(ac, G.struct, { t, partials: [330, 760, 1260, 2100], decay: 0.9, level: 0.16 * k });
      // the twelve docking latches firing in a ripple
      for (let i = 0; i < 12; i++) clank(ac, G.struct, { t: t + 0.6 + i * 0.035 + Math.random() * 0.02, partials: [900 + Math.random() * 300, 2300], decay: 0.12, level: 0.07 * k });
    } else {
      // undocking: probe spring release
      thump(ac, G.struct, { t, f0: 120, f1: 50, dur: 0.25, level: 0.4 * k });
      clank(ac, G.struct, { t, partials: [510, 1240], decay: 0.3, level: 0.08 * k });
    }
  }

  // ------------------------------------------------------------------ callouts
  function callout(c) {
    if (!c || c.voice === false) return;
    if (!game.settings.audio || game.settings.callouts === false) return;
    const who = SPEAKERS[c.who] ? c.who : 'CDR';
    const canSpeak = speech.available && hasUserActivation();
    if (who === 'CAPCOM') {
      // air-to-ground: Quindar intro tone, the transmission, Quindar outro tone
      const t0 = live() ? ac.currentTime + 0.02 : 0;
      if (live()) {
        tone(ac, G.radio, { t: t0, freq: QUINDAR_IN, dur: QUINDAR_DUR, level: 0.07 });
        G.squelchUntil = t0 + 0.3 + speechDuration(c.text) + 0.5;
      }
      const outro = () => {
        if (!live()) return;
        const t = ac.currentTime + 0.05;
        tone(ac, G.radio, { t, freq: QUINDAR_OUT, dur: QUINDAR_DUR, level: 0.07 });
        G.squelchUntil = t + QUINDAR_DUR + 0.1;
      };
      setTimeout(() => {
        const ok = canSpeak && speech.speak(c.text, who, { onend: outro, priority: true });
        if (!ok) setTimeout(outro, speechDuration(c.text) * 1000);
      }, (QUINDAR_DUR + 0.08) * 1000);
      return;
    }
    if (canSpeak) speech.speak(c.text, who);
  }

  // ------------------------------------------------------------------ events
  game.events.on('action', (a) => {
    const n = a?.name;
    if (!n) return;
    if (n === 'MUTE') {
      game.settings.audio = !game.settings.audio;
      if (!game.settings.audio) speech.cancel();
      else resume(true);
      game.events.emit('message', { text: game.settings.audio ? 'Sound on' : 'Sound off', level: 'info', duration: 1.5 });
      return;
    }
    if (!game.started) return;
    if (TOGGLE_ACTIONS.has(n)) click('toggle');
    else if (PUSH_ACTIONS.has(n)) click('push');
    else if (DSKY_ACTIONS.has(n)) click('dsky');
    else if (DETENT_ACTIONS.has(n)) click('detent');
  });
  game.events.on('callout', callout);
  game.events.on('engine', (e) => engineTransient(e, inListeners(listeners(), e?.vessel)));
  game.events.on('touchdown', (e) => touchdown(e, inListeners(listeners(), e?.vessel || 'LM')));
  game.events.on('crash', (e) => crashSound(Math.max(0.2, inListeners(listeners(), e?.vessel || 'LM'))));
  game.events.on('stage', (e) => pyro(inListeners(listeners(), e?.vessel || 'LM')));
  game.events.on('dock', () => latch(Math.max(inListeners(listeners(), 'LM'), inListeners(listeners(), 'CSM')), true));
  game.events.on('undock', () => latch(Math.max(inListeners(listeners(), 'LM'), inListeners(listeners(), 'CSM')), false));
  game.events.on('scenario', () => {
    speech.cancel();
    if (G) {
      G.prevLevels.clear();
      G.squelchUntil = 0;
    }
  });

  // ------------------------------------------------------------------ per frame
  const engLevel = { DPS: 0, APS: 0, SPS: 0 };
  const engThr = { DPS: 0, APS: 0, SPS: 0 };

  function update(frame) {
    if (!ac || !G) return;
    try {
      const t = ac.currentTime;
      const s = game.settings;
      const on = !!s.audio && !!game.started;
      glide(G.master.gain, on ? Math.max(0, Math.min(1, s.volume ?? 0.8)) : 0, t, 0.08);
      // save the CPU while muted (after the fade-out)
      if (s.audio) mutedAt = -1;
      else if (mutedAt < 0) mutedAt = t;
      if (!s.audio && ac.state === 'running' && t - mutedAt > 0.4) {
        const p = ac.suspend();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else if (s.audio && ac.state === 'suspended') resume();
      if (!on) return;

      const view = game.view;
      const iva = view.mode === 'iva' && !!view.ivaVessel;
      const paused = !!game.time.paused;
      const L = listeners();

      // cockpit: full range through the structure; exterior: steep low-pass, quiet
      glide(G.medium.frequency, iva ? 16000 : 420, t, 0.1);
      glide(G.mediumG.gain, iva ? 1 : 0.2, t, 0.1);
      glide(G.struct.gain, paused ? 0 : 1, t, 0.05);

      // ---- main engines
      for (const k of Object.keys(engLevel)) engLevel[k] = engThr[k] = 0;
      for (const { v, k } of L) {
        const e = v.mainEngine;
        if (!e || !e.firing || v.crashed) continue;
        const name = e.name in engLevel ? e.name : 'DPS';
        const thr = Math.max(0, e.throttle || 0);
        engLevel[name] += thr * k;
        engThr[name] = Math.max(engThr[name], thr);
      }
      for (const [name, voice] of Object.entries(G.engines)) voice.set(Math.min(1.2, engLevel[name]), engThr[name], t);

      // ---- RCS
      const used = { LM: false, CSM: false };
      for (const { v, k } of L) {
        const qv = G.quads[v.type];
        if (!qv || used[v.type]) continue;
        used[v.type] = true;
        const jets = v.rcs?.jets || [];
        let prev = G.prevLevels.get(v);
        if (!prev || prev.length !== jets.length) {
          prev = new Float32Array(jets.length);
          G.prevLevels.set(v, prev);
        }
        const sum = [0, 0, 0, 0];
        const lit = [0, 0, 0, 0];
        for (let i = 0; i < jets.length; i++) {
          const j = jets[i];
          const qi = quadIndex(v, j);
          const lv = j.level || 0;
          if (qi >= 0 && qi < 4) {
            sum[qi] += lv;
            if (lv > 0.05 && prev[i] <= 0.05) lit[qi]++;
          }
          prev[i] = lv;
        }
        const centres = centresOf(v);
        const loud = v.type === 'LM' ? 1 : 0.6; // the LM quads sit right outside the cabin wall
        for (let qi = 0; qi < 4; qi++) {
          const pan = panOf(v, centres[qi]);
          qv[qi].set(paused ? 0 : Math.min(1, sum[qi]) * 0.07 * loud * k, pan, t);
          if (lit[qi] && !paused) {
            const key = `${v.id}${qi}`;
            if (t - (G.lastThump.get(key) || 0) > 0.045) {
              G.lastThump.set(key, t);
              const n = Math.min(3, lit[qi]);
              const pnode = typeof ac.createStereoPanner === 'function' ? ac.createStereoPanner() : null;
              const dest = pnode || G.struct;
              if (pnode) {
                pnode.pan.value = pan;
                pnode.connect(G.struct);
                setTimeout(() => pnode.disconnect(), 400);
              }
              const lvl = (0.28 + 0.1 * n) * loud * k;
              thump(ac, dest, { t: t + 0.005, f0: 105 + Math.random() * 25, f1: 48, dur: 0.11, level: lvl });
              noiseBurst(ac, dest, G.noise.white, { t: t + 0.005, type: 'bandpass', freq: 1500, Q: 0.9, attack: 0.001, dur: 0.03, level: lvl * 0.35 });
            }
          }
        }
      }
      for (const type of ['LM', 'CSM']) if (!used[type]) for (const qv of G.quads[type]) qv.set(0, 0, t);

      // ---- regolith blast under the descent engine
      const lm = game.vessels.LM;
      const kLM = inListeners(L, 'LM');
      let dust = 0;
      if (lm && kLM > 0 && lm.mainEngine?.firing && !lm.staged && !paused) {
        const alt = lm.tel.gearAltitude ?? lm.tel.altitude;
        if (alt < 30) dust = 0.05 * lm.mainEngine.throttle * (1 - Math.max(0, alt) / 30) * kLM;
      }
      G.dust.set(dust, t);

      // ---- cabin ambience (cockpit views only)
      const cabinV = iva ? game.vessels[view.ivaVessel] : null;
      G.ambience.set(cabinV?.type || 'LM', cabinV && !cabinV.crashed ? 1 : 0, t);

      // ---- headset: comm hiss, squelch during ground transmissions, master alarm
      G.hiss.set(t < G.squelchUntil ? 0.012 : 0.0035, t);
      const alarmV = cabinV || game.active;
      G.alarm.set(!!alarmV?.cw?.masterAlarm && !paused, 0.05, t);
    } catch (e) {
      if (!update.warned) {
        update.warned = true;
        console.warn('audio update failed', e);
      }
    }
  }

  return {
    update,
    resume() {
      resume(false);
    },
    /** Test hook: create the context even without a user gesture. */
    forceStart() {
      resume(true);
      return !!ac;
    },
    get context() {
      return ac;
    },
    speech,
  };
}
