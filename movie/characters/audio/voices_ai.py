#!/usr/bin/env python3
"""ECHO (characters cut): the dialogue voiced with Kokoro-82M, a local open-source
neural TTS (Apache-2.0, run through onnxruntime), with an acting layer on top.

The from-scratch formant synthesizer (speech.py) stays in the repo; this script
replaces its output for every line, as the user asked for natural voices.

  input       each line's hand-checked ARPAbet (speech.LEXICON + the overrides
              below) converted to Kokoro's misaki phoneme alphabet, so every
              model token belongs to a known ARPAbet phoneme
  timing      a copy of the Kokoro graph that also outputs its predicted
              per-token durations (25 ms frames): phoneme and word boundaries in
              the manifest are the model's own alignment, not an estimate
  acting      per-line segments (phrases rendered separately and joined with
              chosen gaps), speed and gain per segment, punctuation for prosody,
              synthesized in-breaths, an LPC whisper for "Maya...", a breathy
              blend for the awe line, a slight tremor for the scared lines
  voices      MAYA = 0.7 af_heart + 0.3 af_nicole; SAM = 0.5 am_fenrir + 0.5 am_puck;
              VISITOR = 0.4 am_onyx + 0.3 bm_fable + 0.3 am_michael at speed 0.85,
              then an eerie chain: TD-PSOLA pitch-down, formants lowered 5 %, an
              octave-down shadow, a whisper layer, chorus, a gentle radio band,
              the thrown echo on the last word and the dark space tail
  output      48 kHz mono 16-bit (polyphase 24 -> 48 kHz), 20 ms pre-roll, loudness
              normalized with the same per-delivery offsets as before

Setup (once):  pip install kokoro-onnx onnxruntime onnx
               model files in movie/characters/build/models/ (see MODEL_URLS)
Run:           python3 movie/characters/audio/voices_ai.py [d05 d11 ...] [--no-sheets]

Writes movie/characters/build/dialogue/<id>.wav, merges manifest.json, draws
movie/characters/build/voice_sheets/<id>.png. Deterministic (fixed threads, seeded noise).
"""

import json
import os
import sys
import wave

import numpy as np
from scipy import signal

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import speech as SP  # noqa: E402  lexicon, script, dialogue loader, and voice.py (SP.V1) helpers

V1 = SP.V1
CHAR_DIR = SP.CHAR_DIR
MODEL_DIR = os.path.join(CHAR_DIR, "build", "models")
OUT_DIR = os.path.join(CHAR_DIR, "build", "dialogue")
SHEET_DIR = os.path.join(CHAR_DIR, "build", "voice_sheets")
MODEL_URLS = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}
TIMED_MODEL = "kokoro-v1.0-timed.onnx"
DURATION_TENSOR = "/encoder/Gather_output_0"      # predicted frames per token (after rounding, >= 1)

SR_TTS = 24000
FS = 48000
FRAME = 600                     # samples per duration frame at 24 kHz (25 ms)
AUDIO_LEAD_FRAMES = 2           # measured: acoustic landmarks (sibilant noise, stop closures) sit about
                                # 2 frames before the duration grid (+-1 frame); Kokoro's own timestamper
                                # also trims its lead-in
PRE_ROLL = 0.020
TAIL = 0.10                     # s kept after a human line's last phoneme
VISITOR_TAIL = 1.9
SEED = 1974
LUFS_TARGET = -20.0
PEAK_CEIL = -1.0
WHISPER_VOICED_DB = -6.0        # a little of the voiced original kept under the LPC whisper (intelligibility)

VOICES = {
    "maya": {"af_heart": 0.7, "af_nicole": 0.3},
    "sam": {"am_fenrir": 0.5, "am_puck": 0.5},
    "visitor": {"am_onyx": 0.4, "bm_fable": 0.3, "am_michael": 0.3},
}

# Dictionary-style pronunciations for the neural model (it makes its own
# connected-speech allophones, so the hand-coded flaps and elisions that the
# formant engine needed are undone here).
KOKORO_PRON = {
    "sent": "S EH1 N T", "right": "R AY1 T", "at": "AE1 T", "next": "N EH1 K S T",
    "seventy": "S EH1 V AH0 N T IY0", "twenty": "T W EH1 N T IY0", "it's": "IH1 T S",
    "transmitting": "T R AE0 N S M IH1 DX IH0 NG", "we": "W IY1",
}

