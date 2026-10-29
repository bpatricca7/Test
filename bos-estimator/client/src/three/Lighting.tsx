// Review lighting (default, static daylight, independent of the sim clock) and Live lighting (sim-clock sky,
// sun and moon) per UI spec §3.6 / §9.9. Also owns the sky dome, fog, ground and the shadow-map refresh policy.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { clock } from './clock';
import { fieldUniforms, flatLight, groundColor, groundMaterial, groundUniforms, padFloor, padNight, sitePalette } from './assets';
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

// Obsidian. Review is a neutral studio: the model on a lit board on a black table, white key, no blue cast. Live runs
// a real day: a sunlit grey table under a pale sky by day, a warm low sun at dusk, and a deep cold night where the
// massing goes dark, the chamfer edges and the grid near the site light up like blueprint hairlines, windows burn
// tungsten, the kerbs carry a soft tungsten-white street light (the lamp heads keep the sodium) and the crews glow.
const PAL_KEYS = ['board', 'boardEdge', 'table', 'void', 'grid1', 'grid2', 'contour', 'glow', 'road', 'kerb', 'lot', 'lotEdge', 'dash', 'kerbGlow', 'crown', 'skyTop', 'skyHor'] as const;
type Pal = Record<(typeof PAL_KEYS)[number], THREE.Color>;
const pal = (o: Record<(typeof PAL_KEYS)[number], string>): Pal => { const p = {} as Pal; for (const k of PAL_KEYS) p[k] = new THREE.Color(o[k]); return p; };
function mixPal(out: Pal, a: Pal, b: Pal, t: number) { for (let i = 0; i < PAL_KEYS.length; i++) { const k = PAL_KEYS[i]; out[k].copy(a[k]).lerp(b[k], t); } }
/** colours the flat surfaces show (ground: final; lots, roads: target before exposure compensation); crown is an albedo */
const P_REVIEW = pal({ board: '#1a1a1a', boardEdge: '#3c3c3c', table: '#0f0f0f', void: '#080808', grid1: '#1e1e1e', grid2: '#272727', contour: '#1b1b1b', glow: '#000000',
  road: '#303030', kerb: '#787878', lot: '#232323', lotEdge: '#444444', dash: '#8a8a8a', kerbGlow: '#000000', crown: '#4a524b', skyTop: '#0a0a0a', skyHor: '#0d0d0d' });
const P_DAY = pal({ board: '#5a5b5b', boardEdge: '#8e8e8e', table: '#454646', void: '#7e8081', grid1: '#616262', grid2: '#6b6c6c', contour: '#525353', glow: '#000000',
  road: '#262727', kerb: '#bdbdb9', lot: '#797976', lotEdge: '#a3a3a0', dash: '#ecece6', kerbGlow: '#000000', crown: '#56614d', skyTop: '#8a929b', skyHor: '#d3d6d7' });
const P_DUSK = pal({ board: '#262423', boardEdge: '#48433f', table: '#1b1a19', void: '#181615', grid1: '#2b2928', grid2: '#322f2d', contour: '#252321', glow: '#000000',
  road: '#1b1b1c', kerb: '#6b6661', lot: '#2c2a29', lotEdge: '#48443f', dash: '#7a756f', kerbGlow: '#251e14', crown: '#3a3f38', skyTop: '#16181d', skyHor: '#4b3a31' });
const P_NIGHT = pal({ board: '#0c0d10', boardEdge: '#1f252e', table: '#07080a', void: '#020203', grid1: '#0f1114', grid2: '#141920', contour: '#0d1015', glow: '#0f1924',
  road: '#0e0f11', kerb: '#2b2c30', lot: '#111215', lotEdge: '#22262c', dash: '#2a2a2a', kerbGlow: '#5c4e38', crown: '#464d48', skyTop: '#020305', skyHor: '#07090d' });
