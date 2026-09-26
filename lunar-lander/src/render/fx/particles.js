// GPU ballistic particle pool: one instanced draw call per pool, positions evaluated in the vertex
// shader from spawn state (p0, v, t0) under constant gravity — the CPU only writes new particles into
// a ring buffer (partial buffer uploads). Used for descent-engine dust streaks, touchdown puffs,
// RCS vapour and ascent-stage liftoff debris.
//
// Styles:
//   'streak'  quads stretched along the motion over a film shutter interval (fast lunar dust);
//             premultiplied-alpha blending (dust both scatters sunlight and hides the ground)
//   'puff'    soft round sprites that grow with age (RCS vapour, slow dust); additive or alpha
//   'glint'   small tumbling flakes that flash when their facet catches the Sun (foil debris); additive
//
// Positions are in the pool object's LOCAL frame; the owner positions the object every frame with
// the floating origin (object.position = anchorMCI - origin) and may rotate it (body-frame pools).
// Owned by the SKY-FX agent.

import * as THREE from 'three';

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 aP0;
  attribute vec3 aV;
  attribute vec4 aT;   // t0, life, size0, size1
  attribute vec4 aC;   // rgb, alpha
  attribute vec4 aS;   // seed, spin rate, spin phase, drag (1/s)
  uniform float uTime;
  uniform vec3 uGravity;   // local frame
  uniform float uShutter;  // streak exposure time (s)
  uniform float uFadeIn;   // fraction of life
  uniform vec3 uSunLocal;  // Sun direction in the local frame (glints)
  #ifdef USE_VSHADOW
  uniform sampler2D uVesselShadowMap;
  uniform mat4 uVesselShadowMatrix;
  uniform float uVesselShadowEnabled;
  #endif
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vK;
  varying float vSpark;

  vec3 posAt(float age) {
    // linear drag d (1/s) for visual "vapour" deceleration; d = 0 -> exact ballistic
    float d = aS.w;
    float s = d > 1e-4 ? (1.0 - exp(-d * age)) / d : age;
    return aP0 + aV * s + 0.5 * uGravity * age * age;
  }

  void main() {
    float age = uTime - aT.x;
    float life = aT.y;
    vUv = position.xy;
    if (age < 0.0 || age > life || life <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vColor = vec4(0.0);
      return;
    }
    float k = age / life;
    vK = k;
    vec3 p = posAt(age);
    float size = mix(aT.z, aT.w, sqrt(k));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 pos;
    #ifdef STYLE_STREAK
      vec4 mv0 = modelViewMatrix * vec4(posAt(max(age - uShutter, 0.0)), 1.0);
      vec3 axis = mv.xyz - mv0.xyz;
      vec3 mid = 0.5 * (mv.xyz + mv0.xyz);
      vec3 side = cross(axis, mid);
      float sl = length(side);
      side = sl > 1e-8 ? side / sl : vec3(1.0, 0.0, 0.0);
      float al = length(axis);
      vec3 ax = al > 1e-6 ? axis / al : vec3(0.0, 1.0, 0.0);
      // segment from mv0 to mv, widened by size and capped by half a width at both ends
      float t = position.y * 0.5 + 0.5;
      pos = mix(mv0.xyz, mv.xyz, t) + side * position.x * size + ax * position.y * size * 0.5;
      // thin streaks: keep energy ~constant as they stretch (a streak is a moving dot)
      float stretch = al / (al + 2.0 * size);
    #else
      pos = mv.xyz + vec3(position.xy * size, 0.0);
      float stretch = 0.0;
    #endif
    gl_Position = projectionMatrix * vec4(pos, 1.0);
    #include <logdepthbuf_vertex>

    float fade = smoothstep(0.0, uFadeIn, k) * (1.0 - smoothstep(0.55, 1.0, k));
    vColor = vec4(aC.rgb, aC.a * fade);
    #ifdef STYLE_STREAK
      vColor.a *= mix(1.0, 0.55, stretch);
    #endif
    vSpark = 0.0;
    #ifdef STYLE_GLINT
      // a flat flake tumbling about a random axis: specular flash when its normal bisects Sun & eye
      float ph = aS.z + aS.y * age;
      vec3 ax2 = normalize(vec3(sin(aS.x * 12.9), cos(aS.x * 78.2), sin(aS.x * 37.7 + 1.0)));
      vec3 n0 = normalize(cross(ax2, vec3(0.3, 0.9, 0.2)));
      vec3 n1 = cross(ax2, n0);
      vec3 nrm = n0 * cos(ph) + n1 * sin(ph);
      vec3 eye = normalize(-(modelViewMatrix * vec4(p, 1.0)).xyz);
      vec3 eyeL = normalize((inverse(mat3(modelViewMatrix))) * eye);
      vec3 h = normalize(eyeL + uSunLocal);
      vSpark = pow(abs(dot(nrm, h)), 60.0);
    #endif
    #ifdef USE_VSHADOW
      if (uVesselShadowEnabled > 0.5) {
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vec4 c = uVesselShadowMatrix * wp;
        vec3 sp = c.xyz / c.w * 0.5 + 0.5;
        if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0 && sp.z < 1.0) {
          float dd = textureLod(uVesselShadowMap, sp.xy, 0.0).x;
          if (sp.z - 0.00005 > dd) vColor.rgb *= 0.18; // in the spacecraft's shadow: lit by the ground only
        }
      }
    #endif
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uIntensity;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vK;
  varying float vSpark;
  void main() {
    #include <logdepthbuf_fragment>
    if (vColor.a <= 0.0) discard;
    #ifdef STYLE_STREAK
      float a = exp(-3.0 * vUv.x * vUv.x) * (1.0 - smoothstep(0.6, 1.0, abs(vUv.y)));
    #else
      float r2 = dot(vUv, vUv);
      if (r2 > 1.0) discard;
      float a = exp(-3.2 * r2) - exp(-3.2);
    #endif
    #ifdef STYLE_GLINT
      vec3 col = vColor.rgb * (0.08 + 1.2 * vSpark) * uIntensity;
      gl_FragColor = vec4(col * a * vColor.a, 1.0);
    #elif defined(ADDITIVE)
      gl_FragColor = vec4(vColor.rgb * uIntensity * a * vColor.a, 1.0);
    #else
      float al = clamp(a * vColor.a, 0.0, 1.0);
      gl_FragColor = vec4(vColor.rgb * uIntensity * al, al); // premultiplied
    #endif
  }