# Per-line performance. segs: (tts text, speed, gap after in s, gain dB). The tts
# text may differ from the subtitle only in punctuation. Flags: breath (in-breath
# before the line), whisper, breathy (fraction of LPC whisper mixed in), tremor.
ACT = {
    "d01": dict(segs=[("Maya.", 1.08, 0.16, -3.0), ("Maya!", 1.12, 0.12, 0.0), ("Wake up!", 1.15, 0, 0.0)]),
    "d02": dict(segs=[("It's three in the morning,", 0.92, 0.08, 0.0), ("Sam.", 0.88, 0, -1.5)]),
    "d03": dict(segs=[("Something is transmitting.", 1.18, 0.16, 0.0), ("Right at us!", 1.08, 0, 1.0)],
                breath=0.30, breath_mid=True),
    "d04": dict(segs=[("Two tones.", 1.0, 0.26, 0.0), ("On. Off.", 0.95, 0, 0.0)]),
    "d05": dict(segs=[("That's not noise.", 1.0, 0.30, 0.0), ("That's a message.", 0.95, 0, 0.5)]),
    "d06": dict(segs=[("Sixteen seventy-nine pulses.", 1.05, 0.32, 0.0), ("Then… nothing.", 0.9, 0, -1.5)]),
    "d07": dict(segs=[("Twenty-three by seventy-three.", 1.05, 0.30, 0.0), ("Fold it.", 1.0, 0, 1.0)]),
    "d08": dict(segs=[("I know this picture.", 0.80, 0, 0.0)], breathy=0.45),
    "d09": dict(segs=[("We sent it.", 0.97, 0.34, 0.0), ("In nineteen seventy-four.", 0.93, 0, 0.0)]),
    "d10": dict(segs=[("Then who is that?", 1.05, 0.30, 0.0), ("Standing next to us?", 1.0, 0, 0.0)],
                breath=0.28, tremor=0.5),
    "d11": dict(segs=[("We heard you.", 0.85, 0, 0.0)]),
    "d12": dict(segs=[("Maya.", 0.80, 0, 0.0)], whisper=True),    # an ellipsis drags the schwa into "-rth"
    "d13": dict(segs=[("Who are you?", 0.92, 0, 0.0)]),
    "d14": dict(segs=[("You asked if anyone was out there.", 0.85, 0, 0.0)]),
    "d15": dict(segs=[("We were listening.", 0.85, 0, 0.0)]),
    "d16": dict(segs=[("What do you want?", 0.95, 0, 0.0)]),
    "d17": dict(segs=[("To answer.", 0.92, 0.22, 0.0), ("The way you did.", 0.9, 0, 0.0)]),
    "d18": dict(segs=[("With a picture of ourselves.", 0.85, 0, 0.0)]),
    "d19": dict(segs=[("What do we send back?", 0.9, 0, 0.0)], tremor=0.7),
    "d20": dict(segs=[("Something honest.", 0.84, 0, 0.0)]),
}

# ARPAbet -> misaki (Kokoro v1.0's phoneme alphabet, General American)
MIS_V = {"AA": "ɑ", "AE": "æ", "AH": "ʌ", "AO": "ɔ", "AW": "W", "AY": "I", "EH": "ɛ", "ER": "ɜɹ", "EY": "A",
         "IH": "ɪ", "IY": "i", "OW": "O", "OY": "Y", "UH": "ʊ", "UW": "u"}
MIS_C = {"B": "b", "CH": "ʧ", "D": "d", "DH": "ð", "DX": "ɾ", "F": "f", "G": "ɡ", "HH": "h", "JH": "ʤ",
         "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ",
         "T": "t", "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ"}
PUNCT = {".": ".", ",": ",", "!": "!", "?": "?", "…": "…"}


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

def ensure_models():
    for name, url in MODEL_URLS.items():
        if not os.path.exists(os.path.join(MODEL_DIR, name)):
            raise SystemExit("missing %s: download %s into %s" % (name, url, MODEL_DIR))
    timed = os.path.join(MODEL_DIR, TIMED_MODEL)
    if not os.path.exists(timed):
        import onnx
        from onnx import TensorProto, helper
        m = onnx.load(os.path.join(MODEL_DIR, "kokoro-v1.0.onnx"))
        m.graph.node.append(helper.make_node("Identity", [DURATION_TENSOR], ["duration"], name="expose_duration"))
        m.graph.output.append(helper.make_tensor_value_info("duration", TensorProto.INT64, ["tokens_plus_2"]))
        onnx.save(m, timed)
    return timed


