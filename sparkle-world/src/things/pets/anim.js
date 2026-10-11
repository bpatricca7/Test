// Pet animation: turns a small state object (pose, speed, tricks, happiness...) into rig
// transforms every frame. Used by live pets and by the adoption panel's preview.
// Poses blend smoothly (stand / sit / lie / sleep); gaits: walk, trot, hop (bunny), waddle.

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (u) => u * u * (3 - 2 * u);

export function newAnim() {
  return {
    t: Math.random() * 20,
    pose: 'stand', // stand | sit | lie | sleep
    sit: 0, lie: 0, sleep: 0,
    speed: 0, // horizontal speed (m/s)
    phase: Math.random() * TAU,
    air: 0, airTarget: 0,
    swim: false,
    happy: 0, // seconds of extra happiness left (wag, squint, tongue)
    eat: 0, // seconds of nibbling left
    trick: null, trickT: 0, trickDur: 1,
    lookYaw: 0, lookPitch: 0, curYaw: 0, curPitch: 0,
    hideLeft: 0, hide: 0, // turtles: seconds left inside the shell, and the blend weight
    blinkT: 1 + Math.random() * 3, blinkLeft: 0,
    earT: 2 + Math.random() * 3, earLeft: 0, earSide: 0,
    wag: 0.3,
    flying: false,
  };
}

const TRICK_DUR = { hop: 0.75, spin: 1.5, groom: 2.4, binky: 0.8, roll: 1.5, flap: 1.3, rear: 1.4, shake: 0.7 };

/** Show or hide a rig part: separate meshes use visible, merged rigs (bones) use scale 0. */
function show(o, on, sy = 1) {
  o.visible = on;
  if (on) o.scale.set(1, sy, 1);
  else o.scale.set(0, 0, 0);
}

/** Start a little trick animation ('hop' is the happy jump every species can do). */
export function playTrick(a, name) {
  a.trick = name;
  a.trickT = 0;
  a.trickDur = TRICK_DUR[name] || 1;
}

function approach(v, target, rate, dt) {
  const k = Math.min(1, rate * dt);
  return v + (target - v) * k;
}

