"""Per-clip analysis for the current project (REEL_PROJECT):
  * audio: camera track at 48 kHz (stereo) and 16 kHz (mono for ASR)
  * denoise (optional): DeepFilterNet on the dialogue -> <clip>.48k.dn.wav
  * word timestamps: Parakeet-TDT via sherpa-onnx -> words.json
  * face track: Haar-cascade face centre/width every 3rd frame -> faces.json
"""
import json, os, shutil, subprocess, tempfile
import numpy as np, soundfile as sf
import config as C

WAV = os.path.join(C.BUILD, "wav")


def ff(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def extract_audio(clips):
    os.makedirs(WAV, exist_ok=True)
    for c in clips:
        src = os.path.join(C.FOOTAGE, c + ".mov")
        for sr, ch, suffix in ((48000, 2, "48k"), (16000, 1, "16k")):
            out = os.path.join(WAV, f"{c}.{suffix}.wav")
            if not os.path.exists(out):
                # stream 0:a:0 is the AAC stereo track; the APAC spatial track is skipped
                ff("-i", src, "-map", "0:a:0", "-ac", str(ch), "-ar", str(sr), out)


def denoise(clips):
    exe = os.path.join(C.ASSETS, "bin", "deep-filter")
    for c in clips:
        out = os.path.join(WAV, f"{c}.48k.dn.wav")
        if os.path.exists(out):
            continue
        with tempfile.TemporaryDirectory() as tmp:
            mono = os.path.join(tmp, f"{c}.wav")
            ff("-i", os.path.join(WAV, f"{c}.48k.wav"), "-ac", "1", mono)
            subprocess.run([exe, "-D", "-a", str(C.DENOISE_ATTEN_DB), "-o", os.path.join(tmp, "dn"), mono],
                           check=True, capture_output=True)
            y, sr = sf.read(os.path.join(tmp, "dn", f"{c}.wav"))
            n = len(sf.read(mono)[0])
            sf.write(out, np.pad(y, (0, max(0, n - len(y))))[:n].astype(np.float32), sr, subtype="FLOAT")
        print(c, "denoised")


def transcribe(clips):
    import sherpa_onnx
    m = os.path.join(C.ASSETS, "models", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8")
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


def gray_frames(clip, scale=0.5):
    """CFR-30 grey frames, same indexing as the renderer."""
    w, h = int(C.SRC_W * scale), int(C.SRC_H * scale)
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", os.path.join(C.FOOTAGE, clip + ".mov"),
                          "-vf", f"fps=30,scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w)


def faces(clips):
    import cv2
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    out = {}
    for c in clips:
        fr = gray_frames(c, 1.0)
        track = []
        for i in range(0, len(fr), 3):
            f = casc.detectMultiScale(fr[i], 1.1, 5, minSize=(150, 150))
            if len(f):
                x, y, w, h = max(f, key=lambda r: r[2] * r[3])
                track.append([i, x + w / 2, y + h / 2, float(w)])
        p = np.median(np.array(track)[:, 1:], axis=0)
        out[c] = {"cx": float(p[0]), "cy": float(p[1]), "w": float(p[2]), "frames": len(fr),
                  "track": [[int(a), float(b), float(d), float(e)] for a, b, d, e in track]}
        print(c, "face", {k: round(v, 1) for k, v in out[c].items() if k in ("cx", "cy", "w")})
    return out


if __name__ == "__main__":
    os.makedirs(C.BUILD, exist_ok=True)
    clips = C.CLIPS
    extract_audio(clips)
    if C.DENOISE:
        denoise(clips)
    wp, fp = (os.path.join(C.BUILD, x) for x in ("words.json", "faces.json"))
    if not os.path.exists(wp):
        json.dump(transcribe(clips), open(wp, "w"), indent=1)
    if not os.path.exists(fp):
        json.dump(faces(clips), open(fp, "w"))