class Kokoro:
    def __init__(self):
        import onnxruntime as ort
        from kokoro_onnx.config import DEFAULT_VOCAB
        so = ort.SessionOptions()
        so.intra_op_num_threads = 4
        so.inter_op_num_threads = 1
        self.sess = ort.InferenceSession(ensure_models(), so, providers=["CPUExecutionProvider"])
        self.vocab = DEFAULT_VOCAB
        bank = np.load(os.path.join(MODEL_DIR, "voices-v1.0.bin"))
        self.voices = {name: sum(w * bank[v] for v, w in mix.items()) for name, mix in VOICES.items()}

    def run(self, tokens, voice, speed):
        ids = [self.vocab[t] for t in tokens]
        style = self.voices[voice][len(ids)]
        audio, dur = self.sess.run(None, {"tokens": np.array([[0, *ids, 0]], np.int64), "style": style,
                                          "speed": np.array([speed], np.float32)})
        audio, dur = np.asarray(audio, np.float64).ravel(), np.asarray(dur).ravel()
        assert int(dur.sum()) * FRAME == len(audio), "frame size mismatch"
        return audio, dur


# ---------------------------------------------------------------------------
# Text -> tokens with ARPAbet ownership
# ---------------------------------------------------------------------------

def pron(word, line_pron):
    w = word.lower()
    return KOKORO_PRON.get(w) or line_pron.get(w) or SP.LEXICON[w]


def build_tokens(text, line_pron):
    """misaki tokens for one segment, each tagged with the index of the ARPAbet
    phoneme it belongs to (stress marks belong to their vowel; spaces and
    punctuation to none). Returns tokens, owners, phonemes [(label, word idx)], words."""
    tokens, owners, phones, words = [], [], [], []
    for wtok in text.split():
        punct = ""
        while wtok and wtok[-1] in PUNCT:
            punct = wtok[-1] + punct
            wtok = wtok[:-1]
        if tokens:
            tokens.append(" ")
            owners.append(-1)
        words.append(wtok)
        wi = len(words) - 1
        for part in wtok.split("-"):
            for ph in pron(part, line_pron).split():
                base, st = (ph[:-1], ph[-1]) if ph[-1].isdigit() else (ph, None)
                idx = len(phones)
                phones.append((ph, wi))
                if base in MIS_V:
                    sym = MIS_V[base]
                    if st == "0":
                        sym = {"AH": "ə", "ER": "ɚ"}.get(base, sym)
                    if st in ("1", "2"):
                        tokens.append("ˈ" if st == "1" else "ˌ")
                        owners.append(idx)
                    for c in sym:
                        tokens.append(c)
                        owners.append(idx)
                else:
                    tokens.append(MIS_C[base])
                    owners.append(idx)
        for c in punct:
            tokens.append(PUNCT[c])
            owners.append(-1)
    return tokens, owners, phones, words


def phoneme_spans(dur, owners, n_ph):
    """Frame spans per phoneme from the model's token durations. Word-internal
    spaces are split between their neighbours; punctuation stays a pause."""
    starts = np.concatenate([[0], np.cumsum(dur)])      # token k (0 = bos) spans starts[k]..starts[k+1]
    span = [[None, None] for _ in range(n_ph)]
    for k, own in enumerate(owners):
        a, b = starts[k + 1], starts[k + 2]
        if own >= 0:
            s = span[own]
            s[0] = a if s[0] is None else min(s[0], a)
            s[1] = b if s[1] is None else max(s[1], b)
    for k, own in enumerate(owners):                     # spaces between words
        if own == -1 and 0 < k < len(owners) - 1 and owners[k - 1] >= 0 and owners[k + 1] >= 0:
            a, b = starts[k + 1], starts[k + 2]
            mid = 0.5 * (a + b)
            span[owners[k - 1]][1] = mid
            span[owners[k + 1]][0] = mid
    lead = AUDIO_LEAD_FRAMES * FRAME                       # the decoded audio runs ahead of the frame grid
    return [(max(0, s[0] * FRAME - lead), max(0, s[1] * FRAME - lead)) for s in span]   # samples at 24 kHz


# ---------------------------------------------------------------------------
# Signal helpers
# ---------------------------------------------------------------------------

def sound_end(audio, span):
    """The model gives a phrase's last token extra frames of release and silence;
    end the last phoneme where its sound actually dies away (-35 dB re phrase peak)."""
    a, b = int(span[0]), int(span[1])
    hop = int(0.005 * SR_TTS)
    env = np.sqrt(np.convolve(audio ** 2, np.ones(2 * hop) / (2 * hop), "same"))
    thr = env.max() * 10 ** (-35 / 20)
    loud = np.flatnonzero(env[a:b] > thr)
    if not len(loud):
        return b
    return float(min(b, max(a + int(0.04 * SR_TTS), a + loud[-1] + int(0.02 * SR_TTS))))


def fade(x, n_in, n_out):
    x = x.copy()
    if n_in > 0:
        x[:n_in] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(n_in) / n_in)
    if n_out > 0:
        x[-n_out:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(n_out) / n_out)
    return x


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20))