const P = pal({ board: '#000', boardEdge: '#000', table: '#000', void: '#000', grid1: '#000', grid2: '#000', contour: '#000', glow: '#000', road: '#000', kerb: '#000', lot: '#000', lotEdge: '#000', dash: '#000', kerbGlow: '#000', crown: '#000', skyTop: '#000', skyHor: '#000' });
const REVIEW = { hemiSky: new THREE.Color('#f2f2f2'), hemiGround: new THREE.Color('#262626'), key: new THREE.Color('#fffaf3'), amb: new THREE.Color('#ececec') };
const LIVE = {
  noon: new THREE.Color('#fff5e8'), dusk: new THREE.Color('#ff9a58'), moon: new THREE.Color('#8ea0ba'),
  hemiSkyDay: new THREE.Color('#eef0f2'), hemiSkyNight: new THREE.Color('#66748a'), hemiGroundDay: new THREE.Color('#3a3a38'), hemiGroundNight: new THREE.Color('#060607'),
  ambDay: new THREE.Color('#ececec'), ambNight: new THREE.Color('#8191a8'),
};
/** 0 at night → 1 in daylight; 0.5 around 17:30 / 06:30 (dusk and dawn) */
export const daylight = (t: number) => { const x = Math.min(1, Math.max(0, dayFactor(t) / 0.26)); return x * x * (3 - 2 * x); };

