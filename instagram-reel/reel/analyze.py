"""Extract audio, word timestamps (Parakeet-TDT via sherpa-onnx) and face
positions from every clip in footage/. Writes build/{wav/, words.json, faces.json}."""
import glob, json, os, subprocess
import numpy as np, soundfile as sf
from config import FOOTAGE, BUILD, ASSETS, FPS

WAV = os.path.join(BUILD, "wav")


def extract_audio(clips):
    os.makedirs(WAV, exist_ok=True)
    for c in clips:
        src = os.path.join(FOOTAGE, c + ".mov")
        for sr, ch, suffix in ((48000, 2, "48k"), (16000, 1, "16k")):
            out = os.path.join(WAV, f"{c}.{suffix}.wav")
            if not os.path.exists(out):
                # stream 0:a:0 is the AAC stereo track; the APAC spatial track is skipped
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
                                "-map", "0:a:0", "-ac", str(ch), "-ar", str(sr), out], check=True)


def transcribe(clips):
    import sherpa_onnx
    m = os.path.join(ASSETS, "models", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8")
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=f"{m}/encoder.int8.onnx", decoder=f"{m}/decoder.int8.onnx",
        joiner=f"{m}/joiner.int8.onnx", tokens=f"{m}/tokens.txt",
        num_threads=os.cpu_count(), model_type="nemo_transducer")
    out = {}
    for c in clips:
        y, sr = sf.read(os.path.join(WAV, f"{c}.16k.wav"), dtype="float32")
        s = rec.create_stream(); s.accept_waveform(sr, y); rec.decode_stream(s)
        r = s.result
        durs = list(getattr(r, "durations", []) or [])
        words = []
        for k, (tok, st) in enumerate(zip(r.tokens, r.timestamps)):
            d = durs[k] if k < len(durs) else 0.08
            if tok.startswith("▁") or tok.startswith(" ") or not words:
                words.append({"w": tok.lstrip("▁ "), "s": float(st), "e": float(st + d)})
            else:
                words[-1]["w"] += tok
                words[-1]["e"] = float(st + d)
        out[c] = {"text": r.text.strip(), "dur": len(y) / sr, "words": words}
        print(c, "|", r.text.strip())
    return out


def faces(clips):
    import cv2
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    out = {}
    for c in clips:
        cap = cv2.VideoCapture(os.path.join(FOOTAGE, c + ".mov"))
        pts, i = [], 0
        while True:
            ok, fr = cap.read()
            if not ok:
                break
            if i % 5 == 0:
                g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
                f = casc.detectMultiScale(g, 1.1, 5, minSize=(150, 150))
                if len(f):
                    x, y, w, h = max(f, key=lambda r: r[2] * r[3])
                    pts.append((x + w / 2, y + h / 2, w))
            i += 1
        p = np.median(np.array(pts), axis=0)
        out[c] = {"cx": float(p[0]), "cy": float(p[1]), "w": float(p[2]), "frames": i}
        print(c, "face", out[c])
    return out


if __name__ == "__main__":
    clips = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(FOOTAGE, "*.mov")))
    extract_audio(clips)
    wp, fp = os.path.join(BUILD, "words.json"), os.path.join(BUILD, "faces.json")
    if not os.path.exists(wp):
        json.dump(transcribe(clips), open(wp, "w"), indent=1)
    if not os.path.exists(fp):
        json.dump(faces(clips), open(fp, "w"), indent=1)