def lpc(frame, order):
    r = np.correlate(frame, frame, "full")[len(frame) - 1:len(frame) + order]
    if r[0] <= 1e-12:
        return np.zeros(order), 0.0
    r[0] *= 1.0001
    from scipy.linalg import solve_toeplitz
    a = solve_toeplitz(r[:order], r[1:order + 1])
    err = r[0] - np.dot(a, r[1:order + 1])
    return a, max(err, 0.0)


def whisperize(x, sr, rng, order=None):
    """LPC whisper: every 10 ms the spectral envelope is re-estimated and white
    noise with the same envelope and energy replaces the voiced excitation."""
    order = order or int(sr / 1000) + 4
    pre = signal.lfilter([1, -0.9], [1], x)
    n, hop = int(0.025 * sr), int(0.010 * sr)
    win = np.hanning(n)
    out = np.zeros(len(x) + n)
    norm = np.zeros(len(x) + n)
    for i in range(0, len(x) - n, hop):
        fr = pre[i:i + n] * win
        a, err = lpc(fr, order)
        if err <= 0:
            continue
        e = rng.standard_normal(n + 64) * np.sqrt(err / n)
        y = signal.lfilter([1.0], np.concatenate([[1.0], -a]), e)[64:]
        out[i:i + n] += y * win
        norm[i:i + n] += win ** 2
    out = out[:len(x)] / np.maximum(norm[:len(x)], 1e-3)
    return signal.lfilter([1], [1, -0.9], out)


def in_breath(n, sr, rng):
    """An audible in-breath: noise shaped by an open tract, rising then cut."""
    x = rng.standard_normal(n + 2000)
    for f, bw, g in ((900, 700, 1.0), (1900, 900, 0.6), (3200, 1500, 0.3)):
        b, a = signal.iirpeak(f, f / bw, fs=sr)
        x = x + g * signal.lfilter(b, a, x)
    x = signal.sosfilt(signal.butter(2, [250, 5000], "bandpass", fs=sr, output="sos"), x)[2000:]
    u = np.arange(n) / n
    env = np.where(u < 0.82, np.sin(0.5 * np.pi * u / 0.82) ** 1.5, np.cos(0.5 * np.pi * (u - 0.82) / 0.18) ** 2)
    return x * env / rms(x)


def f0_track(x, sr, fmin=55.0, fmax=320.0, hop_s=0.005):
    """Normalized-autocorrelation F0 per hop; 0 where unvoiced."""
    y = signal.sosfilt(signal.butter(4, 1000, "lowpass", fs=sr, output="sos"), x)
    n, hop = int(0.04 * sr), int(hop_s * sr)
    lo, hi = int(sr / fmax), int(sr / fmin)
    thr = 0.03 * np.max(np.abs(y))
    f0 = []
    for i in range(0, len(y) - n, hop):
        s = y[i:i + n] - np.mean(y[i:i + n])
        if np.max(np.abs(s)) < thr:
            f0.append(0.0)
            continue
        ac = signal.fftconvolve(s, s[::-1])[n - 1:]
        e = np.sqrt(ac[0] * np.cumsum(s[::-1] ** 2)[::-1] + 1e-12)
        nc = ac / e
        k = lo + int(np.argmax(nc[lo:hi]))
        f0.append(sr / k if nc[k] > 0.55 else 0.0)
    f0 = np.array(f0)
    f0 = signal.medfilt(f0, 5)
    return f0, hop


