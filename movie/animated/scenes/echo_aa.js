// Antialiasing + grain helper for the observatory and signal scenes.
//
// main.js renders scenes through an EffectComposer whose render targets have
// no multisampling, so thin geometry (feed legs, grid lines, masts) would
// crawl. A scene module can instead render its real scene into its own target
// inside update(), and hand the compositor a single full-screen quad that
// shows the antialiased image. Bloom, tone mapping and sRGB output still
// happen in main.js, so the target stays linear HDR (half float).
//
// mode 'fxaa' (default): one plain target + FXAA in the quad — on SwiftShader
//   this is several times cheaper than a multisampled target.
// mode 'msaa': a 4x multisampled target, resolved by three.js.
//
// The quad also adds a static ordered dither, which hides banding in dark
// gradients, and optionally film grain (seeded by film time, so deterministic).

// Only one scene renders per frame, so modules can share the (large) target.
const SHARED = new Map();

export function makeAA(THREE, renderer, W, H, opts = {}) {
  const mode = opts.mode || 'fxaa';
  const key = `${W}x${H}:${mode}`;
  if (!SHARED.has(renderer)) SHARED.set(renderer, {});
  const cache = SHARED.get(renderer);
  const rt = cache[key] || (cache[key] = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType, samples: mode === 'msaa' ? 4 : 0, depthBuffer: true,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  }));
  const uniforms = {
    tex: { value: rt.texture },
    uInv: { value: new THREE.Vector2(1 / W, 1 / H) },
    uSeed: { value: 0 },
    uGrain: { value: opts.grain ?? 0.0 },
    uDither: { value: opts.dither ?? 0.0006 },
    // darken the bottom of the frame (narration band): (start y from top 0..1, amount)
    uLow: { value: new THREE.Vector2(0.72, 0.0) },
    // CRT scanlines: (amount, period in pixels)
    uScan: { value: new THREE.Vector2(opts.scan ?? 0.0, 3.0) },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    defines: mode === 'fxaa' ? { USE_FXAA: 1 } : {},
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tex;
      uniform vec2 uInv;
      uniform float uSeed, uGrain, uDither;
      uniform vec2 uLow, uScan;
      varying vec2 vUv;
      // perceptual luma of an HDR linear colour
      float pl(vec3 c) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return sqrt(l / (1.0 + l)); }
      const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
      float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
      void main() {
        vec3 rgbM = texture2D(tex, vUv).rgb;
      #ifdef USE_FXAA
        vec3 rgbNW = texture2D(tex, vUv + vec2(-1.0, -1.0) * uInv).rgb;
        vec3 rgbNE = texture2D(tex, vUv + vec2( 1.0, -1.0) * uInv).rgb;
        vec3 rgbSW = texture2D(tex, vUv + vec2(-1.0,  1.0) * uInv).rgb;
        vec3 rgbSE = texture2D(tex, vUv + vec2( 1.0,  1.0) * uInv).rgb;
        float lNW = pl(rgbNW), lNE = pl(rgbNE), lSW = pl(rgbSW), lSE = pl(rgbSE), lM = pl(rgbM);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
        float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec3 col = rgbM;
        if (lMax - lMin > max(0.02, lMax * 0.08)) {
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
          float red = max((lNW + lNE + lSW + lSE) * 0.25 * (1.0 / 8.0), 1.0 / 128.0);
          float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uInv;
          vec3 rgbA = 0.5 * (texture2D(tex, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tex, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
          vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, vUv - dir * 0.5).rgb + texture2D(tex, vUv + dir * 0.5).rgb);
          float lB = pl(rgbB);
          col = (lB < lMin || lB > lMax) ? rgbA : rgbB;
        }
      #else
        vec3 col = rgbM;
      #endif
        if (uScan.x > 0.0) col *= 1.0 - uScan.x * (0.5 + 0.5 * cos(6.2831853 * gl_FragCoord.y / uScan.y));
        float low = smoothstep(uLow.x, 1.0, 1.0 - vUv.y);
        col *= 1.0 - uLow.y * low * (2.0 - low);
        // optional animated film grain (off by default: random noise makes the
        // PNG frames incompressible, which costs ~0.3 s per frame to encode)
        if (uGrain > 0.0) {
          vec2 fc = gl_FragCoord.xy + vec2(uSeed * 17.13, uSeed * 7.77);
          col *= 1.0 + (hash(fc) - 0.5) * 2.0 * uGrain;
        }
        // static 4x4 ordered dither against banding in dark gradients
        ivec2 bp = ivec2(mod(gl_FragCoord.xy, 4.0));
        col += (BAYER[bp.x + bp.y * 4] / 16.0 - 0.47) * uDither;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  }));
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    scene, camera, target: rt, uniforms,
    /** render the real scene into the target; t seeds the grain */
    render(realScene, realCamera, t = 0) {
      uniforms.uSeed.value = Math.floor(t * 24 + 0.5) % 997;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(realScene, realCamera);
      renderer.setRenderTarget(prev);
    },
  };
}
