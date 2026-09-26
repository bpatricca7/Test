// Procedural sky textures, generated off the main thread (sky.worker.js) or time-sliced as a fallback.
//
//   generateEarthRows(W, H, y0, y1, out)  Earth surface albedo (sRGB RGBA; A = water mask) and clouds
//   generateMilkyWayRows(W, H, y0, y1, out)  Milky Way surface brightness in galactic coordinates
//
// Pure functions of their arguments (no DOM, no three.js) so they run identically in a Worker.
// Owned by the SKY-FX agent.
//
// EARTH: equirectangular (u = longitude -180..180 E, v = latitude +90 at the top). Land is real
// geography: the continents are drawn from hand-digitised coastline polygons (~1-2 deg accuracy),
// roughened with domain-warped noise, and coloured by biome (deserts, rain forest, steppe, boreal
// forest, tundra, ice sheets, July sea ice). Clouds follow the July climatology: ITCZ north of the
// equator, clear subtropical highs and deserts, stratocumulus decks off California/Peru/Namibia, the
// Indian monsoon, mid-latitude storm tracks with spiral cyclones, the stormy Southern Ocean.
//
// MILKY WAY: equirectangular in galactic coordinates (u = l, centred on the Galactic Centre; v = b).
// Thin disc + bulge, the Great Rift and Coalsack, star-cloud mottling, the Magellanic Clouds and M31.

const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------------------ noise
function hash(ix, iy, iz) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 3D value noise in [0,1] with quintic interpolation. */
export function vnoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash(ix, iy, iz);
  const b = hash(ix + 1, iy, iz);
  const c = hash(ix, iy + 1, iz);
  const d = hash(ix + 1, iy + 1, iz);
  const e = hash(ix, iy, iz + 1);
  const f = hash(ix + 1, iy, iz + 1);
  const g = hash(ix, iy + 1, iz + 1);
  const h = hash(ix + 1, iy + 1, iz + 1);
  const k0 = a + (b - a) * ux;
  const k1 = c + (d - c) * ux;
  const k2 = e + (f - e) * ux;
  const k3 = g + (h - g) * ux;
  const l0 = k0 + (k1 - k0) * uy;
  const l1 = k2 + (k3 - k2) * uy;
  return l0 + (l1 - l0) * uz;
}

/** Fractal sum of value noise, result ~[0,1]. */
export function fbm(x, y, z, oct = 5, lac = 2.03, gain = 0.5) {
  let s = 0;
  let a = 0.5;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x, y, z);
    n += a;
    a *= gain;
    x = x * lac + 17.1;
    y = y * lac + 3.7;
    z = z * lac + 11.3;
  }
  return s / n;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------ geography
