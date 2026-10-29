// Review lighting (default, static daylight, independent of the sim clock) and Live lighting (sim-clock sky,
// sun and moon) per UI spec §3.6 / §9.9. Also owns the sky dome, fog, ground and the shadow-map refresh policy.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { clock } from './clock';
import { fieldUniforms, flatLight, groundColor, groundMaterial, groundUniforms } from './assets';
import { rt } from './runtime';

/**
 * Directional shadows sample the shadow map once, with hardware 2×2 PCF (a sampler2DShadow with linear
 * filtering), instead of three's five rotated taps: the edges stay soft at site scale and every lit pixel of
 * the High tier does a quarter of the shadow work, which software rasterizers feel directly.
 */
(() => {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const five = /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \) \* radius, shadowCoord\.z \) \)[\s\S]*?\) \* 0\.2;/;
  if (five.test(chunk)) (THREE.ShaderChunk as Record<string, string>).shadowmap_pars_fragment = chunk.replace(five, 'shadow = texture( shadowMap, shadowCoord.xyz );');
})();

/** 0 at night → 1 at solar noon. */
export const dayFactor = (t: number) => Math.max(0, Math.sin(((t - 6) / 12) * Math.PI));
/** 0 by day → 1 deep night, with dusk/dawn ramps. */
export const nightFactor = (t: number) => { const d = dayFactor(t); return d > 0.25 ? 0 : 1 - d / 0.25; };

// Obsidian: Review is a neutral studio (black void, white key, no blue cast); Live runs from a graphite overcast day to an
// obsidian night where the only colour is warm window light and a faint cold moon on the massing.
const REVIEW = {
  top: new THREE.Color('#0a0a0a'), horizon: new THREE.Color('#1b1b1b'),
  hemiSky: new THREE.Color('#f2f2f2'), hemiGround: new THREE.Color('#262626'),
  key: new THREE.Color('#fffaf3'), ground: new THREE.Color('#0d0d0d'),
};
const LIVE = {
  topDay: new THREE.Color('#2c2c2c'), topNight: new THREE.Color('#020202'), horDay: new THREE.Color('#6b6b6b'), horNight: new THREE.Color('#0d0d0d'),
  night: new THREE.Color('#9aa5b6'), dusk: new THREE.Color('#ffb07a'), noon: new THREE.Color('#fffaf2'),
  hemiSky: new THREE.Color('#e4e6ea'), hemiGround: new THREE.Color('#222222'), groundDay: new THREE.Color('#151515'), groundNight: new THREE.Color('#080808'),
};
/** key light direction for Review: azimuth 135° (from +z toward +x), elevation 50° */
const REVIEW_DIR = (() => { const az = (135 * Math.PI) / 180, el = (50 * Math.PI) / 180; return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize(); })();

