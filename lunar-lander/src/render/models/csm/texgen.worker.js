// Web Worker: generates the CSM's procedural skin atlases off the main thread (see texgen.js).
import { generate } from './texgen.js';

self.onmessage = (e) => {
  const { id, kind, opts } = e.data;
  try {
    const res = generate(kind, opts);
    self.postMessage({ id, res }, [res.albedo.buffer, res.orm.buffer, res.normal.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
