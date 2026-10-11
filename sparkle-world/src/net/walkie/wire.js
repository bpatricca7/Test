// Walkie-talkie wire format (docs/MULTIPLAYER.md Addendum C). One pure module shared by the
// page (src/net/walkie/*) and the Railway relay (server/voice.mjs imports this file), so both
// sides read the same bytes and the same limits.
//
// Audio travels as BINARY WebSocket frames on the game's own socket:
//
//   byte 0     0x57 ('W'): audio frame, version 1
//   byte 1     flags: 1 = first frame of a press, 2 = last frame of a press
//   bytes 2-3  seq (uint16 little endian, per press, from 0)
//   bytes 4-5  ADPCM predictor at the frame start (int16 little endian)
//   byte 6     ADPCM step index at the frame start (0..88)
//   byte 7     0 (reserved; 16 kHz mono)
//   bytes 8..  IMA ADPCM, 4 bits per sample, low nibble first: (length - 8) * 2 samples
//
// Every frame carries its own decoder state, so a frame decodes on its own.
// Control travels as small JSON frames {t:'v', k, ...} on the same socket (never presence):
//
//   page -> server   {t:'v', k:'on', h:<host peer>}  my parent said yes: send me voices of
//                                                    my game (the server decides which game
//                                                    from the room's gate, not from h, and
//                                                    also needs my presence wk:1, the badge
//                                                    every player sees, to send me or relay me)
//                    {t:'v', k:'off'}                 no voices for me (and none from me)
//                    {t:'v', k:'req'}                 the button went down: may I talk?
//                    {t:'v', k:'end'}                 the button came up (if no last frame did)
//                    {t:'v', k:'mute', p:[peer...]}   I muted these friends for myself
//   server -> page   {t:'v', k:'hi', ok, talk}        answer to 'on' (ok: I am in the game)
//                    {t:'v', k:'go'}                  you may talk now (the floor is yours)
//                    {t:'v', k:'busy', by}            someone else is talking
//                    {t:'v', k:'no', why}             not now: off | group | quiet | muted | wait
//                                                     (off: no voice-on, or presence wk is not 1)
//                    {t:'v', k:'talk', by}            who talks now (null = nobody)
//                    {t:'v', k:'cut', why}            your press ended: cap | idle | quiet | muted | group

export const W = Object.freeze({
  MAGIC: 0x57,
  HEADER: 8,
  RATE: 16000,
  FRAME_SAMPLES: 1280, // 80 ms
  MAX_FRAME_SAMPLES: 2048, // 128 ms
  MAX_FRAME_BYTES: 8 + 1024,
  BURST_MS: 15000, // one press may talk at most 15 s
  BURST_SAMPLES: 15 * 16000,
  // server limits (server/voice.mjs)
  GRACE_MS: 1000, // network slack on top of BURST_MS before the server cuts
  FIRST_FRAME_MS: 3000, // the microphone may take this long to start after 'go'
  IDLE_MS: 1500, // a talker who sends no audio this long loses the floor
  ACTIVE_SAMPLES: 320, // a frame shorter than this (20 ms) is not "talking" for IDLE_MS / FIRST_FRAME_MS
  COOLDOWN_MS: 700, // the same talker may press again after this pause
  CUT_COOLDOWN_MS: 2500, // ... after a press the server cut (15 s cap, silence)
  PRIORITY_MS: 2500, // a friend who heard "busy" goes first: the last talker waits this long for her
  BYTES_PER_S: 12000, // per talker (a press needs about 8.1 KB/s)
  BYTES_BURST: 16000, // a busy tablet may send about 1.5 s of frames at once after a stall
  FRAMES_PER_S: 25, // a press needs 12.5 frames/s
  FRAMES_BURST: 24,
  // frames that are not relayed (bad header, no floor, over the rate) still cost the sender:
  // past this budget the server closes the connection (4008), like the JSON rate limit does
  JUNK_PER_S: 30,
  JUNK_BURST: 60,
  JUNK_BYTES_PER_S: 16000,
  JUNK_BYTES_BURST: 64000,
  MAX_MUTES: 8,
});

export const F_START = 1;
export const F_END = 2;

/** Peer ids are made by the server (sha256 hex, 16 characters); accept only that shape. */
export const PEER_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isPeerId = (v) => typeof v === 'string' && PEER_RE.test(v);

function asBytes(b) {
  if (b instanceof Uint8Array) return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return null;
}

/**
 * Read a frame header. Returns { flags, seq, pred, index, samples } or null when the bytes are
 * not a valid audio frame (wrong magic, too short, too long, odd reserved byte, bad index).
 */
export function readHeader(buf) {
  const b = asBytes(buf);
  if (!b || b.length < W.HEADER || b.length > W.MAX_FRAME_BYTES) return null;
  if (b[0] !== W.MAGIC || b[7] !== 0 || (b[1] & ~3) !== 0 || b[6] > 88) return null;
  let pred = b[4] | (b[5] << 8);
  if (pred & 0x8000) pred -= 0x10000;
  return { flags: b[1], seq: b[2] | (b[3] << 8), pred, index: b[6], samples: (b.length - W.HEADER) * 2 };
}

/** Build a frame: header + ADPCM bytes (Uint8Array). */
export function packFrame(flags, seq, pred, index, data) {
  const out = new Uint8Array(W.HEADER + data.length);
  out[0] = W.MAGIC;
  out[1] = flags & 3;
  out[2] = seq & 0xff;
  out[3] = (seq >> 8) & 0xff;
  const p = pred & 0xffff;
  out[4] = p & 0xff;
  out[5] = (p >> 8) & 0xff;
  out[6] = index;
  out[7] = 0;
  out.set(data, W.HEADER);
  return out;
}

/** The ADPCM bytes of a frame (a view, no copy). */
export function frameData(buf) {
  const b = asBytes(buf);
  return b.subarray(W.HEADER);
}
