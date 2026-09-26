// LM cross-pointer (X-pointer): forward and lateral velocity in the LM body axes.
// Horizontal needle = forward velocity (moves up for forward), vertical needle = lateral velocity
// (moves right for right). Full scale ±20 ft/s (or ±200 with the X10 scale).
import { THREE, createCase, limiter, finish, approach } from './common.js';
import { crossPointerVelocities } from './math.js';

/**
 * LM cross-pointer. opts: { size=0.11, scale=20 (ft/s full scale) }
 * Forward = velocity along body forward (-Z), lateral = along body right (+X), from vessel.vel
 * (MCI; the Moon does not rotate, so this is surface-relative).
 */
export function createCrossPointer(opts = {}) {
  const s = opts.size || 0.11;
  const fs = opts.scale || 20;
  const fr = s * 0.055;
  const span = s * 0.36; // needle travel for full scale
  const fw = s - 2 * fr + 0.002; // face width (see createCase)
  const { group } = createCase({
    width: s,
    height: s,
    frame: fr,
    corner: s * 0.04,
    faceSpec: {
      draw(P) {
        // graticule: centre cross (dim) and ticks every 20 % of full scale
        P.line(-span, 0, span, 0, s * 0.004, '#8a8a86', false);
        P.line(0, -span, 0, span, s * 0.004, '#8a8a86', false);
        for (let i = -5; i <= 5; i++) {
          if (!i) continue;
          const f = (i / 5) * span;
          const L = i % 5 === 0 ? s * 0.05 : s * 0.028;
          P.line(f, -L / 2, f, L / 2, s * 0.006);
          P.line(-L / 2, f, L / 2, f, s * 0.006);
        }
        P.ring(0, 0, s * 0.02, s * 0.004);
        const e = fw / 2 - s * 0.055;
        P.text('FWD', 0, e + s * 0.012, s * 0.05);
        P.text('AFT', 0, -e - s * 0.012, s * 0.05);
        P.text('L', -e - s * 0.01, 0, s * 0.055);
        P.text('R', e + s * 0.01, 0, s * 0.055);
        P.text(`${fs}`, -e + s * 0.02, e + s * 0.008, s * 0.04, { align: 'left' });
        P.text('FT/SEC', e - s * 0.02, -e - s * 0.004, s * 0.035, { align: 'right' });
        P.text(`${fs}`, span + s * 0.015, -s * 0.045, s * 0.036, { align: 'center' });
        P.text(`${fs / 2}`, span / 2, -s * 0.045, s * 0.036, { align: 'center' });
      },
    },
    depth: 0.03,
  });
  const mat = new THREE.MeshStandardMaterial({ color: 0xdad9d0, roughness: 0.4, emissive: 0xdad9d0, emissiveIntensity: 0.06 });
  const nw = s * 0.012;
  const vNeedle = new THREE.Mesh(new THREE.BoxGeometry(nw, span * 2.35, 0.0006), mat);
  const hNeedle = new THREE.Mesh(new THREE.BoxGeometry(span * 2.35, nw, 0.0006), mat);
  vNeedle.position.z = 0.0008;
  hNeedle.position.z = 0.0015;
  vNeedle.castShadow = hNeedle.castShadow = true;
  group.add(vNeedle, hNeedle);
  const lim = limiter(30);
  let fx = 0;
  let fy = 0;
  function update(vessel, game, dt) {
    const e = lim.tick(dt);
    if (!e || !vessel) return;
    const v = crossPointerVelocities(vessel.vel, vessel.quat);
    const fwd = vessel.landed ? 0 : v.fwd;
    const lat = vessel.landed ? 0 : v.lat;
    const cl = (v) => Math.max(-1.12, Math.min(1.12, v / fs));
    fx = approach(fx, cl(lat), e, 8);
    fy = approach(fy, cl(fwd), e, 8);
    vNeedle.position.x = fx * span;
    hNeedle.position.y = fy * span;
    void game;
  }
  return finish(group, s, s, update);
}
