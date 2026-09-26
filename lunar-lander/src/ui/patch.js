// Mission-patch motif (SVG, line art): a ring lettered "APOLLO 11 · COLUMBIA · EAGLE", the Earth
// low in a black sky, the lunar horizon and Eagle descending on its plume. Drawn with thin strokes
// so it sits quietly next to the title typography. Used on the title screen and the result card.

import { s } from './dom.js';

let uid = 0;

/**
 * @param {{size?: number, text?: string, className?: string}} opts
 * @returns {SVGSVGElement}
 */
export function createPatch({ size = 120, text = 'APOLLO 11 · COLUMBIA · EAGLE ·', className = 'patch' } = {}) {
  const id = `patch${++uid}`;
  const svg = s('svg', { viewBox: '0 0 100 100', width: size, height: size, class: className, 'aria-hidden': 'true' });
  const defs = s('defs', null,
    s('path', { id: `${id}-ring`, d: 'M 50 50 m -41 0 a 41 41 0 1 1 82 0 a 41 41 0 1 1 -82 0' }),
    s('clipPath', { id: `${id}-clip` }, s('circle', { cx: 50, cy: 50, r: 35.2 })),
    s('radialGradient', { id: `${id}-sky`, cx: '50%', cy: '35%', r: '65%' },
      s('stop', { offset: '0%', 'stop-color': '#10141c' }),
      s('stop', { offset: '100%', 'stop-color': '#020304' })),
    s('linearGradient', { id: `${id}-moon`, x1: '0', y1: '0', x2: '1', y2: '0.4' },
      s('stop', { offset: '0%', 'stop-color': '#2b2a28' }),
      s('stop', { offset: '100%', 'stop-color': '#8c8880' })),
    s('linearGradient', { id: `${id}-plume`, x1: '0', y1: '0', x2: '0', y2: '1' },
      s('stop', { offset: '0%', 'stop-color': '#ffd8a0', 'stop-opacity': '0.9' }),
      s('stop', { offset: '100%', 'stop-color': '#ffb347', 'stop-opacity': '0' })),
  );
  svg.appendChild(defs);

  // outer ring with lettering
  svg.appendChild(s('circle', { cx: 50, cy: 50, r: 48, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.55', 'stroke-width': '0.6' }));
  svg.appendChild(s('circle', { cx: 50, cy: 50, r: 36, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '0.8', 'stroke-width': '0.8' }));
  svg.appendChild(
    s('text', { class: 'patch-text', fill: 'currentColor', 'font-size': '6.4', 'letter-spacing': '1.55' },
      s('textPath', { href: `#${id}-ring`, startOffset: '0' }, text)),
  );

  // inner scene, clipped to the disc
  const g = s('g', { 'clip-path': `url(#${id}-clip)` });
  g.appendChild(s('rect', { x: 0, y: 0, width: 100, height: 100, fill: `url(#${id}-sky)` }));
  // a few stars
  for (const [x, y, r] of [[28, 30, 0.35], [36, 22, 0.25], [64, 24, 0.3], [73, 38, 0.25], [42, 40, 0.2], [58, 34, 0.2], [24, 45, 0.25]]) {
    g.appendChild(s('circle', { cx: x, cy: y, r, fill: '#fff', 'fill-opacity': '0.8' }));
  }
  // Earth: half-lit globe
  g.appendChild(s('circle', { cx: 68, cy: 30, r: 5.2, fill: '#0c1830' }));
  g.appendChild(s('path', { d: 'M 68 24.8 A 5.2 5.2 0 0 1 68 35.2 A 2.4 5.2 0 0 0 68 24.8 Z', fill: '#7fb2ff', 'fill-opacity': '0.95' }));
  // lunar horizon and a couple of craters
  g.appendChild(s('path', { d: 'M 0 74 Q 50 62 100 74 L 100 100 L 0 100 Z', fill: `url(#${id}-moon)` }));
  g.appendChild(s('ellipse', { cx: 34, cy: 76, rx: 5, ry: 1.3, fill: '#000', 'fill-opacity': '0.35' }));
  g.appendChild(s('ellipse', { cx: 70, cy: 79, rx: 3.4, ry: 0.9, fill: '#000', 'fill-opacity': '0.3' }));
  // descent plume
  g.appendChild(s('path', { d: 'M 48.6 60.5 L 51.4 60.5 L 54 70 L 46 70 Z', fill: `url(#${id}-plume)` }));
  // Eagle (front view): ascent stage, descent stage, legs, footpads, engine bell
  const lm = s('g', { fill: 'none', stroke: '#f2efe8', 'stroke-width': '0.9', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  lm.appendChild(s('path', { d: 'M 45.5 44 L 54.5 44 L 57 48.5 L 55.5 52 L 44.5 52 L 43 48.5 Z', fill: '#1a1c20' }));
  lm.appendChild(s('path', { d: 'M 47.5 47 L 49.2 49.5 M 52.5 47 L 50.8 49.5', 'stroke-width': '0.6' })); // windows
  lm.appendChild(s('path', { d: 'M 42 52 L 58 52 L 59 57.5 L 41 57.5 Z', fill: '#b08a3e', 'fill-opacity': '0.85' }));
  lm.appendChild(s('path', { d: 'M 48.6 57.5 L 51.4 57.5 L 52.2 60.5 L 47.8 60.5 Z' }));
  lm.appendChild(s('path', { d: 'M 42.5 55 L 35.5 63.5 M 57.5 55 L 64.5 63.5 M 43 57.5 L 37.5 62.5 M 57 57.5 L 62.5 62.5' }));
  lm.appendChild(s('path', { d: 'M 33.6 63.8 L 37.4 63.8 M 62.6 63.8 L 66.4 63.8', 'stroke-width': '1.3' }));
  g.appendChild(lm);
  svg.appendChild(g);
  return svg;
}