def psola(x, sr, ratio, f0=None, hop=None):
    """TD-PSOLA pitch shift by `ratio` (< 1 lowers), keeping timing and the
    spectral envelope. Unvoiced stretches pass through unchanged."""
    if f0 is None:
        f0, hop = f0_track(x, sr)
    off = int(0.02 * sr)

    def f0_at(t):                                   # nearest analysis frame; 0 = unvoiced
        k = int(round((t * sr - off) / hop))
        return f0[k] if 0 <= k < len(f0) else 0.0

    lp = signal.sosfiltfilt(signal.butter(2, 900, "lowpass", fs=sr, output="sos"), x)
    # analysis marks: one per period, snapped to the low-passed waveform's peak
    marks = []
    t = 0.0
    while t < len(x) / sr:
        f = f0_at(t)
        if f < 50.0:
            t += 0.0025
            continue
        T = 1.0 / f
        c = int(t * sr)
        a, b = max(0, c - int(0.3 * T * sr)), min(len(x), c + int(0.3 * T * sr))
        if marks and marks[-1] > c - int(1.5 * T * sr):
            a = max(a, marks[-1] + int(0.7 * T * sr))
            b = max(b, a + 1)
        b = min(b, len(x))
        if b <= a:
            t += T
            continue
        m = a + int(np.argmax(lp[a:b]))
        marks.append(m)
        t = m / sr + T
    marks = np.array(marks, int)
    out = np.zeros(len(x) + sr)
    wsum = np.zeros(len(x) + sr)
    vmask = np.zeros(len(x))
    if len(marks) >= 2:
        periods = np.diff(marks)
        periods = np.concatenate([periods, periods[-1:]])
        # a voiced run = consecutive marks closer than 25 ms
        run_ok = periods < 0.025 * sr
        for j in range(len(marks) - 1):
            if run_ok[j]:
                vmask[marks[j]:marks[j + 1]] = 1.0
        ts = marks[0] / sr
        while ts < marks[-1] / sr:
            j = int(np.argmin(np.abs(marks - ts * sr)))
            if not run_ok[j] and (j == 0 or not run_ok[j - 1]):
                nxt = marks[marks > ts * sr + 1]
                if not len(nxt):
                    break
                ts = nxt[0] / sr
                continue
            P = int(periods[j] if run_ok[j] else periods[j - 1])
            m = marks[j]
            L = min(P, int(0.02 * sr))
            a, b = max(0, m - L), min(len(x), m + L)
            w = np.hanning(b - a)
            c = int(ts * sr)
            o = c - (m - a)
            if o >= 0:
                out[o:o + len(w)] += x[a:b] * w
                wsum[o:o + len(w)] += w
            ts += P / sr / ratio
    y = out[:len(x)] / np.maximum(wsum[:len(x)], 0.5)
    vmask = np.clip(SP.gsmooth(vmask, 0.006 * sr) * 1.3, 0, 1)
    return vmask * y + (1 - vmask) * x


# ---------------------------------------------------------------------------
# The Visitor's eerie chain
# ---------------------------------------------------------------------------

VISITOR_PITCH_ST = -4.0         # total pitch drop
VISITOR_TRACT = 0.95            # formants x0.95 (a 5 % longer vocal tract)


def visitor_chain(x24, phon, seed):
    """x24: the Kokoro voice at 24 kHz. Returns (48 kHz signal, time scale factor)."""
    rng = np.random.default_rng(seed)
    x = signal.resample_poly(x24, 2, 1)
    f0, hop = f0_track(x, FS)
    ratio = 2 ** (VISITOR_PITCH_ST / 12) / VISITOR_TRACT
    main = psola(x, FS, ratio, f0, hop)
    shadow = psola(x, FS, ratio * 0.5, f0, hop)
    # longer tract: resample so formants (and pitch) drop 5 % and time stretches 5 %
    stretch = 1.0 / VISITOR_TRACT
    up, down = 20, 19
    main = signal.resample_poly(main, up, down)
    shadow = signal.resample_poly(shadow, up, down)
    n = len(main)
    t = np.arange(n) / FS
    shadow = signal.sosfilt(signal.butter(2, 1800, "lowpass", fs=FS, output="sos"), shadow)
    whisper = whisperize(main, FS, rng)
    d = int(0.028 * FS)
    whisper = np.concatenate([np.zeros(d), whisper[:-d]])
    chorus = V1.fractional_delay(main, (0.012 + 0.003 * np.sin(2 * np.pi * 0.31 * t)) * FS)
    ref = rms(main)
    dry = (main + chorus * 10 ** (-12 / 20)
           + shadow * ref / rms(shadow) * 10 ** (-14 / 20)
           + whisper * ref / rms(whisper) * 10 ** (-19 / 20))
    return dry, stretch


