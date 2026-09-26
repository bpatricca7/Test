// Tests for SKY-FX logic that runs without WebGL: RCS effect lifetime, cloud climatology, exposure /
// bloom settings sanity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAYERS } from '../src/core/constants.js';
import { createLM, createCSM } from '../src/core/state.js';
import { createRcsEffects } from '../src/render/fx/rcs.js';
import { prepareEarth, generateEarthRows } from '../src/render/sky/skyGen.js';
import { EXPOSURE_PROFILES, BLOOM } from '../src/render/post.js';

const ctx = { THREE, quality: 'low', LAYERS };

test('RCS effects re-attach to a reloaded vessel without allocating new GPU objects', () => {
  const lm = createLM();
  const fx = createRcsEffects(ctx, lm);
  const geos = [];
  fx.group.traverse((o) => o.geometry && geos.push(o.geometry));
  assert.ok(geos.length >= 2, 'cones + vapour pool');
  let disposed = 0;
  for (const g of geos) g.addEventListener('dispose', () => disposed++);
  // a scenario reload recreates the vessel (new jet table, same layout)
  const lm2 = createLM();
  assert.notEqual(lm2.rcs.jets, lm.rcs.jets);
  assert.equal(fx.rebind(lm2), true);
  assert.equal(disposed, 0);
  // the rebound effects follow the NEW table
  lm2.rcs.jets[3].level = 1;
  fx.update({}, lm2, 0.1, 1 / 60, 1);
  assert.ok(fx.pool.active, 'firing jet emits vapour');
  // a different layout is refused (caller rebuilds) and dispose frees everything
  assert.equal(fx.rebind(createCSM()), lm2.rcs.jets.length === createCSM().rcs.jets.length);
  fx.dispose();
  assert.equal(disposed, geos.length);
  assert.equal(fx.group.parent, null);
});

test('RCS vapour is short-lived and thinning (no lingering clumps)', () => {
  const lm = createLM();
  const fx = createRcsEffects(ctx, lm);
  lm.rcs.jets[0].level = 1;
  let t = 0;
  for (let i = 0; i < 6; i++) fx.update({}, lm, (t += 1 / 60), 1 / 60, 1);
  lm.rcs.jets[0].level = 0;
  const T = fx.pool.aT.array;
  let maxLife = 0;
  for (let i = 0; i < fx.pool.capacity; i++) maxLife = Math.max(maxLife, T[i * 4 + 1]);
  assert.ok(maxLife > 0 && maxLife <= 0.2, `puff life ${maxLife} s`);
  assert.ok(fx.pool.uniforms.uThin.value > 0, 'puffs dim as they expand');
  // 0.25 s after the valve closed nothing is left
  for (let i = 0; i < 15; i++) fx.update({}, lm, (t += 1 / 60), 1 / 60, 1);
  assert.equal(fx.pool.active, false);
  fx.dispose();
});

test('Earth clouds: July climatology structure', () => {
  const W = 256;
  const H = 128;
  const prep = prepareEarth(W, H);
  const alb = new Uint8Array(W * H * 4);
  const cl = new Uint8Array(W * H * 4);
  generateEarthRows(prep, 0, H, alb, cl);
  const mean = (lat0, lat1, lon0, lon1) => {
    let s = 0;
    let n = 0;
    for (let y = 0; y < H; y++) {
      const lat = 90 - ((y + 0.5) / H) * 180;
      if (lat < lat0 || lat > lat1) continue;
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * 360 - 180;
        if (lon < lon0 || lon > lon1) continue;
        s += cl[(y * W + x) * 4] / 255;
        n++;
      }
    }
    return s / n;
  };
  const itcz = mean(5, 11, -170, -100);
  const subtrop = mean(-28, -15, -150, -110); // SE Pacific trade-wind belt (clear-ish)
  const sahara = mean(18, 28, -10, 25);
  const southernOcean = mean(-62, -48, -180, 180);
  assert.ok(itcz > subtrop * 1.3, `ITCZ ${itcz} vs trades ${subtrop}`);
  assert.ok(sahara < 0.12, `Sahara ${sahara}`);
  assert.ok(southernOcean > 0.45, `Southern Ocean ${southernOcean}`);
  let tot = 0;
  let wsum = 0;
  for (let y = 0; y < H; y++) {
    const w = Math.cos((90 - ((y + 0.5) / H) * 180) * (Math.PI / 180));
    for (let x = 0; x < W; x++) tot += (cl[(y * W + x) * 4] / 255) * w;
    wsum += w * W;
  }
  const f = tot / wsum;
  assert.ok(f > 0.27 && f < 0.6, `global cloud fraction (opacity-weighted) ${f}`);
});

test('exposure and bloom settings keep sunlit diffuse surfaces out of the glow', () => {
  for (const p of Object.values(EXPOSURE_PROFILES)) {
    assert.ok(p.minEV < p.maxEV && p.litMaxEV <= p.maxEV);
    assert.ok(p.vHi > p.hi && p.vPull > 0);
  }
  // exterior: a sunlit scene may open at most ~x20-x32 ("sunny 16" + 2 stops), which keeps the
  // (art-directed) star field below visibility together with the star-visibility gate
  assert.ok(EXPOSURE_PROFILES.exterior.litMaxEV <= Math.log2(32));
  // Soft-knee prefilter (same maths as post.js): fraction of a pixel's value that glows.
  const glow = (L) => {
    const k = BLOOM.knee;
    let soft = Math.min(Math.max(L - BLOOM.threshold + k, 0), 2 * k);
    soft = (soft * soft) / (4 * k + 1e-4);
    return Math.max(soft, L - BLOOM.threshold) / L;
  };
  // a white Lambertian facing the Sun (7/pi) at a typical sunlit exterior exposure (x3) barely glows;
  // regolith (albedo ~0.12) and mid-grey paint never do. The Sun disc (clamped to 64) always does.
  assert.ok(glow((7 / Math.PI) * 3) < 0.03, `white card glow ${glow((7 / Math.PI) * 3)}`);
  assert.equal(glow(0.12 * (7 / Math.PI) * 3), 0);
  assert.ok(glow(64) > 0.8);
});
