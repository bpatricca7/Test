// Non-reactive values the scene writes every frame (same pattern as clock.ts). The shell may read them
// (compass, scale bar: P2) but never subscribes to them.
export const bridge = { azimuth: 0, pxPerFoot: 0, fps: 0, transitioning: false };
