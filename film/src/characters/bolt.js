// BOLT — a small, brave, slightly rusty trash-compacting robot on tank treads.
// The rig is driven entirely through `bolt.pose(p)` with plain numbers so shots
// can keyframe any part of him.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { paintedMetalTexture, treadTexture } from '../lib/textures.js';
import { autoBlink, noise1, clamp } from '../lib/anim.js';

const eyeVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const eyeFrag = /* glsl */ `
uniform float uLidTop, uLidAngle, uLidBot, uPupil, uDizzy, uSpin, uGlow, uLight, uSide, uSparkle, uHeart;
uniform vec2 uLook;
uniform vec3 uLidColor, uIrisA, uIrisB;
varying vec2 vUv;
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float heart(vec2 p) {
  p.y -= 0.15; p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec3 col = mix(vec3(0.012, 0.016, 0.03), vec3(0.06, 0.08, 0.12), clamp(0.5 - p.y * 0.4 - r * 0.3, 0.0, 1.0));
  vec2 ip = p - uLook * 0.26;
  float ir = length(ip);
  float irisR = 0.6 * uPupil;
  float iris = smoothstep(irisR, irisR - 0.035, ir);
  float ang = atan(ip.y, ip.x);
  vec3 irisCol = mix(uIrisB, uIrisA, smoothstep(irisR, irisR * 0.25, ir));
  irisCol *= 0.82 + 0.18 * sin(ang * 22.0) * smoothstep(irisR * 0.3, irisR * 0.8, ir);
  irisCol *= 0.8 + 0.4 * smoothstep(irisR, irisR * 0.9, ir);
  col = mix(col, irisCol * (0.55 + uGlow), iris);
  // aperture ring
  col = mix(col, irisCol * 0.35, smoothstep(0.03, 0.0, abs(ir - irisR * 0.62)) * iris * 0.6);
  float pr = 0.27 * uPupil;
  float pupil = smoothstep(pr, pr - 0.03, ir);
  if (uHeart > 0.0) {
    float h = heart(ip / (0.62 * uPupil) * vec2(1.0, -1.0) * 1.35 + vec2(0.0, 0.65));
    float hm = smoothstep(0.02, -0.02, h) * uHeart;
    col = mix(col, vec3(1.4, 0.25, 0.45), hm);
    pupil *= 1.0 - uHeart;
  }
  col = mix(col, vec3(0.005), pupil);
  // lens glass rings
  col += vec3(0.25, 0.32, 0.38) * smoothstep(0.025, 0.0, abs(r - 0.93)) * 0.6;
  col += vec3(0.12, 0.16, 0.2) * smoothstep(0.02, 0.0, abs(r - 0.78)) * 0.4;
  if (uDizzy > 0.0) {
    float a = atan(p.y, p.x);
    float sp = sin(a + r * 16.0 - uSpin);
    vec3 sc = mix(vec3(0.02), vec3(0.95, 0.95, 1.0), smoothstep(-0.2, 0.2, sp));
    col = mix(col, sc, uDizzy * smoothstep(0.9, 0.85, r));
  }
  // catchlights
  vec2 cl = uLook * 0.1;
  float c1 = smoothstep(0.19, 0.16, length(p - vec2(-0.3, 0.34) - cl));
  float c2 = smoothstep(0.085, 0.065, length(p - vec2(0.27, -0.24) - cl));
  float c3 = smoothstep(0.05, 0.035, length(p - vec2(-0.05, 0.5) - cl));
  col += vec3(2.2) * (c1 + c2 * 0.8 + c3 * 0.6 * uSparkle) * (1.0 + uSparkle * 0.6) * (1.0 - uDizzy * 0.7);
  // eyelids: top shutter (tilted) and a smiling bottom lid
  vec2 lp = rot(p, uLidAngle * uSide);
  float topEdge = 1.05 - 2.1 * uLidTop;
  float lidT = smoothstep(topEdge - 0.025, topEdge + 0.025, lp.y);
  float botEdge = -1.05 + 2.1 * uLidBot - 0.55 * uLidBot * (1.0 - p.x * p.x);
  float lidB = smoothstep(botEdge + 0.025, botEdge - 0.025, p.y);
  float lid = max(lidT, lidB);
  float edge = max(smoothstep(0.07, 0.0, abs(lp.y - topEdge)) * step(0.01, uLidTop), smoothstep(0.07, 0.0, abs(p.y - botEdge)) * step(0.01, uLidBot));
  vec3 lidCol = uLidColor * uLight * (0.75 + 0.35 * clamp(lp.y * 0.5 + 0.5, 0.0, 1.0));
  col = mix(col, lidCol, lid);
  col = mix(col, lidCol * 0.35, edge * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`;

