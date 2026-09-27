"""Render the reel: grade -> reframe/punch-ins -> captions, name card, list
header, sparkles -> end card. Pipes frames to ffmpeg with the finished mix.

  python3 render.py                 # full render -> out/<name>.mp4
  python3 render.py --stills 1,9.4  # QA stills -> out/stills/
"""
import argparse, json, os, subprocess
from functools import lru_cache
import numpy as np, cv2
from PIL import Image
import config as C
import gfx
from gfx import blit, pil_to_rgba, text_sprite, font, rounded_pill, emoji, split_emoji
from gfx import ease_out_back, ease_out, ease_in_out, clamp01

W, H, FPS = C.W, C.H, C.FPS
OUT_NAME = C.OUT_NAME
CAP_Y = C.CAP_Y
CAP_MAX_W = 960
EMPHASIS = {"disney", "chelsea", "packs", "magic", "beignets"}

TL = json.load(open(os.path.join(C.BUILD, "timeline.json")))
EV = TL["events"]
SEGS = TL["segments"]
TOTAL_FRAMES = round(TL["total"] * FPS)


# ------------------------------------------------------------------ source frames
class Frames:
    def __init__(self):
        self.cache = {}

    def get(self, clip, idx):
        if clip not in self.cache:
            self.cache = {}  # segments are in clip order; keep one clip in memory
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", os.path.join(C.FOOTAGE, clip + ".mov"),
                   "-vf", "fps=30,scale=in_color_matrix=bt709:in_range=tv,format=bgr24", "-f", "rawvideo", "-"]
            raw = subprocess.run(cmd, check=True, capture_output=True).stdout
            self.cache[clip] = np.frombuffer(raw, np.uint8).reshape(-1, C.SRC_H, C.SRC_W, 3)
        fr = self.cache[clip]
        return fr[min(max(idx, 0), len(fr) - 1)]


# ------------------------------------------------------------------ look
def _grade_lut():
    x = np.arange(256) / 255.0
    s = x * x * (3 - 2 * x)
    curve = 0.84 * x + 0.16 * s                          # gentle S-curve
    b = np.clip(curve * 0.975, 0, 1)                     # a touch warmer
    r = np.clip(curve * 1.02, 0, 1)
    return (np.stack([b, curve, r], 1) * 255).round().astype(np.uint8)[:, None, :]


LUT = _grade_lut()
_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.20 * (((_xx - W / 2) / (W / 2)) ** 2 + ((_yy - H * 0.45) / (H / 2)) ** 2) ** 1.4).clip(0.6, 1)[..., None]
del _yy, _xx


def grade(img):
    f = cv2.LUT(img, LUT).astype(np.float32)
    mx, mn = f.max(2), f.min(2)
    sat = (mx - mn) / (mx + 1.0)
    gray = f[..., 0] * 0.114 + f[..., 1] * 0.587 + f[..., 2] * 0.299
    k = (1 + 0.16 * (1 - sat))[..., None]                # vibrance: lift the muted colours most
    return np.clip(gray[..., None] + (f - gray[..., None]) * k, 0, 255)


def camera(seg, tl_t):
    """Zoom and crop origin (source px) for a timeline time inside seg."""
    dur = seg["tl1"] - seg["tl0"]
    u = (tl_t - seg["tl0"]) / dur
    z0 = seg["zoom"]
    z1 = seg.get("push", z0 * 1.025)                     # every shot drifts in a little
    z = z0 + (z1 - z0) * u
    if tl_t >= EV["freeze"]:                             # keep pushing on the end card
        z = z1 + 0.03 * (tl_t - EV["freeze"]) / 2.5
    if seg.get("punch"):
        z *= 1 + 0.045 * (1 - ease_out((tl_t - seg["tl0"]) / 0.22))
    face = seg["face"]
    s = 1.5 * z
    w, h = C.SRC_W / z, C.SRC_H / z
    x0 = min(max(face["cx"] - w / 2, 0), C.SRC_W - w)
    pref = C.TOP_HEADROOM if z0 <= 1.15 else max(C.TOP_HEADROOM, C.PUNCH_HEADROOM)
    chin = face["cy"] + (C.CHIN_PX if C.CHIN_PX is not None else C.CHIN_RATIO * face["w"])
    y0 = max((C.SRC_H - h) * pref, chin - (C.CAPTION_TOP - 40) / s)
    y0 = min(max(y0, 0), C.SRC_H - h)
    return s, x0, y0


def base_frame(frames, t):
    k = next((i for i, s in enumerate(SEGS) if s["tl0"] <= t < s["tl1"]), len(SEGS) - 1)
    seg = SEGS[k]
    st = min(t, seg["tl1"] - 1 / FPS)                    # freeze on the last frame
    src_t = seg["i"] + (st - seg["tl0"])
    img = grade(frames.get(seg["clip"], round(src_t * FPS)))
    s, x0, y0 = camera(seg, t)
    M = np.float32([[s, 0, -s * x0], [0, s, -s * y0]])
    f = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    blur = cv2.GaussianBlur(f, (0, 0), 1.2)
    f = f + 0.45 * (f - blur)                            # recover crispness after the upscale
    return f * VIGNETTE