def visitor_space(dry, active, throw_from, speech_end, seed):
    """A gentler version of the first cut's transmission and space: a wider
    band (130 Hz - 5 kHz), light compression and overdrive, faint gated static
    and 1420 Hz carrier, the thrown echo on the last word, the dark cavern."""
    rng = np.random.default_rng(seed + 1)
    end = int((speech_end + VISITOR_TAIL) * FS)
    dry = np.concatenate([dry, np.zeros(max(0, end - len(dry)))])[:end]
    active = np.concatenate([active, np.zeros(max(0, end - len(active)), bool)])[:end]
    n = len(dry)
    t = np.arange(n) / FS
    sos = lambda order, f, kind: signal.butter(order, f, kind, fs=FS, output="sos")
    x = signal.sosfilt(sos(2, 130.0, "highpass"), dry)
    x = signal.sosfilt(sos(4, 5000.0, "lowpass"), x)
    x = signal.lfilter(*V1.peaking_eq(1600.0, 2.0, 0.8), x)
    x = x / np.max(np.abs(x))
    a = np.exp(-1.0 / (0.045 * FS))
    env = np.sqrt(signal.lfilter([1 - a], [1, -a], x * x)) + 1e-9
    x = x * np.minimum(1.0, (env / rms(x[active])) ** (1.0 / 2.0 - 1.0))
    x = x / np.max(np.abs(x))
    x = np.tanh(1.4 * x) / np.tanh(1.4)
    x = x * (1.0 + 0.05 * V1.smooth_noise(n, 3.0, rng))
    voice_rms = rms(x[active])
    g = V1.envelope_follower(active.astype(float), 0.035, 0.45)
    static = signal.sosfilt(sos(2, [300, 4500], "bandpass"), rng.standard_normal(n))
    static *= 1.0 + 0.5 * V1.smooth_noise(n, 9.0, rng)
    static *= voice_rms * 10 ** (-38 / 20) / rms(static)
    carrier_f = 1420.0 + 2.5 * V1.smooth_noise(n, 0.8, rng)
    carrier = np.sqrt(2) * voice_rms * 10 ** (-44 / 20) * np.sin(2 * np.pi * np.cumsum(carrier_f) / FS)
    x = x + g * (static + carrier)
    throw = V1.envelope_follower((t >= throw_from).astype(float), 0.03, 0.03)
    echo = np.zeros(n)
    tone = x * throw
    first = max(0.56, speech_end - throw_from + 0.12)        # never on top of the word itself
    for delay, gain_db, lp in ((first, -10.0, 2500.0), (2 * first, -17.0, 1700.0)):
        tone = signal.sosfilt(sos(2, lp, "lowpass"), tone)
        k = int(delay * FS)
        echo[k:] += 10 ** (gain_db / 20) * tone[:n - k]
    echo = signal.sosfilt(sos(2, 300.0, "highpass"), echo)
    wet = signal.fftconvolve(x + echo, V1.reverb_ir(rng))[:n]
    out = x + echo + 10 ** (-14 / 20) * wet
    out = signal.sosfilt(sos(2, 25.0, "highpass"), out)       # no DC from the space
    k = int(0.6 * FS)
    out[-k:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, k)))
    return out


# ---------------------------------------------------------------------------
# One line
# ---------------------------------------------------------------------------

def k_loudness(x, spans):
    k = SP.k_weight(x)
    m = np.zeros(len(x), bool)
    for a, b in spans:
        m[int(a * FS):int(b * FS)] = True
    return -0.691 + 10 * np.log10(np.mean(k[m[:len(k)]] ** 2) + 1e-20)


