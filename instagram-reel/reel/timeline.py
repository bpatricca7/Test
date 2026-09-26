"""Turn the EDL in config.py into an output timeline (build/timeline.json).

* Segments are laid end to end. Segments that open a musical section get the
  pause before them stretched so their anchor word lands on the beat grid.
* Caption words are aligned to the ASR words and mapped onto the timeline.
"""
import copy, difflib, json, math, os, re
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
import config as C

EMOJI_RE = re.compile(r"[\U0001F000-\U0001FFFF☀-➿⭐️‍]+")
_env_cache = {}


def energy(clip):
    """5 ms speech-band energy envelope (dB) of a clip."""
    if clip not in _env_cache:
        y, sr = sf.read(C.voice_wav(clip))
        m = sosfilt(butter(4, [100, 8000], btype="band", fs=sr, output="sos"), y if y.ndim == 1 else y.mean(1))
        hop = sr // 200
        n = len(m) // hop
        db = 20 * np.log10(np.sqrt((m[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
        _env_cache[clip] = (db, np.percentile(db, 90))
    return _env_cache[clip]


def speech_onset(clip, t):
    db, p90 = energy(clip)
    i = int(t * 200)
    while i < len(db) and db[i] < p90 - 22:
        i += 1
    return i / 200


def word_onset(clip, s):
    """Refine an ASR word start: snap to a silence->speech edge near it if there is one."""
    db, p90 = energy(clip)
    thr = p90 - 22
    lo, hi = max(0, int((s - 0.16) * 200)), max(0, int((s - 0.04) * 200))
    if hi > lo and (db[lo:hi] < thr).all():      # a real pause precedes this word
        i = hi
        while i < min(len(db), int((s + 0.2) * 200)) and db[i] < thr:
            i += 1
        return i / 200
    return max(0.0, s - 0.02)


def speech_end(clip, t):
    """Last speech sample at or before t."""
    db, p90 = energy(clip)
    i = min(int(t * 200), len(db) - 1)
    while i > 0 and db[i] < p90 - 22:
        i -= 1
    return (i + 1) / 200


def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())


def align_words(clip, words_asr):
    """Map caption words (from CAPTIONS) onto ASR word timings."""
    chunks = []
    for raw in C.CAPTIONS[clip].split("|"):
        emo = "".join(EMOJI_RE.findall(raw))
        text = EMOJI_RE.sub("", raw).strip()
        chunks.append({"words": text.split(), "emoji": emo})
    cap = [w for ch in chunks for w in ch["words"]]
    asr = [w["w"] for w in words_asr]
    sm = difflib.SequenceMatcher(None, [norm(w) for w in cap], [norm(w) for w in asr], autojunk=False)
    idx = [None] * len(cap)
    for tag, a0, a1, b0, b1 in sm.get_opcodes():
        if tag in ("equal", "replace"):
            # unequal replacements ("mom of three" vs "Mama 3") map proportionally
            for k in range(a1 - a0):
                idx[a0 + k] = b0 + (k * (b1 - b0)) // (a1 - a0)
    starts = [words_asr[j]["s"] if j is not None else None for j in idx]
    ends = [words_asr[j]["e"] if j is not None else None for j in idx]
    # interpolate anything the aligner could not pair
    for k in range(len(cap)):
        if starts[k] is None:
            prev = next((starts[j] for j in range(k - 1, -1, -1) if starts[j] is not None), 0.0)
            nxt = next((starts[j] for j in range(k + 1, len(cap)) if starts[j] is not None), prev + 0.3)
            starts[k] = (prev + nxt) / 2
            ends[k] = nxt
    out, n = [], 0
    for ch in chunks:
        ws = []
        for w in ch["words"]:
            ws.append({"w": w, "s": starts[n], "e": ends[n]})
            n += 1
        out.append({"emoji": ch["emoji"], "words": ws})
    return out


def build():
    words = json.load(open(os.path.join(C.BUILD, "words.json")))
    faces = json.load(open(os.path.join(C.BUILD, "faces.json")))
    segs = copy.deepcopy(C.SEGMENTS)
    captions = {c: align_words(c, words[c]["words"]) for c in C.CAPTIONS}

    def word_time(clip, word):
        for ch in captions[clip]:
            for w in ch["words"]:
                if norm(w["w"]) == norm(word):
                    return word_onset(clip, w["s"])
        raise KeyError(word)

    # --- lay out segments, stretching pauses before beat-snapped sections ---
    t = 0.0
    sections = []
    for k, s in enumerate(segs):
        if s.get("snap") and k > 0:
            p = segs[k - 1]
            if s.get("anchor"):
                # anchor word may sit in a later segment: offset = durations until it
                off, j = 0.0, k
                while True:
                    sj = segs[j]
                    if sj["clip"] in captions and any(norm(w["w"]) == norm(s["anchor"]) for ch in captions[sj["clip"]] for w in ch["words"]):
                        wt = word_time(sj["clip"], s["anchor"])
                        if sj["i"] <= wt < sj["o"]:
                            off += wt - sj["i"]
                            break
                    off += sj["o"] - sj["i"]
                    j += 1
            else:
                off = speech_onset(s["clip"], s["i"]) - s["i"]
            pause = (p["o"] - speech_end(p["clip"], p["o"])) + (speech_onset(s["clip"], s["i"]) - s["i"])
            grid = C.BEAT if s["snap"] == "beat" else C.BEAT / 2
            anchor = t + off + max(0.0, s.get("min_pause", C.MIN_SECTION_PAUSE) - pause)
            target = math.ceil(anchor / grid - 1e-6) * grid
            delta = target - (t + off)
            p["o"] += delta
            p["tl1"] += delta
            t += delta
            s["anchor_tl"] = target
        s["tl0"] = t
        t += s["o"] - s["i"]
        s["tl1"] = t
        if s.get("section"):
            sections.append({"name": s["section"], "t": s.get("anchor_tl", s["tl0"]), "seg": k})

    # quantise every boundary to the frame grid (audio and video cut together)
    def q(x):
        return round(x * C.FPS) / C.FPS
    # segments that continue straight on from the previous one stay sample-continuous
    for a, b in zip(segs, segs[1:]):
        b["cont"] = a["clip"] == b["clip"] and abs(a["o"] - b["i"]) < 1e-6
    for k, s in enumerate(segs):
        s["tl0"], s["tl1"] = q(s["tl0"]), q(s["tl1"])
        if s.get("cont"):
            s["i"] = segs[k - 1]["o"]
        s["o"] = s["i"] + (s["tl1"] - s["tl0"])
    for a, b in zip(segs, segs[1:]):
        assert abs(a["tl1"] - b["tl0"]) < 1e-9

    def to_tl(clip, ct, prefer="next"):
        """clip time -> timeline time (None if the clip time was cut)."""
        best = None
        for s in segs:
            if s["clip"] == clip:
                if s["i"] - 1e-6 <= ct < s["o"]:
                    return s["tl0"] + ct - s["i"]
                if prefer == "next" and ct < s["i"] and (best is None or s["i"] < best["i"]):
                    best = s
        return best["tl0"] if best else None

    chunks = []
    for clip, chs in captions.items():
        for ch in chs:
            ws = []
            for w in ch["words"]:
                st = to_tl(clip, word_onset(clip, w["s"]))
                ws.append({"w": w["w"], "t": st})
            if all(w["t"] is not None for w in ws):
                chunks.append({"clip": clip, "emoji": ch["emoji"], "words": ws})
    chunks.sort(key=lambda c: c["words"][0]["t"])
    for a, b in zip(chunks, chunks[1:]):
        a["end"] = b["words"][0]["t"]

    reveal = next(s["anchor_tl"] for s in segs if s.get("anchor"))
    freeze = segs[-1]["tl1"]
    final_chord = reveal + 6 * C.BEAT
    total = q(final_chord + C.END_TAIL)
    chunks[-1]["end"] = freeze

    def chunk_word_t(clip, word):
        for c in chunks:
            if c["clip"] == clip:
                for w in c["words"]:
                    if norm(w["w"]) == norm(word):
                        return w["t"]
        raise KeyError(word)

    # framing: the face median over each shot (or the whole clip)
    for s in segs:
        f = faces[s["clip"]]
        tr = [r for r in f.get("track", []) if s["i"] * C.FPS <= r[0] < s["o"] * C.FPS]
        if C.FACE_MODE == "segment" and len(tr) >= 3:
            a = np.median(np.array(tr)[:, 1:], axis=0)
            s["face"] = {"cx": float(a[0]), "cy": float(a[1]), "w": float(a[2])}
        else:
            s["face"] = {k: f[k] for k in ("cx", "cy", "w")}

    name_clip = C.NAME_CLIP
    seg_name = [s for s in segs if s["clip"] == name_clip]
    k_list = next(k for k, s in enumerate(segs) if s.get("section") == "list")
    k_punch = next(k for k in range(k_list, len(segs)) if segs[k].get("punch"))
    p = segs[k_punch]
    events = {
        "name_in": chunk_word_t(name_clip, C.NAME_WORD),
        "name_out": seg_name[-1]["tl1"],
        "name_clip_in": seg_name[0]["tl0"],
        "tags": [chunk_word_t(name_clip, w) for _, w in C.NAME_TAGS],
        "list_header_in": segs[k_list]["tl0"] + 0.15,
        "list_header_out": p["tl0"],
        "tada": p["tl0"] + speech_end(p["clip"], p["o"]) - p["i"] + 0.05,
        "reveal": reveal,
        "freeze": freeze,
        "final_chord": final_chord,
        "punches": [s["tl0"] for s in segs if s.get("punch")],
        "stop": next(s["tl0"] for s in segs if s.get("section") == "stop"),
    }
    tl = {"fps": C.FPS, "bpm": C.BPM, "total": total, "segments": segs, "sections": sections,
          "chunks": chunks, "events": events, "faces": faces}
    json.dump(tl, open(os.path.join(C.BUILD, "timeline.json"), "w"), indent=1, ensure_ascii=False)
    return tl


if __name__ == "__main__":
    tl = build()
    for s in tl["segments"]:
        print(f'{s["tl0"]:6.2f}-{s["tl1"]:6.2f}  {s["clip"]} {s["i"]:.2f}-{s["o"]:.2f}  z={s["zoom"]}  {s.get("section", "")}')
    print("sections", [(x["name"], round(x["t"], 3), round(x["t"] / C.BEAT, 2)) for x in tl["sections"]])
    print("events", json.dumps(tl["events"], indent=None))
    print("total", tl["total"])
    for c in tl["chunks"]:
        print(f'{c["words"][0]["t"]:6.2f}-{c["end"]:6.2f} ', " ".join(f'{w["w"]}@{w["t"]:.2f}' for w in c["words"]), c["emoji"])
