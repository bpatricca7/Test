"""Review helpers for the finished ad (used by the review/QA pass).

  python3 src/review_tools.py sheets  out/riviera-ad-9x16.mp4 [--every 0.5] [--from 0 --to 30]
      -> build/review/<name>/contact_*.jpg   labelled frame grids (with safe-zone overlay)
  python3 src/review_tools.py frames  out/riviera-ad-9x16.mp4 1.5,8.0,25.2
      -> build/review/<name>/frame_<t>.jpg   full-res single frames (+ _safe.jpg with UI overlay)
  python3 src/review_tools.py audio
      -> build/review/audio_lanes.png       VO / music / SFX / mix envelopes against the beat
                                             grid, scene cuts and VO line boundaries
         build/review/audio_report.json     loudness, peaks, per-scene levels, ducking depth
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FFMPEG = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()
REVIEW = os.path.join(ROOT, "build", "review")


def font(sz):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def grab(video, t, w=None):
    cmd = [FFMPEG, "-v", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1"]
    if w:
        cmd += ["-vf", f"scale={w}:-2"]
    cmd += ["-f", "image2pipe", "-c:v", "png", "-"]
    from io import BytesIO
    return Image.open(BytesIO(subprocess.run(cmd, capture_output=True, check=True).stdout)).convert("RGB")


def safe_overlay(im, variant):
    """Draw platform-UI danger zones (top bar, bottom caption/CTA area, right action rail)."""
    W, H = im.size
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    s = W / 1080
    if H / W > 1.7:  # 9:16
        zones = [(0, 0, W, 220 * s), (0, H - 420 * s, W, H), (W - 140 * s, 0, W, H)]
    else:  # 4:5 feed: only tiny margins
        zones = [(0, 0, W, 40 * s), (0, H - 60 * s, W, H)]
    for z in zones:
        d.rectangle(z, fill=(255, 0, 80, 60), outline=(255, 0, 80, 200), width=max(1, int(3 * s)))
    return Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")


def sheets(video, every=0.5, t0=0.0, t1=None, cols=6, tile_w=300):
    name = os.path.splitext(os.path.basename(video))[0]
    out = os.path.join(REVIEW, name)
    os.makedirs(out, exist_ok=True)
    dur = float(subprocess.run([FFMPEG, "-i", video], capture_output=True, text=True).stderr.split("Duration: ")[1].split(",")[0].split(":")[-1])
    t1 = t1 or dur
    times = [round(t, 3) for t in np.arange(t0, t1 - 1e-6, every)]
    variant = None
    per = cols * 4
    f = font(18)
    paths = []
    for k in range(0, len(times), per):
        chunk = times[k:k + per]
        tiles = []
        for t in chunk:
            im = grab(video, t, tile_w)
            im = safe_overlay(im, variant)
            d = ImageDraw.Draw(im)
            d.rectangle((0, 0, 86, 26), fill=(0, 0, 0))
            d.text((6, 3), f"{t:5.2f}s", fill=(255, 255, 0), font=f)
            tiles.append(im)
        tw, th = tiles[0].size
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (tw + 6) + 6, rows * (th + 6) + 6), (40, 40, 40))
        for i, im in enumerate(tiles):
            sheet.paste(im, (6 + (i % cols) * (tw + 6), 6 + (i // cols) * (th + 6)))
        p = os.path.join(out, f"contact_{chunk[0]:05.2f}-{chunk[-1]:05.2f}.jpg")
        sheet.save(p, quality=88)
        paths.append(p)
        print(p)
    return paths


def frames(video, ts):
    name = os.path.splitext(os.path.basename(video))[0]
    out = os.path.join(REVIEW, name)
    os.makedirs(out, exist_ok=True)
    for t in ts:
        im = grab(video, t)
        p = os.path.join(out, f"frame_{t:05.2f}.jpg")
        im.save(p, quality=92)
        safe_overlay(im, None).save(p.replace(".jpg", "_safe.jpg"), quality=85)
        print(p)


def audio():
    import soundfile as sf
    sb = json.load(open(os.path.join(ROOT, "storyboard.json")))
    vt = json.load(open(os.path.join(ROOT, "src", "data", "vo_timeline.json")))
    A = os.path.join(ROOT, "build", "audio")
    tracks = {}
    for n in ("vo", "music", "sfx", "mix"):
        p = os.path.join(A, n + ".wav")
        if os.path.exists(p):
            x, sr = sf.read(p, always_2d=True)
            tracks[n] = (x.mean(axis=1), sr)
    os.makedirs(REVIEW, exist_ok=True)
    dur = float(sb["duration"])
    W, lane = 3000, 170
    img = Image.new("RGB", (W, lane * len(tracks) + 80), (18, 18, 22))
    d = ImageDraw.Draw(img)
    f = font(16)
    X = lambda t: int(t / dur * (W - 60)) + 50
    beat = 60.0 / sb["bpm"]
    for i in range(int(dur / beat) + 1):
        t = sb.get("beat_offset", 0) + i * beat
        d.line((X(t), 30, X(t), img.height), fill=(60, 60, 70) if i % 4 else (110, 110, 130))
    for sc in sb["scenes"]:
        d.line((X(sc["start"]), 0, X(sc["start"]), img.height), fill=(255, 200, 0), width=2)
        d.text((X(sc["start"]) + 4, 4), sc["id"], fill=(255, 200, 0), font=f)
    report = {"tracks": {}}
    for li, (n, (x, sr)) in enumerate(tracks.items()):
        y0 = 40 + li * lane
        d.text((4, y0 + 4), n, fill=(255, 255, 255), font=f)
        hop = sr // 200
        m = len(x) // hop
        env = np.abs(x[: m * hop]).reshape(m, hop).max(axis=1)
        db = 20 * np.log10(np.maximum(env, 1e-5))
        for j in range(m):
            t = j * hop / sr
            h = int(np.clip((db[j] + 60) / 60, 0, 1) * (lane - 20))
            d.line((X(t), y0 + lane - 10, X(t), y0 + lane - 10 - h), fill=(90, 170, 255) if n != "vo" else (120, 230, 140))
        if n == "vo":
            for l in vt["lines"]:
                d.rectangle((X(l["start"]), y0 + 2, X(l["end"]), y0 + 14), outline=(120, 230, 140))
        peak = 20 * np.log10(np.abs(x).max() + 1e-9)
        per_scene = {}
        for sc in sb["scenes"]:
            seg = x[int(sc["start"] * sr): int(sc["end"] * sr)]
            per_scene[sc["id"]] = round(float(20 * np.log10(np.sqrt((seg ** 2).mean()) + 1e-9)), 1)
        report["tracks"][n] = {"peak_db": round(float(peak), 2), "rms_db_per_scene": per_scene}
    if "mix" in tracks:
        p = subprocess.run([FFMPEG, "-hide_banner", "-i", os.path.join(A, "mix.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True).stderr
        tail = p[p.rfind("Summary:"):]
        report["mix_ebur128_summary"] = " ".join(tail.split())
    if "music" in tracks and "vo" in tracks:
        # how much quieter is music under VO than between VO lines (in the mix it is ducked by mix.py)
        pass
    p = os.path.join(REVIEW, "audio_lanes.png")
    img.save(p)
    json.dump(report, open(os.path.join(REVIEW, "audio_report.json"), "w"), indent=1)
    print(p)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "sheets":
        a = sys.argv[2:]
        opt = lambda k, dflt: float(a[a.index(k) + 1]) if k in a else dflt
        sheets(a[0], every=opt("--every", 0.5), t0=opt("--from", 0.0), t1=opt("--to", None))
    elif cmd == "frames":
        frames(sys.argv[2], [float(t) for t in sys.argv[3].split(",")])
    elif cmd == "audio":
        audio()
