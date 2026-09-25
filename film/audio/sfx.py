"""Sound effects, all synthesized: motors, servos, chirps, clanks, the bonk,
slide whistle, a rubber-duck squeak, whooshes, magic shimmer, birds, crickets
and wind. `render(cues, total)` builds the effects stem from cues.json.
"""
import numpy as np
from scipy import signal
import synth as S
from synth import SR, t_axis, lp, hp, bp

R = np.random.default_rng(11)


def noise(n):
    return R.standard_normal(n)


def fade(x, a=0.005, b=0.02):
    n = len(x)
    na, nb = min(int(a * SR), n // 2), min(int(b * SR), n // 2)
    x = x.copy()
    if na:
        x[:na] *= np.linspace(0, 1, na)
    if nb:
        x[-nb:] *= np.linspace(1, 0, nb)
    return x


def sweep_bp(x, f0, f1, q=4.0, block=256):
    """Band-pass with a center frequency gliding from f0 to f1 (log)."""
    out = np.zeros_like(x)
    n = len(x)
    zi = np.zeros(2)
    for i in range(0, n, block):
        k = i / max(n - 1, 1)
        f = f0 * (f1 / f0) ** k
        w0 = 2 * np.pi * min(f, SR * 0.45) / SR
        alpha = np.sin(w0) / (2 * q)
        b = np.array([alpha, 0, -alpha]) / (1 + alpha)
        a = np.array([1, -2 * np.cos(w0) / (1 + alpha), (1 - alpha) / (1 + alpha)])
        seg = x[i:i + block]
        y, zi = signal.lfilter(b, a, seg, zi=zi)
        out[i:i + block] = y
    return out


def glide_sine(f0, f1, dur, curve=1.0, vib=0.0, vib_rate=6.0):
    t = t_axis(dur)
    k = (t / dur) ** curve
    f = f0 * (f1 / f0) ** k
    if vib:
        f = f * (1 + vib * np.sin(2 * np.pi * vib_rate * t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# ------------------------------------------------------------------ robots
def motor(dur, speed=1.0, decel=0.0):
    """Little electric tread motor. decel: fraction of the end spent slowing down."""
    t = t_axis(dur)
    sp = np.ones_like(t) * speed
    if decel > 0:
        k = np.clip((t / dur - (1 - decel)) / decel, 0, 1)
        sp *= 1 - k * 0.85
    sp *= np.minimum(1, t / 0.12)
    f = 70 + 110 * sp
    ph = 2 * np.pi * np.cumsum(f) / SR
    whine = np.sin(ph) * 0.5 + np.sin(2 * ph) * 0.3 + np.sin(3.01 * ph) * 0.2 + np.sin(6 * ph) * 0.1
    whine = lp(whine, 1600)
    rattle = bp(noise(len(t)), 900, 3500) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * np.cumsum(14 * sp) / SR)))
    grit = lp(noise(len(t)), 500) * 0.4
    y = whine * 0.55 + rattle * 0.12 + grit * 0.3
    return fade(y * (0.3 + 0.7 * sp), 0.04, 0.12)


def servo(dur=0.35, f0=520, f1=780):
    t = t_axis(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sign(np.sin(ph)) * 0.4 + np.sin(2 * ph) * 0.3
    y = bp(y, 400, 3000) + bp(noise(len(t)), 2000, 6000) * 0.05
    return fade(y * 0.5, 0.02, 0.06)


def chirp(notes, dur_each=0.09, glide=0.4, wave='sine'):
    """Robot 'voice' beeps: notes are Hz; glides between them."""
    out = []
    for i, f in enumerate(notes):
        nxt = notes[i + 1] if i + 1 < len(notes) else f
        t = t_axis(dur_each)
        k = np.clip((t / dur_each - (1 - glide)) / max(glide, 1e-3), 0, 1)
        ff = f * (nxt / f) ** k
        ph = 2 * np.pi * np.cumsum(ff) / SR
        y = np.sin(ph) + (0.25 * np.sin(2 * ph) if wave == 'rich' else 0)
        out.append(y)
    y = np.concatenate(out)
    return fade(y * 0.5, 0.004, 0.03)


def clank(vel=0.8, pitch=1.0):
    t = t_axis(0.6)
    parts = [(320, 1.0, 14), (873, 0.6, 18), (1470, 0.45, 22), (2250, 0.3, 30), (3310, 0.2, 40)]
    y = sum(a * np.sin(2 * np.pi * f * pitch * t + R.random() * 6) * np.exp(-t * d) for f, a, d in parts)
    y += hp(noise(len(t)), 2000) * np.exp(-t * 80) * 0.6
    return y * vel * 0.4


def thud(vel=0.8, f=110):
    t = t_axis(0.5)
    ff = f * (0.5 + 0.5 * np.exp(-t * 18))
    y = np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t * 10)
    y += lp(noise(len(t)), 300) * np.exp(-t * 25) * 0.6
    return y * vel