function stadiumPoints(len, h, n) {
  // Perimeter of a stadium (two half circles + straights) in the (z, y) plane, centered at origin.
  const r = h / 2, half = len / 2 - r;
  const pts = [];
  const straight = 2 * half, arc = Math.PI * r, total = 2 * straight + 2 * arc;
  for (let i = 0; i <= n; i++) {
    let s = (i / n) * total;
    let z, y, nz, ny;
    if (s < straight) { z = -half + s; y = -r; nz = 0; ny = -1; }
    else if ((s -= straight) < arc) { const a = -Math.PI / 2 + s / r; z = half + Math.cos(a) * r; y = Math.sin(a) * r; nz = Math.cos(a); ny = Math.sin(a); }
    else if ((s -= arc) < straight) { z = half - s; y = r; nz = 0; ny = 1; }
    else { s -= straight; const a = Math.PI / 2 + s / r; z = -half + Math.cos(a) * r; y = Math.sin(a) * r; nz = Math.cos(a); ny = Math.sin(a); }
    pts.push({ z, y, nz, ny, s: (i / n) * total });
  }
  return { pts, total };
}

function treadBand(len, h, width, period) {
  const { pts } = stadiumPoints(len, h, 72);
  const pos = [], nor = [], uv = [], idx = [];
  pts.forEach((p, i) => {
    for (const side of [-1, 1]) {
      pos.push((side * width) / 2, p.y, p.z);
      nor.push(0, p.ny, p.nz);
      uv.push(side < 0 ? 0 : 1, p.s / period);
    }
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function stadiumShape(len, h) {
  const r = h / 2, half = len / 2 - r;
  const s = new THREE.Shape();
  s.moveTo(-half, -r);
  s.lineTo(half, -r);
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-half, r);
  s.absarc(-half, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

function textPlate(text, w, h, color = '#f3ead6') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const ctx = c.getContext('2d');
  ctx.font = `700 ${c.height * 0.8}px Fredoka, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
}

export class Bolt {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Bolt';
    const bodyTex = paintedMetalTexture('#2c9aa6', 3, { dirt: 0.45 });
    const headTex = paintedMetalTexture('#efe4c9', 9, { dirt: 0.2 });
    const paint = new THREE.MeshStandardMaterial({ map: bodyTex, roughness: 0.55, metalness: 0.25, bumpMap: bodyTex, bumpScale: 0.3 });
    const cream = new THREE.MeshStandardMaterial({ map: headTex, roughness: 0.5, metalness: 0.15 });
    const gunmetal = new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 0.45, metalness: 0.8 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: '#26282b', roughness: 0.6, metalness: 0.6 });
    const orange = new THREE.MeshStandardMaterial({ color: '#f07a2a', roughness: 0.45, metalness: 0.2 });
    this.mats = { paint, cream, gunmetal, darkMetal, orange };

    const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

    // Hierarchy -------------------------------------------------------------
    this.bob = new THREE.Group();
    this.root.add(this.bob);

    // Treads
    this.treadTex = [treadTexture(), treadTexture()];
    this.treads = [];
    this.wheels = [];
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const g = new THREE.Group();
      g.position.set(side * 0.315, 0.135, 0.0);
      const bandMat = new THREE.MeshStandardMaterial({ map: this.treadTex[i], roughness: 0.9, metalness: 0.1, bumpMap: this.treadTex[i], bumpScale: 2 });
      const band = cast(new THREE.Mesh(treadBand(0.66, 0.27, 0.13, 0.5), bandMat));
      g.add(band);
      const frameShape = stadiumShape(0.6, 0.21);
      const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
      frameGeo.translate(0, 0, -0.055);
      frameGeo.rotateY(Math.PI / 2);
      const frame = cast(new THREE.Mesh(frameGeo, darkMetal));
      g.add(frame);
      // outer hub plate with wheels
      for (const wz of [-0.2, 0, 0.2]) {
        const wheel = new THREE.Group();
        wheel.position.set(side * 0.068, 0, wz);
        const disc = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24), gunmetal));
        disc.rotation.z = Math.PI / 2;
        wheel.add(disc);
        for (let k = 0; k < 3; k++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.12), darkMetal);
          spoke.position.x = side * 0.008;
          spoke.rotation.x = (k * Math.PI) / 3;
          wheel.add(spoke);
        }
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), orange);
        cap.rotation.z = Math.PI / 2;
        cap.position.x = side * 0.01;
        wheel.add(cap);
        g.add(wheel);
        this.wheels.push({ wheel, side });
      }
      this.bob.add(g);
      this.treads.push(g);
    }

    this.bodyPivot = new THREE.Group();
    this.bodyPivot.position.set(0, 0.2, 0);
    this.bob.add(this.bodyPivot);

    const body = cast(new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.47, 0.46, 4, 0.05), paint));
    body.position.y = 0.235;
    this.bodyPivot.add(body);
    // Orange trim band around the top of the body
    const trim = cast(new THREE.Mesh(new RoundedBoxGeometry(0.515, 0.045, 0.475, 2, 0.02), orange));
    trim.position.y = 0.43;
    this.bodyPivot.add(trim);
    // Side name plates
    for (const side of [-1, 1]) {
      const plate = textPlate('BOLT', 0.3, 0.09);
      plate.position.set(side * 0.2515, 0.28, 0);
      plate.rotation.y = (side * Math.PI) / 2;
      this.bodyPivot.add(plate);
    }

    // Compactor hatch (hinged at the bottom)
    this.hatch = new THREE.Group();
    this.hatch.position.set(0, 0.06, 0.232);
    const hatchPanel = cast(new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.3, 0.025, 2, 0.012), cream));
    hatchPanel.position.set(0, 0.15, 0.006);
    this.hatch.add(hatchPanel);
    const handle = cast(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), gunmetal));
    handle.position.set(0, 0.27, 0.025);
    this.hatch.add(handle);
    for (const [rx, ry] of [[-0.155, 0.02], [0.155, 0.02], [-0.155, 0.28], [0.155, 0.28]]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), gunmetal);
      rivet.position.set(rx, ry, 0.02);
      this.hatch.add(rivet);
    }
    // chest display (battery / heart)
    this.displayCanvas = document.createElement('canvas');
    this.displayCanvas.width = 128;
    this.displayCanvas.height = 64;
    this.displayTex = new THREE.CanvasTexture(this.displayCanvas);
    this.displayTex.colorSpace = THREE.SRGBColorSpace;
    this.displayMat = new THREE.MeshBasicMaterial({ map: this.displayTex, toneMapped: true });
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), this.displayMat);
    display.position.set(0, 0.16, 0.0195);
    this.hatch.add(display);
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.1, 0.012, 2, 0.01), darkMetal);
    bezel.position.set(0, 0.16, 0.012);
    this.hatch.add(bezel);
    this.bodyPivot.add(this.hatch);
    // dark cavity behind the hatch
    const cavity = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.02), new THREE.MeshBasicMaterial({ color: '#0b0908' }));
    cavity.position.set(0, 0.215, 0.228);
    this.bodyPivot.add(cavity);

    // Arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.27, 0.36, 0.1);
      const joint = cast(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), gunmetal));
      shoulder.add(joint);
      const upper = cast(new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.2, 0.07, 2, 0.02), paint));
      upper.position.set(side * 0.02, -0.09, 0);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.set(side * 0.02, -0.18, 0);
      shoulder.add(elbow);
      const ej = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 14), gunmetal));
      ej.rotation.z = Math.PI / 2;
      elbow.add(ej);
      const fore = cast(new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.16, 0.06, 2, 0.02), gunmetal));
      fore.position.y = -0.08;
      elbow.add(fore);
      const hand = new THREE.Group();
      hand.position.y = -0.17;
      elbow.add(hand);
      const palm = cast(new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.035, 0.08, 2, 0.012), darkMetal));
      hand.add(palm);
      const fingers = [];
      for (const f of [-1, 1]) {
        const fp = new THREE.Group();
        fp.position.set(0, -0.012, f * 0.03);
        const finger = cast(new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.09, 0.02, 2, 0.008), orange));
        finger.position.y = -0.045;
        fp.add(finger);
        hand.add(fp);
        fingers.push({ fp, f });
      }
      this.bodyPivot.add(shoulder);
      this.arms.push({ shoulder, elbow, hand, fingers, side });
    }

    // Neck + head
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.47, -0.08);
    this.bodyPivot.add(this.neck);
    const neckBase = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.04, 20), darkMetal));
    neckBase.position.y = 0.02;
    this.neck.add(neckBase);
    this.neckRod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 1, 14), gunmetal));
    this.neck.add(this.neckRod);
    this.neckRing = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), orange));
    this.neck.add(this.neckRing);
    this.head = new THREE.Group();
    this.neck.add(this.head);
    const headMesh = cast(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.22, 0.2, 4, 0.07), cream));
    headMesh.position.set(0, 0.11, 0.02);
    this.head.add(headMesh);
    const chin = cast(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.05, 0.12, 2, 0.02), darkMetal));
    chin.position.set(0, 0.005, 0);
    this.head.add(chin);

    // Eyes
    this.eyeUniforms = [];
    this.eyes = [];
    this.brows = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.11, 0.115, 0.1);
      const housing = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.097, 0.1, 0.07, 32), gunmetal));
      housing.rotation.x = Math.PI / 2;
      housing.position.z = 0.02;
      eye.add(housing);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.089, 0.009, 10, 40), darkMetal);
      bezel.position.z = 0.056;
      eye.add(bezel);
      const u = {
        uLidTop: { value: 0.15 }, uLidAngle: { value: 0 }, uLidBot: { value: 0 }, uPupil: { value: 1 }, uDizzy: { value: 0 },
        uSpin: { value: 0 }, uGlow: { value: 0.25 }, uLight: { value: 1 }, uSide: { value: side }, uSparkle: { value: 0 }, uHeart: { value: 0 },
        uLook: { value: new THREE.Vector2() }, uLidColor: { value: new THREE.Color('#3b4046') },
        uIrisA: { value: new THREE.Color('#ffc861') }, uIrisB: { value: new THREE.Color('#b45a12') },
      };
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.086, 48), new THREE.ShaderMaterial({ uniforms: u, vertexShader: eyeVert, fragmentShader: eyeFrag }));
      lens.position.z = 0.0555;
      eye.add(lens);
      // glass dome for specular highlights
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 32, 8, 0, Math.PI * 2, 0, 0.582),
        new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.08, metalness: 0, clearcoat: 1, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, envMapIntensity: 0.7 }),
      );
      glass.rotation.x = Math.PI / 2;
      glass.position.z = -0.078;
      eye.add(glass);
      this.head.add(eye);
      this.eyes.push(eye);
      this.eyeUniforms.push(u);
      const brow = cast(new THREE.Mesh(new RoundedBoxGeometry(0.13, 0.025, 0.03, 2, 0.01), darkMetal));
      const browPivot = new THREE.Group();
      browPivot.position.set(side * 0.11, 0.232, 0.1);
      browPivot.add(brow);
      this.head.add(browPivot);
      this.brows.push({ pivot: browPivot, side });
    }
    // Blush
    this.blush = [];
    for (const side of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.035, 24), new THREE.MeshBasicMaterial({ color: '#ff6f8a', transparent: true, opacity: 0, depthWrite: false }));
      b.scale.set(1.3, 0.7, 1);
      b.position.set(side * 0.2, 0.045, 0.121);
      this.head.add(b);
      this.blush.push(b);
    }
    // Antenna
    this.antenna = new THREE.Group();
    this.antenna.position.set(-0.14, 0.215, -0.01);
    this.head.add(this.antenna);
    const rod = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.17, 8), gunmetal));
    rod.position.y = 0.085;
    this.antenna.add(rod);
    this.antennaBallMat = new THREE.MeshStandardMaterial({ color: '#ff8a2a', emissive: new THREE.Color('#ff6a10'), emissiveIntensity: 1.5, roughness: 0.3 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.027, 16, 12), this.antennaBallMat);
    ball.position.y = 0.175;
    this.antenna.add(ball);
    const abase = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.02, 10), darkMetal));
    abase.position.y = 0.005;
    this.antenna.add(abase);

    this.displayState = null;
    this.pose({});
  }

  drawDisplay(mode, t) {
    const key = mode + (mode === 'battery' ? Math.floor(t * 2) % 4 : '');
    if (key === this.displayState) return;
    this.displayState = key;
    const ctx = this.displayCanvas.getContext('2d');
    ctx.fillStyle = '#0b1a14';
    ctx.fillRect(0, 0, 128, 64);
    if (mode === 'heart') {
      ctx.fillStyle = '#ff4f7a';
      ctx.save();
      ctx.translate(64, 34);
      ctx.scale(1.6, 1.6);
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.bezierCurveTo(-14, 0, -14, -12, -6, -12);
      ctx.bezierCurveTo(-2, -12, 0, -9, 0, -7);
      ctx.bezierCurveTo(0, -9, 2, -12, 6, -12);
      ctx.bezierCurveTo(14, -12, 14, 0, 0, 10);
      ctx.fill();
      ctx.restore();
    } else if (mode === 'low') {
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 4;
      ctx.strokeRect(24, 16, 72, 32);
      ctx.fillStyle = '#ff5a3a';
      ctx.fillRect(98, 26, 6, 12);
      ctx.fillRect(30, 22, 12, 20);
    } else {
      const bars = 2 + (Math.floor(t * 2) % 4 === 0 ? 0 : 1) + 1;
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 4;
      ctx.strokeRect(24, 16, 72, 32);
      ctx.fillStyle = '#7dffb0';
      ctx.fillRect(98, 26, 6, 12);
      for (let i = 0; i < bars; i++) ctx.fillRect(30 + i * 16, 22, 12, 20);
    }
    this.displayTex.needsUpdate = true;
  }

  // p: see defaults below. Every field is optional.
  pose(p) {
    const d = {
      x: 0, y: 0, z: 0, rotY: 0, t: 0,
      odo: 0, odoL: null, odoR: null,
      hop: 0, squash: 1, lean: 0, roll: 0, shake: 0,
      neckExt: 0, headYaw: 0, headPitch: 0, headRoll: 0,
      armL: [-0.35, 0.1, -0.7, 0.2], armR: [-0.35, 0.1, -0.7, 0.2], // [raise, spread, elbow, claw]
      lidTop: 0.12, lidAngle: 0, lidBot: 0, pupil: 1, lookX: 0, lookY: 0, dizzy: 0, sparkle: 0, heart: 0,
      blink: true, brow: 0, browY: 0, blush: 0, antenna: 1, antennaWiggle: 0, glow: 0.25, light: 1,
      hatch: 0, display: 'battery', idle: 1, seed: 0,
    };
    const q = { ...d, ...p };
    const t = q.t;
    this.root.position.set(q.x, q.y, q.z);
    this.root.rotation.y = q.rotY;

    // idle "breathing" hum + squash & stretch keeps volume
    const idle = q.idle * (Math.sin(t * 2.6 + q.seed) * 0.006);
    const sq = q.squash;
    this.bob.position.y = q.hop + idle;
    this.bob.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    const shake = q.shake ? noise1(t * 40 + q.seed) * q.shake : 0;
    this.bodyPivot.rotation.set(q.lean, shake * 0.3, q.roll + shake);

    // treads + wheels
    const oL = q.odoL ?? q.odo, oR = q.odoR ?? q.odo;
    this.treadTex[0].offset.y = -oL / 0.5;
    this.treadTex[1].offset.y = -oR / 0.5;
    for (const { wheel, side } of this.wheels) wheel.rotation.x = (side < 0 ? oL : oR) / 0.075;

    // arms
    for (const arm of this.arms) {
      const a = arm.side < 0 ? q.armL : q.armR;
      arm.shoulder.rotation.set(a[0], 0, arm.side * a[1]);
      arm.elbow.rotation.set(a[2], 0, 0);
      for (const { fp, f } of arm.fingers) fp.rotation.x = -f * (0.12 + a[3] * 0.6);
    }
    this.hatch.rotation.x = q.hatch * 1.4;

    // neck & head
    const ext = 0.13 + q.neckExt;
    this.neckRod.scale.y = ext;
    this.neckRod.position.y = ext / 2 + 0.02;
    this.neckRing.position.y = ext * 0.6 + 0.02;
    this.head.position.y = ext + 0.02;
    this.neck.rotation.set(q.headPitch * 0.4, q.headYaw * 0.3, 0);
    this.head.rotation.set(q.headPitch * 0.6, q.headYaw * 0.7, q.headRoll);

    // eyes
    const blink = q.blink ? autoBlink(t, q.seed + 1) : 0;
    for (const u of this.eyeUniforms) {
      u.uLidTop.value = clamp(Math.max(q.lidTop, blink));
      u.uLidAngle.value = q.lidAngle;
      u.uLidBot.value = q.lidBot;
      u.uPupil.value = q.pupil;
      u.uLook.value.set(q.lookX, q.lookY);
      u.uDizzy.value = q.dizzy;
      u.uSpin.value = t * 9;
      u.uSparkle.value = q.sparkle;
      u.uHeart.value = q.heart;
      u.uGlow.value = q.glow;
      u.uLight.value = q.light;
    }
    for (const { pivot, side } of this.brows) {
      pivot.rotation.z = side * q.brow;
      pivot.position.y = 0.232 + q.browY;
    }
    for (const b of this.blush) b.material.opacity = q.blush * 0.75;

    // antenna jiggle (secondary motion driven by hops/turns)
    const wig = q.antennaWiggle;
    this.antenna.rotation.z = Math.sin(t * 17) * wig * 0.35 + Math.sin(t * 1.3 + q.seed) * 0.04;
    this.antenna.rotation.x = Math.cos(t * 13) * wig * 0.2;
    this.antennaBallMat.emissiveIntensity = 0.4 + q.antenna * 2.6;

    this.drawDisplay(q.display, t);
  }
}
