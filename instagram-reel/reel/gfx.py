"""Text, emoji and sparkle sprites + compositing onto float BGR frames."""
import os
from functools import lru_cache
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import config as C

FONTS = os.path.join(C.ASSETS, "fonts")
EMOJI = os.path.join(C.ASSETS, "emoji")


@lru_cache(None)
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def font_var(name, size, weight):
    f = ImageFont.truetype(os.path.join(FONTS, name), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def pil_to_rgba(im):
    """PIL RGBA -> float32 (h, w, 4) BGRA in 0..1 (straight alpha)."""
    a = np.asarray(im).astype(np.float32) / 255.0
    return a[..., [2, 1, 0, 3]].copy()


def text_sprite(text, fnt, fill, stroke=0, stroke_fill=(0, 0, 0), spacing=0, shadow=None, pad=40):
    """Render one line of text. shadow=(dx, dy, blur, alpha)."""
    if spacing:
        widths = [fnt.getlength(ch) for ch in text]
        w = int(sum(widths) + spacing * (len(text) - 1))
    else:
        w = int(fnt.getlength(text))
    asc, desc = fnt.getmetrics()
    W, H = w + 2 * pad + 2 * stroke, asc + desc + 2 * pad + 2 * stroke
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0 = pad + stroke, pad + stroke

    def draw(dr, color, sw, sf):
        if spacing:
            x = x0
            for ch, cw in zip(text, widths):
                dr.text((x, y0), ch, font=fnt, fill=color, stroke_width=sw, stroke_fill=sf)
                x += cw + spacing
        else:
            dr.text((x0, y0), text, font=fnt, fill=color, stroke_width=sw, stroke_fill=sf)

    if shadow:
        dx, dy, blur, alpha = shadow
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw(ImageDraw.Draw(sh), (0, 0, 0, 255), stroke, (0, 0, 0, 255))
        sh = sh.filter(ImageFilter.GaussianBlur(blur))
        sh.putalpha(sh.getchannel("A").point(lambda v: int(v * alpha)))
        base = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        base.alpha_composite(sh, (dx, dy))
        im = base
        d = ImageDraw.Draw(im)
    draw(d, fill, stroke, stroke_fill)
    return im


@lru_cache(None)
def emoji(ch, size):
    cps = "-".join(f"{ord(c):x}" for c in ch if ord(c) != 0xFE0F)
    for name in (cps, cps + "-fe0f"):
        p = os.path.join(EMOJI, name + ".png")
        if os.path.exists(p):
            im = Image.open(p).convert("RGBA").resize((size, size), Image.LANCZOS)
            return im
    return None


def split_emoji(s):
    """Split an emoji string into individual emoji (ZWJ sequences kept together)."""
    out, cur = [], ""
    for c in s:
        if c in ("‍", "️") or (cur.endswith("‍")):
            cur += c
        else:
            if cur:
                out.append(cur)
            cur = c
    if cur:
        out.append(cur)
    return out


# ------------------------------------------------------------------ compositing
def blit(frame, spr, cx, cy, scale=1.0, alpha=1.0, angle=0.0, additive=False):
    """Composite a straight-alpha BGRA float sprite centred at (cx, cy)."""
    if alpha <= 0.002 or scale <= 0.01:
        return
    h, w = spr.shape[:2]
    Hf, Wf = frame.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, scale)
    M[0, 2] += cx - w / 2
    M[1, 2] += cy - h / 2
    # bounding box of the transformed sprite
    corners = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], np.float32) @ M.T
    x0, y0 = np.floor(corners.min(0)).astype(int)
    x1, y1 = np.ceil(corners.max(0)).astype(int)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(Wf, x1), min(Hf, y1)
    if x1 <= x0 or y1 <= y0:
        return
    M2 = M.copy()
    M2[0, 2] -= x0
    M2[1, 2] -= y0
    pm = spr.copy()
    pm[..., :3] *= pm[..., 3:4]          # premultiply so edges filter cleanly
    warped = cv2.warpAffine(pm, M2, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    a = warped[..., 3:4] * alpha
    rgb = warped[..., :3] * alpha * 255.0
    roi = frame[y0:y1, x0:x1]
    if additive:
        roi += rgb
    else:
        roi *= (1 - a)
        roi += rgb


def rounded_pill(w, h, r, fill, outline=None, ow=0, shadow=(0, 6, 10, 0.35), pad=30):
    W, H = w + 2 * pad, h + 2 * pad
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if shadow:
        dx, dy, blur, al = shadow
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([pad + dx, pad + dy, pad + w + dx, pad + h + dy], r, fill=(0, 0, 0, int(255 * al)))
        im = sh.filter(ImageFilter.GaussianBlur(blur))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([pad, pad, pad + w, pad + h], r, fill=fill, outline=outline, width=ow)
    return im


# ------------------------------------------------------------------ sparkles
@lru_cache(None)
def star_sprite(size, warm=True):
    """Four-point twinkle star with a soft glow (BGRA float, straight alpha)."""
    s = size
    y, x = np.mgrid[-1:1:complex(0, s), -1:1:complex(0, s)]
    ax, ay = np.abs(x) + 1e-6, np.abs(y) + 1e-6
    star = np.exp(-((ax ** 0.5 + ay ** 0.5) ** 2) / 0.08)            # astroid-ish 4 points
    star = np.maximum(star, np.exp(-(ax / 0.9) ** 2 - (ay / 0.035) ** 2))  # long horizontal flare
    star = np.maximum(star, np.exp(-(ay / 0.9) ** 2 - (ax / 0.035) ** 2))  # long vertical flare
    glow = np.exp(-(x ** 2 + y ** 2) / 0.05) * 0.55
    a = np.clip(star + glow, 0, 1)
    core = np.clip(star * 1.4, 0, 1)
    gold = np.array(C.GOLD[::-1], np.float32) / 255 if warm else np.array([1, 1, 1], np.float32)
    col = core[..., None] * 1.0 + (1 - core[..., None]) * gold          # white core -> gold rim
    return np.dstack([col, a]).astype(np.float32)


class Sparkles:
    """Pre-seeded particle bursts: each particle twinkles, drifts and fades."""

    def __init__(self):
        self.parts = []

    def burst(self, t0, cx, cy, sx, sy, count, seed, size=(18, 52), life=(0.7, 1.5), spread_t=0.35, rise=40):
        rng = np.random.default_rng(seed)
        for _ in range(count):
            ang = rng.uniform(0, 2 * np.pi)
            r = np.sqrt(rng.uniform(0.05, 1))
            self.parts.append(dict(
                t0=t0 + rng.uniform(0, spread_t), life=rng.uniform(*life),
                x=cx + np.cos(ang) * r * sx, y=cy + np.sin(ang) * r * sy,
                vx=rng.normal(0, 12), vy=-rng.uniform(0.3, 1) * rise,
                size=int(rng.uniform(*size)), tw=rng.uniform(5, 11), ph=rng.uniform(0, 6.28),
                rot=rng.choice([0.0, 45.0]) + rng.normal(0, 8), warm=rng.random() < 0.75))

    def draw(self, frame, t):
        for p in self.parts:
            u = (t - p["t0"]) / p["life"]
            if not (0 <= u <= 1):
                continue
            env = np.sin(np.pi * u) ** 0.8
            tw = 0.65 + 0.35 * np.sin(p["tw"] * (t - p["t0"]) * 2 * np.pi / 3 + p["ph"])
            spr = star_sprite(64, p["warm"])
            sc = p["size"] / 64 * (0.6 + 0.4 * env) * tw
            dt = t - p["t0"]
            blit(frame, spr, p["x"] + p["vx"] * dt, p["y"] + p["vy"] * dt, scale=sc,
                 alpha=env * 0.95, angle=p["rot"] + 25 * dt, additive=True)


# ------------------------------------------------------------------ easing
def clamp01(x):
    return max(0.0, min(1.0, x))


def ease_out_back(x, k=1.7):
    x = clamp01(x) - 1
    return 1 + (k + 1) * x ** 3 + k * x ** 2


def ease_out(x):
    x = clamp01(x)
    return 1 - (1 - x) ** 3


def ease_in_out(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)