/** the table follows the site bounds; it eases toward a grown site while a read streams */
export const tableTarget = { cx: 0, cz: 0, hx: 60, hz: 45, r: 80, m: 6, set: false };
const ease = (a: number, b: number, k: number) => a + (b - a) * k;
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

  useFrame((_, dtRaw) => {
    const t = clock.time;
    let night = 0;
    let L = 1;
    if (!live) {
      mixPal(P, P_REVIEW, P_REVIEW, 0);
      uniforms.top.value.copy(P.skyTop); uniforms.horizon.value.copy(P.skyHor); uniforms.glowAmt.value = 0; uniforms.disc.value = 0;
      dir.copy(REVIEW_DIR);
      if (sun.current) { sun.current.intensity = 2.0; sun.current.color.copy(REVIEW.key); }
      if (moon.current) moon.current.intensity = 0;
      if (hemi.current) { hemi.current.intensity = 1.0; hemi.current.color.copy(REVIEW.hemiSky); hemi.current.groundColor.copy(REVIEW.hemiGround); }
      if (amb.current) { amb.current.intensity = 0.35; amb.current.color.copy(REVIEW.amb); }
      if (stars.current) stars.current.visible = false;
      fieldUniforms.uEdgeGlow.value.setRGB(0, 0, 0);
    } else {
      const day = dayFactor(t);
      night = nightFactor(t);
      L = daylight(t);
      if (L >= 0.5) mixPal(P, P_DUSK, P_DAY, (L - 0.5) * 2); else mixPal(P, P_NIGHT, P_DUSK, L * 2);
      const ang = ((t - 6) / 12) * Math.PI;
      dir.set(Math.cos(ang), Math.sin(ang), 0.45).normalize();
      // a low warm sun at dusk; moonlight from high above at night
      const minY = 0.2 + 0.4 * (1 - L);
      if (dir.y < minY) { dir.y = minY + (minY - dir.y) * 0.3; dir.normalize(); }
      uniforms.sunDir.value.set(Math.cos(ang), Math.sin(ang), 0.45).normalize();
      uniforms.glowAmt.value = Math.exp(-Math.pow(Math.sin(ang) / 0.22, 2)) * 0.9;
      uniforms.disc.value = day > 0 ? 0.8 : 0;
      uniforms.top.value.copy(P.skyTop);
      uniforms.horizon.value.copy(P.skyHor);
      fog.color.copy(P.skyHor);
      if (sun.current) {
        sun.current.intensity = 0.5 + (0.7 + 1.9 * day) * L;
        if (L >= 0.5) tmp.copy(LIVE.dusk).lerp(LIVE.noon, Math.min(1, (L - 0.5) * 2.4)); else { const k = Math.max(0, Math.min(1, (L - 0.12) / 0.38)); tmp.copy(LIVE.moon).lerp(LIVE.dusk, k * k); }
        sun.current.color.copy(tmp);
      }
      if (moon.current) moon.current.intensity = 0.25 * night;
      if (hemi.current) { hemi.current.intensity = 0.26 + 0.89 * L; hemi.current.color.copy(LIVE.hemiSkyNight).lerp(LIVE.hemiSkyDay, L); hemi.current.groundColor.copy(LIVE.hemiGroundNight).lerp(LIVE.hemiGroundDay, L); }
      if (amb.current) { amb.current.intensity = 0.1 + 0.2 * L; amb.current.color.copy(LIVE.ambNight).lerp(LIVE.ambDay, L); }
      if (stars.current) stars.current.visible = day < 0.12;
      // the chamfer edges light up from dusk: white, ~1 px (screen-space in the shader), a modest bloom
      const e = Math.pow(1 - L, 1.6) * 1.35;
      fieldUniforms.uEdgeGlow.value.setRGB(e, e, e);
      // haze only well beyond the model: the campus stays crisp, the far table melts into the sky
      fog.near = Math.max(420, geo.r * 4); fog.far = Math.max(fog.near + 600, geo.r * 11);
    }
    // the table: ease toward the site bounds (a streaming read grows the site a few buildings at a time)
    {
      const g = groundUniforms, tt = tableTarget;
      const k = 1 - Math.exp(-Math.min(0.1, dtRaw || 0) * 7);
      // a new project (or the first frame) snaps; growth eases, except under reduced motion, where it snaps too
      const kk = useStore.getState().reducedMotion || Math.abs(g.uCenter.value.x - tt.cx) + Math.abs(g.uCenter.value.y - tt.cz) > tt.r * 1.5 || !tt.set ? 1 : k;
      g.uCenter.value.set(ease(g.uCenter.value.x, tt.cx, kk), ease(g.uCenter.value.y, tt.cz, kk));
      g.uHalf.value.set(ease(g.uHalf.value.x, tt.hx, kk), ease(g.uHalf.value.y, tt.hz, kk));
      g.uSiteR.value = ease(g.uSiteR.value, tt.r, kk); g.uBoardM.value = ease(g.uBoardM.value, tt.m, kk);
      tt.set = true;
      const off = Math.abs(g.uHalf.value.x - tt.hx) + Math.abs(g.uHalf.value.y - tt.hz) + Math.abs(g.uCenter.value.x - tt.cx) + Math.abs(g.uCenter.value.y - tt.cz);
      if (off > 0.05) rt.animating.add('table'); else if (rt.animating.has('table')) { rt.animating.delete('table'); g.uCenter.value.set(tt.cx, tt.cz); g.uHalf.value.set(tt.hx, tt.hz); g.uSiteR.value = tt.r; g.uBoardM.value = tt.m; }
      g.uBoard.value.copy(P.board); g.uBoardEdge.value.copy(P.boardEdge); g.uTable.value.copy(P.table); g.uVoid.value.copy(P.void);
      g.uGrid1.value.copy(P.grid1); g.uGrid2.value.copy(P.grid2); g.uContour.value.copy(P.contour); g.uGlow.value.copy(P.glow);
      g.uGridAmt.value = 1;
      { const S = Math.max(1, g.uSiteR.value); g.uInvS.value = 1 / S; g.uInvSp.value = 1 / Math.max(20, S * 0.3); }
      groundColor.copy(P.board);
      const sp = sitePalette;
      sp.road.copy(P.road); sp.kerb.copy(P.kerb); sp.lot.copy(P.lot); sp.lotEdge.copy(P.lotEdge); sp.dash.copy(P.dash); sp.kerbGlow.copy(P.kerbGlow); sp.crown.copy(P.crown);
    }
    groundMaterial(true).color.copy(groundColor); groundMaterial(true, true).color.copy(groundColor);
    // irradiance / π on a horizontal surface, for the unlit flat surfaces of the Fast tier
    const c = fl.c.setRGB(0, 0, 0);
    if (amb.current) { c.r = amb.current.color.r * amb.current.intensity; c.g = amb.current.color.g * amb.current.intensity; c.b = amb.current.color.b * amb.current.intensity; }
    if (hemi.current) { c.r += hemi.current.color.r * hemi.current.intensity; c.g += hemi.current.color.g * hemi.current.intensity; c.b += hemi.current.color.b * hemi.current.intensity; }
    if (sun.current) { const k = Math.max(0, dir.y) * sun.current.intensity; c.r += sun.current.color.r * k; c.g += sun.current.color.g * k; c.b += sun.current.color.b * k; }
    if (moon.current && moon.current.intensity > 0) { const md = fl.m.copy(moon.current.position).sub(moon.current.target.position).normalize(); const k = Math.max(0, md.y) * moon.current.intensity; c.r += moon.current.color.r * k; c.g += moon.current.color.g * k; c.b += moon.current.color.b * k; }
    flatLight.value.setRGB(c.r / Math.PI, c.g / Math.PI, c.b / Math.PI);
    padFloor.value = night * 0.2; padNight.value = night * 0.3;
    sitePalette.exposure = flatLight.value.r * 0.2126 + flatLight.value.g * 0.7152 + flatLight.value.b * 0.0722;
    // dimmed buildings sink toward the board (as an albedo under the current light)
    fieldUniforms.uGround.value.copy(P.board).multiplyScalar(1 / Math.max(0.05, sitePalette.exposure));
    fieldUniforms.uNight.value = night;
    fieldUniforms.uTime.value = performance.now() / 1000;
    if (sun.current) { sun.current.position.set(geo.cx + dir.x * geo.r * 2, dir.y * geo.r * 2, geo.cz + dir.z * geo.r * 2); }
    if (moon.current) moon.current.position.set(geo.cx - dir.x * 100, 120, geo.cz - dir.z * 100 - 80);
    if (sky.current) {
      sky.current.position.copy(camera.position); sky.current.scale.setScalar((camera as THREE.PerspectiveCamera).far * 0.9);
      // only draw the dome when some of the view looks above the horizon
      camera.updateMatrixWorld();
      let up = -1;
      for (let x = -1; x <= 1; x += 2) { fl.b.set(x, 1, 0.5).unproject(camera).sub(camera.position).normalize(); up = Math.max(up, fl.b.y); }
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
  const rings = useStore((s) => s.quality) === 'high'; // the table's contour rings are a High-tier detail
  const invalidate = useThree((s) => s.invalidate);
  const select = useStore((s) => s.select);
  const b = layout?.bounds ?? { x: 0, z: 0, w: 200, d: 200 };
  const size = Math.max(6000, Math.max(b.w, b.d) * 12);
  // the board hugs the campus bounds one margin out (an empty project shows a bare board waiting for a model)
  const empty = !layout || (layout.buildings.length === 0 && layout.zones.length === 0);
  const tb = empty ? { x: 0, z: 0, w: 120, d: 84 } : b;
  const wasEmpty = useRef(true);
  useEffect(() => {
    const r = Math.max(40, Math.hypot(tb.w, tb.d) / 2);
    // a site that grows (a streaming read) eases; a first model, another project or a jump in size snaps
    const ratio = r / Math.max(1, tableTarget.r);
    if (wasEmpty.current || empty || ratio > 2 || ratio < 0.5) tableTarget.set = false;
    wasEmpty.current = empty;
    Object.assign(tableTarget, { cx: tb.x, cz: tb.z, hx: tb.w / 2, hz: tb.d / 2, r, m: Math.max(5, Math.min(30, r * 0.07)) });
    invalidate();
  }, [tb.x, tb.z, tb.w, tb.d, empty, invalidate]);
  return (
    // the open ground never carries building shadows (lots, roads and pads cover the campus), so it stays on the
    // cheap unlit × flat-light material in both tiers
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.x, 0, b.z]} material={groundMaterial(true, rings)} name="ground" renderOrder={-1}
      onClick={(e) => { if (e.delta > 4 || useStore.getState().focusMode === 'building') return; e.stopPropagation(); select({ kind: null }); }}>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}
