// The message itself: fold (96-118), recognition (118-138), visitor (138-160).
//
// 1,679 cubes, one per bit. They stream through space as a helix, feed into
// the top of the 23 x 73 grid one row at a time, our 1974 original flies in
// behind them, a scan finds the difference, and the new figure steps out.

export async function create({ THREE, TL, ENV, U }) {
  const { clamp, lerp, smooth, easeInOut, easeOut, prog, mulberry32 } = U;
  const COLS = TL.grid.cols, ROWS = TL.grid.rows;
  const SENT = TL.grid.sent, RET = TL.grid.returned;
  const F = TL.fold, R = TL.recognition, V = TL.visitor;
  const N = COLS * ROWS;

  const gx = c => c - (COLS - 1) / 2;
  const gy = r => (ROWS - 1) / 2 - r;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010207);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 6000);

  // ---- light ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x05060c, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-40, 60, 80);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fb6ff, 1.2);
  rim.position.set(60, -20, -80);
  scene.add(rim);

  // ---- space backdrop --------------------------------------------------------
  const rnd = mulberry32(7301);
  const glowTex = U.makeGlowTexture(THREE, 64, 0.2);
  {
    const n = 7000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = 1800 + rnd() * 600;
      const s = Math.sqrt(1 - u * u);
      pos.set([rr * s * Math.cos(th), rr * u, rr * s * Math.sin(th)], i * 3);
      const m = 0.25 + Math.pow(rnd(), 4) * 1.6, tint = rnd();
      const c = tint < 0.15 ? [1, 0.85, 0.7] : tint < 0.4 ? [0.75, 0.85, 1] : [1, 1, 1];
      col.set(c.map(v => v * m), i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
      size: 9, map: glowTex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    })));
    // faint colored nebula haze
    for (const [x, y, z, s, c, o] of [
      [-900, 300, -1500, 2600, 0x2a3f9a, 0.10], [1100, -500, -1700, 2400, 0x5a2a8a, 0.07],
      [300, 900, -1800, 2000, 0x1f6f8a, 0.06], [-400, -900, 1500, 2600, 0x2a2f7a, 0.06],
    ]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      sp.position.set(x, y, z);
      sp.scale.set(s, s, 1);
      scene.add(sp);
    }
  }
  // dust drifting around the picture, for parallax
  const dust = (() => {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(rnd() - 0.5) * 260, (rnd() - 0.5) * 200, (rnd() - 0.5) * 220], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.9, map: glowTex, color: 0x7f9cff, transparent: true, opacity: 0.35, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    scene.add(p);
    return p;
  })();

  // ---- the bits --------------------------------------------------------------
  const emissive = { value: 1.0 };
  function glowingStandard(params) {
    const m = new THREE.MeshStandardMaterial(params);
    m.onBeforeCompile = sh => {
      sh.uniforms.uEmissive = emissive;
      sh.fragmentShader = 'uniform float uEmissive;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )\n totalEmissiveRadiance += vColor.rgb * uEmissive;\n#endif');
    };
    return m;
  }
  const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
  const bits = new THREE.InstancedMesh(cubeGeo, glowingStandard({ color: 0xffffff, metalness: 0.35, roughness: 0.35 }), N);
  bits.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bits.frustumCulled = false;
  scene.add(bits);
  for (let i = 0; i < N; i++) bits.setColorAt(i, new THREE.Color(1, 1, 1));
  bits.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // our 1974 original: a ghost layer of only its lit bits
  const ghostIdx = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (SENT[r][c]) ghostIdx.push([r, c]);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const ghost = new THREE.InstancedMesh(new THREE.BoxGeometry(0.82, 0.82, 0.12), ghostMat, ghostIdx.length);
  ghost.frustumCulled = false;
  for (let i = 0; i < ghostIdx.length; i++) ghost.setColorAt(i, new THREE.Color(0.3, 0.55, 1.0));
  scene.add(ghost);

  // scan bar
  const scanGroup = new THREE.Group();
  const scanBar = new THREE.Mesh(new THREE.PlaneGeometry(34, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xc8faff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const trailTex = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(120,230,255,0)'); gr.addColorStop(1, 'rgba(120,230,255,0.9)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const scanTrail = new THREE.Mesh(new THREE.PlaneGeometry(34, 7),
    new THREE.MeshBasicMaterial({ map: trailTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3 }));
  scanTrail.position.y = 3.5;
  scanGroup.add(scanBar, scanTrail);
  scanGroup.position.z = 0.6;
  scene.add(scanGroup);

  // ---- per-bit data ------------------------------------------------------------
  const vb = V.box, hb = V.human_box;
  const inVisitor = (r, c) => r >= vb.r0 && r <= vb.r1 && c >= vb.c0 && c <= vb.c1 && RET[r][c];
  const inHuman = (r, c) => r >= hb.r0 && r <= hb.r1 && c >= hb.c0 && c <= hb.c1;
  const visCx = gx((vb.c0 + vb.c1) / 2), visCy = gy((vb.r0 + vb.r1) / 2);
  const shoulder = { x: gx(vb.c1) - visCx, y: gy(vb.r0 + 5) - visCy };   // pivot of the right arm
  const isRightArm = (r, c) => c === vb.c1 && (r === vb.r0 + 6 || r === vb.r0 + 7);

  const tumble = [];
  const tr = mulberry32(55);
  for (let i = 0; i < N; i++) {
    const ax = new THREE.Vector3(tr() - 0.5, tr() - 0.5, tr() - 0.5).normalize();
    tumble.push({ ax, spin: 2 + tr() * 4, jit: tr() });
  }

  // ---- the stream: a helix along a meandering path into the top of the grid ----
  const V_STREAM = 200;                                   // units per second
  const SPACING = F.row_stagger * V_STREAM / COLS;        // so each row arrives row_stagger apart
  const S0 = (F.fold.start - F.snake.start) * V_STREAM;   // head distance at snake start
  const ENTRY = new THREE.Vector3(gx(COLS - 1) + 3, gy(0) + 3, 0);
  const D = new THREE.Vector3(0.95, 0.0, -1.0).normalize();
  const N1 = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
  const N2 = new THREE.Vector3().crossVectors(N1, D).normalize();
  const tmpP = new THREE.Vector3();

  function pathPoint(s, out) {
    out.copy(ENTRY).addScaledVector(D, s);
    if (s > 0) {
      const k = smooth(60, 520, s);
      out.addScaledVector(N1, 34 * Math.sin(s * 0.0042) * k);
      out.addScaledVector(N2, 22 * Math.sin(s * 0.0029 + 1.1) * k);
      const R = 4.2 * smooth(0, 24, s);
      const w = s * 0.075;
      out.addScaledVector(N1, R * Math.cos(w)).addScaledVector(N2, R * Math.sin(w));
    }
    return out;
  }
  const headS = t => S0 - V_STREAM * (t - F.snake.start);
  const entryTime = i => F.snake.start + (S0 + i * SPACING) / V_STREAM;

  // ---- helpers -------------------------------------------------------------------
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const C = new THREE.Color();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C1 = new THREE.Vector3(), C2 = new THREE.Vector3();
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();

  function bezier(p0, p1, p2, p3, u, out) {
    const v = 1 - u;
    return out.set(0, 0, 0)
      .addScaledVector(p0, v * v * v).addScaledVector(p1, 3 * v * v * u)
      .addScaledVector(p2, 3 * v * u * u).addScaledVector(p3, u * u * u);
  }

  // camera shots, each a function of t writing camPos / camTgt / fov
  function shotFollow(t) {
    const h = headS(t);
    pathPoint(h - 12, camPos);
    camPos.addScaledVector(N1, -24).addScaledVector(N2, 9);
    pathPoint(h + 48, camTgt);
    camTgt.addScaledVector(N1, -10);
    return 46;
  }
  function shotGrid(t) {
    // waiting at the top of the grid as the stream pours in, easing down and
    // out as it fills, then a slow orbit once it is complete
    const fill = easeInOut(prog(t, F.fold.start - 0.5, F.fold.end - 1));
    const ty = lerp(17, 0, fill);
    const o = easeInOut(prog(t, F.orbit.start, F.orbit.end + 2));
    const ang = Math.sin(o * Math.PI) * 0.5 + lerp(0.42, 0, fill);
    const tx = lerp(30, 0, fill);
    const dist = lerp(104, 128, fill) - 10 * o;
    camPos.set(tx * 0.4 + Math.sin(ang) * dist, ty + 2 + Math.sin(o * Math.PI) * 6, Math.cos(ang) * dist);
    camTgt.set(tx, ty, 0);
    return 40;
  }
  function shotRecognition(t) {
    const p = easeInOut(prog(t, R.move_left.start, R.move_left.end));
    const drift = prog(t, R.move_left.start, 138);
    const yaw = 0.16 * Math.sin(drift * Math.PI * 0.9);          // parallax so the ghost reads as a layer behind
    const dist = lerp(128, 118, drift);
    const off = lerp(0, 38, p);
    camPos.set(off + Math.sin(yaw) * dist, lerp(2, 0, p), Math.cos(yaw) * dist);
    camTgt.set(off, 0, 0);
    return 40;
  }
  function shotPush(t) {
    const p = easeInOut(prog(t, V.push_in.start, V.push_in.end));
    shotRecognition(Math.min(t, 137.99));
    const a = camPos.clone(), b = camTgt.clone();
    const cx = lerp(gx(8), visCx, smooth(V.step_out.start, V.turn.end, t));
    const cy = gy(52) - 2.2;
    const dist = lerp(46, 40, prog(t, V.push_in.end, 160));
    camPos.lerpVectors(a, new THREE.Vector3(cx + 2, cy + 1.5, dist), p);
    camTgt.lerpVectors(b, new THREE.Vector3(cx, cy, 0), p);
    // a gentle handheld sway once we're close
    const sway = p * 0.25;
    camPos.x += Math.sin(t * 0.7) * sway; camPos.y += Math.sin(t * 0.53 + 1) * sway;
    return lerp(40, 36, p);
  }

  let fov = 40;
  function placeCamera(t) {
    // ride with the stream, then cut ahead to the grid and watch it pour in
    if (t < F.fold.start - 0.55) fov = shotFollow(t);
    else if (t < R.move_left.start) fov = shotGrid(t);
    else if (t < V.push_in.start) fov = shotRecognition(t);
    else fov = shotPush(t);
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // ---- per frame ------------------------------------------------------------------
  function update(t) {
    placeCamera(t);
    dust.rotation.y = t * 0.01;
    dust.rotation.x = Math.sin(t * 0.05) * 0.05;

    const scanP = prog(t, V.scan.start, V.scan.end);
    const scanY = gy(0) + 0.5 - scanP * ROWS;
    const scanning = t >= V.scan.start;
    const focus = easeInOut(prog(t, V.push_in.start, V.push_in.end));
    const lift = easeInOut(prog(t, V.step_out.start, V.step_out.end));
    const turnOut = easeInOut(prog(t, V.step_out.start, V.step_out.start + 1.8));
    const turnBack = easeInOut(prog(t, V.turn.start, V.turn.end));
    const yawFig = 0.9 * turnOut * (1 - turnBack);
    const raise = easeInOut(prog(t, V.raise_hand.start, V.raise_hand.end));
    const wave = raise * Math.sin(Math.max(0, t - V.raise_hand.end) * 5.5) * 0.18 * (1 - smooth(157, 159, t));
    const armAng = raise * 2.45 + wave;
    const voice = U.envAt(ENV, 'voice_rms', t);
    const afterVoice = smooth(V.voice + 2.4, V.voice + 4.5, t);

    for (let r = 0, i = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++, i++) {
        const on = RET[r][c];
        const gxp = gx(c), gyp = gy(r);
        const te = entryTime(i);
        const land = te + F.row_flight;
        const tb = tumble[i];
        let scale = on ? 1 : 0.3;
        let depth = 1;
        Q.identity();

        if (t < te) {
          // riding the stream
          pathPoint(headS(t) + i * SPACING, P);
          Q.setFromAxisAngle(tb.ax, t * tb.spin);
          scale *= 0.9;
        } else if (t < land) {
          // folding into place
          const u = (t - te) / F.row_flight;
          const e = easeInOut(u);
          A.copy(ENTRY);
          C1.copy(ENTRY).add(new THREE.Vector3(-4, 6, 22));
          B.set(gxp, gyp, 0);
          C2.set(gxp, gyp + 4, 16);
          bezier(A, C1, C2, B, e, P);
          Q.setFromAxisAngle(tb.ax, (1 - e) * (3 + tb.spin));
          scale *= 1 + 0.35 * Math.sin(u * Math.PI);
        } else {
          P.set(gxp, gyp, 0);
          // a small settle bounce on landing
          const since = t - land;
          if (since < 0.5) P.z += Math.sin(since * 14) * Math.exp(-since * 9) * 0.8;
        }

        // brightness
        let bright = on ? 1.0 : 0.1;
        let cr = 0.82, cg = 0.9, cbl = 1.0;
        if (!on) { cr = 0.35; cg = 0.5; cbl = 1.0; }
        if (t >= land) bright += 0.8 * Math.exp(-(t - land) * 5);
        else if (t >= te) bright += 0.4;

        const visitorBit = inVisitor(r, c);
        const revealed = scanning && gyp > scanY;
        if (visitorBit && revealed) {
          const pulse = 0.85 + 0.15 * Math.sin(t * 3.1 + r * 0.5);
          cr = 1.0; cg = 0.36 + 0.25 * voice; cbl = 0.2 + 0.2 * voice;
          bright = pulse * (1.6 + 1.2 * voice) + (scanning && Math.abs(gyp - scanY) < 1 ? 1.0 : 0);
        } else if (on && scanning && Math.abs(gyp - scanY) < 1.2) {
          bright += 0.6;           // the scan lights each row as it passes
        }
        if (on && inHuman(r, c) && afterVoice > 0) bright += 0.35 * afterVoice;   // we glow back, a little

        // push-in: everything but the two figures recedes
        const inFocusRows = r >= vb.r0 && r <= vb.r1;
        if (!inFocusRows) { bright *= 1 - focus; scale *= 1 - focus; }
        if (!visitorBit && focus > 0 && inFocusRows) bright *= 1 - 0.25 * focus - 0.2 * lift;

        // the visitor steps out of the picture
        if (visitorBit && lift > 0) {
          let lx = gxp - visCx, ly = gyp - visCy;
          if (isRightArm(r, c) && armAng !== 0) {
            const dx = lx - shoulder.x, dy = ly - shoulder.y;
            const ca = Math.cos(armAng), sa = Math.sin(armAng);
            lx = shoulder.x + dx * ca - dy * sa;
            ly = shoulder.y + dx * sa + dy * ca;
          }
          const sc = 1 + 0.08 * lift;
          const cy = Math.cos(yawFig), sy = Math.sin(yawFig);
          const zl = 4 * lift;
          P.set(visCx + lx * sc * cy, visCy + ly * sc + 1.2 * lift, zl + lx * sc * -sy);
          Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawFig);
          depth = 1 + 1.2 * lift;
          scale *= sc;
        }

        S.set(scale, scale, scale * depth);
        M.compose(P, Q, S);
        bits.setMatrixAt(i, M);
        const b = Math.max(0, bright);
        C.setRGB(cr * b, cg * b, cbl * b);
        bits.setColorAt(i, C);
      }
    }
    bits.instanceMatrix.needsUpdate = true;
    bits.instanceColor.needsUpdate = true;
    emissive.value = 0.7;

    // the 1974 original flies in behind and settles as a faint layer
    const gIn = easeOut(prog(t, R.ghost_in.start, R.ghost_in.end));
    const gAlpha = t < R.ghost_in.start ? 0
      : smooth(R.ghost_in.start, R.ghost_in.start + 0.8, t) * (1 - smooth(V.scan.end, V.scan.end + 2.5, t));
    ghost.visible = gAlpha > 0.001;
    if (ghost.visible) {
      const gz = lerp(-520, -3.2, gIn);
      const rot = (1 - gIn) * 1.3;
      const gxo = lerp(-60, 0, gIn), gyo = lerp(40, 0, gIn);
      for (let k = 0; k < ghostIdx.length; k++) {
        const [r, c] = ghostIdx[k];
        P.set(gx(c), gy(r), 0).applyAxisAngle(new THREE.Vector3(0.3, 1, 0.1).normalize(), rot);
        P.x += gxo; P.y += gyo; P.z += gz;
        M.compose(P, Q.identity(), S.set(1, 1, 1));
        ghost.setMatrixAt(k, M);
        const diff = !RET[r][c];
        const hot = diff && scanning && gy(r) > scanY ? 1 : 0;
        C.setRGB(lerp(0.3, 1.0, hot), lerp(0.55, 0.3, hot), lerp(1.0, 0.25, hot));
        ghost.setColorAt(k, C);
      }
      ghost.instanceMatrix.needsUpdate = true;
      ghost.instanceColor.needsUpdate = true;
      ghostMat.opacity = 0.42 * gAlpha * (1 - focus);
    }

    // scan bar
    const sa = U.window01(t, V.scan.start - 0.15, V.scan.end + 0.35, 0.15, 0.35);
    scanGroup.visible = sa > 0;
    scanGroup.position.y = scanY;
    scanBar.material.opacity = sa;
    scanTrail.material.opacity = 0.35 * sa;
  }

  function bloom(t) {
    // stronger glow on landings and on the visitor's voice
    const v = U.envAt(ENV, 'voice_rms', t);
    return { strength: 0.7 + 0.35 * v, radius: 0.35, threshold: 0.62 };
  }

  return { scene, camera, update, bloom };
}