def render_line(d, tts):
    lid, spk = d["id"], d["speaker"]
    act = ACT[lid]
    spec = SP.SCRIPT.get(lid, {})
    line_pron = {}
    rng = np.random.default_rng(SEED + int(lid[1:]) * 7)
    # 1. synthesize each segment and cut it around its phonemes
    chunks, phon, words = [], [], []
    for text, speed, gap, gain in act["segs"]:
        tokens, owners, phones, seg_words = build_tokens(text, line_pron)
        audio, dur = tts.run(tokens, spk, speed)
        spans = phoneme_spans(dur, owners, len(phones))
        spans[-1] = (spans[-1][0], sound_end(audio, spans[-1]))
        chunks.append(dict(audio=audio, spans=spans, phones=phones, words=seg_words, gap=gap, gain=gain))
    # 2. lay the chunks out: pre-roll, optional breath, then phrases with their gaps
    t0 = PRE_ROLL
    out = np.zeros(int(12 * SR_TTS))
    breath = act.get("breath", 0.0)
    breath_spans = []
    if breath:
        n = int(breath * SR_TTS)
        breath_spans.append((int(t0 * SR_TTS), n))
        t0 += breath + 0.06
    word_base = 0
    for ci, c in enumerate(chunks):
        a0, b1 = c["spans"][0][0], c["spans"][-1][1]
        head = int((0.02 if ci == 0 else 0.04) * SR_TTS)
        tail = int(0.12 * SR_TTS)
        lo, hi = max(0, int(a0) - head), min(len(c["audio"]), int(b1) + tail)
        seg = fade(c["audio"][lo:hi], int(0.004 * SR_TTS), int(0.06 * SR_TTS)) * 10 ** (c["gain"] / 20)
        off = int(round(t0 * SR_TTS)) - (int(a0) - lo)
        out[off:off + len(seg)] += seg
        for (ph, wi), (sa, sb) in zip(c["phones"], c["spans"]):
            phon.append(dict(p=ph, start=t0 + (sa - a0) / SR_TTS, end=t0 + (sb - a0) / SR_TTS, word=word_base + wi))
        for wi, w in enumerate(c["words"]):
            ws = [q for q in phon if q["word"] == word_base + wi]
            words.append(dict(w=w, start=ws[0]["start"], end=ws[-1]["end"]))
        word_base += len(c["words"])
        t0 = phon[-1]["end"] + c["gap"]
        if act.get("breath_mid") and ci == 0 and len(chunks) > 1:   # a gasp between the phrases
            n = int(0.24 * SR_TTS)
            breath_spans.append((int((phon[-1]["end"] + 0.10) * SR_TTS), n))
            t0 = phon[-1]["end"] + 0.10 + 0.24 + 0.05
    speech_end = phon[-1]["end"]
    out = out[:int((speech_end + TAIL) * SR_TTS)]
    ref = rms(out[out != 0])
    for i0, n in breath_spans:
        br = in_breath(n, SR_TTS, rng) * ref * 10 ** (-20 / 20)
        out[i0:i0 + n] += br[:len(out) - i0]
    # 3. performance post-processing (24 kHz)
    if act.get("whisper"):
        w = whisperize(out, SR_TTS, rng)
        out = w * rms(out) / rms(w) + 10 ** (WHISPER_VOICED_DB / 20) * out
    elif act.get("breathy"):
        w = whisperize(out, SR_TTS, rng)
        k = act["breathy"]
        out = (1 - 0.5 * k) * out + k * w * rms(out) / rms(w)
    if act.get("tremor"):
        tt = np.arange(len(out)) / SR_TTS
        shake = 0.5 * np.sin(2 * np.pi * 5.6 * tt) + 0.7 * V1.smooth_noise(len(out), 6.5, rng)
        out = out * (1 + 0.07 * act["tremor"] * shake)
        # a light pitch shake: vary the playback rate by about 1 % around the
        # true time (the local drift stays under a millisecond)
        rate = 1 + 0.01 * act["tremor"] * shake
        pos = np.cumsum(rate) - rate[0]
        pos *= (len(out) - 1) / pos[-1]
        out = np.interp(pos, np.arange(len(out)), out)
    # 4. to 48 kHz; the Visitor gets its chain
    if spk == "visitor":
        dry, stretch = visitor_chain(out, phon, SEED + int(lid[1:]))
        for q in phon:
            q["start"] = PRE_ROLL + (q["start"] - PRE_ROLL) * stretch
            q["end"] = PRE_ROLL + (q["end"] - PRE_ROLL) * stretch
        for q in words:
            q["start"] = PRE_ROLL + (q["start"] - PRE_ROLL) * stretch
            q["end"] = PRE_ROLL + (q["end"] - PRE_ROLL) * stretch
        speech_end = phon[-1]["end"]
        # the stretch moves the first phoneme a hair later; pull the audio back to keep 20 ms pre-roll
        shift = int(round((PRE_ROLL * stretch - PRE_ROLL) * FS))
        dry = dry[shift:]
        active = np.zeros(len(dry), bool)
        active[int(PRE_ROLL * FS):int(speech_end * FS)] = True
        last_word = len(words) - 1
        throw_from = min(q["start"] for q in phon if q["word"] == last_word)
        y = visitor_space(dry, active, throw_from, speech_end, SEED + int(lid[1:]))
    else:
        y = signal.resample_poly(out, 2, 1)
        y = signal.sosfilt(signal.butter(2, 50.0, "highpass", fs=FS, output="sos"), y)
        y = y[:int((speech_end + TAIL) * FS)]
        y = fade(y, 0, int(0.03 * FS))
    y[:int(0.010 * FS)] = 0.0
    # 5. loudness: same per-delivery offsets as the formant renders
    spans = [(q["start"], q["end"]) for q in phon]
    offset = spec.get("style", {}).get("loud", 0.0)
    y = y * 10 ** ((LUFS_TARGET + offset - k_loudness(y, spans)) / 20)
    peak = np.max(np.abs(y))
    if peak > 10 ** (PEAK_CEIL / 20):
        y *= 10 ** (PEAK_CEIL / 20) / peak
    # words must match the subtitle
    said = [w["w"].lower() for w in words]
    want = [w.strip(".,!?…").lower() for w in d["text"].replace("...", "").split()]
    assert said == want, (lid, said, want)
    for w, text_w in zip(words, d["text"].replace("...", "").split()):
        w["w"] = text_w.strip(".,!?…")
    info = dict(loudness=k_loudness(y, spans), peak=20 * np.log10(np.max(np.abs(y))), end=speech_end)
    return y, phon, words, info


