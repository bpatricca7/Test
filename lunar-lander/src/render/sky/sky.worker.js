// Worker: generates the Earth and Milky Way textures off the main thread (see skyGen.js).
// Loaded with Vite's inline-worker import so the single-file build works from file://.
import { prepareEarth, generateEarthRows, generateMilkyWayRows } from './skyGen.js';

self.onmessage = (e) => {
  const { kind, W, H } = e.data;
  if (kind === 'earth') {
    const prep = prepareEarth(W, H);
    const albedo = new Uint8Array(W * H * 4);
    const clouds = new Uint8Array(W * H * 4);
    generateEarthRows(prep, 0, H, albedo, clouds);
    self.postMessage({ kind, W, H, albedo, clouds }, [albedo.buffer, clouds.buffer]);
  } else if (kind === 'milkyway') {
    const data = new Uint8Array(W * H * 4);
    generateMilkyWayRows(W, H, 0, H, data);
    self.postMessage({ kind, W, H, data }, [data.buffer]);
  }
};
