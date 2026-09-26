// Web Worker: generates the LM's procedural material maps off the main thread (see texgen.js).
import { generate } from './texgen.js';

self.onmessage = (e) => {
  const { id, kind, size, seed } = e.data;
  const res = generate(kind, size, seed);
  self.postMessage({ id, res }, Object.values(res).map((a) => a.buffer));
};
