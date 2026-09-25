// Rolling dusty ground that can blossom into a meadow.
import * as THREE from 'three';
import { noise2, smoothstep } from '../lib/anim.js';
import { groundDetailTexture } from '../lib/textures.js';
import { LAYOUT, patchMaterial } from './common.js';

const MOUNDS = [
  { x: LAYOUT.seat[0] - 0.5, z: LAYOUT.seat[1] + 1.5, h: 1.1, r: 5 },
  { x: LAYOUT.plant[0], z: LAYOUT.plant[1], h: 0.12, r: 2.2 },
  { x: -18, z: -14, h: 2.5, r: 9 },
  { x: 20, z: 12, h: 2.0, r: 10 },
];

export function heightAt(x, z) {
  const d = Math.hypot(x, z);
  const far = smoothstep(14, 60, d);
  let h = (noise2(x * 0.018 + 3.1, z * 0.018 - 1.7) - 0.5) * 10 * far;
  h += (noise2(x * 0.05 + 7.3, z * 0.05 + 2.2) - 0.5) * 2.4 * (0.12 + far);
  h += (noise2(x * 0.4, z * 0.4) - 0.5) * 0.05;
  for (const m of MOUNDS) h += m.h * Math.exp(-((x - m.x) ** 2 + (z - m.z) ** 2) / (m.r * m.r));
  return h;
}

export function buildTerrain(scene) {
  const size = 900, seg = 240;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  // denser vertices near the center: warp the grid radially
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z) / (size / 2);
    const k = Math.pow(r, 1.8) / Math.max(r, 1e-6);
    x *= k; z *= k;
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();
  const detail = groundDetailTexture();
  detail.repeat.set(1, 1);
  const mat = new THREE.MeshLambertMaterial({ map: detail, bumpMap: detail, bumpScale: 1.2 });
  mat.userData.u = {
    uSandA: { value: new THREE.Color('#c98e5a') },
    uSandB: { value: new THREE.Color('#e2b27c') },
    uGrassA: { value: new THREE.Color('#4f8f2f') },
    uGrassB: { value: new THREE.Color('#8cc24a') },
    uSoil: { value: new THREE.Vector4(LAYOUT.plant[0], LAYOUT.plant[1], 0.7, 0) },
    uSoilCol: { value: new THREE.Color('#4a2f1f') },
  };
  patchMaterial(mat, {
    key: 'terrain',
    vertexHead: `varying vec4 vTN;`,
    vertexBody: `{
      vec3 twp = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vTN.x = gNoise(twp.xz * 0.035) * 0.65 + gNoise(twp.xz * 0.13) * 0.35;
      vTN.y = gNoise(twp.xz * 0.09);
      float d = length(twp.xz - uBloomCenter);
      vTN.z = d - (uBloomRadius + (gNoise(twp.xz * 0.22) - 0.5) * 5.0);
    }`,
    fragHead: `uniform vec3 uSandA, uSandB, uGrassA, uGrassB, uSoilCol; uniform vec4 uSoil; varying vec4 vTN;`,
    fragReplace: {
      '#include <map_fragment>': `
        vec2 tuv = vWPos.xz * 0.23;
        float det = texture2D(map, tuv).r * 0.6 + texture2D(map, tuv * 0.21 + 0.37).r * 0.4;
        vec3 sand = mix(uSandA, uSandB, vTN.x) * (0.5 + 0.7 * det);
        float bm = 1.0 - smoothstep(-3.0, 0.0, vTN.z);
        vec3 grass = mix(uGrassA, uGrassB, vTN.y * 0.8 + det * 0.3) * (0.65 + 0.5 * det);
        vec3 gcol = mix(sand, grass, bm);
        float sd = length(vWPos.xz - uSoil.xy);
        gcol = mix(gcol, uSoilCol * (0.6 + 0.6 * det), (1.0 - smoothstep(uSoil.z * 0.55, uSoil.z, sd)) * uSoil.w);
        diffuseColor.rgb *= gcol;
      `,
      '#include <bumpmap_pars_fragment>': `
        #ifdef USE_BUMPMAP
        uniform sampler2D bumpMap; uniform float bumpScale;
        vec2 dHdxy_fwd() {
          vec2 tuv = vWPos.xz * 0.23;
          vec2 dSTdx = dFdx(tuv); vec2 dSTdy = dFdy(tuv);
          float Hll = bumpScale * texture2D(bumpMap, tuv).x;
          float dBx = bumpScale * texture2D(bumpMap, tuv + dSTdx).x - Hll;
          float dBy = bumpScale * texture2D(bumpMap, tuv + dSTdy).x - Hll;
          return vec2(dBx, dBy);
        }
        vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
          // same as three.js, but safe against zero-length derivatives at grazing angles
          vec3 dx = dFdx(surf_pos.xyz), dy = dFdy(surf_pos.xyz);
          vec3 vSigmaX = dx / max(length(dx), 1e-8); vec3 vSigmaY = dy / max(length(dy), 1e-8); vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
          vec3 n = abs(fDet) * surf_norm - vGrad;
          float l2 = dot(n, n);
          return l2 > 1e-12 ? n * inversesqrt(l2) : surf_norm;
        }
        #endif`,
      '#include <emissivemap_fragment>': `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.55, 1.0, 0.35) * exp(-(vTN.z * vTN.z) / 2.56) * uFrontGlow;`,
    },
  });
  const origCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    origCompile(shader);
    Object.assign(shader.uniforms, mat.userData.u);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, uniforms: mat.userData.u };
}