// Coastline polygons as flat [lon, lat, lon, lat, ...] (deg). Land first, then water bodies.
// prettier-ignore
const LAND = [
  // North America (mainland, Alaska to Panama)
  [-165,60,-162,55.5,-158,57,-152,59,-147,61,-140,60,-135,58,-131,54,-127,50,-124,46,-124,42,-121,36,-117.5,33,-117,32,-114.5,29,-112,26.5,-110,23,-110.5,24.5,-112.5,28.5,-114.5,31.5,-113,31.5,-111,28,-109,25.5,-106,23,-105,20,-100,17,-94,16,-92,14.5,-88,13.3,-86,11.5,-84,9.5,-80,7.5,-77.5,8.5,-79.5,9.5,-83,10,-83.5,14,-86,16,-88,15.8,-88.3,18.5,-87,21.5,-90.5,21,-91,19,-94,18.3,-96.5,19.5,-97.5,22,-97.5,26,-97,28,-94,29.6,-90,29.2,-88,30.5,-85,29.8,-83,29,-82.6,27.5,-81.8,25.5,-80.4,25.2,-80,27,-81.2,30,-81,32,-78,34,-76,35.5,-76.3,37,-75,38.5,-74,40.5,-70,41.5,-70.5,43,-67,44.5,-64,45.5,-61,45.5,-60,46.8,-64.5,48.5,-66.5,50,-60,50.2,-56,51.5,-56,53.5,-60,55.5,-62,58,-64.5,60,-70,61,-78,62.5,-85,66,-90,68.5,-96,68,-105,68,-115,68.8,-125,70,-135,69,-141,69.7,-156,71.2,-162,70,-166,68.5,-163,66,-168,65.5,-161,64.5,-165,62],
  // Canadian Arctic islands
  [-62,66.8,-68,62,-78,64.5,-73,67.5,-80,70,-90,72,-83,73.5,-72,71,-66,69],
  [-118,69,-101,68,-101,73,-117,73],
  [-90,76.5,-62,82,-72,83,-95,81],
  [-96,74,-80,74.5,-80,76,-96,76.3],
  [-125,72,-117,71,-116,74,-125,74.3],
  [-110,75,-100,75.5,-105,78,-115,77],
  // Greenland, Iceland
  [-73,78,-60,82,-30,83.5,-20,82,-18,77,-22,72,-24,69,-32,68,-40,65,-43,60,-48,61,-52,65,-54,69,-56,72.5,-66,76],
  [-24,65.5,-22,66.5,-15,66.5,-13.5,65,-18,63.4,-22.5,63.8],
  // Caribbean
  [-85,21.9,-82,23.1,-77,21.2,-74.1,20.2,-77.7,19.8,-81,21.6],
  [-74.5,19.8,-70,19.9,-68.3,18.6,-71.5,17.6,-74.4,18.2],
  [-78.3,18.4,-76.2,18.4,-76.8,17.8],
  [-67.2,18.5,-65.6,18.4,-65.8,18,-67.2,18],
  // South America
  [-77.5,8.5,-75.5,10.8,-72,12.3,-68,10.6,-62,10.7,-60,8.5,-57,6,-52,5,-50,1.5,-48,-1,-44,-2.5,-39,-3.5,-35,-5.5,-35,-9,-37,-12,-39,-17,-40,-20.5,-42,-23,-45,-24,-48.5,-26,-48.7,-28.5,-51,-31,-53.5,-34,-56.5,-34.8,-58.5,-34.5,-57,-37,-58,-38.8,-62,-39,-62.3,-41,-65,-41.5,-64.5,-43,-65.5,-45,-67.5,-46.5,-66,-48,-68.5,-50.5,-68.5,-52.3,-70,-53,-68,-54.8,-72,-54.5,-74.5,-52,-75.5,-48,-74,-44,-73.5,-40,-73.5,-37,-71.5,-33,-71.5,-28,-70.5,-23,-70.2,-18.5,-75,-15.5,-77,-12,-79.5,-7.5,-81.2,-5,-80,-2,-80.5,0.5,-78.5,2.5,-77.5,4,-77.2,7],
  // Eurasia
  [-9.3,43.2,-8.9,38.7,-8.9,37,-6,36.2,-5.6,36,-2,36.7,0,38.7,0.2,40,3.2,42,3,43.3,4.5,43.4,6.5,43.1,8.7,44.3,10.5,43.5,12.3,41.8,15.6,40,16,38,15.7,38.2,17,39,18.5,40.2,16,41.5,13.5,43.6,12.3,45.3,13.7,45.6,14.5,45.2,17.5,43,19.5,41.8,19.3,40,21,38.5,22,36.5,23,37.8,24,38.2,23,39.5,23.5,40.5,26,40.8,26.5,39.5,27.2,37.5,28.5,36.7,30.5,36.4,32.5,36.1,34.5,36.8,36,36.8,35.9,35.4,35,33,34.5,31.5,34.3,31.2,34.9,29.5,35,28,36.5,26,38,24,39,21.5,41,18,42.8,14.5,43.5,12.7,45,12.8,48,14,51,15.2,52.2,15.8,55,17.3,56.8,18.5,57.8,20.5,59.8,22.5,58.5,23.6,56.5,24.5,56.3,26.2,55.5,25.5,54,24.1,51.6,24.3,51.2,26.1,50.2,26,48.5,28.3,48,30,50,30.2,51,28,53.5,26.8,56,27,57.3,25.8,61.5,25.2,64.5,25.3,66.5,25.4,67.5,23.8,68.8,22.5,70.3,20.9,72.8,21,72.9,19,73.5,16,74.5,13,76,9.5,77.5,8.1,78.2,9,79.3,10.3,80.2,13.5,80.3,15.8,82.3,17,84.9,19.3,87,21.5,88.5,21.8,90.5,22.5,91.8,22.3,92.3,20.7,94,18.8,94.5,16.2,97.5,16.5,98,13.5,98.6,10,98.3,8,100.3,6.3,101,3,103.5,1.3,104.2,1.5,103.4,4.3,102.4,6.2,100.3,8.4,99.2,10.2,100,13.4,100.9,12.7,102.6,12.1,104.5,10.5,105,8.7,106.7,10.4,109,11.8,109.3,13.5,108.3,16,106.5,18,106.7,20.7,108,21.6,110.5,21,113.5,22.4,116.5,23,119.5,25.5,121.8,28,121.9,31,120.5,33.5,119.2,35,120.5,36.4,122.5,37.1,121,37.7,118.8,37.5,118,38.7,121,40.8,122.2,40.5,121.2,39,124.4,40,126,37.7,126.5,34.5,129.4,35.4,129.5,37,128.3,38.6,129.8,40.8,130.7,42.3,133,42.8,135.5,43.9,138.5,47,140.5,48.5,141,52,140,53.5,137,54,135.3,54.7,137.7,56.4,142,59.2,146,59.3,151,59.1,155,59.3,155.5,57,156.5,51,158.5,52.9,160,54.3,162,56.2,163,57.8,162,58.3,164,60,170,60,174.5,61.8,177.5,62.5,179.9,64.5,179.9,68.9,175,69.8,170,70,161,69.6,152,70.9,141,72.6,130,71,128,72.5,118,73.5,112,73.8,108,73.4,105,77.5,99,76.2,93,75.8,87,74.2,80,72.4,76,72.5,72.5,72.8,68.5,72.9,66.5,70.7,67.5,68.5,65,69.2,60,68.8,57,68.5,53.8,68.2,48,67.6,44,68.3,41,67,33,69.3,28.5,71,25.5,71.1,18.5,70,14.5,68.3,12.5,66,10.5,64.5,8.5,63.2,5.2,62,5.3,59.5,6.5,58.1,8.5,58.3,10.5,59.2,11.3,58.9,12,57.3,12.8,55.7,14.2,55.4,16,56.2,16.6,57.8,18.2,59.4,17.3,61,17.5,62.5,21,64.5,22.3,65.8,25.3,65.4,24.5,64.8,21.5,63,21.5,61,22.5,60,25.5,60.4,28.5,60.5,29.5,59.9,28,59.5,23.5,59.3,24,58.2,21.5,57,21,55.5,19.5,54.4,18.5,54.8,16,54.3,14,53.9,11,54,10.8,54.9,9.9,57.6,8.2,56.7,8.6,55,8.8,53.8,7,53.5,4.8,53,4,51.5,1.8,50.9,0,49.6,-1.5,49.6,-1.8,48.6,-4.7,48.5,-4.2,47.8,-2.2,47,-1.2,46,-1.5,43.5,-3.8,43.4,-8,43.7],
  // Mediterranean islands
  [12.4,38.1,15.6,38.3,15.1,36.7,12.8,37.6], [8.2,41,9.8,41.1,9.6,39.1,8.4,39], [8.6,42.9,9.5,43,9.4,41.4,8.7,41.7],
  [23.5,35.6,26.3,35.3,24.5,34.9], [32.3,35.1,34.6,35.7,33.9,34.6,32.5,34.7],
  // British Isles
  [-5.7,50.1,-3,50.6,1.4,51.2,1.7,52.7,0.2,53.5,-0.5,54.5,-1.6,55.6,-2.1,57.6,-3.3,58.6,-5,58.6,-5.7,57.5,-6.2,56.5,-5.5,55.3,-4.8,54.8,-3.2,54.1,-3,53.2,-4.7,52.8,-5.2,51.7,-3.3,51.4,-4.4,50.4],
  [-6,52.2,-6.2,54.2,-7.3,55.3,-8.5,54.4,-10,53.9,-9.7,51.5,-8.2,51.8],
  // Arctic islands of Eurasia
  [11,78.5,16,80,27,80,22,77.5,16,76.5], [52,71,56,73.5,63,76.5,68,77,60,75,56,71], [95,79,105,79,100,81], [135,75,150,75,142,76.5],
  // Japan, Sakhalin, Taiwan, Hainan, Sri Lanka
  [129.7,33.2,131.9,33.9,131.3,31.3,130.2,31.3],
  [131,34.3,135,33.5,137,34.6,139.8,35,140.9,36.8,141.9,39.5,141.5,41.4,140,40.7,139.8,38.5,137.3,37.5,136.7,37.3,135.5,35.6,132.7,35.5],
  [140,41.5,141.3,41.8,143.3,42,145.8,43.3,145,44.2,141.9,45.5,141.4,43.3,140,42.8],
  [132.5,34,134.6,34.2,134.3,33.2,133,32.8],
  [142,46,143.5,46.8,143.2,49.5,144.5,49,142.6,54.3,142,53.5,142.2,50],
  [120.1,23,121,25.3,121.9,24.9,120.8,22], [108.7,19.2,110,20.1,111,19.6,109.6,18.2], [79.8,8,80.2,9.8,81.9,7.4,80.6,5.9],
  // Philippines
  [120.6,18.5,122.3,18.5,122,16.4,124,13.8,121.6,13.9,120.6,14.5,119.8,16.4], [122,7,123.6,8.5,126.6,9.3,126.2,6.3,125.3,5.6,123.7,7.6], [122,10.8,125.5,11.5,125,9.9,122.8,9.2],
  // Indonesia, New Guinea
  [95.3,5.6,97.5,5.3,100.4,2.2,104,-1,106,-3.1,105.8,-5.8,104.5,-5.9,102.3,-4,100.3,-0.8,98.7,1.7],
  [105.2,-6.8,106,-5.9,108.5,-6.4,110.5,-6.8,112.6,-6.9,114.6,-7.7,114.4,-8.7,111,-8.2,108,-7.8,106.4,-7.4],
  [109,1.5,109.6,-1,110.2,-2.9,112,-3.4,114.5,-4,116.5,-2.5,116,0,117.9,1,118.7,5,117,7,116,6,115,4.9,113,3.2,111,1.8],
  [119.5,-5.5,120.5,-5.6,121,-3,123.3,-4.8,122.5,-1,125,1.5,124,0.8,120,0.5,119.8,-3],
  [131,-1,134,-0.9,138,-1.6,141,-2.6,145.8,-5.4,147.5,-6.1,148,-8,150.8,-10.3,147,-10.1,144,-7.8,141,-9.1,138.3,-8.3,137.8,-5.3,134.3,-4.1,132.8,-4.1,131.9,-2.8],
  [115,-8.8,119,-8.7,124,-8.3,127,-8.3,125,-9.5,123.5,-10.4,118.5,-9.2],
  // Australia, Tasmania, New Zealand
  [113.4,-22,114,-26.5,115,-29.5,115,-34,117.8,-35.1,120,-33.9,123.5,-33.9,126,-32.3,131,-31.5,134.2,-32.7,136,-34.8,137.8,-32.8,138,-35.6,140,-37.8,143.5,-38.8,146.3,-39.1,148.3,-37.8,150,-37.5,151.3,-33.8,153.1,-30.3,153.6,-28.2,153,-25.3,150.8,-22.6,149,-20.5,146.3,-19,145.3,-15,143.5,-14,142.5,-10.7,141.6,-12.8,141.6,-16.5,140.6,-17.5,139.3,-17.3,137.5,-16,135.5,-14.8,136.7,-12.2,133,-11.3,130.3,-12.2,129.5,-15,127,-13.8,125,-15.2,123.6,-17,122.2,-18.2,119,-20,116.7,-20.6],
  [144.6,-40.7,148.3,-40.9,148,-43.2,146,-43.6,145,-42.2],
  [172.7,-34.4,174.6,-36,175.9,-37.5,178.5,-37.7,177,-39.3,176.8,-40.2,175.2,-41.6,174.6,-39.8,173.8,-39.2,174.6,-37.8],
  [172.7,-40.5,174.3,-41.7,173,-43.9,171.2,-44.5,169,-46.6,166.5,-46,166.7,-45,168.4,-44,171,-42.5],
  // Africa, Madagascar
  [-5.9,35.8,-2,35.1,1,36.5,3.5,36.8,7.5,37,10,37.3,11,36.8,10.2,35.8,11.1,35.2,10.1,34.3,11.2,33.2,12.5,32.8,15.2,32.3,15.8,31.4,19,30.3,20,31,20,32,21.5,32.9,23,32.6,25,31.8,29,30.9,31,31.5,32.3,31.3,34.2,31.3,34.9,29.5,32.5,29.9,33.6,27.8,35,24.5,36.9,22,37.3,18.8,38.6,17.8,39.7,15.1,41.2,13.9,43.3,12.3,44.5,10.4,47.5,11.2,51.2,11.8,51,10.4,49.8,7.5,48,4.5,46,2,43.5,-0.5,41.5,-1.8,40,-3.3,39.2,-4.7,39.3,-7,39.7,-10,40.5,-11,40.6,-15,37.5,-17.8,35.3,-22,35.5,-24,32.8,-25.6,32.9,-28.5,31,-29.8,28,-32.8,25.7,-34,22.5,-34,20,-34.8,18.4,-34.1,18.2,-31.5,16.5,-28.6,15.2,-26.6,14.5,-22.9,13.2,-19,11.8,-17.3,11.8,-15.8,12.5,-13.5,13.8,-10.8,13.2,-8.5,12.3,-6.1,11.8,-4.3,9.5,-2.5,9.3,-0.5,9.8,2,9.8,3.2,8.6,4.5,6,4.3,4.5,6.3,2.7,6.3,1,5.9,-2,4.7,-4.6,5.2,-7.5,4.4,-9,5,-11.3,6.7,-13,7.9,-13.5,9.4,-15,10.9,-16.7,12.4,-17.2,14.7,-16.5,16.5,-16.1,19.5,-17,21,-16.2,23.7,-14.6,25.5,-13.2,27.7,-10.2,29.2,-9.6,30.7,-8.5,33.3,-6.8,34.1],
  [49.3,-12,50.5,-15.5,49.5,-17.5,47.5,-24.7,45.2,-25.5,43.6,-23,43.3,-21.5,44.4,-19,44,-17,46.3,-15.6,48,-13.6],
  // Antarctica (closed through the pole)
  [-180,-78.5,-160,-77.5,-150,-76.5,-140,-75,-120,-73.5,-100,-73,-80,-73,-75,-70,-65,-67,-60,-63.5,-57,-63.3,-62,-68,-62,-72,-60,-75,-50,-77.5,-35,-78,-30,-76,-20,-73,-10,-71,0,-70,20,-70,40,-69.5,60,-67.5,70,-68.5,75,-69.5,80,-67,90,-66.5,100,-65.8,110,-66,120,-66.8,130,-66.2,140,-66.7,150,-68.5,160,-70,170,-71.5,180,-78.5,180,-90,-180,-90],
];
// prettier-ignore
const WATER = [
  [-95,59,-94,56.5,-88,55.5,-82,53,-79,51.5,-79,55,-77,58.5,-78,62,-83,63.8,-88,64,-93,62], // Hudson Bay
  [27.5,42.5,28,41.3,29.5,41.2,31.5,41.2,34,42,36,41.7,38.5,40.9,41.5,41.5,41.7,42.5,40,43.5,38.5,44.5,37.5,45.3,39,47.1,35,45.4,33.5,44.5,32.5,45.4,31,46.6,30,45.8,29.6,44.8,28.6,44], // Black Sea
  [47,44.7,49.3,46.4,51.5,47,53,46.8,53.2,45.3,51.3,44.5,52.7,42,54,41,53.9,38,53,37,50.4,37.2,49,38.4,49.5,40.3,48.5,41.8,47.5,43], // Caspian
  [58.2,46.5,61.2,46.8,61.8,45,60.2,43.6,58.5,44.5], // Aral Sea (1969)
  [-92,46.7,-84.5,46.5,-85,48,-89,48.5], // Lake Superior
  [32,-1,34,-0.3,34,-3,31.8,-2.5], // Lake Victoria
];

