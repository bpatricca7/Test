// Ears: a small SDF sculpt (helix rim, antihelix, concha bowl, tragus, lobe)
// polygonized with surface nets and set into the side of the head.
import * as THREE from 'three';
import { ellipsoid, ellipsoidR, roundCone, smin, smax, surfaceNets, gradient, fieldAO, clamp } from './sdf.js';

function earSDF(s = 1) {
  // ear-local: x out of the head, y up, z forward (toward the face)
  const plate = ellipsoidR(0.0035, 0.002, -0.002, 0.0038, 0.029, 0.0165, 0, 0, 0.08);
  const helixPts = [];
  for (let i = 0; i <= 18; i++) {
    const a = (-0.35 + i / 18 * 1.9) * Math.PI; // from front-top over the back down to the lobe
    const y = 0.0265 * Math.cos(a * 0.5 - 0.1) * 1.0;
    const pa = -0.35 * Math.PI + (i / 18) * 1.9 * Math.PI;
    const yy = 0.004 + 0.025 * Math.sin(pa + Math.PI / 2 * 0);
    void y;
    helixPts.push([0.0055 + 0.0012 * Math.sin(i / 18 * Math.PI), 0.004 + 0.0255 * Math.cos(pa * 0.62), -0.001 - 0.0155 * Math.sin(pa * 0.62) ]);
    void yy;
  }
  const helix = [];
  for (let i = 0; i < helixPts.length - 1; i++) {
    const a = helixPts[i], b = helixPts[i + 1];
    const r0 = 0.0026 * (1 - 0.25 * (i / 18)), r1 = 0.0026 * (1 - 0.25 * ((i + 1) / 18));
    helix.push(roundCone(a[0], a[1], a[2], b[0], b[1], b[2], r0, r1));
  }
  const lobe = ellipsoid(0.0035, -0.023, -0.0015, 0.0036, 0.0078, 0.0072);
  const concha = ellipsoid(0.0092, -0.004, 0.0012, 0.0056, 0.0092, 0.0068);
  const fossa = ellipsoid(0.0075, 0.014, -0.004, 0.0035, 0.007, 0.006);
  const anti = [roundCone(0.0068, 0.016, -0.007, 0.0072, 0.004, -0.0088, 0.0021, 0.0023),
    roundCone(0.0072, 0.004, -0.0088, 0.0072, -0.009, -0.0065, 0.0023, 0.002)];
  const tragus = ellipsoidR(0.0062, -0.0055, 0.0098, 0.0028, 0.0042, 0.0024, 0, 0, 0);
  const stem = ellipsoid(-0.004, -0.003, 0.004, 0.006, 0.016, 0.011);
  return (x, y, z) => {
    x /= s; y /= s; z /= s;
    let d = smin(plate(x, y, z), lobe(x, y, z), 0.006);
    let h = helix[0](x, y, z);
    for (let i = 1; i < helix.length; i++) h = Math.min(h, helix[i](x, y, z));
    d = smin(d, h, 0.003);
    d = smin(d, stem(x, y, z), 0.004);
    d = smin(d, Math.min(anti[0](x, y, z), anti[1](x, y, z)), 0.002);
    d = smax(d, -concha(x, y, z), 0.0025);
    d = smax(d, -fossa(x, y, z), 0.0018);
    d = smin(d, tragus(x, y, z), 0.002);
    return d * s;
  };
}

export function createEars(H, skinMat, colorFn, s = 1) {
  const f = earSDF(s);
  const vs = 0.00125 * s;
  const min = [-0.007 * s, -0.036 * s, -0.022 * s], max = [0.013 * s, 0.036 * s, 0.018 * s];
  const res = [0, 1, 2].map(i => Math.round((max[i] - min[i]) / vs) + 1);
  const m = surfaceNets(f, min, max, res, { snap: 2 });
  const n = m.positions.length / 3;
  const col = new Float32Array(n * 3), ao = new Float32Array(n), wet = new Float32Array(n);
  const g3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = m.positions[3 * i], y = m.positions[3 * i + 1], z = m.positions[3 * i + 2];
    gradient(f, x, y, z, g3);
    ao[i] = clamp(0.35 + 0.65 * fieldAO(f, x, y, z, g3[0], g3[1], g3[2], 0.006 * s, 4));
    const c = colorFn(x, y, z, 'ear');
    // inner ear and rim edges a touch redder
    col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('ao', new THREE.BufferAttribute(ao, 1));
  g.setAttribute('wet', new THREE.BufferAttribute(wet, 1));
  g.setIndex(m.indices);
  g.computeVertexNormals();
  const ears = [];
  const ep = H.landmarks.ear;
  for (const side of [1, -1]) {
    const mesh = new THREE.Mesh(g, skinMat);
    mesh.position.set(side * ep[0], ep[1], ep[2]);
    // ear plane: flared out ~22 deg at the back, tilted back ~14 deg
    mesh.rotation.set(0, side > 0 ? -0.36 : Math.PI + 0.36, side > 0 ? 0.0 : 0.0, 'YXZ');
    if (side < 0) mesh.scale.set(1, 1, -1);
    mesh.rotateX(side > 0 ? -0.22 : 0.22);
    mesh.name = side > 0 ? 'earL' : 'earR';
    ears.push(mesh);
  }
  return { ears, tris: m.indices.length / 3 };
}
