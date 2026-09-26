// Boulder cast shadows: the rock meshes rendered from the Sun into two depth maps (cascades) that the
// terrain and rock shaders sample, so every block near the camera throws its long, crisp low-Sun shadow
// across the regolith (a 1 m rock at the 10.8 deg Sun: a 5 m shadow), and rocks shadow each other.
//
// The maps live in their own small scene (twin InstancedMeshes that share the rock geometry and instance
// buffers, see rocks.js), rendered by an orthographic camera looking down the Sun direction. Each
// cascade is a prism along the Sun: across-Sun it covers 2*half metres, along-Sun on the ground that
// footprint stretches by 1/sin(sun elevation) — exactly the direction in which shadows are long.
// The camera sits in a double-precision "shadow anchor" frame near the viewer; the maps are re-rendered
// only when the rock set changes or the viewer moves away from the anchor (rocks and Sun are static).

import * as THREE from 'three';

/**
 * @param {object} ctx RenderContext
 * @param {{size:number, halves:number[]}} opts map resolution and cascade half-widths (m, near first)
 */
export function createRockShadow(ctx, opts) {
  const size = opts.size;
  const halves = opts.halves;
  const reversed = ctx.depthMode === 'reversed';
  const scene = new THREE.Scene();
  scene.name = 'rockShadowScene';
  const group = new THREE.Group();
  scene.add(group);
  const REACH = 700; // m sunward of the anchor still inside the map (upsun rocks cast into it)
  const DEPTH = 3000;
  const cascades = halves.map((half) => {
    const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, stencilBuffer: false });
    target.depthTexture = new THREE.DepthTexture(size, size);
    target.depthTexture.type = THREE.UnsignedIntType;
    target.depthTexture.minFilter = THREE.NearestFilter;
    target.depthTexture.magFilter = THREE.NearestFilter;
    target.texture.generateMipmaps = false;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, DEPTH);
    if (reversed) cam._reversedDepth = true;
    return { half, target, cam, mat: new THREE.Matrix4() };
  });
  const uniforms = {
    uRockShMap0: { value: cascades[0].target.depthTexture },
    uRockShMap1: { value: cascades[1].target.depthTexture },
    uRockShMat0: { value: new THREE.Matrix4() },
    uRockShMat1: { value: new THREE.Matrix4() },
    uRockShOff: { value: new THREE.Vector3() },
    uRockShOn: { value: 0 },
    uRockShTexel: { value: 1 / size },
  };
  // depth units per metre along the Sun (for biases)
  const perM = (1 / (DEPTH - 1)).toExponential(4);
  const glsl = /* glsl */ `
    uniform sampler2D uRockShMap0;
    uniform sampler2D uRockShMap1;
    uniform mat4 uRockShMat0;
    uniform mat4 uRockShMat1;
    uniform vec3 uRockShOff;
    uniform float uRockShOn;
    uniform float uRockShTexel;
    float rsTap(sampler2D m, vec2 uv, float z) {
      ${reversed ? 'return step(texture2D(m, uv).x, z);' : 'return step(z, texture2D(m, uv).x);'}
    }
    // bilinear-weighted 2x2 comparison, averaged over a 2x2 footprint (smooth ~2 texel edges)
    float rsPCF(sampler2D m, vec2 uv, float z) {
      if (${reversed ? 'z <= 0.0' : 'z >= 1.0'}) return 1.0; // beyond the far plane (down-Sun of the map)
      float t = uRockShTexel;
      float s = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = (vec2(float(k & 1), float(k >> 1)) - 0.5) * t * 1.1;
        vec2 st = (uv + o) / t - 0.5;
        vec2 f = fract(st);
        vec2 c = (floor(st) + 0.5) * t;
        float a = rsTap(m, c, z);
        float b = rsTap(m, c + vec2(t, 0.0), z);
        float d = rsTap(m, c + vec2(0.0, t), z);
        float e = rsTap(m, c + vec2(t), z);
        s += mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
      }
      return s * 0.25;
    }
    // 1 = lit, 0 = in a boulder's shadow. biasM: depth bias in metres (receivers that are rocks
    // themselves need more). posRender: render-space world position.
    float rockShadow(vec3 posRender, float biasM) {
      if (uRockShOn < 0.5) return 1.0;
      vec3 p = posRender + uRockShOff;
      float bias = biasM * ${perM};
      vec4 c = uRockShMat0 * vec4(p, 1.0);
      vec2 uv = c.xy * 0.5 + 0.5;
      float z = ${reversed ? 'c.z + bias' : 'c.z * 0.5 + 0.5 - bias'};
      float edge = min(min(uv.x, uv.y), 1.0 - max(uv.x, uv.y));
      if (edge > 0.01) {
        float s0 = rsPCF(uRockShMap0, uv, z);
        if (edge > 0.06) return s0;
        // blend into the far cascade near the border
        vec4 c1 = uRockShMat1 * vec4(p, 1.0);
        float s1 = rsPCF(uRockShMap1, c1.xy * 0.5 + 0.5, ${reversed ? 'c1.z + bias' : 'c1.z * 0.5 + 0.5 - bias'});
        return mix(s1, s0, smoothstep(0.01, 0.06, edge));
      }
      c = uRockShMat1 * vec4(p, 1.0);
      uv = c.xy * 0.5 + 0.5;
      edge = min(min(uv.x, uv.y), 1.0 - max(uv.x, uv.y));
      if (edge <= 0.0) return 1.0;
      float s = rsPCF(uRockShMap1, uv, ${reversed ? 'c.z + bias' : 'c.z * 0.5 + 0.5 - bias'});
      return mix(1.0, s, smoothstep(0.0, 0.05, edge));
    }
  `;

  const anchor = new THREE.Vector3(Infinity, 0, 0); // MCI of the shadow frame origin
  const _up = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _f = new THREE.Vector3();
  let dirty = true;
  let lastRockVersion = -1;
  const stats = { rendered: 0 };
  const renderer = ctx.renderer;
  const occluder = new THREE.Vector3();

  function place(frame) {
    // anchor: the viewer's ground point pushed forward along the horizontal view direction
    const cam = frame.cameraMCI;
    _up.copy(cam).normalize();
    _f.set(0, 0, -1).applyQuaternion(frame.cameraQuat);
    _f.addScaledVector(_up, -_f.dot(_up));
    if (_f.lengthSq() < 1e-8) _f.set(0, 0, 0);
    else _f.normalize();
    const lead = halves[0] * 0.6;
    _v.copy(cam).addScaledVector(_f, lead);
    return _v;
  }

  return {
    uniforms,
    glsl,
    scene,
    group,
    stats,
    /** Mark the rock set as changed (instances rebuilt). */
    invalidate() {
      dirty = true;
    },
    /**
     * Per frame: re-anchor/re-render when needed and update the sampling uniforms.
     * @param {object} frame FrameContext
     * @param {THREE.Vector3} rockAnchor MCI anchor of the rock instance matrices
     * @param {number} rockCount instances drawn
     * @param {number} rockVersion bumps whenever the instances were rebuilt
     */
    update(frame, rockAnchor, rockCount, rockVersion) {
      const on = rockCount > 0;
      uniforms.uRockShOn.value = on ? 1 : 0;
      if (!on) return;
      if (rockVersion !== lastRockVersion) dirty = true;
      const want = place(frame);
      // re-anchor when the viewer's lead point left the central part of the near cascade
      if (!Number.isFinite(anchor.x) || occluder.copy(want).sub(anchor).length() > halves[0] * 0.3) dirty = true;
      if (dirty) {
        dirty = false;
        lastRockVersion = rockVersion;
        anchor.copy(want);
        group.position.copy(rockAnchor).sub(anchor);
        const sun = frame.sunDir;
        _up.copy(anchor).normalize();
        for (const c of cascades) {
          c.cam.position.copy(sun).multiplyScalar(REACH);
          c.cam.up.copy(_up);
          c.cam.lookAt(0, 0, 0);
          c.cam.updateProjectionMatrix();
          c.cam.updateMatrixWorld(true);
          c.mat.multiplyMatrices(c.cam.projectionMatrix, c.cam.matrixWorldInverse);
        }
        uniforms.uRockShMat0.value.copy(cascades[0].mat);
        uniforms.uRockShMat1.value.copy(cascades[1].mat);
        // render (must neither render nor consume the renderer's sunlight shadow map)
        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        const prevShadowAuto = renderer.shadowMap.autoUpdate;
        const prevShadowNeeds = renderer.shadowMap.needsUpdate;
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
        renderer.autoClear = true;
        scene.updateMatrixWorld(true);
        for (const c of cascades) {
          renderer.setRenderTarget(c.target);
          renderer.clear(true, true, false);
          renderer.render(scene, c.cam);
        }
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;
        renderer.shadowMap.autoUpdate = prevShadowAuto;
        renderer.shadowMap.needsUpdate = prevShadowNeeds;
        stats.rendered++;
      }
      // render space -> shadow frame: p + origin - anchor
      uniforms.uRockShOff.value.copy(frame.origin).sub(anchor);
    },
  };
}
