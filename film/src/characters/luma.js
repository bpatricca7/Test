// LUMA — a pearly, floating explorer robot with glowing eyes and a spinning halo ring.
import * as THREE from 'three';
import { autoBlink, clamp, lerp } from '../lib/anim.js';

const GLOW = new THREE.Color('#5fe6ff');

function eggProfile() {
  const pts = [
    [0.0, -0.44], [0.035, -0.43], [0.075, -0.39], [0.115, -0.32], [0.15, -0.23], [0.172, -0.14], [0.18, -0.07],
    [0.174, -0.015], [0.155, 0.025], [0.12, 0.05], [0.07, 0.063], [0.0, 0.068],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const curve = new THREE.SplineCurve(pts);
  return curve.getPoints(48).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}

export class Luma {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Luma';
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.squashG = new THREE.Group();
    this.tilt.add(this.squashG);

    const pearl = new THREE.MeshPhysicalMaterial({ color: '#f5f2ec', roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color('#cfe8ff') });
    const visorMat = new THREE.MeshPhysicalMaterial({ color: '#05070b', roughness: 0.12, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.mats = { pearl, visorMat };
    const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    this.body = cast(new THREE.Mesh(new THREE.LatheGeometry(eggProfile(), 48), pearl));
    this.squashG.add(this.body);

    // soft glowing belt seam
    this.beltMat = new THREE.MeshBasicMaterial({ color: GLOW.clone().multiplyScalar(1.5) });
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.006, 8, 64), this.beltMat);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.06;
    this.squashG.add(belt);

    this.headG = new THREE.Group();
    this.headG.position.y = 0.245;
    this.squashG.add(this.headG);
    const head = cast(new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 32), pearl));
    head.scale.set(1.08, 0.9, 1.0);
    this.headG.add(head);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2015, 48, 24, Math.PI / 2 - 1.0, 2.0, 0.62, 1.22), visorMat);
    visor.scale.copy(head.scale);
    this.headG.add(visor);

    // eyes are painted into a canvas each frame and wrapped over the visor
    this.eyeCanvas = document.createElement('canvas');
    this.eyeCanvas.width = 512;
    this.eyeCanvas.height = 262;
    this.eyeTex = new THREE.CanvasTexture(this.eyeCanvas);
    this.eyeTex.colorSpace = THREE.SRGBColorSpace;
    this.eyeMat = new THREE.MeshBasicMaterial({ map: this.eyeTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.2, 2.2, 2.2) });
    const eyes = new THREE.Mesh(new THREE.SphereGeometry(0.203, 48, 24, Math.PI / 2 - 1.0, 2.0, 0.62, 1.22), this.eyeMat);
    eyes.scale.copy(head.scale);
    this.headG.add(eyes);

    // little antenna-bud on top of the head
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: GLOW.clone().multiplyScalar(2) }));
    bud.position.y = 0.19;
    this.bud = bud;
    this.headG.add(bud);

    // floating fin-arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.225, -0.08, 0);
      const fin = cast(new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 16), pearl));
      fin.scale.set(0.75, 2.0, 1.1);
      fin.position.y = -0.06;
      pivot.add(fin);
      this.squashG.add(pivot);
      this.arms.push({ pivot, side });
    }

    // halo ring
    this.ringG = new THREE.Group();
    this.ringG.position.y = -0.1;
    this.ringMat = new THREE.MeshBasicMaterial({ color: GLOW.clone().multiplyScalar(2.0), transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.007, 8, 96), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    this.ringG.add(ring);
    for (let i = 0; i < 3; i++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), this.ringMat);
      const a = (i / 3) * Math.PI * 2;
      bead.position.set(Math.cos(a) * 0.34, 0, Math.sin(a) * 0.34);
      this.ringG.add(bead);
    }
    this.tilt.add(this.ringG);

    // hover light (point light that softly lights the ground & friends)
    this.light = new THREE.PointLight(GLOW, 0, 6, 1.6);
    this.light.position.y = -0.3;
    this.root.add(this.light);

    // scanning beam
    const beamGeo = new THREE.ConeGeometry(0.9, 2.2, 40, 1, true);
    beamGeo.translate(0, -1.1, 0);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uAmt: { value: 0 }, uTime: { value: 0 }, uColor: { value: GLOW } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform float uAmt, uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float lines = 0.55 + 0.45 * sin(vUv.y * 60.0 - uTime * 12.0);
          float a = uAmt * pow(vUv.y, 1.5) * lines * 0.35; gl_FragColor = vec4(uColor * a * 2.0, 1.0); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(0, -0.35, 0.05);
    this.beam.rotation.x = 0.5;
    this.beam.visible = false;
    this.tilt.add(this.beam);

    this.lastEyeKey = '';
    this.pose({});
  }

  // Draw one set of eyes of a given kind with intensity `a` into the canvas.
  drawEyeKind(ctx, kind, a, st) {
    if (a <= 0.001) return;
    const W = 512, H = 262;
    const cy = H * 0.5 + st.lookY * -30, cx = W / 2 + st.lookX * 45;
    const sep = 88;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#bff6ff';
    ctx.strokeStyle = '#bff6ff';
    ctx.shadowColor = '#5fe6ff';
    ctx.shadowBlur = 26;
    ctx.lineCap = 'round';
    const open = clamp(1 - st.blink);
    for (const side of [-1, 1]) {
      const x = cx + side * sep;
      ctx.save();
      ctx.translate(x, cy);
      if (kind === 'open' || kind === 'wide') {
        const rw = kind === 'wide' ? 44 : 38, rh = (kind === 'wide' ? 58 : 50) * Math.max(0.08, open);
        ctx.rotate(side * st.tiltEyes);
        ctx.beginPath();
        ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
        ctx.fill();
        if (st.sad > 0) {
          // sad lids: cut top-inner corner
          ctx.globalCompositeOperation = 'destination-out';
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.rotate(side * -0.45 * st.sad);
          ctx.fillRect(-80, -130, 160, 110 - 40 * st.sad);
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (kind === 'happy') {
        ctx.lineWidth = 20;
        ctx.beginPath();
        ctx.arc(0, 18, 36, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      } else if (kind === 'closed') {
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.arc(0, -14, 34, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      } else if (kind === 'heart') {
        const s = 3.4 * (1 + 0.06 * Math.sin(st.t * 10));
        ctx.scale(s, s);
        ctx.beginPath();
        ctx.moveTo(0, 10);
        ctx.bezierCurveTo(-14, 0, -14, -12, -6, -12);
        ctx.bezierCurveTo(-2, -12, 0, -9, 0, -7);
        ctx.bezierCurveTo(0, -9, 2, -12, 6, -12);
        ctx.bezierCurveTo(14, -12, 14, 0, 0, 10);
        ctx.fillStyle = '#ffd0ea';
        ctx.shadowColor = '#ff5fb8';
        ctx.fill();
      } else if (kind === 'star') {
        ctx.rotate(st.t * 1.5 * side);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rad = i % 2 === 0 ? 50 : 20;
          ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        ctx.closePath();
        ctx.fill();
      } else if (kind === 'scan') {
        ctx.fillRect(-46, -8, 92, 16);
      } else if (kind === 'sleepy') {
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(-34, 6);
        ctx.lineTo(34, 6);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (kind === 'scan') {
      // sweeping scanner light between the eyes
      const sx = W / 2 + Math.sin(st.t * 5) * 150;
      const g = ctx.createRadialGradient(sx, cy, 0, sx, cy, 60);
      g.addColorStop(0, 'rgba(200,255,255,0.9)');
      g.addColorStop(1, 'rgba(200,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 60, cy - 60, 120, 120);
    }
    ctx.restore();
  }

  drawEyes(st) {
    const key = JSON.stringify([st.kind, st.kind2, st.mix.toFixed(3), st.blink.toFixed(3), st.lookX.toFixed(3), st.lookY.toFixed(3), st.sad.toFixed(2), st.tiltEyes.toFixed(3),
      ['heart', 'star', 'scan'].includes(st.kind) || ['heart', 'star', 'scan'].includes(st.kind2) ? st.t.toFixed(3) : 0]);
    if (key === this.lastEyeKey) return;
    this.lastEyeKey = key;
    const ctx = this.eyeCanvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 262);
    this.drawEyeKind(ctx, st.kind, 1 - st.mix, st);
    if (st.kind2) this.drawEyeKind(ctx, st.kind2, st.mix, st);
    this.eyeTex.needsUpdate = true;
  }

  pose(p) {
    const d = {
      x: 0, y: 1.2, z: 0, rotY: 0, pitch: 0, roll: 0, t: 0, scale: 1, squash: 1, bob: 1, seed: 0,
      eyes: 'open', eyes2: null, eyeMix: 0, blink: true, lookX: 0, lookY: 0, sad: 0, tiltEyes: 0,
      headYaw: 0, headPitch: 0, headRoll: 0,
      armL: [0.15, 0, 0], armR: [0.15, 0, 0], // [spread angle, raise (forward swing), lift]
      glow: 1, light: 0, ring: 1, ringSpin: null, beam: 0,
    };
    const q = { ...d, ...p };
    const t = q.t;
    const hover = q.bob * (Math.sin(t * 2.1 + q.seed) * 0.03 + Math.sin(t * 3.7 + q.seed * 2) * 0.01);
    this.root.position.set(q.x, q.y + hover, q.z);
    this.root.rotation.y = q.rotY;
    this.root.scale.setScalar(q.scale);
    this.tilt.rotation.set(q.pitch + Math.sin(t * 1.7 + q.seed) * 0.03 * q.bob, 0, q.roll + Math.sin(t * 1.3 + q.seed) * 0.04 * q.bob);
    const sq = q.squash;
    this.squashG.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.headG.rotation.set(q.headPitch, q.headYaw, q.headRoll);
    for (const { pivot, side } of this.arms) {
      const a = side < 0 ? q.armL : q.armR;
      pivot.rotation.set(-a[1], 0, side * (a[0] + Math.sin(t * 2.3 + side) * 0.05 * q.bob));
      pivot.position.y = -0.08 + a[2];
    }
    this.ringG.rotation.y = q.ringSpin ?? t * 0.9;
    this.ringG.rotation.x = 0.28 + Math.sin(t * 0.8) * 0.05;
    this.ringG.rotation.z = -0.12;
    this.ringMat.opacity = 0.9 * q.ring;
    this.ringG.visible = q.ring > 0.01;
    const g = q.glow;
    this.ringMat.color.copy(GLOW).multiplyScalar(0.6 + 1.6 * g);
    this.beltMat.color.copy(GLOW).multiplyScalar(0.5 + 1.2 * g);
    this.bud.material.color.copy(GLOW).multiplyScalar(0.8 + 1.6 * g);
    this.eyeMat.color.setScalar(1.2 + 1.4 * g);
    this.light.intensity = q.light;
    this.light.visible = q.light > 0.001;
    this.beam.visible = q.beam > 0.01;
    this.beamMat.uniforms.uAmt.value = q.beam;
    this.beamMat.uniforms.uTime.value = t;
    this.beam.rotation.y = Math.sin(t * 2.2) * 0.6;
    const blink = q.blink ? autoBlink(t, q.seed + 7, 3.1) : 0;
    this.drawEyes({ kind: q.eyes, kind2: q.eyes2, mix: q.eyeMix, blink, lookX: q.lookX, lookY: q.lookY, sad: q.sad, tiltEyes: q.tiltEyes, t });
  }
}

export { GLOW as LUMA_GLOW, lerp };
