"""QA helper: transcribe the generated voice lines with Whisper (sherpa-onnx) to confirm they are intelligible."""
import json, os, sys
import librosa, sherpa_onnx
M = os.environ.get("WHISPER_DIR", "/tmp/claude-0/models/sherpa-onnx-whisper-base.en")
HERE = os.path.dirname(os.path.abspath(__file__))
rec = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=f"{M}/base.en-encoder.int8.onnx", decoder=f"{M}/base.en-decoder.int8.onnx",
    tokens=f"{M}/base.en-tokens.txt", num_threads=4)
script = json.load(open(os.path.join(HERE, "..", "src", "story", "script.json")))
for line in script["lines"]:
    if len(sys.argv) > 1 and line["id"] not in sys.argv[1:]:
        continue
    y, _ = librosa.load(os.path.join(HERE, "build", "voices", line["id"] + ".wav"), sr=16000)
    s = rec.create_stream(); s.accept_waveform(16000, y); rec.decode_stream(s)
    print(f'{line["id"]}  want: {line["text"]}\n      got:  {s.result.text.strip()}')
