// Terrain chunk worker. Imported by terrain.js with Vite's inline-worker syntax
// (`import ChunkWorker from './chunk.worker.js?worker&inline'`), so the single-file build keeps working.
import { generateChunk } from './chunkGen.js';

self.onmessage = (e) => {
  const req = e.data;
  try {
    const r = generateChunk(req);
    const transfer = [r.pos.buffer, r.morph.buffer, r.nrm.buffer, r.aux.buffer];
    if (r.boulders) transfer.push(r.boulders.buffer);
    self.postMessage(r, transfer);
  } catch (err) {
    self.postMessage({ key: req.key, error: String((err && err.stack) || err) });
  }
};