// Arid regions as soft ellipses [lonC, latC, halfWidthLon, halfWidthLat, strength] (negative = wetter).
// prettier-ignore
const ARID = [
  [8, 23.5, 27, 8, 1.0], [2, 15, 26, 3.5, 0.45], [46, 22.5, 11, 8, 1.0], [60, 30, 12, 6, 0.8], [71, 27, 4.5, 3, 0.7],
  [19, -23, 7, 6, 0.75], [14.5, -22, 2.5, 8, 0.9], [132, -25, 15, 8.5, 0.95], [-111, 31, 7, 6.5, 0.7], [-104, 39, 6, 6, 0.35],
  [-70, -22, 1.8, 7, 0.9], [-68, -44, 3.5, 6, 0.6], [95, 41.5, 20, 5, 0.85], [65, 45, 15, 4.5, 0.5], [45, 8, 6, 5, 0.7],
  [-40, -8, 5, 4, 0.35], [80, 36, 8, 4, 0.7], [-60, -26, 6, 6, 0.25], [25, -12, 10, 5, 0.3],
];

function polyToRows(poly, W, H, mask, val) {
  // even-odd scanline fill of a lon/lat polygon into a W x H mask (row 0 = lat +90)
  const n = poly.length / 2;
  const xs = [];
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = poly[i * 2 + 1];
      const yj = poly[j * 2 + 1];
      if (yi > lat !== yj > lat) {
        const xi = poly[i * 2];
        const xj = poly[j * 2];
        xs.push(xi + ((lat - yi) / (yj - yi)) * (xj - xi));
      }
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(((xs[k] + 180) / 360) * W - 0.5));
      const x1 = Math.min(W - 1, Math.floor(((xs[k + 1] + 180) / 360) * W - 0.5));
      for (let x = x0; x <= x1; x++) mask[y * W + x] = val;
    }
  }
}

