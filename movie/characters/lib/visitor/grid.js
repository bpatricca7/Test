// The Visitor: one big dynamic skin buffer made of regular grid patches.
//
// Every surface of the body (head, lids, crest, torso, neck, limbs, hands) is a
// (u around) x (v along) grid of vertices regenerated on the CPU from the pose
// each frame. All patches live in one BufferGeometry so the hologram renders
// in one depth pre-pass and one colour pass.
//
// Vertex (i, j) of a patch is at index off + j * cols + i. Wrapped patches get
// a duplicate seam column (cols = nu + 1) so texture coordinates can wrap.

export class SkinBuffer {
  constructor() {
    this.patches = [];
    this.count = 0;
    this.idx = [];
  }

  add(nu, nv, opt = {}) {
    const wrap = opt.wrap !== false;
    const cols = wrap ? nu + 1 : nu;
    const p = { nu, nv, cols, wrap, flip: !!opt.flip, off: this.count, count: cols * nv, name: opt.name || '' };
    this.count += p.count;
    const I = this.idx;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = p.off + j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (!p.flip) I.push(a, b, c, b, d, c); else I.push(a, c, b, b, c, d);
    }
    this.patches.push(p);
    return p;
  }

  build(THREE) {
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.tex = new Float32Array(n * 3);   // texture coords: (u, v, 0) in tiles, or rest xyz for triplanar
    this.info = new Float32Array(n * 4);  // part id, crease, ambient occlusion, vein/glow mask
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    this.texAttr = new THREE.BufferAttribute(this.tex, 3);
    this.infoAttr = new THREE.BufferAttribute(this.info, 4);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('aTex', this.texAttr);
    g.setAttribute('aInfo', this.infoAttr);
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.1, 0), 3);
    this.geometry = g;
    this.triangles = this.idx.length / 3;
    return g;
  }

  // copy column 0 into the seam column for a wrapped patch
  seam(p, arr = this.pos, stride = 3) {
    if (!p.wrap) return;
    for (let j = 0; j < p.nv; j++) {
      const a = (p.off + j * p.cols) * stride, b = (p.off + j * p.cols + p.nu) * stride;
      for (let c = 0; c < stride; c++) arr[b + c] = arr[a + c];
    }
  }

  // grid normals by central differences; collapsed rings (poles) point away from the neighbouring ring
  normals(p) {
    const P = this.pos, N = this.nrm, { nu, nv, cols, off, wrap, flip } = p;
    const at = (i, j) => (off + j * cols + i) * 3;
    for (let j = 0; j < nv; j++) {
      const jp = Math.min(j + 1, nv - 1), jm = Math.max(j - 1, 0);
      for (let i = 0; i < nu; i++) {
        const ip = wrap ? (i + 1) % nu : Math.min(i + 1, nu - 1);
        const im = wrap ? (i - 1 + nu) % nu : Math.max(i - 1, 0);
        const a = at(ip, j), b = at(im, j), c = at(i, jp), d = at(i, jm);
        const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
        const vx = P[c] - P[d], vy = P[c + 1] - P[d + 1], vz = P[c + 2] - P[d + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        let l = Math.hypot(nx, ny, nz);
        const o = at(i, j);
        const ul = Math.hypot(ux, uy, uz);
        if (l < 1e-12 || ul < 1e-7) {
          // pole: direction from the neighbouring ring's centre
          const jj = j === 0 ? 1 : j === nv - 1 ? nv - 2 : j;
          let cx = 0, cy = 0, cz = 0;
          for (let k = 0; k < nu; k++) { const q = at(k, jj); cx += P[q]; cy += P[q + 1]; cz += P[q + 2]; }
          cx /= nu; cy /= nu; cz /= nu;
          nx = P[o] - cx; ny = P[o + 1] - cy; nz = P[o + 2] - cz;
          l = Math.hypot(nx, ny, nz) || 1;
        }
        N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
      }
    }
    this.seam(p, N);
  }

  touch() {
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }
}