`;

/**
 * Instanced GPU particle pool.
 */
export class ParticlePool {
  /**
   * @param {object} ctx RenderContext
   * @param {object} o
   * @param {number} o.capacity max live particles
   * @param {'streak'|'puff'|'glint'} [o.style='puff']
   * @param {boolean} [o.additive=false] additive blending (else premultiplied alpha)
   * @param {boolean} [o.vesselShadow=false] darken particles inside the spacecraft shadow
   * @param {number} [o.shutter=1/48] streak shutter time (s)
   * @param {number} [o.fadeIn=0.08] fade-in fraction of life
   * @param {string} [o.name]
   */
  constructor(ctx, { capacity, style = 'puff', additive = false, vesselShadow = false, shutter = 1 / 48, fadeIn = 0.08, name = 'particles' }) {
    this.capacity = capacity;
    this.head = 0;
    this.time = 0;
    this.dirtyFrom = -1;
    this.dirtyCount = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aP0 = mk(3);
    this.aV = mk(3);
    this.aT = mk(4);
    this.aC = mk(4);
    this.aS = mk(4);
    // mark all slots dead
    for (let i = 0; i < capacity; i++) this.aT.array[i * 4 + 1] = -1;
    g.setAttribute('aP0', this.aP0);
    g.setAttribute('aV', this.aV);
    g.setAttribute('aT', this.aT);
    g.setAttribute('aC', this.aC);
    g.setAttribute('aS', this.aS);
    g.instanceCount = capacity;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const defines = {};
    if (style === 'streak') defines.STYLE_STREAK = '';
    if (style === 'glint') defines.STYLE_GLINT = '';
    if (additive) defines.ADDITIVE = '';
    if (vesselShadow) defines.USE_VSHADOW = '';
    const uniforms = {
      uTime: { value: 0 },
      uGravity: { value: new THREE.Vector3() },
      uShutter: { value: shutter },
      uFadeIn: { value: fadeIn },
      uIntensity: { value: 1 },
      uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
    };
    if (vesselShadow) Object.assign(uniforms, ctx.vesselShadow.uniforms);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      defines,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive || style === 'glint' ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(ctx.LAYERS.FX);
    this.mesh.name = name;
    this.mesh.renderOrder = 10;
    this.uniforms = uniforms;
    this.live = 0; // approximate: time of the last particle death (for early-out)
    this.lastDeath = -1;
  }

  /**
   * Spawn one particle (local frame).
   * @param {number[]|THREE.Vector3} p position
   * @param {number[]|THREE.Vector3} v velocity (m/s)
   * @param {number} life s
   * @param {number} size0 half-size at birth (m)
   * @param {number} size1 half-size at death (m)
   * @param {number} r @param {number} g @param {number} b colour (linear radiance for additive; albedo-lit for alpha)
   * @param {number} a opacity
   * @param {number} [seed] @param {number} [spin] rad/s (glints) @param {number} [drag] 1/s
   */
  emit(p, v, life, size0, size1, r, g, b, a, seed = Math.random(), spin = 0, drag = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const P = this.aP0.array;
    const V = this.aV.array;
    const T = this.aT.array;
    const C = this.aC.array;
    const S = this.aS.array;
    P[i * 3] = p.x ?? p[0];
    P[i * 3 + 1] = p.y ?? p[1];
    P[i * 3 + 2] = p.z ?? p[2];
    V[i * 3] = v.x ?? v[0];
    V[i * 3 + 1] = v.y ?? v[1];
    V[i * 3 + 2] = v.z ?? v[2];
    T[i * 4] = this.time;
    T[i * 4 + 1] = life;
    T[i * 4 + 2] = size0;
    T[i * 4 + 3] = size1;
    C[i * 4] = r;
    C[i * 4 + 1] = g;
    C[i * 4 + 2] = b;
    C[i * 4 + 3] = a;
    S[i * 4] = seed;
    S[i * 4 + 1] = spin;
    S[i * 4 + 2] = seed * 6.2831853;
    S[i * 4 + 3] = drag;
    this.lastDeath = Math.max(this.lastDeath, this.time + life);
    // track the dirty range (ring buffer: may wrap -> whole buffer)
    if (this.dirtyFrom < 0) {
      this.dirtyFrom = i;
      this.dirtyCount = 1;
    } else {
      const end = this.dirtyFrom + this.dirtyCount;
      if (i === end % this.capacity && this.dirtyCount < this.capacity) this.dirtyCount++;
      else {
        this.dirtyFrom = 0;
        this.dirtyCount = this.capacity;
      }
    }
  }

  /** Remove every particle. */
  clear() {
    const T = this.aT.array;
    for (let i = 0; i < this.capacity; i++) T[i * 4 + 1] = -1;
    this.dirtyFrom = 0;
    this.dirtyCount = this.capacity;
    this.lastDeath = -1;
  }

  /** True while any particle may still be alive. */
  get active() {
    return this.time <= this.lastDeath;
  }

  /**
   * Set the pool clock and upload new particles. Call once per frame after emitting.
   * @param {number} t pool time (s)
   */
  update(t) {
    this.time = t;
    this.uniforms.uTime.value = t;
    this.mesh.visible = this.active;
    if (this.dirtyFrom >= 0) {
      for (const a of [this.aP0, this.aV, this.aT, this.aC, this.aS]) {
        a.clearUpdateRanges();
        if (this.dirtyFrom + this.dirtyCount <= this.capacity) a.addUpdateRange(this.dirtyFrom * a.itemSize, this.dirtyCount * a.itemSize);
        else {
          a.addUpdateRange(this.dirtyFrom * a.itemSize, (this.capacity - this.dirtyFrom) * a.itemSize);
          a.addUpdateRange(0, (this.dirtyFrom + this.dirtyCount - this.capacity) * a.itemSize);
        }
        a.needsUpdate = true;
      }
      this.dirtyFrom = -1;
      this.dirtyCount = 0;
    }
  }
}