/** Apply one frame of animation to a rig. */
export function animate(rig, a, dt) {
  a.t += dt;
  const t = a.t;
  const spec = rig.spec;
  const gait = spec.gait;
  const horse = gait === 'trot';
  const crawl = gait === 'crawl';
  const low = horse; // horses lie down instead of sitting (turtles just rest as they are)

  // ----- pose weights -----
  const wantSit = a.pose === 'sit' && !low && !crawl ? 1 : 0;
  const wantLie = a.pose === 'lie' || a.pose === 'sleep' || (a.pose === 'sit' && low) ? 1 : 0;
  a.sit = approach(a.sit, wantSit, 7, dt);
  a.lie = approach(a.lie, wantLie, 5, dt);
  a.sleep = approach(a.sleep, a.pose === 'sleep' ? 1 : 0, 3, dt);
  a.air = approach(a.air, a.airTarget, 10, dt);
  if (a.happy > 0) a.happy = Math.max(0, a.happy - dt);
  if (a.eat > 0) a.eat = Math.max(0, a.eat - dt);
  const ws = a.sit, wl = a.lie, wz = a.sleep;

  // ----- reset -----
  const J = rig.jumper, B = rig.body, H = rig.head, L = rig.legs;
  J.position.set(0, 0, 0);
  J.rotation.set(0, 0, 0);
  B.position.y = rig.bodyY;
  B.rotation.set(0, 0, 0);
  H.rotation.set(0, 0, 0);
  for (const l of rig.legs) l.rotation.set(0, 0, 0);
  if (rig.tail) rig.tail.rotation.set(0, 0, 0);
  if (rig.tail2) rig.tail2.rotation.set(0, 0, 0);
  for (const e of rig.ears) e.rotation.set(0, 0, 0);
  for (const w of rig.wings) w.rotation.set(0, 0, 0);
  if (rig.mane) rig.mane.rotation.set(0, 0, 0);
  if (rig.canHide) {
    H.position.copy(rig.headRest);
    H.scale.setScalar(1);
    for (let i = 0; i < L.length; i++) {
      L[i].position.copy(rig.legRest[i]);
      L[i].scale.setScalar(1);
    }
    if (rig.tail) {
      rig.tail.position.copy(rig.tailRest);
      rig.tail.scale.setScalar(1);
    }
  }

  // ----- gait -----
  const legLen = rig.legLen;
  const move = clamp01(a.speed / Math.max(1, spec.speed)) * (1 - wl) * (1 - ws);
  const stepRate = Math.min(4.6, Math.max(1.7, 0.95 / legLen));
  a.phase += dt * (a.swim ? 9 : a.speed * stepRate + (move > 0.02 ? 0 : 0));
  const ph = a.phase;
  if (a.swim && wl < 0.5 && crawl) {
    // flippers: long sweeping strokes, the back ones kicking
    for (let i = 0; i < L.length; i++) {
      const back = i > 1, side = i % 2 ? -1 : 1;
      L[i].rotation.y = side * Math.sin(ph * 0.7 + (back ? 1.6 : 0)) * (back ? 0.45 : 0.7);
      L[i].rotation.z = side * (0.25 + Math.sin(ph * 0.7) * 0.2);
    }
    H.rotation.x -= 0.12;
  } else if (a.swim && wl < 0.5) {
    for (let i = 0; i < L.length; i++) L[i].rotation.x = Math.sin(ph + i * 1.7) * 0.55;
    B.rotation.x -= 0.12;
  } else if (gait === 'hop') {
    if (move > 0.05) {
      const u = (ph / TAU) % 1;
      const lift = Math.sin(u * Math.PI);
      J.position.y += lift * 0.17 * Math.min(1, move * 1.5);
      B.rotation.x += -0.22 * Math.cos(u * TAU) * move;
      for (const l of rig.back) l.rotation.x += 0.9 * lift * move;
      for (const l of rig.front) l.rotation.x += -0.7 * lift * move;
      for (const e of rig.ears) e.rotation.x += -0.35 * lift * move;
    }
  } else if (gait === 'waddle') {
    const amp = move * 0.9;
    L[0].rotation.x = Math.sin(ph) * amp;
    L[1].rotation.x = -Math.sin(ph) * amp;
    J.rotation.z = Math.sin(ph) * 0.16 * move;
    J.position.y += Math.abs(Math.sin(ph)) * 0.025 * move;
    for (let i = 0; i < rig.wings.length; i++) rig.wings[i].rotation.z = (i ? -1 : 1) * (0.15 * move + Math.abs(Math.sin(ph)) * 0.25 * move);
  } else if (crawl) {
    // a slow, steady turtle walk: diagonal pairs, a gentle rock of the shell
    const amp = move * 0.55;
    const s = Math.sin(ph);
    L[0].rotation.x = s * amp;
    L[3].rotation.x = s * amp;
    L[1].rotation.x = -s * amp;
    L[2].rotation.x = -s * amp;
    B.rotation.z = Math.sin(ph) * 0.05 * move;
    H.rotation.y += Math.sin(ph * 0.5) * 0.08 * move;
    B.position.y += Math.abs(Math.cos(ph)) * 0.012 * move;
  } else {
    const gallop = horse && spec.big ? clamp01((a.speed - spec.speed * 1.15) / 3) : 0;
    const amp = move * (horse ? 0.62 : 0.72) + gallop * 0.25;
    const s = Math.sin(ph);
    L[0].rotation.x = s * amp;
    L[3].rotation.x = s * amp;
    L[1].rotation.x = -s * amp;
    L[2].rotation.x = -s * amp;
    B.position.y += Math.abs(Math.cos(ph)) * 0.035 * move * (horse ? 1.6 : 1);
    H.rotation.x += Math.sin(ph * 2) * 0.05 * move;
    if (gallop > 0) {
      // a rocking-horse canter when she rides fast
      B.rotation.x += Math.sin(ph) * 0.06 * gallop;
      H.rotation.x -= Math.sin(ph) * 0.08 * gallop;
    }
    if (rig.mane) rig.mane.rotation.z = Math.sin(ph) * 0.04 * move;
  }

  // ----- idle life -----
  B.position.y += Math.sin(t * 2.1) * 0.005 * (1 - move);
  a.blinkT -= dt;
  if (a.blinkT <= 0) {
    a.blinkLeft = 0.13;
    a.blinkT = Math.random() < 0.2 ? 0.25 : 1.6 + Math.random() * 3.4;
  }
  if (a.blinkLeft > 0) a.blinkLeft -= dt;
  a.earT -= dt;
  if (a.earT <= 0) {
    a.earLeft = 0.35;
    a.earSide = Math.random() < 0.5 ? 0 : 1;
    a.earT = 1.8 + Math.random() * 4;
  }
  if (a.earLeft > 0) {
    a.earLeft -= dt;
    const e = rig.ears[a.earSide];
    if (e) e.rotation.z += Math.sin((1 - a.earLeft / 0.35) * TAU) * 0.3 * (a.earSide ? -1 : 1);
  }

  // tail
  const happy = a.happy > 0 ? 1 : 0;
  const wag = Math.min(1, a.wag + happy);
  if (rig.tail) {
    const T = rig.tail;
    if (spec.key === 'kitty' || rig.species === 'kitty') {
      T.rotation.y = Math.sin(t * (1.6 + wag * 2)) * (0.3 + wag * 0.2);
      if (rig.tail2) rig.tail2.rotation.x = -0.2 + Math.sin(t * 2.2 + 1) * 0.25;
    } else if (horse) {
      T.rotation.y = Math.sin(t * 1.4) * 0.22 + Math.sin(t * 7) * 0.08 * wag;
      T.rotation.x = Math.sin(t * 1.1) * 0.06 - 0.25 * move;
    } else {
      const f = 5 + wag * 11;
      T.rotation.y = Math.sin(t * f) * (0.2 + wag * 0.45);
    }
    T.rotation.y += 1.1 * wz;
  }
  if (rig.wings.length && gait === 'waddle' && move < 0.05) {
    rig.wings[0].rotation.z += Math.sin(t * 3) * 0.04;
    rig.wings[1].rotation.z -= Math.sin(t * 3) * 0.04;
  }

  // ----- sit -----
  if (ws > 0.001) {
    const bunny = gait === 'hop';
    if (gait === 'waddle') {
      B.position.y -= legLen * 0.9 * ws;
      for (const l of L) l.rotation.x += -1.3 * ws;
    } else {
      B.rotation.x += (bunny ? -0.55 : -0.48) * ws;
      B.position.y -= legLen * (bunny ? 0.25 : 0.5) * ws;
      for (const l of rig.back) l.rotation.x += (bunny ? 0.2 : -1.25) * ws;
      for (const l of rig.front) l.rotation.x += (bunny ? -0.1 : 0.48) * ws;
      H.rotation.x += 0.36 * ws;
    }
  }
  // ----- lie / sleep -----
  if (wl > 0.001) {
    B.position.y -= legLen * (horse ? 0.78 : 0.9) * wl;
    for (const l of rig.front) l.rotation.x += -1.45 * wl;
    for (const l of rig.back) l.rotation.x += (horse ? -1.5 : -1.35) * wl;
    H.rotation.x += 0.12 * wl;
    if (wz > 0.001) {
      H.rotation.x += 0.26 * wz;
      H.rotation.y += 0.42 * wz;
      B.rotation.z += 0.1 * wz;
      B.position.y += Math.sin(t * 1.7) * 0.01 * wz;
      for (const e of rig.ears) e.rotation.x += (gait === 'hop' ? -1.1 : -0.15) * wz;
    }
  }

  // ----- air -----
  if (a.air > 0.01 && !a.swim) {
    for (const l of rig.front) l.rotation.x += -0.55 * a.air;
    for (const l of rig.back) l.rotation.x += 0.6 * a.air;
    for (const e of rig.ears) e.rotation.x += -0.25 * a.air;
    if (a.flying) {
      for (let i = 0; i < L.length; i++) L[i].rotation.x += Math.sin(t * 9 + (i % 2) * Math.PI) * 0.35;
    }
  }

  // ----- eating -----
  if (a.eat > 0) {
    if (horse) {
      B.rotation.x += 0.2;
      H.rotation.x += 0.75 + Math.sin(t * 14) * 0.1;
    } else {
      H.rotation.x += 0.45 + Math.sin(t * 16) * 0.12;
    }
  }

  // ----- tricks -----
  if (a.trick) {
    a.trickT += dt;
    const u = clamp01(a.trickT / a.trickDur);
    const bell = Math.sin(u * Math.PI);
    switch (a.trick) {
      case 'hop':
        J.position.y += bell * (horse ? 0.5 : 0.45);
        J.rotation.y += ease(u) * TAU;
        for (const l of rig.front) l.rotation.x -= 0.6 * bell;
        for (const l of rig.back) l.rotation.x += 0.6 * bell;
        break;
      case 'spin':
        J.rotation.y += ease(u) * TAU * 2;
        J.position.y += Math.abs(Math.sin(u * Math.PI * 4)) * 0.08;
        break;
      case 'groom': {
        B.rotation.x += -0.48 * bell;
        B.position.y -= legLen * 0.5 * bell;
        for (const l of rig.back) l.rotation.x += -1.25 * bell;
        L[0].rotation.x += 0.48 * bell;
        L[1].rotation.x += (-1.7 + Math.sin(t * 12) * 0.25) * bell;
        H.rotation.x += 0.25 * bell;
        H.rotation.z += 0.25 * bell;
        break;
      }
      case 'binky':
        J.position.y += bell * 0.5;
        J.rotation.z += Math.sin(u * TAU) * 0.55;
        J.rotation.y += Math.sin(u * TAU) * 0.4;
        for (const e of rig.ears) e.rotation.x += -0.5 * bell;
        break;
      case 'roll':
        J.position.y += bell * 0.55;
        J.rotation.z += ease(u) * TAU;
        break;
      case 'flap':
        for (let i = 0; i < rig.wings.length; i++) rig.wings[i].rotation.z += (i ? -1 : 1) * (0.9 + Math.sin(t * 34) * 0.5) * bell;
        J.position.y += Math.abs(Math.sin(u * Math.PI * 3)) * 0.12;
        break;
      case 'rear':
        B.rotation.x += -0.55 * bell;
        for (const l of rig.front) l.rotation.x += (-0.9 + Math.sin(t * 14) * 0.35) * bell;
        H.rotation.x += -0.2 * bell;
        break;
      case 'shake':
        J.rotation.z += Math.sin(u * Math.PI * 10) * 0.2 * bell;
        break;
      default:
        break;
    }
    if (u >= 1) a.trick = null;
  }

  // ----- turtle: tucked into the shell -----
  if (rig.canHide) {
    if (a.hideLeft > 0) a.hideLeft = Math.max(0, a.hideLeft - dt);
    a.hide = approach(a.hide, a.hideLeft > 0 ? 1 : 0, a.hideLeft > 0 ? 12 : 3.2, dt);
    const h = a.hide;
    if (h > 0.001) {
      const k = 1 - 0.72 * h;
      H.position.z -= 0.22 * h;
      H.position.y -= 0.05 * h;
      H.scale.setScalar(k);
      for (let i = 0; i < L.length; i++) {
        L[i].position.x *= 1 - 0.3 * h;
        L[i].position.y += 0.06 * h;
        L[i].scale.set(k, k, k);
      }
      if (rig.tail) {
        rig.tail.position.z += 0.12 * h;
        rig.tail.scale.setScalar(k);
      }
      B.position.y -= 0.1 * h;
      J.rotation.z += Math.sin(t * 30) * 0.03 * h * (a.hideLeft > 0 && a.hideLeft < 0.5 ? 1 : 0);
    }
  }

  // ----- look -----
  const lookK = Math.min(1, 5 * dt);
  const maxYaw = horse ? 0.5 : 0.75;
  a.curYaw += (Math.max(-maxYaw, Math.min(maxYaw, a.lookYaw)) * (1 - wz) - a.curYaw) * lookK;
  a.curPitch += (Math.max(-0.4, Math.min(0.4, a.lookPitch)) * (1 - wz) - a.curPitch) * lookK;
  H.rotation.y += a.curYaw;
  H.rotation.x += a.curPitch;
  if (happy) {
    H.rotation.z += Math.sin(t * 5) * 0.08;
    for (const e of rig.ears) e.rotation.x += -0.12;
  }

  // ----- face -----
  const sleepy = wz > 0.5 || a.hide > 0.6;
  const joy = !sleepy && happy && a.eat <= 0;
  const ey = a.blinkLeft > 0 ? 0.12 : 1;
  for (const e of rig.eyes) {
    const hm = e.userData.happy, sm = e.userData.sleepy;
    show(e, !sleepy && !joy, ey);
    if (hm) show(hm, joy);
    if (sm) show(sm, sleepy);
  }
  if (rig.tongue) show(rig.tongue, (happy > 0 || (move > 0.6 && a.speed > spec.speed * 1.1)) && a.eat <= 0 && wz < 0.5);
}