export function Lighting() {
  const lighting = useStore((s) => s.lighting ?? 'review');
  const quality = useStore((s) => s.quality);
  const { layout } = useDerived();
  const live = lighting === 'live';
  const { scene, gl, camera, invalidate } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const moon = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const stars = useRef<THREE.Group>(null);
  const sky = useRef<THREE.Mesh>(null);
  const fog = useMemo(() => new THREE.Fog('#0d0d0d', 300, 2000), []);
  const uniforms = useMemo(() => ({ top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color('#ff8f4a') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glowAmt: { value: 0 }, disc: { value: 0 } }), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const fl = useMemo(() => ({ c: new THREE.Color(), m: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  const lastShadowT = useRef(-1);
  const lastShadowAt = useRef(0);

  // radius / centre of the site for fog and shadow camera
  const geo = useMemo(() => {
    const b = layout?.bounds ?? { x: 0, z: 0, w: 120, d: 120 };
    const r = Math.max(60, Math.hypot(b.w, b.d) / 2);
    return { cx: b.x, cz: b.z, r, h: layout?.maxHeight ?? 10 };
  }, [layout]);

  useEffect(() => { scene.fog = live ? fog : null; return () => { scene.fog = null; }; }, [live, fog, scene]);
  // a new layout first shows with the previous shadow map; the shadow pass (a 2048² depth render of the whole
  // site) runs in the frame after, so an edit reaches the screen without waiting for it
  const firstLayout = useRef(true);
  useEffect(() => { gl.shadowMap.autoUpdate = false; rt.shadowDirty = true; }, [gl, quality, live]);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    if (firstLayout.current) { firstLayout.current = false; rt.shadowDirty = true; return; }
    rt.shadowDeferred = true;
  }, [gl, layout]);

  // shadow camera fitted to the site bounds + 10%
  useEffect(() => {
    const s = sun.current; if (!s) return;
    const r = geo.r * 1.1;
    const cam = s.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = r * 4 + geo.h * 2 + 50;
    cam.updateProjectionMatrix();
    s.target.position.set(geo.cx, 0, geo.cz); s.target.updateMatrixWorld();
    rt.shadowDirty = true;
  }, [geo]);

  useFrame(() => {
    const t = clock.time;
    let night = 0;
    if (!live) {
      uniforms.top.value.copy(REVIEW.top); uniforms.horizon.value.copy(REVIEW.horizon); uniforms.glowAmt.value = 0; uniforms.disc.value = 0;
      dir.copy(REVIEW_DIR);
      if (sun.current) { sun.current.intensity = 2.0; sun.current.color.copy(REVIEW.key); }
      if (moon.current) moon.current.intensity = 0;
      if (hemi.current) { hemi.current.intensity = 1.0; hemi.current.color.copy(REVIEW.hemiSky); hemi.current.groundColor.copy(REVIEW.hemiGround); }
      if (amb.current) amb.current.intensity = 0.35;
      if (stars.current) stars.current.visible = false;
      groundColor.copy(REVIEW.ground); groundUniforms.uGridAmt.value = 1;
      fieldUniforms.uGround.value.copy(REVIEW.ground);
    } else {
      const day = dayFactor(t);
      night = nightFactor(t);
      const ang = ((t - 6) / 12) * Math.PI;
      dir.set(Math.cos(ang), Math.sin(ang), 0.45).normalize();
      if (dir.y < 0.5) { dir.y = 0.5 + (0.5 - dir.y) * 0.3; dir.normalize(); } // moonlight from high above at night
      uniforms.sunDir.value.set(Math.cos(ang), Math.sin(ang), 0.45).normalize();
      uniforms.glowAmt.value = Math.exp(-Math.pow(Math.sin(ang) / 0.22, 2)) * 0.9;
      uniforms.disc.value = day > 0 ? 0.8 : 0;
      uniforms.top.value.copy(LIVE.topNight).lerp(LIVE.topDay, day);
      uniforms.horizon.value.copy(LIVE.horNight).lerp(LIVE.horDay, Math.min(1, day * 1.4));
      fog.color.copy(uniforms.horizon.value);
      if (sun.current) {
        sun.current.intensity = 0.8 + day * 1.45;
        if (day <= 0) tmp.copy(LIVE.night); else if (day < 0.35) tmp.copy(LIVE.dusk).lerp(LIVE.noon, day / 0.35); else tmp.copy(LIVE.noon);
        sun.current.color.copy(tmp);
      }
      if (moon.current) moon.current.intensity = 0.6 * night;
      // night floor: roofs stay readable (category colours distinguishable) at 22:30
      if (hemi.current) { hemi.current.intensity = Math.max(0.45, 0.6 + day * 0.7 + night * 0.25); hemi.current.color.copy(LIVE.hemiSky); hemi.current.groundColor.copy(LIVE.hemiGround); }
      if (amb.current) amb.current.intensity = 0.32 + day * 0.2 + night * 0.2;
      if (stars.current) stars.current.visible = day < 0.12;
      groundColor.copy(LIVE.groundNight).lerp(LIVE.groundDay, Math.min(1, day * 1.5)); groundUniforms.uGridAmt.value = 0.35;
      fieldUniforms.uGround.value.copy(groundColor);
      fog.near = Math.max(300, geo.r * 2); fog.far = Math.max(fog.near + 200, geo.r * 6);
    }
    groundMaterial(true).color.copy(groundColor);
    // irradiance / π on a horizontal surface, for the unlit flat surfaces of the Fast tier
    const c = fl.c.setRGB(0, 0, 0);
    if (amb.current) { c.r = amb.current.color.r * amb.current.intensity; c.g = amb.current.color.g * amb.current.intensity; c.b = amb.current.color.b * amb.current.intensity; }
    if (hemi.current) { c.r += hemi.current.color.r * hemi.current.intensity; c.g += hemi.current.color.g * hemi.current.intensity; c.b += hemi.current.color.b * hemi.current.intensity; }
    if (sun.current) { const k = Math.max(0, dir.y) * sun.current.intensity; c.r += sun.current.color.r * k; c.g += sun.current.color.g * k; c.b += sun.current.color.b * k; }
    if (moon.current && moon.current.intensity > 0) { const md = fl.m.copy(moon.current.position).sub(moon.current.target.position).normalize(); const k = Math.max(0, md.y) * moon.current.intensity; c.r += moon.current.color.r * k; c.g += moon.current.color.g * k; c.b += moon.current.color.b * k; }
    flatLight.value.setRGB(c.r / Math.PI, c.g / Math.PI, c.b / Math.PI);
    fieldUniforms.uNight.value = night;
    fieldUniforms.uTime.value = performance.now() / 1000;
    if (sun.current) { sun.current.position.set(geo.cx + dir.x * geo.r * 2, dir.y * geo.r * 2, geo.cz + dir.z * geo.r * 2); }
    if (moon.current) moon.current.position.set(geo.cx - dir.x * 100, 120, geo.cz - dir.z * 100 - 80);
    if (sky.current) {
      sky.current.position.copy(camera.position); sky.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.9);
      // only draw the dome when some of the view looks above the horizon
      camera.updateMatrixWorld();
      let up = -1;
      for (const x of [-1, 1]) { fl.b.set(x, 1, 0.5).unproject(camera).sub(camera.position).normalize(); up = Math.max(up, fl.b.y); }
      sky.current.visible = up > -0.03;
    }
    // shadow map: refresh on demand (layout, selection, lighting) and at ≤ 1 Hz while the Live sun moves (spec: ≤ 4 Hz)
    // the Live sun moves with the clock: refresh the shadow map when it has moved ≥ 6 sim-minutes, at most 1×/s
    if (live && quality === 'high' && Math.abs(t - lastShadowT.current) > 0.1 && performance.now() - lastShadowAt.current > 1000) { lastShadowT.current = t; rt.shadowDirty = true; }
    if (rt.shadowDeferred) { rt.shadowDeferred = false; if (!rt.shadowDirty) { rt.shadowDirty = true; invalidate(); return; } }
    if (rt.shadowDirty) { gl.shadowMap.needsUpdate = true; rt.shadowDirty = false; lastShadowAt.current = performance.now(); }
  }, -2);

  return (
    <>
      <mesh ref={sky} renderOrder={1000} frustumCulled={false} raycast={() => null} name="sky">
        <sphereGeometry args={[1, 32, 16]} />
        <shaderMaterial side={THREE.BackSide} depthWrite={false} depthTest fog={false} uniforms={uniforms}
          vertexShader={'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }'}
          fragmentShader={`uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform float glowAmt; uniform float disc; varying vec3 vDir;
            void main(){ float h = clamp(vDir.y, -0.1, 1.0); float k = pow(1.0 - clamp(h, 0.0, 1.0), 2.2); vec3 c = mix(top, horizon, k);
              float s = max(0.0, dot(normalize(vDir), normalize(sunDir))); c += glow * glowAmt * pow(s, 6.0) * (1.0 - clamp(h*3.0,0.0,1.0)*0.6);
              c += vec3(1.0, 0.95, 0.85) * pow(s, 400.0) * disc * step(0.0, sunDir.y); gl_FragColor = vec4(c, 1.0);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`} />
      </mesh>
      {live && <group ref={stars}><Stars radius={900} depth={80} count={2200} factor={4} fade speed={0.35} /></group>}
      <ambientLight ref={amb} intensity={0.35} color="#ececec" />
      <hemisphereLight ref={hemi} intensity={1} color="#f2f2f2" groundColor="#262626" />
      <directionalLight ref={sun} intensity={2} castShadow={quality === 'high'} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.04} />
      {live && <directionalLight ref={moon} intensity={0} color="#9aa5b6" />}
    </>
  );
}

/** Ground plane with the review grid. Clicking empty ground clears the selection. */
export function Ground() {
  const { layout } = useDerived();
  const select = useStore((s) => s.select);
  const b = layout?.bounds ?? { x: 0, z: 0, w: 200, d: 200 };
  const size = Math.max(6000, Math.max(b.w, b.d) * 12);
  useEffect(() => { groundUniforms.uFadeFar.value = Math.max(900, Math.max(b.w, b.d) * 2.2); }, [b.w, b.d]);
  return (
    // the open ground never carries building shadows (lots, roads and pads cover the campus), so it stays on the
    // cheap unlit × flat-light material in both tiers
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.x, 0, b.z]} material={groundMaterial(true)} name="ground" renderOrder={-1}
      onClick={(e) => { if (e.delta > 4 || useStore.getState().focusMode === 'building') return; e.stopPropagation(); select({ kind: null }); }}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