/** Land mask (1 = land) on a W x H equirectangular grid. */
export function buildLandMask(W, H) {
  const m = new Uint8Array(W * H);
  for (const p of LAND) polyToRows(p, W, H, m, 1);
  for (const p of WATER) polyToRows(p, W, H, m, 0);
  return m;
}

function blurMask(src, W, H, r) {
  // separable box blur (wraps in longitude), float result 0..1
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * W + ((k + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = s / n;
      s += src[y * W + ((x + r + 1) % W)] - src[y * W + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let s = 0;
      let c = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= H) continue;
        s += tmp[yy * W + x];
        c++;
      }
      out[y * W + x] = s / c;
    }
  }
  return out;
}

// Mid-latitude cyclones (July): [lon, lat, radius deg, twist (+ = counter-clockwise)]
// prettier-ignore
const CYCLONES = [
  [-165, 48, 9, 1], [-40, 57, 10, 1], [-20, 62, 7, 1], [160, 44, 8, 1], [95, 58, 7, 1], [-100, 55, 6, 1],
  [-150, -52, 11, -1], [-85, -55, 10, -1], [-20, -50, 12, -1], [40, -55, 10, -1], [100, -52, 11, -1], [150, -58, 9, -1],
  [135, 22, 4, 1], [-60, -38, 7, -1],
];