def crunch(dur=0.35):
    t = t_axis(dur)
    grains = np.zeros(len(t))
    for _ in range(40):
        i = R.integers(0, len(t) - 400)
        grains[i:i + 400] += noise(400) * np.exp(-np.arange(400) / 60) * R.uniform(0.3, 1)
    y = bp(grains, 300, 3500) * 0.8 + lp(noise(len(t)), 150) * 0.8
    squeal = S.saw_bl(np.linspace(700, 520, len(t)), t, 12)
    y += bp(squeal, 500, 2500) * 0.15
    return fade(y * np.exp(-t * 3) * 0.6, 0.005, 0.05)


def creak(dur=1.5, rate=(18, 45), f=(420, 900)):
    t = t_axis(dur)
    r = np.interp(t, [0, dur * 0.5, dur], [rate[0], rate[1], rate[0] * 1.3])
    ph = np.cumsum(r) / SR
    clicks = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)
    exc = np.convolve(clicks, np.exp(-np.arange(200) / 25))[: len(t)]
    y = bp(exc, f[0], f[0] * 1.3) + bp(exc, f[1], f[1] * 1.25) * 0.7
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.5
    return y * env * 0.8


def slide_whistle(dur=0.45, f0=1900, f1=500):
    y = glide_sine(f0, f1, dur, curve=0.8, vib=0.012, vib_rate=7)
    y += 0.08 * bp(noise(len(y)), 1000, 4000)
    return fade(y * 0.35, 0.02, 0.05)


def bonk():
    t = t_axis(0.7)
    f = 560 * (1 + 0.5 * np.exp(-t * 60))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t * 7) + 0.5 * np.sin(1.52 * ph) * np.exp(-t * 11) + 0.25 * np.sin(2.31 * ph) * np.exp(-t * 16)
    y += lp(noise(len(t)), 1200) * np.exp(-t * 60) * 0.8
    return y * 0.55


def tweety(dur=2.2):
    """Cartoon 'dizzy birdies' twittering around the head."""
    y = np.zeros(int(dur * SR))
    tt = 0.0
    while tt < dur - 0.2:
        d = R.uniform(0.06, 0.11)
        f0 = R.uniform(2600, 3600)
        c = glide_sine(f0, f0 * R.uniform(1.2, 1.5), d, vib=0.05, vib_rate=40)
        c = fade(c, 0.005, 0.02) * R.uniform(0.3, 0.6)
        i = int(tt * SR)
        y[i:i + len(c)] += c[: len(y) - i]
        tt += d + R.uniform(0.03, 0.12)
    env = np.minimum(1, t_axis(dur) / 0.2) * np.minimum(1, (dur - t_axis(dur)) / 0.5)
    return y * env * 0.4


def rattle(dur=0.6, rate=30):
    t = t_axis(dur)
    clicks = (np.sin(2 * np.pi * rate * t) > 0.95).astype(float)
    y = np.convolve(clicks, np.exp(-np.arange(300) / 40) * noise(300))[: len(t)]
    return bp(y, 800, 5000) * 0.5


def squeak(dur=0.28, f0=1100):
    t = t_axis(dur)
    f = f0 * (1 + 0.35 * np.sin(np.pi * t / dur)) * (1 + 0.03 * np.sin(2 * np.pi * 35 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph)
    y = bp(y, 900, 4000) + 0.2 * bp(noise(len(t)), 2000, 5000)
    return fade(y * 0.4, 0.01, 0.05)


def whoosh(dur=0.5, f0=300, f1=2500, vel=0.6, q=2.5):
    y = sweep_bp(noise(int(dur * SR)), f0, f1, q)
    env = np.sin(np.pi * np.clip(t_axis(dur) / dur, 0, 1)) ** 1.5
    return y * env * vel


def big_whoosh(dur=1.7):
    """Falling-star roar: rising noise + descending tone (doppler)."""
    t = t_axis(dur)
    y = sweep_bp(noise(len(t)), 200, 3000, 1.5) * (t / dur) ** 2
    tone = glide_sine(1400, 380, dur, curve=2.5) * (t / dur) ** 3 * 0.4
    sh = shimmer(dur, 0.5) * (t / dur) ** 2
    return (y * 0.9 + tone + sh * 0.4)


def boom():
    t = t_axis(3.0)
    f = 55 * (1 + 1.5 * np.exp(-t * 8))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    y += lp(noise(len(t)), 600) * np.exp(-t * 3) * 0.8
    y += bp(noise(len(t)), 800, 4000) * np.exp(-t * 12) * 0.4
    return y * 0.9


def debris(dur=1.8):
    y = np.zeros(int(dur * SR))
    for _ in range(26):
        c = clank(R.uniform(0.1, 0.35), R.uniform(0.8, 2.2))
        i = int(R.uniform(0, dur - 0.5) ** 1.3 / dur ** 0.3 * SR)
        y[i:i + len(c)] += c[: len(y) - i]
    y += lp(noise(len(y)), 2500) * np.exp(-t_axis(dur) * 2) * 0.25
    return y


def hover_hum(dur):
    t = t_axis(dur)
    y = np.sin(2 * np.pi * 196 * t) * 0.5 + np.sin(2 * np.pi * 294.5 * t) * 0.25 + np.sin(2 * np.pi * 392.3 * t) * 0.12
    y *= 0.7 + 0.3 * np.sin(2 * np.pi * 2.1 * t)
    y += bp(noise(len(t)), 3000, 8000) * 0.03 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.7 * t))
    return y * 0.35


