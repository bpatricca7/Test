// Spoken crew / Mission Control callouts with the Web Speech API (speechSynthesis).
// Each speaker gets a consistent voice and pitch; the text is lightly rewritten so the synthesiser
// reads it the way the crew said it ("1202" -> "twelve oh two", "3 1/2" -> "3 and a half").
// Never throws when speech is unavailable (headless browsers, some Linux builds).

/** Per-speaker voice character. */
export const SPEAKERS = {
  CDR: { pitch: 0.9, rate: 1.1, slot: 0 },
  LMP: { pitch: 1.08, rate: 1.16, slot: 1 },
  CMP: { pitch: 0.98, rate: 1.1, slot: 2 },
  CAPCOM: { pitch: 1.14, rate: 1.08, slot: 3 },
};

/** Rewrite a callout for text-to-speech. Pure. */
export function spokenText(text) {
  let s = String(text || '');
  s = s.replace(/\b(\d+) 1\/2\b/g, '$1 and a half');
  s = s.replace(/\b1\/2\b/g, 'a half');
  s = s.replace(/\b12(0\d)\b/g, (m, d) => `twelve oh ${+d === 0 ? 'oh' : +d}`); // 1201, 1202 program alarms
  s = s.replace(/\bP(\d\d)\b/g, (m, d) => `P ${d}`);
  s = s.replace(/[—–]/g, ', ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Rough speaking time (s) of a text, for when the synthesiser gives no end event. */
export function speechDuration(text, rate = 1.1) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return (0.6 + words * 0.36) / rate;
}

/**
 * Pick an English voice for a speaker slot from a voice list. Prefers en-US, then any English;
 * spreads speakers over the available voices so crew and CAPCOM sound different.
 */
export function pickVoice(voices, slot = 0) {
  if (!voices || !voices.length) return null;
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
  const us = en.filter((v) => /^en[-_]US/i.test(v.lang || ''));
  const pool = us.length >= 2 ? us : en.length ? en : voices;
  // local voices first: they start speaking without a network round trip
  const local = pool.filter((v) => v.localService);
  const list = local.length >= Math.min(2, pool.length) ? local : pool;
  return list[slot % list.length] || null;
}

export function createSpeech(game) {
  const synth = typeof window !== 'undefined' && window.speechSynthesis && typeof window.SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null;
  let voices = [];
  let pending = 0;
  const load = () => {
    try {
      voices = synth ? synth.getVoices() || [] : [];
    } catch {
      voices = [];
    }
  };
  if (synth) {
    load();
    try {
      synth.addEventListener?.('voiceschanged', load);
    } catch {
      /* ignore */
    }
  }

  return {
    available: !!synth,
    get busy() {
      return pending;
    },
    /**
     * Speak `text` as `who`. Returns false when it cannot (callbacks are then not called).
     * @param {{onstart?: Function, onend?: Function, priority?: boolean}} [cb]
     */
    speak(text, who = 'CDR', cb = {}) {
      if (!synth) return false;
      // keep the voice loop current: drop routine chatter when the queue backs up
      if (pending >= 2 && !cb.priority) return false;
      try {
        if (!voices.length) load();
        const sp = SPEAKERS[who] || SPEAKERS.CDR;
        const u = new window.SpeechSynthesisUtterance(spokenText(text));
        const v = pickVoice(voices, sp.slot);
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        } else u.lang = 'en-US';
        u.pitch = sp.pitch;
        u.rate = sp.rate;
        u.volume = Math.max(0, Math.min(1, game.settings.volume ?? 0.8));
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          pending = Math.max(0, pending - 1);
          cb.onend?.();
        };
        u.onstart = () => cb.onstart?.();
        u.onend = finish;
        u.onerror = finish;
        pending++;
        synth.speak(u);
        // some engines never fire onend: give up after a generous estimate
        setTimeout(finish, (speechDuration(text, sp.rate) * 2 + 4) * 1000);
        return true;
      } catch {
        return false;
      }
    },
    cancel() {
      try {
        synth?.cancel();
      } catch {
        /* ignore */
      }
      pending = 0;
    },
  };
}