/**
 * Prepare the shared (row-independent) data for the Earth texture. Call once, pass to rows().
 * @param {number} W @param {number} H
 */
export function prepareEarth(W, H) {
  const MW = W; // mask at texture resolution (warped lookups are bilinear)
  const MH = H;
  const land = buildLandMask(MW, MH);
  const coast = blurMask(land, MW, MH, Math.max(2, Math.round(W / 256)));
  return { W, H, MW, MH, land, coast };
}

function sampleMask(prep, lon, lat, which) {
  const { MW, MH } = prep;
  const src = which === 'coast' ? prep.coast : prep.land;
  let x = ((lon + 180) / 360) * MW - 0.5;
  let y = ((90 - lat) / 180) * MH - 0.5;
  y = Math.min(MH - 1.001, Math.max(0, y));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const xa = ((x0 % MW) + MW) % MW;
  const xb = (xa + 1) % MW;
  const y1 = Math.min(MH - 1, y0 + 1);
  const a = src[y0 * MW + xa];
  const b = src[y0 * MW + xb];
  const c = src[y1 * MW + xa];
  const d = src[y1 * MW + xb];
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

function aridity(lon, lat) {
  let a = 0;
  for (const [lc, bc, hw, hh, s] of ARID) {
    let dl = lon - lc;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    const d = Math.hypot(dl / hw, (lat - bc) / hh);
    a += s * (1 - smooth(0.55, 1.35, d));
  }
  return Math.max(-0.3, Math.min(1, a));
}

/**
 * Generate rows [y0, y1) of the Earth textures.
 * @param {object} prep result of prepareEarth
 * @param {number} y0 @param {number} y1
 * @param {Uint8Array} albedo RGBA (sRGB colour, A = 255 water / 0 land)
 * @param {Uint8Array} clouds RGBA (R = cloud opacity, G = cloud "thickness" for shading)
 */
export function generateEarthRows(prep, y0, y1, albedo, clouds) {
  const { W, H } = prep;
  for (let y = y0; y < y1; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const cl = Math.cos(lat * D2R);
    const sl = Math.sin(lat * D2R);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 360 - 180;
      const px = cl * Math.cos(lon * D2R);
      const py = cl * Math.sin(lon * D2R);
      const pz = sl;
      // ---- coastline roughening: warp the lookup by fractal noise (~1 deg)
      const wx = (fbm(px * 9 + 3.1, py * 9, pz * 9, 4) - 0.5) * 2.6;
      const wy = (fbm(px * 9, py * 9 + 7.7, pz * 9, 4) - 0.5) * 2.0;
      const landF = sampleMask(prep, lon + wx / Math.max(0.2, cl), lat + wy, 'land');
      const isLand = landF > 0.5;
      const i4 = (y * W + x) * 4;
      // ---- surface colour (sRGB 0..1)
      let r;
      let g;
      let b;
      const n1 = fbm(px * 14, py * 14, pz * 14, 5);
      const n2 = fbm(px * 40 + 5, py * 40, pz * 40, 3);
      const alat = Math.abs(lat);
      if (isLand) {
        const ar = aridity(lon + (n1 - 0.5) * 8, lat + (n2 - 0.5) * 4);
        // vegetation zones by latitude (July: northern summer)
        const tropical = 1 - smooth(8, 18, alat);
        const boreal = smooth(48, 56, lat) * (1 - smooth(66, 71, lat));
        const tundra = smooth(64, 70, alat);
        // base palettes
        const forestT = [0.1, 0.2, 0.08];
        const forestM = [0.16, 0.24, 0.11];
        const forestB = [0.12, 0.18, 0.1];
        const grass = [0.36, 0.36, 0.2];
        const savanna = [0.5, 0.44, 0.27];
        const desert = [0.8, 0.66, 0.46];
        const desertRed = [0.78, 0.52, 0.32];
        const tundraC = [0.42, 0.38, 0.3];
        let c = forestM;
        c = mixC(c, forestT, tropical);
        c = mixC(c, forestB, boreal);
        const vv = fbm(px * 4 + 1.3, py * 4, pz * 4, 3) - 0.5; // large-scale moisture variety
        c = mixC(c, grass, smooth(0.12, 0.4, ar + (n1 - 0.5) * 0.3 + vv * 0.45 * (1 - tropical)));
        c = mixC(c, savanna, smooth(0.35, 0.65, ar + (n1 - 0.5) * 0.3));
        const des = lon > 110 && lat < -10 ? desertRed : desert;
        c = mixC(c, des, smooth(0.6, 0.9, ar + (n2 - 0.5) * 0.2));
        c = mixC(c, tundraC, tundra);
        const v = 0.8 + 0.4 * n2;
        r = c[0] * v;
        g = c[1] * v;
        b = c[2] * v;
        // ice sheets: Greenland, Antarctica, Arctic islands
        const ice = smooth(-60, -63, lat) + (lon > -75 && lon < -10 && lat > 60 ? smooth(0.2, 0.5, (lat - 60) / 20 + (n1 - 0.5)) : 0) + smooth(76, 80, lat);
        const iceC = 0.88 + 0.08 * n2;
        const k = Math.min(1, ice);
        r = mix(r, iceC, k);
        g = mix(g, iceC, k);
        b = mix(b, iceC * 1.02, k);
      } else {
        // ocean: deep blue, lighter/greener over the continental shelves and in the tropics
        const shelf = sampleMask(prep, lon, lat, 'coast');
        const deep = [0.02, 0.07, 0.19];
        const shallow = alat < 30 ? [0.07, 0.3, 0.4] : [0.06, 0.18, 0.26];
        const t = smooth(0.05, 0.5, shelf) * (0.6 + 0.4 * n2);
        r = mix(deep[0], shallow[0], t);
        g = mix(deep[1], shallow[1], t);
        b = mix(deep[2], shallow[2], t);
        // July sea ice: Arctic pack north of ~76N, Antarctic pack out to ~60S (winter maximum)
        const packN = smooth(74, 80, lat + (n1 - 0.5) * 8);
        const packS = smooth(-60, -64, lat + (n1 - 0.5) * 6);
        const pk = Math.max(packN, packS) * (0.75 + 0.25 * n2);
        r = mix(r, 0.82, pk);
        g = mix(g, 0.85, pk);
        b = mix(b, 0.9, pk);
      }
      albedo[i4] = Math.round(Math.min(1, r) * 255);
      albedo[i4 + 1] = Math.round(Math.min(1, g) * 255);
      albedo[i4 + 2] = Math.round(Math.min(1, b) * 255);
      albedo[i4 + 3] = isLand ? 0 : 255;

      // ---- clouds (July climatology)
      let cov = 0.43;
      const itcz = Math.exp(-(((lat - 8 - 2.5 * Math.sin(lon * D2R * 2 + 1)) / 4.5) ** 2));
      cov = mix(cov, 0.66, itcz * (0.45 + 0.9 * fbm(px * 5 + 2.2, py * 5, pz * 5 + 9.1, 2))); // ITCZ: a narrow, wavy band of convective clusters
      cov = mix(cov, 0.22, Math.exp(-(((alat - 24) / 7) ** 2))); // subtropical highs
      cov = mix(cov, 0.65, smooth(38, 50, alat) * (1 - smooth(68, 80, alat))); // storm tracks
      cov = mix(cov, 0.67, smooth(-45, -55, lat) * (1 - smooth(-66, -72, lat))); // Southern Ocean
      if (isLand) cov -= 0.45 * Math.max(0, aridity(lon, lat)) + 0.05;
      // stratocumulus decks and the monsoon
      const box = (l0, l1, b0, b1) => smooth(l0 - 5, l0 + 5, lon) * (1 - smooth(l1 - 5, l1 + 5, lon)) * smooth(b0 - 4, b0 + 4, lat) * (1 - smooth(b1 - 4, b1 + 4, lat));
      const sc = Math.max(box(-135, -118, 18, 36), box(-92, -74, -28, -6), box(-8, 12, -26, -8));
      cov = mix(cov, 0.72, sc);
      const monsoon = box(70, 110, 8, 26);
      cov = mix(cov, 0.75, monsoon);
      cov = mix(cov, 0.1, box(-20, 35, 17, 30) + box(40, 58, 16, 29));
      // spiral cyclones: rotate the noise lookup about each centre
      let qx = lon;
      let qy = lat;
      let swirl = 0;
      for (const [cx, cy, rad, tw] of CYCLONES) {
        let dx = lon - cx;
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        dx *= cl;
        const dy = lat - cy;
        const d = Math.hypot(dx, dy) / rad;
        if (d > 2.2) continue;
        const ang = tw * 2.2 * Math.exp(-d * 1.3) * (1 - smooth(1.4, 2.2, d));
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        qx += ((ca * dx - sa * dy) - dx) / Math.max(0.2, cl);
        qy += (sa * dx + ca * dy) - dy;
        swirl = Math.max(swirl, Math.exp(-d * d * 1.5));
      }
      cov = mix(cov, 0.85, swirl * 0.6);
      // frontal cloud bands trailing equatorward (and westward) from the mid-latitude lows: long,
      // curved, narrow — the dominant large-scale structure in Apollo photographs of the Earth
      let front = 0;
      for (const [cx, cy, rad, tw] of CYCLONES) {
        if (Math.abs(cy) < 30) continue;
        let dx = lon - cx;
        if (dx > 180) dx -= 360;
        if (dx < -180) dx += 360;
        dx *= cl;
        const dy = (lat - cy) * -tw; // + toward the equator in both hemispheres
        const len = rad * 3.6;
        if (dy < -rad || dy > len + rad || Math.abs(dx) > len * 1.2) continue;
        const sAlong = Math.max(0, dy) / len;
        // the front curves west as it runs toward the equator
        const cxLine = rad * 0.35 - len * (0.25 * sAlong + 0.45 * sAlong * sAlong);
        const w = rad * (0.2 + 0.25 * sAlong);
        const band = Math.exp(-(((dx - cxLine) / w) ** 2)) * smooth(-rad * 0.5, rad * 0.3, dy) * (1 - smooth(len * 0.7, len, dy));
        front = Math.max(front, band);
      }
      cov = mix(cov, 0.8, front * 0.75);
      const qc = Math.cos(qy * D2R);
      const cx3 = qc * Math.cos(qx * D2R);
      const cy3 = qc * Math.sin(qx * D2R);
      const cz3 = Math.sin(qy * D2R);
      // stretch along longitude (zonal flow) outside the tropics
      const zonal = 1 + 1.4 * smooth(20, 45, alat);
      // two-level domain warp: sheared, streaky structures instead of isotropic puffs
      const wq = fbm(cx3 * 6, cy3 * 6, cz3 * 6 * zonal, 3) - 0.5;
      const wq2 = fbm(cx3 * 17 + wq * 2.5, cy3 * 17 + 4.2, cz3 * 17 * zonal, 3) - 0.5;
      const cn = fbm(cx3 * 11 + wq * 3.0 + wq2 * 0.9, cy3 * 11 + wq * 2.6, cz3 * 11 * zonal + wq * 1.8 + wq2 * 0.7, 6, 2.1, 0.55);
      const fine = fbm(cx3 * 70 + wq * 3 + wq2 * 2, cy3 * 70, cz3 * 70 * zonal, 3);
      let cd = smooth(1 - cov - 0.06, 1 - cov + 0.16, cn + (fine - 0.5) * 0.2 * (1 + sc));
      cd *= 0.8 + 0.2 * fine;
      // trade-wind / subtropical skies: scattered small cumulus, not solid blobs (except the ITCZ,
      // the stratocumulus decks and the cyclones)
      const trop = (1 - smooth(22, 32, alat)) * (1 - itcz * 0.8) * (1 - sc) * (1 - swirl) * (1 - monsoon);
      const cu = fbm(cx3 * 55 + wq2 * 3, cy3 * 55, cz3 * 55, 3);
      cd *= 1 - trop * (1 - smooth(0.36, 0.58, cu));
      const j4 = i4;
      clouds[j4] = Math.round(Math.min(1, Math.max(0, cd)) * 255);
      clouds[j4 + 1] = Math.round(Math.min(1, Math.max(0, (cn - (1 - cov)) * 2.5)) * 255);
      clouds[j4 + 2] = 0;
      clouds[j4 + 3] = 255;
    }
  }
}