def scan_beep():
    return chirp([1760, 2350], 0.07, 0.8) * 0.8


def shimmer(dur=1.5, vel=0.5, rise=True):
    t = t_axis(dur)
    y = np.zeros(len(t))
    for _ in range(36):
        f = R.uniform(2000, 7000)
        start = R.uniform(0, dur * 0.9)
        d = R.uniform(0.2, 0.6)
        tt = t_axis(d)
        g = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 8)
        i = int(start * SR)
        y[i:i + len(g)] += g[: len(y) - i] * R.uniform(0.2, 0.7)
    env = (t / dur) if rise else np.ones_like(t)
    return y * env * vel * 0.35


def sparkle(vel=0.5, n=8):
    y = np.zeros(int(1.2 * SR))
    for k in range(n):
        f = R.choice([2093, 2349, 2637, 3136, 3520, 4186, 4699, 5274])
        tt = t_axis(0.8)
        g = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 6)
        i = int(k * 0.045 * SR + R.uniform(0, 0.02) * SR)
        y[i:i + len(g)] += g[: len(y) - i] * R.uniform(0.3, 0.8)
    return y * vel * 0.3


def pop(f=600, vel=0.4):
    y = glide_sine(f, f * 2.2, 0.06, curve=0.6)
    return fade(y, 0.002, 0.02) * vel


def dig_scrape():
    t = t_axis(0.22)
    y = bp(noise(len(t)), 250, 2500) * np.exp(-t * 12)
    grains = (R.random(len(t)) > 0.995) * noise(len(t)) * 3
    return (y + bp(grains, 1000, 5000)) * 0.35


def pat():
    t = t_axis(0.25)
    return (lp(noise(len(t)), 250) * np.exp(-t * 30) + np.sin(2 * np.pi * 80 * t) * np.exp(-t * 25) * 0.5) * 0.6


def pour(dur=2.6):
    t = t_axis(dur)
    y = bp(noise(len(t)), 1200, 6000) * (0.6 + 0.4 * lp(np.abs(noise(len(t))), 20) * 3)
    for _ in range(int(dur * 25)):
        f = R.uniform(700, 1800)
        b = glide_sine(f, f * 1.6, 0.03)
        i = R.integers(0, len(t) - len(b))
        y[i:i + len(b)] += b * R.uniform(0.1, 0.3)
    return fade(y * 0.25, 0.1, 0.2)


def snore(dur=1.4):
    t = t_axis(dur)
    f = 95 + 25 * np.sin(np.pi * t / dur)
    y = S.saw_bl(f, t, 20)
    y = lp(y, 700) * np.sin(np.pi * t / dur) ** 2
    return y * 0.18


def power_down(dur=0.9):
    y = glide_sine(900, 90, dur, curve=0.7)
    return fade(lp(y, 2000) * 0.3, 0.01, 0.1)


def power_up(dur=0.4):
    y = glide_sine(200, 1400, dur, curve=1.5)
    return fade(y * 0.25, 0.01, 0.05)


def rustle(dur):
    t = t_axis(dur)
    y = hp(noise(len(t)), 2500) * lp(np.abs(noise(len(t))), 8) * 4
    return y * 0.12


def birds(dur):
    y = np.zeros(int(dur * SR))
    tt = 0.3
    while tt < dur - 1:
        # a little phrase of 2-5 chirps
        base = R.uniform(2500, 4200)
        for k in range(R.integers(2, 6)):
            d = R.uniform(0.05, 0.12)
            c = glide_sine(base * R.uniform(0.9, 1.2), base * R.uniform(1.1, 1.6), d, vib=0.02, vib_rate=30)
            c = fade(c, 0.005, 0.02) * R.uniform(0.2, 0.5)
            i = int(tt * SR)
            y[i:i + len(c)] += c[: len(y) - i]
            tt += d + R.uniform(0.02, 0.08)
        tt += R.uniform(0.4, 1.6)
    return y * 0.35


