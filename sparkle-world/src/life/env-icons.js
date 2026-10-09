// Colorful little SVG icons for the time of day and the weather (24x24 viewBox, the same
// <svg class="sw-icon"> shape as src/ui/icons.js so they drop into pills and buttons).

const wrap = (body) => `<svg class="sw-icon sw-env-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

/** n ray strokes around (cx, cy); a full circle, or spread evenly over the arc from..to. */
function rays(cx, cy, r0, r1, n, color, width = 2.2, from = null, to = null) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = from === null ? ((i + 0.5) / n) * Math.PI * 2 : from + ((to - from) * i) / (n - 1);
    d += `M${(cx + Math.cos(a) * r0).toFixed(2)} ${(cy + Math.sin(a) * r0).toFixed(2)}L${(cx + Math.cos(a) * r1).toFixed(2)} ${(cy + Math.sin(a) * r1).toFixed(2)}`;
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
}

const SUN = rays(12, 12, 7.4, 10.4, 8, '#FFB31F') +
  '<circle cx="12" cy="12" r="5.6" fill="#FFD23F" stroke="#FFB31F" stroke-width="1.4"/>' +
  '<circle cx="10" cy="11.2" r=".8" fill="#8A5A2B"/><circle cx="14" cy="11.2" r=".8" fill="#8A5A2B"/>' +
  '<path d="M10.2 13.6q1.8 1.5 3.6 0" stroke="#8A5A2B" stroke-width="1" fill="none" stroke-linecap="round"/>';

const MOON = '<path d="M16.8 16.6A7.6 7.6 0 0 1 9.4 4.2a7.9 7.9 0 1 0 10.4 10.6 7.4 7.4 0 0 1-3 1.8Z" fill="#C3AEFF" stroke="#9C7BFF" stroke-width="1.3" stroke-linejoin="round"/>' +
  '<path d="M18.6 3.2l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7Z" fill="#FFD95A"/><circle cx="20.6" cy="9.4" r=".9" fill="#FFE78F"/>';

function halfSun(fill, stroke, ground) {
  return rays(12, 16, 7.4, 10.2, 5, stroke, 2.1, Math.PI * 1.1, Math.PI * 1.9) +
    `<path d="M5.6 16a6.4 6.4 0 0 1 12.8 0Z" fill="${fill}" stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M2.5 16.4h19" stroke="${ground}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M6 20h12" stroke="${ground}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
}

const DAWN = halfSun('#FFC98A', '#FF9F5A', '#FF8FB8');
const DUSK = halfSun('#FFA3B9', '#FF7FA0', '#A58BFF');

const CLOUD = (x = 0, y = 0, fill = '#FFFFFF', stroke = '#9EB0E6') =>
  `<path transform="translate(${x} ${y})" d="M6.6 19.4a3.9 3.9 0 0 1-.4-7.8 5.3 5.3 0 0 1 10.2-1.2 4.5 4.5 0 0 1 1.2 9Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/>`;

const SMALL_SUN = rays(16.5, 7.5, 4.6, 6.6, 7, '#FFB31F', 1.8) + '<circle cx="16.5" cy="7.5" r="3.6" fill="#FFD23F" stroke="#FFB31F" stroke-width="1.1"/>';
const SMALL_MOON = '<path d="M19.4 10.4a4.6 4.6 0 0 1-5.4-6.2 4.8 4.8 0 1 0 5.4 6.2Z" fill="#C3AEFF" stroke="#9C7BFF" stroke-width="1"/>';

const DROPS = '<path d="M8 20.6l-.9 2M12.4 20.6l-.9 2M16.8 20.6l-.9 2" stroke="#4FB5F5" stroke-width="2" stroke-linecap="round"/>';
const SPRINKLES = '<path d="M7.6 20.4l-.8 1.8" stroke="#FF6FB5" stroke-width="2" stroke-linecap="round"/><path d="M12 20.8l1 1.6" stroke="#3FD8B0" stroke-width="2" stroke-linecap="round"/><path d="M16.6 20.3l-.6 1.9" stroke="#FFC94D" stroke-width="2" stroke-linecap="round"/>';
const FLAKES = '<g stroke="#6CC6FF" stroke-width="1.4" stroke-linecap="round"><path d="M8 19.6v3.4M6.5 20.4l3 1.8M9.5 20.4l-3 1.8"/><path d="M16 19.6v3.4M14.5 20.4l3 1.8M17.5 20.4l-3 1.8"/></g>';

const RAINBOW = ['#FF8C8C', '#FFB86B', '#FFE066', '#8EE08A', '#7CCBFF', '#B69CFF']
  .map((c, i) => `<path d="M${2.5 + i * 1.5} 18.5a${9.5 - i * 1.5} ${9.5 - i * 1.5} 0 0 1 ${19 - i * 3} 0" stroke="${c}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`).join('') +
  '<path d="M3.2 20.6a2.4 2.4 0 0 1 .1-4.8 3.2 3.2 0 0 1 6-.4 2.6 2.6 0 0 1 .5 5.2Z" fill="#fff" stroke="#B7C3EE" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M19 3.4l.6 1.3 1.3.6-1.3.6-.6 1.3-.6-1.3-1.3-.6 1.3-.6Z" fill="#FFD95A"/>';

/** Icon for a time phase ('dawn'|'day'|'dusk'|'night') and weather kind. */
export function timeIcon(phase, weather = 'sunny', { sprinkles = false } = {}) {
  const night = phase === 'night';
  const behind = night ? SMALL_MOON : SMALL_SUN;
  switch (weather) {
    case 'cloudy': return wrap(behind + CLOUD(-1.2, 0));
    case 'rain': return wrap(behind + CLOUD(-1.2, -2.4) + (sprinkles ? SPRINKLES : DROPS));
    case 'snow': return wrap(behind + CLOUD(-1.2, -2.4) + FLAKES);
    case 'rainbow': if (!night) return wrap(RAINBOW); break;
    default: break;
  }
  return wrap(phase === 'dawn' ? DAWN : phase === 'dusk' ? DUSK : night ? MOON : SUN);
}

/** Big icons for weather buttons (settings weather wand). */
export function weatherIcon(kind, opts) {
  return timeIcon('day', kind === 'sunny' ? 'sunny' : kind, opts);
}

export const TIME_LABELS = { dawn: 'Sunrise', day: 'Daytime', dusk: 'Sunset', night: 'Night' };
