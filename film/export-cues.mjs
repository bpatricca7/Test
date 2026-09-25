// Writes audio/build/cues.json (voice + sound-effect timings) for the Python mixer.
import fs from 'fs';
import { SFX, VOICES, BEAT } from './src/story/cues.js';
fs.mkdirSync('audio/build', { recursive: true });
fs.writeFileSync('audio/build/cues.json', JSON.stringify({ end: BEAT.end, voices: VOICES, sfx: SFX }, null, 1));
console.log(`wrote audio/build/cues.json: ${VOICES.length} voice cues, ${SFX.length} sfx cues`);
