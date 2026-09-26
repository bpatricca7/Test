// Viewing angles of the LM panels from the CDR design eye (LM-CABIN helper): node dev/lm-cabin-angles.mjs
import * as THREE from 'three';
import { LM } from '../src/core/constants.js';
import { panelLayout } from '../src/render/cockpit/lm/layout.js';
const L = panelLayout();
const eye = LM.eyeCDR;
for (const [id, x] of [['p1B', -0.075], ['p1B', 0.105], ['p1A', 0], ['p4', 0], ['p3L', 0]]) {
  const f = L[id].frame;
  const c = f.center.clone().addScaledVector(f.right, x);
  const d = c.clone().sub(eye);
  const dep = Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI;
  const view = Math.acos(-d.clone().normalize().dot(f.normal)) * 180 / Math.PI;
  const top = f.center.clone().addScaledVector(f.up, L[id].h / 2); const dt = top.sub(eye);
  console.log(id, x, 'dist', d.length().toFixed(2), 'depression', dep.toFixed(1), 'view-angle-to-normal', view.toFixed(1), 'top edge depression', (Math.atan2(-dt.y, Math.hypot(dt.x, dt.z)) * 180 / Math.PI).toFixed(1));
}
