"""QA: transcribe the final mix around each voice cue to make sure dialogue stays intelligible."""
import json, os, re
import numpy as np, soundfile as sf, librosa, sherpa_onnx
HERE = os.path.dirname(os.path.abspath(__file__))
M = os.environ.get("WHISPER_DIR", "/tmp/claude-0/models/sherpa-onnx-whisper-base.en")
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=f"{M}/base.en-encoder.int8.onnx", decoder=f"{M}/base.en-decoder.int8.onnx", tokens=f"{M}/base.en-tokens.txt", num_threads=4)
mix, sr = sf.read(os.path.join(HERE, 'build', 'soundtrack.wav'))
mono = mix.mean(axis=1)
cues = json.load(open(os.path.join(HERE, 'build', 'cues.json')))
dur = json.load(open(os.path.join(HERE, '..', 'src', 'story', 'voice_durations.json')))
script = {l['id']: l['text'] for l in json.load(open(os.path.join(HERE, '..', 'src', 'story', 'script.json')))['lines']}
norm = lambda s: re.sub(r'[^a-z ]', '', s.lower()).split()
bad = 0
for v in cues['voices']:
    a, b = int(v['t'] * sr), int((v['t'] + dur[v['id']] + 0.1) * sr)
    y = librosa.resample(mono[a:b].astype(np.float32), orig_sr=sr, target_sr=16000)
    s = rec.create_stream(); s.accept_waveform(16000, y); rec.decode_stream(s)
    got, want = norm(s.result.text), norm(script[v['id']])
    hit = sum(1 for w in want if w in got) / max(1, len(want))
    flag = '' if hit >= 0.6 else '  <-- CHECK'
    bad += hit < 0.6
    print(f"{v['id']} {hit:4.0%}  {s.result.text.strip()[:70]}{flag}")
print('lines needing attention:', bad)
