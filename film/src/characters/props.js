// The little sprout, the old tin can it grows in, and Bolt's watering can.
import * as THREE from 'three';
import { canLabelTexture, glowSprite } from '../lib/textures.js';
import { clamp, ease } from '../lib/anim.js';

function leafGeometry(len, width) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width * 0.9, len * 0.15, width * 0.8, len * 0.75, 0, len);
  s.bezierCurveTo(-width * 0.8, len * 0.75, -width * 0.9, len * 0.15, 0, 0);
  const g = new THREE.ShapeGeometry(s, 16);
  const pos = g.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // cup the leaf and curl the tip
    pos.setZ(i, -Math.pow(x / width, 2) * width * 0.5 + Math.pow(y / len, 2) * len * 0.25);
    const vein = Math.exp(-Math.pow(x / (width * 0.08), 2));
    const k = y / len;
    col.push(0.55 + 0.35 * k - vein * 0.15, 0.85 + 0.1 * k + vein * 0.08, 0.35 + 0.2 * k - vein * 0.1);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Sprout {
  constructor() {
    this.root = new THREE.Group();
    const green = new THREE.MeshStandardMaterial({ color: '#7fdc4a', emissive: new THREE.Color('#2f7a18'), emissiveIntensity: 0.35, roughness: 0.45, side: THREE.DoubleSide, vertexColors: true });
    this.leafMat = green;
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.006, 0.035, 0), new THREE.Vector3(-0.004, 0.07, 0.003), new THREE.Vector3(0.0, 0.1, 0),
    ]);
    const stemGeo = new THREE.TubeGeometry(stemCurve, 20, 0.0055, 8, false);
    const stemMat = new THREE.MeshStandardMaterial({ color: '#5fae36', emissive: new THREE.Color('#1d4d10'), emissiveIntensity: 0.3, roughness: 0.5 });
    this.stemMat = stemMat;
    this.stem = new THREE.Mesh(stemGeo, stemMat);
    this.stem.castShadow = true;
    this.root.add(this.stem);
    this.leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.098, 0);
      const leaf = new THREE.Mesh(leafGeometry(0.075, 0.032), green);
      leaf.castShadow = true;
      pivot.add(leaf);
      this.root.add(pivot);
      this.leaves.push({ pivot, side });
    }
    // tiny new bud in the middle
    this.bud = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), green);
    this.bud.position.y = 0.102;
    this.root.add(this.bud);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowSprite(), color: new THREE.Color('#9dff6a'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.glow.position.y = 0.08;
    this.glow.scale.setScalar(0.5);
    this.root.add(this.glow);
    this.pose({});
  }
  pose({ grow = 1, unfurl = 1, t = 0, glow = 0, sway = 1, scale = 1, halo = 1 }) {
    const g = clamp(grow);
    this.root.scale.setScalar(Math.max(0.0001, scale * (0.25 + 0.75 * ease.outBack(g))));
    for (const { pivot, side } of this.leaves) {
      const open = clamp(unfurl);
      pivot.rotation.set(0, side < 0 ? Math.PI : 0, 0);
      pivot.rotateZ(-(0.25 + 0.95 * open) + Math.sin(t * 1.6 + side) * 0.06 * sway);
      pivot.rotateX(0.25 * side * 0);
    }
    this.stem.rotation.z = Math.sin(t * 1.1) * 0.05 * sway;
    this.leafMat.emissiveIntensity = 0.3 + Math.min(glow, 2.5) * 1.2;
    this.stemMat.emissiveIntensity = 0.3 + Math.min(glow, 2.5) * 0.8;
    this.glow.material.opacity = Math.min(0.85, glow * 0.45) * halo;
    this.glow.scale.setScalar(0.3 + Math.min(glow, 2) * 0.18);
    this.glow.visible = this.glow.material.opacity > 0.01;
  }
}

export class TinCan {
  constructor() {
    this.root = new THREE.Group();
    const label = canLabelTexture();
    const metal = new THREE.MeshStandardMaterial({ color: '#b9b4aa', roughness: 0.35, metalness: 0.9 });
    const labelMat = new THREE.MeshStandardMaterial({ map: label, roughness: 0.75, metalness: 0.1 });
    const R = 0.072, H = 0.15;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H * 0.8, 40, 1, true), labelMat);
    outer.position.y = H / 2;
    outer.castShadow = outer.receiveShadow = true;
    this.root.add(outer);
    for (const y of [0.012, H - 0.012]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 8, 40), metal);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = y;
      rim.castShadow = true;
      this.root.add(rim);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.002, R * 1.002, 0.02, 40, 1, true), metal);
      band.position.y = y + (y < 0.1 ? 0.004 : -0.004);
      this.root.add(band);
    }
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.97, H * 0.99, 40, 1, true), new THREE.MeshStandardMaterial({ color: '#8a8278', roughness: 0.5, metalness: 0.8, side: THREE.BackSide }));
    inner.position.y = H / 2;
    this.root.add(inner);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R, 32), metal);
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.002;
    this.root.add(bottom);
    this.soil = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 32), new THREE.MeshStandardMaterial({ color: '#3a2618', roughness: 1 }));
    this.soil.rotation.x = -Math.PI / 2;
    this.soil.position.y = H * 0.72;
    this.root.add(this.soil);
    this.sproutAnchor = new THREE.Group();
    this.sproutAnchor.position.y = H * 0.72;
    this.root.add(this.sproutAnchor);
    this.height = H;
  }
}

export class WateringCan {
  constructor() {
    this.root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#4d86b8', roughness: 0.45, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.18, 28), mat);
    body.position.y = 0.09;
    body.castShadow = true;
    this.root.add(body);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.26, 12), mat);
    spout.position.set(0, 0.12, 0.16);
    spout.rotation.x = 0.95;
    spout.castShadow = true;
    this.root.add(spout);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.015, 0.03, 14), mat);
    rose.position.set(0, 0.2, 0.265);
    rose.rotation.x = 0.95;
    this.root.add(rose);
    this.spoutTip = new THREE.Object3D();
    this.spoutTip.position.set(0, 0.215, 0.28);
    this.root.add(this.spoutTip);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 20, Math.PI), mat);
    handle.position.set(0, 0.18, -0.02);
    handle.rotation.y = Math.PI / 2;
    this.root.add(handle);
  }
}