def crickets(dur):
    t = t_axis(dur)
    y = np.zeros(len(t))
    for c in range(3):
        f = 4300 + c * 350
        car = np.sin(2 * np.pi * f * t)
        pulses = (np.sin(2 * np.pi * 28 * t + c) > 0.3).astype(float)
        groups = (np.sin(2 * np.pi * (0.9 + 0.3 * c) * t + c * 2) > 0.2).astype(float)
        y += car * lp(pulses * groups, 300) * (0.6 - 0.15 * c)
    return y * 0.06


def wind(dur, gust=0.5):
    t = t_axis(dur)
    n = noise(len(t))
    base = lp(n, 500) * 1.0 + bp(n, 500, 1500) * 0.3
    g = 0.6 + gust * lp(noise(len(t)), 0.4) * 30
    g = np.clip(g, 0.2, 1.6)
    whistle = sweep_bp(noise(len(t)), 700, 1100, 12) * 0.3 * np.clip(g - 0.8, 0, 1)
    return (base * g + whistle) * 0.3


def giggle():
    notes = [1320, 1480, 1320, 1580, 1320]
    return chirp(notes, 0.07, 0.3) * 0.5


def clap():
    t = t_axis(0.12)
    return bp(noise(len(t)), 800, 3000) * np.exp(-t * 60) * 0.4


def iris():
    return whoosh(0.5, 3000, 400, 0.3, 3)


FX = {
    'servo': servo, 'clank': clank, 'thud': thud, 'crunch': crunch, 'slide_whistle': slide_whistle, 'bonk': bonk,
    'rattle': rattle, 'squeak': squeak, 'big_whoosh': big_whoosh, 'boom': boom, 'debris': debris, 'scan_beep': scan_beep,
    'sparkle': sparkle, 'pop': pop, 'dig': dig_scrape, 'pat': pat, 'power_down': power_down, 'power_up': power_up,
    'giggle': giggle, 'clap': clap, 'iris': iris,
}


def make(cue):
    kind = cue['sfx']
    a = cue.get('args', {})
    if kind == 'motor':
        return motor(cue['dur'], a.get('speed', 1.0), a.get('decel', 0.0))
    if kind == 'chirp':
        return chirp(a['notes'], a.get('each', 0.09), a.get('glide', 0.4), a.get('wave', 'sine'))
    if kind == 'whoosh':
        return whoosh(cue.get('dur', 0.5), a.get('f0', 300), a.get('f1', 2500), a.get('vel', 0.6))
    if kind == 'creak':
        return creak(cue['dur'])
    if kind == 'tweety':
        return tweety(cue['dur'])
    if kind == 'shimmer':
        return shimmer(cue['dur'], a.get('vel', 0.5), a.get('rise', True))
    if kind == 'hover':
        return hover_hum(cue['dur'])
    if kind == 'pour':
        return pour(cue['dur'])
    if kind == 'snore':
        return snore(cue.get('dur', 1.4))
    if kind == 'rustle':
        return rustle(cue['dur'])
    if kind == 'birds':
        return birds(cue['dur'])
    if kind == 'crickets':
        return crickets(cue['dur'])
    if kind == 'wind':
        return wind(cue['dur'], a.get('gust', 0.5))
    if kind == 'sparkle':
        return sparkle(a.get('vel', 0.5), a.get('n', 8))
    if kind == 'pop':
        return pop(a.get('f', 600), a.get('vel', 0.4))
    if kind == 'clank':
        return clank(a.get('vel', 0.8), a.get('pitch', 1.0))
    if kind == 'thud':
        return thud(a.get('vel', 0.8), a.get('f', 110))
    if kind == 'squeak':
        return squeak(a.get('dur', 0.28), a.get('f0', 1100))
    if kind == 'servo':
        return servo(cue.get('dur', 0.35), a.get('f0', 520), a.get('f1', 780))
    return FX[kind]()


def render(cues, total):
    tr = S.Track(total)
    for c in cues:
        x = make(c)
        if 'dur' in c and c['sfx'] in ('wind', 'hover', 'birds', 'crickets', 'rustle'):
            fi, fo = c.get('fadeIn', 1.0), c.get('fadeOut', 1.0)
            n = len(x)
            env = np.ones(n)
            a, b = int(fi * SR), int(fo * SR)
            if a:
                env[:a] = np.linspace(0, 1, a)
            if b:
                env[-b:] *= np.linspace(1, 0, b)
            x = x * env
        tr.add(c['t'], x, c.get('gain', 1.0), c.get('pan', 0.0))
    return tr.buf
