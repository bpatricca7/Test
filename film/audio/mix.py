"""Final sound mix: voices + score + effects, with the music ducking under dialogue.
Writes audio/build/soundtrack.wav (48 kHz stereo, 24-bit)."""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import synth as S  # noqa: E402
import music  # noqa: E402
import sfx  # noqa: E402

SR = S.SR
BUILD = os.path.join(HERE, 'build')


def smooth_env(x, attack=0.03, release=0.5):
    env = np.abs(x)
    b, a = signal.butter(1, 30 / (SR / 2))
    env = signal.lfilter(b, a, env)
    out = np.zeros_like(env)
    ga, gr = np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR))
    # block-wise one-pole follower (fast enough in numpy via decimation)
    dec = 48
    e = env[::dec]
    o = np.zeros_like(e)
    ga, gr = np.exp(-dec / (attack * SR)), np.exp(-dec / (release * SR))
    v = 0.0
    for i, s in enumerate(e):
        g = ga if s > v else gr
        v = g * v + (1 - g) * s
        o[i] = v
    out = np.repeat(o, dec)[: len(env)]
    return out


def main():
    cues = json.load(open(os.path.join(BUILD, 'cues.json')))
    total = cues['end'] + 1.0
    n = int(total * SR)

    # ---- voices
    vox = np.zeros((n + SR * 4, 2))
    for v in cues['voices']:
        y, sr = sf.read(os.path.join(BUILD, 'voices', v['id'] + '.wav'))
        assert sr == SR
        g = 1.0 if v['id'].startswith('n') else 1.1
        p = 0.0 if v['id'].startswith('n') else (-0.12 if v['id'].startswith('b') else 0.12)
        i = int(v['t'] * SR)
        vox[i:i + len(y)] += S.pan(y, p) * g
    room = S.reverb_ir(0.9, 0.01, 5000, seed=5)
    vox = vox + S.convolve_stereo(vox, room)[: len(vox)] * 0.07
    vox = vox[:n]

    # ---- music
    print('rendering score...')
    mus = music.score(total)[:n]
    hall = S.reverb_ir(2.6, 0.03, 4200)
    mus = mus * 0.8 + S.convolve_stereo(mus, hall)[:n] * 0.42

    # ---- effects
    print('rendering effects...')
    fx = sfx.render(cues['sfx'], total)[:n]
    fx = fx + S.convolve_stereo(fx, S.reverb_ir(1.2, 0.015, 5000, seed=9))[:n] * 0.12

    # ---- ducking under dialogue
    venv = smooth_env(vox.mean(axis=1), 0.04, 0.6)
    venv = np.clip(venv / (np.percentile(venv[venv > 1e-4], 90) + 1e-9), 0, 1)
    duck_m = (1 - 0.62 * venv)[:, None]
    duck_f = (1 - 0.45 * venv)[:, None]

    mix = vox * 1.0 + mus * 0.55 * duck_m + fx * 0.6 * duck_f

    # ---- master: gentle bus compression, soft limiting, fade out
    level = smooth_env(mix.mean(axis=1), 0.01, 0.25)
    thr = 0.35
    gain = np.where(level > thr, (thr + (level - thr) / 2.5) / np.maximum(level, 1e-9), 1.0)
    mix *= gain[:, None]
    peak = np.abs(mix).max()
    mix = mix / peak * 0.95
    mix = np.tanh(mix * 1.15) / np.tanh(1.15)
    tail = int(2.0 * SR)
    mix[-tail:] *= np.linspace(1, 0, tail)[:, None]
    mix *= 0.93
    out = os.path.join(BUILD, 'soundtrack.wav')
    sf.write(out, mix.astype(np.float32), SR, subtype='PCM_24')
    for name, stem in (('stem_voice.wav', vox), ('stem_music.wav', mus * 0.55), ('stem_fx.wav', fx * 0.6)):
        sf.write(os.path.join(BUILD, name), (stem / (np.abs(stem).max() + 1e-9) * 0.9).astype(np.float32), SR)
    rms = np.sqrt(np.mean(mix ** 2))
    print(f'wrote {out}  {len(mix) / SR:.1f}s  rms {20 * np.log10(rms):.1f} dBFS')


if __name__ == '__main__':
    main()