# ------------------------------------------------------------------ captions
CAP_FONT_NAME = "Poppins-ExtraBold.ttf"


def _layout(ci):
    ch = TL["chunks"][ci]
    words = [w["w"] for w in ch["words"]]
    emo = split_emoji(ch["emoji"])
    size = 76
    while True:
        f = font(CAP_FONT_NAME, size)
        sp = f.getlength(" ") + 12      # room for the highlight pill
        ws = [f.getlength(w) for w in words]
        esz = int(size * 1.1)
        tot = sum(ws) + sp * (len(ws) - 1) + (len(emo) * (esz + 8) + 10 if emo else 0)
        if tot <= CAP_MAX_W or size <= 50:
            return f, size, sp, ws, emo, esz, tot
        size -= 2


@lru_cache(None)
def caption_sprite(ci, active):
    """Caption text with the active word on a red pill. Returns (sprite, text_w, emoji_x0, esz)."""
    ch = TL["chunks"][ci]
    f, size, sp, ws, emo, esz, tot = _layout(ci)
    pad, stroke = 40, 8
    asc, desc = f.getmetrics()
    text_w = sum(ws) + sp * (len(ws) - 1)
    Wc, Hc = int(tot) + 2 * pad + 40, asc + desc + 2 * pad
    base = Image.new("RGBA", (Wc, Hc), (0, 0, 0, 0))
    x = pad + 20
    boxes = []
    for i, (w, wl) in enumerate(zip(ch["words"], ws)):
        boxes.append((x, wl))
        x += wl + sp
    # active-word pill
    from PIL import ImageDraw, ImageFilter
    layer = Image.new("RGBA", (Wc, Hc), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if 0 <= active < len(boxes):
        bx, bw = boxes[active]
        top, bot = pad + int(asc * 0.18), pad + asc + int(desc * 0.45)
        d.rounded_rectangle([bx - 14, top - 6, bx + bw + 14, bot + 6], 18, fill=C.RED + (255,))
    for i, ((bx, bw), w) in enumerate(zip(boxes, ch["words"])):
        is_active = i == active
        emph = any(e in w["w"].lower() for e in EMPHASIS)
        fill = C.WHITE if is_active else (C.GOLD if emph else C.WHITE)
        d.text((bx, pad), w["w"], font=f, fill=fill + (255,),
               stroke_width=0 if is_active else stroke, stroke_fill=C.INK + (255,))
    # soft drop shadow under everything
    sh = Image.new("RGBA", (Wc, Hc), (0, 0, 0, 0))
    sh.putalpha(layer.getchannel("A").point(lambda v: int(v * 0.55)))
    sh = sh.filter(ImageFilter.GaussianBlur(9))
    base.alpha_composite(sh, (0, 6))
    base.alpha_composite(layer)
    return pil_to_rgba(base), text_w, pad + 20 + text_w + 18, esz


@lru_cache(None)
def emoji_sprite(e, size):
    im = emoji(e, size)
    return pil_to_rgba(im) if im is not None else None


def draw_captions(frame, t):
    if t >= EV["freeze"]:
        return
    if C.NAME_CARD == "lower" and EV["name_clip_in"] <= t < EV["name_out"]:
        return                                                   # the name card speaks for itself
    chunks = TL["chunks"]
    for ci, ch in enumerate(chunks):
        t_in = ch["words"][0]["t"] - 0.03
        t_out = ch["end"] - (0.03 if ci + 1 < len(chunks) else 0.0)   # hand over exactly when the next chunk comes in
        if not (t_in <= t < t_out):
            continue
        active = max(i for i, w in enumerate(ch["words"]) if w["t"] - 0.03 <= t or i == 0)
        spr, text_w, ex0, esz = caption_sprite(ci, active)
        if ci == 0 and t_in <= 0.0:
            sc, al = 1.0, 1.0                                    # frame 0 is the cover: show it
        else:
            u = (t - t_in) / 0.16
            sc, al = 0.82 + 0.18 * ease_out_back(u), clamp01((t - t_in) / 0.05)
        if t_out - t < 0.14 and ci == len(chunks) - 1:
            al *= clamp01((t_out - t) / 0.14)
        cx = W / 2
        blit(frame, spr, cx, CAP_Y, scale=sc, alpha=al)
        # emoji pop in on the last word
        emo = split_emoji(ch["emoji"])
        if emo:
            te = ch["words"][-1]["t"] - 0.05
            if t >= te:
                u = (t - te) / 0.25
                es = ease_out_back(u, 2.4)
                wig = 10 * np.sin((t - te) * 9) * np.exp(-(t - te) * 3)
                x = cx + (ex0 - spr.shape[1] / 2) * sc
                for k, e in enumerate(emo):
                    es_spr = emoji_sprite(e, esz)
                    if es_spr is not None:
                        blit(frame, es_spr, x + (k + 0.5) * (esz + 8) * sc, CAP_Y - 4, scale=sc * es, alpha=al, angle=wig)


# ------------------------------------------------------------------ titles
@lru_cache(None)
def script_title(text, size, shadow_offset):
    f = font("Pacifico-Regular.ttf", size)
    white = text_sprite(text, f, C.WHITE + (255,), shadow=(0, 8, 14, 0.5))
    red = text_sprite(text, f, C.RED + (255,))
    im = Image.new("RGBA", white.size, (0, 0, 0, 0))
    im.alpha_composite(red, shadow_offset)
    im.alpha_composite(white)
    return pil_to_rgba(im)


@lru_cache(None)
def pill(text, fnt_name, size, fill, color, emo=None, pad_x=30, pad_y=14):
    f = font(fnt_name, size)
    tw = f.getlength(text)
    asc, desc = f.getmetrics()
    esz = int(size * 1.15) if emo else 0
    w = int(tw + 2 * pad_x + (esz + 12 if emo else 0))
    h = int(asc + desc * 0.6 + 2 * pad_y)
    im = rounded_pill(w, h, h // 2, fill + (255,))
    from PIL import ImageDraw
    d = ImageDraw.Draw(im)
    x = 30 + pad_x
    if emo:
        e = emoji(emo, esz)
        if e is not None:
            im.alpha_composite(e, (int(x), int(30 + (h - esz) / 2)))
        x += esz + 12
    d.text((x, 30 + pad_y - desc * 0.15), text, font=f, fill=color + (255,))
    return pil_to_rgba(im)


def wipe(spr, u, soft=60):
    """Reveal a sprite left-to-right."""
    if u >= 1:
        return spr
    w = spr.shape[1]
    edge = -soft + (w + soft) * clamp01(u)
    ramp = np.clip((edge - np.arange(w)) / soft, 0, 1).astype(np.float32)
    out = spr.copy()
    out[..., 3] *= ramp[None, :]
    return out


NAME_Y, TAG_Y = C.NAME_Y, C.TAG_Y


@lru_cache(None)
def hi_sprite():
    return pil_to_rgba(text_sprite("Hi, I'm", font("Poppins-ExtraBold.ttf", 46), C.WHITE + (255,),
                                   stroke=6, stroke_fill=C.INK + (255,), shadow=(0, 5, 9, 0.5)))


def draw_name_card(frame, t):
    t0, t1 = EV["name_in"] - 0.04, EV["name_out"]
    fade = clamp01((t1 - t) / 0.2)
    lift = (1 - fade) * -20
    if C.NAME_CARD == "lower" and EV["name_clip_in"] - 0.02 <= t < t1:
        v = (t - EV["name_clip_in"] + 0.02) / 0.25
        blit(frame, hi_sprite(), W / 2, NAME_Y - 122 + lift + 16 * (1 - ease_out(v)), alpha=clamp01(v * 2) * fade)
    if not (t0 <= t < t1):
        return
    spr = script_title(C.NAME, 150, (5, 7))
    u = (t - t0) / 0.45
    blit(frame, wipe(spr, u), W / 2, NAME_Y + lift, scale=0.94 + 0.06 * ease_out(u), alpha=fade)
    sprs = [pill(txt, "Poppins-SemiBold.ttf", 38, C.WHITE, C.RED) for txt, _ in C.NAME_TAGS]
    gap = 14
    widths = [s.shape[1] - 60 for s in sprs]
    x = W / 2 - (sum(widths) + gap * (len(widths) - 1)) / 2
    for spr_t, wdt, tt in zip(sprs, widths, EV["tags"]):
        if t >= tt - 0.04:
            v = (t - tt + 0.04) / 0.28
            blit(frame, spr_t, x + wdt / 2, TAG_Y + lift + 18 * (1 - ease_out(v)), scale=0.6 + 0.4 * ease_out_back(v, 2.2), alpha=clamp01(v * 3) * fade)
        x += wdt + gap


def draw_list_header(frame, t):
    t0, t1 = EV["list_header_in"], EV["list_header_out"]
    if not (t0 <= t < t1):
        return
    spr = pill(C.LIST_HEADER, "Poppins-ExtraBold.ttf", 40, C.RED, C.WHITE, emo="✨")
    u = (t - t0) / 0.3
    fade = clamp01((t1 - t) / 0.18)
    blit(frame, spr, W / 2, C.LIST_HEADER_Y - 10 * (1 - fade), scale=0.7 + 0.3 * ease_out_back(u, 2.0), alpha=clamp01(u * 3) * fade)


@lru_cache(None)
def end_texts():
    top = pil_to_rgba(text_sprite(C.BRAND_TOP, font("Poppins-SemiBold.ttf", 50), C.WHITE + (255,), spacing=3, shadow=(0, 5, 10, 0.55)))
    script = script_title(C.BRAND_SCRIPT, 210, (6, 9))
    bottom = pil_to_rgba(text_sprite(C.BRAND_BOTTOM, font("Poppins-Black.ttf", 80), C.GOLD + (255,), stroke=5,
                                     stroke_fill=C.INK + (255,), spacing=9, shadow=(0, 7, 12, 0.55)))
    follow = pill(C.FOLLOW_CTA, "Poppins-ExtraBold.ttf", 42, C.RED, C.WHITE, emo="✨", pad_x=34, pad_y=18)
    return top, script, bottom, follow


def end_card(frame, t):
    tf = EV["freeze"]
    if t < tf:
        return frame
    u = clamp01((t - tf) / 0.45)
    e = ease_in_out(u)
    if e > 0:
        blurred = cv2.GaussianBlur(frame, (0, 0), 1 + 13 * e)
        frame = blurred * (1 - 0.40 * e)
    top, script, bottom, follow = end_texts()
    bob = 4 * np.sin((t - tf) * 2.2)
    a = (t - tf - 0.05) / 0.35
    blit(frame, top, W / 2, 690 + 30 * (1 - ease_out(a)) + bob, alpha=clamp01(a * 2))
    b = (t - tf - 0.12) / 0.45
    blit(frame, script, W / 2, 858 + bob, scale=0.7 + 0.3 * ease_out_back(b, 1.6), alpha=clamp01(b * 3))
    c = (t - tf - 0.30) / 0.4
    blit(frame, bottom, W / 2, 1036 + 34 * (1 - ease_out(c)) + bob, alpha=clamp01(c * 2.5))
    d = (t - EV["final_chord"] + 0.02) / 0.3
    blit(frame, follow, W / 2, 1250, scale=0.6 + 0.4 * ease_out_back(d, 2.2), alpha=clamp01(d * 3))
    return frame


SPARKLES = gfx.Sparkles()
SPARKLES.burst(EV["name_in"] - 0.02, W / 2, NAME_Y, 320, 70, 16, seed=1)
SPARKLES.burst(EV["list_header_in"], W / 2, C.LIST_HEADER_Y, 260, 40, 8, seed=2, size=(14, 34))
SPARKLES.burst(EV["reveal"], W / 2, CAP_Y, 400, 70, 16, seed=3)
SPARKLES.burst(EV["freeze"] + 0.12, W / 2, 870, 430, 250, 34, seed=4, life=(0.9, 1.8))
SPARKLES.burst(EV["final_chord"], W / 2, 950, 480, 330, 34, seed=5, life=(0.9, 1.9), spread_t=0.5)


def render_frame(frames, t):
    f = base_frame(frames, t)
    f = end_card(f, t)
    draw_name_card(f, t)
    draw_list_header(f, t)
    draw_captions(f, t)
    SPARKLES.draw(f, t)
    return np.clip(f, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stills", default="")
    args = ap.parse_args()
    os.makedirs(C.OUT, exist_ok=True)
    frames = Frames()
    if args.stills:
        d = os.path.join(C.OUT, "stills")
        os.makedirs(d, exist_ok=True)
        for s in sorted(float(x) for x in args.stills.split(",")):
            cv2.imwrite(os.path.join(d, f"t{s:06.2f}.png"), render_frame(frames, s))
        return
    out = os.path.join(C.OUT, OUT_NAME + ".mp4")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-i", os.path.join(C.BUILD, "mix.wav"),
           "-map", "0:v", "-map", "1:a",
           "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
           "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-maxrate", "16M", "-bufsize", "32M",
           "-profile:v", "high", "-level", "4.2", "-g", "60",
           "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
           "-c:a", "aac", "-b:a", "320k", "-ar", "48000",
           "-map_metadata", "-1", "-movflags", "+faststart", "-shortest", out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    cover_t = EV["name_in"] + 0.9
    for i in range(TOTAL_FRAMES):
        t = i / FPS
        fr = render_frame(frames, t)
        p.stdin.write(fr.tobytes())
        if abs(t - cover_t) < 0.5 / FPS:
            cv2.imwrite(os.path.join(C.OUT, OUT_NAME + "-cover.jpg"), fr, [cv2.IMWRITE_JPEG_QUALITY, 94])
        if i % 150 == 0:
            print(f"frame {i}/{TOTAL_FRAMES}", flush=True)
    p.stdin.close()
    p.wait()
    print("wrote", out)


if __name__ == "__main__":
    main()
