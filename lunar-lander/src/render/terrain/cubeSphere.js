// Cube-sphere parametrisation shared by the terrain main thread and the chunk workers (no three.js).
//
// Six faces; each face has an outward normal N and in-plane axes U, V with U x V = N, so a grid
// triangulated (i,j)->(i+1,j)->(i+1,j+1) is counter-clockwise seen from outside.
// Face coordinates s, t in [-1, 1] are "tan-warped": direction = normalize(N + tan(s*pi/4) U + tan(t*pi/4) V),
// which makes grid cells nearly equal in angular size (a chunk edge is ~ R*pi/2 / 2^level metres).

export const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [0, 0, -1], v: [1, 0, 0] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const Q = Math.PI / 4;

/** Unit direction for face f at face coords (s, t) (may extend slightly beyond [-1,1]). Writes out[o..o+2]. */
export function faceDir(f, s, t, out, o = 0) {
  const F = FACES[f];
  const a = Math.tan(s * Q);
  const b = Math.tan(t * Q);
  const x = F.n[0] + a * F.u[0] + b * F.v[0];
  const y = F.n[1] + a * F.u[1] + b * F.v[1];
  const z = F.n[2] + a * F.u[2] + b * F.v[2];
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  out[o] = x * l;
  out[o + 1] = y * l;
  out[o + 2] = z * l;
  return out;
}

/** Face coordinates of direction (x,y,z) projected onto face f's plane. Returns false if behind the face. */
export function dirToFaceST(f, x, y, z, out) {
  const F = FACES[f];
  const dn = x * F.n[0] + y * F.n[1] + z * F.n[2];
  if (dn <= 1e-6) return false;
  out[0] = Math.atan((x * F.u[0] + y * F.u[1] + z * F.u[2]) / dn) / Q;
  out[1] = Math.atan((x * F.v[0] + y * F.v[1] + z * F.v[2]) / dn) / Q;
  return true;
}

/** Which face a direction belongs to (largest |component|). */
export function dirFace(x, y, z) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) return x >= 0 ? 0 : 1;
  if (ay >= az) return y >= 0 ? 2 : 3;
  return z >= 0 ? 4 : 5;
}

/** Face-coordinate width of a chunk at `level`. */
export const chunkWidthST = (level) => 2 / (1 << level);