function mixC(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// -------------------------------------------------------------------------------------- Milky Way
// Galactic-coordinate features: [l, b, sigmaL, sigmaB, amplitude]
// prettier-ignore
const MW_BLOBS = [
  [0, -1, 14, 7, 1.0], // bulge (Sagittarius star cloud)
  [-8, -4, 5, 3, 0.45], // Large Sagittarius star cloud
  [27, -2, 6, 3.5, 0.35], // Scutum star cloud
  [78, 1.5, 12, 4, 0.45], // Cygnus star cloud
  [-73, -1, 12, 4, 0.4], // Carina
  [-50, 0, 10, 3, 0.25], // Norma / Centaurus
  [-133, -1, 18, 5, 0.15], // Puppis/Vela
  [135, 0, 20, 4, 0.12], // Perseus/Cassiopeia
];
// Dust lanes (extinction): [l, b, sigmaL, sigmaB, tau]
// prettier-ignore
const MW_DUST = [
  [30, 2, 28, 3.2, 1.3], // Great Rift (Aquila to Sagittarius)
  [70, 2.5, 14, 3, 1.1], // northern rift through Cygnus
  [5, 12, 7, 6, 0.8], // Ophiuchus dark clouds (rho Oph / Pipe)
  [-58, -0.5, 2.5, 2.5, 1.2], // Coalsack
  [-20, 0.3, 40, 1.2, 0.6], // Norma dust lane
  [170, -12, 12, 6, 0.4], // Taurus dark clouds
];
// Galaxies/clouds: [l, b, sigmaMajor, sigmaMinor, PA(rad), amplitude, grain]
// prettier-ignore
const MW_GAL = [
  [-79.5, -32.9, 3.2, 2.4, 0.3, 0.55, 1], // LMC
  [-57.2, -44.3, 1.6, 1.0, 0.7, 0.3, 1], // SMC
  [121.2, -21.6, 1.3, 0.35, 0.9, 0.35, 0], // M31
  [-50.9, 15.0, 0.18, 0.18, 0, 0.25, 0], // omega Cen
];

function gaussL(l, l0, s) {
  let d = l - l0;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.exp(-0.5 * (d / s) * (d / s));
}

/**
 * Generate rows [y0,y1) of the Milky Way texture (W x H, u = galactic longitude with l = 0 at the
 * centre, increasing to the LEFT as on sky charts is NOT applied — u = (l + 180)/360; v = b, +90 at the top).
 * RGBA8, sqrt-encoded intensity (shader squares it), peak ~1.
 */
export function generateMilkyWayRows(W, H, y0, y1, out) {
  for (let y = y0; y < y1; y++) {
    const b = 90 - ((y + 0.5) / H) * 180;
    const cb = Math.cos(b * D2R);
    const sb = Math.sin(b * D2R);
    for (let x = 0; x < W; x++) {
      const l = ((x + 0.5) / W) * 360 - 180;
      const px = cb * Math.cos(l * D2R);
      const py = cb * Math.sin(l * D2R);
      const pz = sb;
      // thin disc: brighter toward the centre, thicker in the bulge region
      const ampl = 0.3 + 0.7 * Math.exp(-0.5 * (l / 60) ** 2);
      const hb = 2.4 + 3.5 * Math.exp(-0.5 * (l / 30) ** 2);
      const ab = Math.abs(b + 0.4 * Math.sin(l * D2R * 2)); // slight warp
      let I = ampl * (0.65 * Math.exp(-0.5 * (ab / hb) ** 2) + 0.35 * Math.exp(-ab / (hb * 2.5)));
      I += 0.025 * Math.exp(-ab / 25); // faint unresolved background
      for (const [l0, b0, sl, sbb, a] of MW_BLOBS) I += a * gaussL(l, l0, sl) * Math.exp(-0.5 * ((b - b0) / sbb) ** 2);
      // star-cloud mottling (multi-scale), strongest in the plane
      const m1 = fbm(px * 12, py * 12, pz * 12, 5);
      const m2 = fbm(px * 45 + 3, py * 45, pz * 45, 3);
      I *= 0.55 + 0.9 * m1 * (0.75 + 0.5 * m2);
      // dust extinction
      let tau = 0;
      for (const [l0, b0, sl, sbb, t] of MW_DUST) tau += t * gaussL(l, l0, sl) * Math.exp(-0.5 * ((b - b0) / sbb) ** 2);
      const dn = fbm(px * 20 + 9, py * 20, pz * 20, 4);
      tau *= 0.4 + 1.3 * dn;
      tau += 0.3 * Math.exp(-0.5 * (b / 0.9) ** 2) * smooth(0.45, 0.7, dn) * Math.exp(-0.5 * (l / 90) ** 2);
      I *= Math.exp(-tau);
      // colour: warm bulge, neutral-blue disc; dust reddens
      const warm = Math.min(1, Math.exp(-0.5 * (l / 25) ** 2 - 0.5 * (b / 12) ** 2) * 1.2 + tau * 0.25);
      let r = I * mix(0.86, 1.0, warm);
      let g = I * mix(0.9, 0.86, warm);
      let bl = I * mix(1.0, 0.68, warm);
      // Magellanic Clouds, M31, omega Cen
      for (const [l0, b0, s1, s2, pa, a, grain] of MW_GAL) {
        let dl = l - l0;
        if (dl > 180) dl -= 360;
        if (dl < -180) dl += 360;
        dl *= Math.cos(b0 * D2R);
        const db = b - b0;
        const u = dl * Math.cos(pa) + db * Math.sin(pa);
        const v = -dl * Math.sin(pa) + db * Math.cos(pa);
        let g2 = a * Math.exp(-0.5 * ((u / s1) ** 2 + (v / s2) ** 2));
        if (grain) g2 *= 0.5 + m2 * m1 * 1.6;
        r += g2 * 0.95;
        g += g2 * 0.93;
        bl += g2 * 0.9;
      }
      const i4 = (y * W + x) * 4;
      out[i4] = Math.round(Math.sqrt(Math.min(1, r / 1.6)) * 255);
      out[i4 + 1] = Math.round(Math.sqrt(Math.min(1, g / 1.6)) * 255);
      out[i4 + 2] = Math.round(Math.sqrt(Math.min(1, bl / 1.6)) * 255);
      out[i4 + 3] = 255;
    }
  }
}