def manifest_entry(lid, phon, words, end):
    r = lambda v: round(float(v), 4)
    return {"wav": lid + ".wav", "duration": r(end),
            "phonemes": [{"p": q["p"], "start": r(q["start"]), "end": r(q["end"])} for q in phon],
            "words": [{"w": w["w"], "start": r(w["start"]), "end": r(w["end"])} for w in words]}


# ---------------------------------------------------------------------------
# Analysis sheet: spectrogram with the model-aligned phoneme boundaries
# ---------------------------------------------------------------------------

def render_sheet(path, lid, d, y, phon, words, info):
    W, L, R, ph, wh = 1200, 58, 14, 300, 70
    H = 26 + ph + 44 + wh + 30
    img = np.full((H, L + W + R, 3), 16, np.uint8)
    white, grey, yellow = (230, 230, 230), (120, 120, 120), (255, 210, 80)
    tmax = len(y) / FS
    title = "%s  %s  %s   SPEECH %.2f S (TARGET %.1f)  %.1f LUFS  PEAK %.1f DBFS  (KOKORO)" % (
        lid.upper(), d["speaker"].upper(), d["text"], info["end"] - PRE_ROLL, d["target"], info["loudness"], info["peak"])
    V1.draw_text(img, L, 6, title, white)
    y0 = 26
    img[y0:y0 + ph, L:L + W] = V1.spectrogram_panel(y, tmax, W, ph, f_max=8000.0, win_s=0.005)
    for k in range(0, 8001, 1000):
        yy = y0 + int(round((1 - k / 8000) * (ph - 1)))
        img[yy, L - 5:L] = white
        V1.draw_text(img, L - 26, yy - 5, "%dK" % (k // 1000), grey)
    x_of = lambda tm: L + int(round(tm / tmax * (W - 1)))
    for j, q in enumerate(phon):
        xa, xb = x_of(q["start"]), x_of(q["end"])
        img[y0:y0 + ph:3, xa] = yellow
        V1.draw_text(img, (xa + xb) // 2 - 2 * len(q["p"]), y0 + ph + 2 + (j % 2) * 7, q["p"], white, scale=1)
    for w in words:
        V1.draw_text(img, x_of(w["start"]), y0 + ph + 20, w["w"], yellow)
    yw = y0 + ph + 44 + 10
    edges = np.linspace(0, len(y), W + 1).astype(int)
    mid = yw + wh // 2
    for px in range(W):
        s = y[edges[px]:edges[px + 1]]
        if len(s):
            img[mid - int(s.max() * (wh // 2 - 2)):mid - int(s.min() * (wh // 2 - 2)) + 1, L + px] = (120, 200, 255)
    for j in range(int(tmax * 10) + 1):
        xx = x_of(j * 0.1)
        img[yw + wh + 2:yw + wh + (8 if j % 5 == 0 else 5), xx] = grey
        if j % 5 == 0:
            V1.draw_text(img, xx - 6, yw + wh + 10, "%.1f" % (j * 0.1), grey)
    V1.write_png(path, img)


# ---------------------------------------------------------------------------

def write_wav(path, x):
    pcm = np.clip(np.round(x * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FS)
        w.writeframes(pcm.tobytes())


def main(argv):
    only = [a for a in argv if a.startswith("d")]
    sheets = "--no-sheets" not in argv
    os.makedirs(OUT_DIR, exist_ok=True)
    if sheets:
        os.makedirs(SHEET_DIR, exist_ok=True)
    tts = Kokoro()
    dialogue = SP.load_dialogue()
    man_path = os.path.join(OUT_DIR, "manifest.json")
    manifest = {"lines": {}}
    if os.path.exists(man_path):
        with open(man_path) as f:
            manifest = json.load(f)
    print("id   speaker  target  speech  x target  LUFS   peak   text")
    for d in dialogue:
        if only and d["id"] not in only:
            continue
        y, phon, words, info = render_line(d, tts)
        write_wav(os.path.join(OUT_DIR, d["id"] + ".wav"), y)
        manifest["lines"][d["id"]] = manifest_entry(d["id"], phon, words, info["end"])
        if sheets:
            render_sheet(os.path.join(SHEET_DIR, d["id"] + ".png"), d["id"], d, y, phon, words, info)
        sp = info["end"] - PRE_ROLL
        print("%s  %-8s %5.2f  %6.2f   %5.2f   %5.1f  %5.1f   %s" % (
            d["id"], d["speaker"], d["target"], sp, sp / d["target"], info["loudness"], info["peak"], d["text"]))
    manifest["lines"] = dict(sorted(manifest["lines"].items()))
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=1)
    print("wrote", OUT_DIR)


if __name__ == "__main__":
    main(sys.argv[1:])
