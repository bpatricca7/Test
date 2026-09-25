// Final "film look": vignette, gentle grain, color grade, fades and the classic iris-out.
import * as THREE from 'three';

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.02 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color(0, 0, 0) },
    uIris: { value: 2.0 },
    uIrisCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 16 / 9 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uLift: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uAberration: { value: 0.0012 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uFade, uIris, uAspect, uSaturation, uContrast, uAberration;
    uniform vec3 uFadeColor, uLift, uGain; uniform vec2 uIrisCenter; varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 dc = vUv - 0.5;
      float ab = uAberration * dot(dc, dc) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - dc * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + dc * ab).b;
      col = col * uGain + uLift * (1.0 - col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      float v = smoothstep(0.95, 0.25, length(dc * vec2(1.0, 0.82)) * 1.05);
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (rand(vUv * 1000.0 + fract(uTime * 7.13)) - 0.5) * uGrain;
      col = mix(col, uFadeColor, uFade);
      vec2 ip = (vUv - uIrisCenter) * vec2(uAspect, 1.0);
      float iris = smoothstep(uIris, uIris - 0.004, length(ip));
      col *= iris;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
