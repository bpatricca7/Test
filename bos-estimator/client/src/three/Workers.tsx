// Crews (UI spec §9.11). One instanced set for every drawn agent (bodies, heads, gear, ground rings) plus an
// invisible pick proxy of r = 0.9 spheres with an analytic ray test, so clicks land reliably. Bounding spheres are
// fixed to the site bounds × 1.5 on every layout change. Inside a building (Interior tab) the local interior crew
// replaces the site roster. The worker card itself is drawn by the label layer.
import { useEffect, useMemo } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { crewMeta, type Crew } from '@shared/factors';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { crewColor } from '../components/lib/theme';
import { clock } from './clock';
import { agentStates, type AgentState } from './sim';
import { interiorAgents } from './InteriorCrew';
import { basic, mat, std } from './assets';
import { rt, type CrewPoint } from './runtime';

const m4 = new THREE.Matrix4();
const q0 = new THREE.Quaternion();
const v0 = new THREE.Vector3();
const s0 = new THREE.Vector3();
const e0 = new THREE.Euler();
const QI = new THREE.Quaternion();
const c0 = new THREE.Color();
const NEUTRAL_BODY = new THREE.Color('#2b3240');
const SKIN = new THREE.Color('#f1d3b3');
const capFor = (n: number) => { let c = 32; while (c < n) c *= 2; return c; };

type GearKind = 'mower' | 'cart' | 'tray' | 'none';
const gearOf = (crew: Crew): GearKind => { const m = crewMeta(crew); return m.domain === 'grounds' ? (crew === 'grounds_mow' ? 'mower' : 'cart') : m.domain === 'dining' ? 'tray' : crew === 'supervision' ? 'none' : 'cart'; };
const GEAR_SIZE: Record<GearKind, [number, number, number]> = { mower: [1.1, 0.5, 1.4], cart: [0.55, 0.5, 0.8], tray: [0.5, 0.06, 0.35], none: [0, 0, 0] };
const GEAR_COLOR: Record<GearKind, THREE.Color> = { mower: new THREE.Color('#d97706'), cart: new THREE.Color('#fbbf24'), tray: new THREE.Color('#e2e8f0'), none: new THREE.Color('#000') };

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
/**
 * Analytic pick test against the agents (instance translations). The pick radius is 0.9 units or `userData.k`
 * × distance (a few screen pixels), whichever is larger, so crew members stay clickable at site distance.
 * The hit is reported at the agent's own depth, so a building in front still wins and ground behind loses.
 */
function proxyRaycast(this: THREE.InstancedMesh, raycaster: THREE.Raycaster, out: THREE.Intersection[]) {
  const k = (this.userData.k as number | undefined) ?? 0;
  const r0 = (this.userData.r0 as number | undefined) ?? 0.9;
  const ids = this.userData.ids as string[] | undefined;
  const hist = this.userData.hist as Map<string, { x: number; y: number; z: number; t: number }[]> | undefined;
  const o = raycaster.ray.origin, dir = raycaster.ray.direction;
  const xray = this.userData.xray as Uint8Array | undefined;
  // one hit: the agent closest to the pointer (in pick-radius units); overlapping figures resolve by proximity
  let best = -1, bestPerp = Infinity, bestT = 0;
  for (let i = 0; i < this.count; i++) {
    this.getMatrixAt(i, m4);
    _c.setFromMatrixPosition(m4);
    // where the agent is now, or was during the last few hundred ms (a moving agent stays clickable)
    const test = (x: number, y: number, z: number) => {
      _c.set(x, y, z);
      const t = _d.copy(_c).sub(o).dot(dir);
      if (t <= 0) return;
      const perp = _d.copy(o).addScaledVector(dir, t).distanceTo(_c) / Math.max(r0, k * t);
      if (perp < bestPerp) { bestPerp = perp; bestT = t; best = i; }
    };
    test(_c.x, _c.y, _c.z);
    const h = ids && hist ? hist.get(ids[i]) : undefined;
    if (h) for (const p of h) test(p.x, p.y, p.z);
  }
  if (best < 0 || bestPerp > 1) return;
  const distance = xray?.[best] === 1 ? 0 : Math.max(0, bestT - 0.9);
  if (distance < raycaster.near || distance > raycaster.far) return;
  out.push({ distance, point: o.clone().addScaledVector(dir, distance), object: this, instanceId: best } as THREE.Intersection);
}

export function Workers() {
  const { roster, layout, estById } = useDerived();
  const invalidate = useThree((s) => s.invalidate);
  const crewFilter = useStore((s) => s.crewFilter);
  const focusMode = useStore((s) => s.focusMode);
  const selection = useStore((s) => s.selection);
  const buildingTab = useStore((s) => s.buildingTab);
  const lighting = useStore((s) => s.lighting ?? 'review');
  const grounds = useStore((s) => s.project?.inventory.grounds);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);

  const selId = selection.kind === 'facility' ? selection.id : null;
  const focused = focusMode === 'building' && selId != null;
  const interiorView = focused && buildingTab === 'interior';
  const attached = useMemo(() => new Set((grounds ?? []).filter((g) => selId != null && g.facilityId === selId).map((g) => g.id)), [grounds, selId]);
  const placement = useMemo(() => (selId && layout ? layout.buildings.find((b) => b.id === selId) : undefined), [layout, selId]);
  const crewColored = lighting === 'live' || crewFilter != null; // who carries the colour: crews in Live / when filtered

  const cap = capFor(roster.length + 32);
  const meshes = useMemo(() => {
    const body = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.55, 2, 7), std('crew-body', { color: '#ffffff', roughness: 0.55, emissive: '#000000' }), cap);
    const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 7, 5), std('crew-head', { color: '#ffffff', roughness: 0.7 }), cap);
    const gear = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('crew-gear', { color: '#ffffff', roughness: 0.6 }), cap);
    const ringGeo = new THREE.RingGeometry(0.45, 0.6, 16); ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.InstancedMesh(ringGeo, basic('crew-ring', { color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }), cap);
    const proxy = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 6, 4), basic('crew-proxy', { colorWrite: false, depthWrite: false }), cap);
    // crews working inside buildings, seen through the walls when the camera is close (site view)
    const xbody = new THREE.InstancedMesh(body.geometry, mat('crew-xbody', () => new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 })), cap);
    const xhead = new THREE.InstancedMesh(head.geometry, mat('crew-xhead', () => new THREE.MeshBasicMaterial({ color: '#f1d3b3', depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 })), cap);
    xbody.renderOrder = 20; xhead.renderOrder = 21; xbody.name = 'crew-xray-bodies'; xhead.name = 'crew-xray-heads';
    for (const m of [xbody, xhead]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.raycast = () => {}; }
    xbody.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (const m of [body, head, gear, ring]) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.raycast = () => {}; }
    body.castShadow = true; gear.castShadow = true;
    ring.renderOrder = 2;
    proxy.visible = false; proxy.count = 0; proxy.raycast = proxyRaycast; proxy.name = 'crew-proxy';
    body.name = 'crew-bodies'; head.name = 'crew-heads'; gear.name = 'crew-gear'; ring.name = 'crew-rings';
    return { body, head, gear, ring, proxy, xbody, xhead, ids: [] as string[], xray: new Uint8Array(cap) };
  }, [cap]);
  useEffect(() => () => { for (const m of [meshes.body, meshes.head, meshes.gear, meshes.ring, meshes.proxy]) m.geometry.dispose(); }, [meshes]);
  useEffect(() => { meshes.proxy.userData.xray = meshes.xray; }, [meshes]);

  // fixed bounding spheres: the site bounds × 1.5
  useEffect(() => {
    const b = layout?.bounds ?? { x: 0, z: 0, w: 200, d: 200 };
    const sph = new THREE.Sphere(new THREE.Vector3(b.x, 0, b.z), (Math.hypot(b.w, b.d) / 2) * 1.5 + 20);
    for (const m of [meshes.body, meshes.head, meshes.gear, meshes.ring, meshes.proxy, meshes.xbody, meshes.xhead]) m.boundingSphere = sph.clone();
    invalidate();
  }, [layout, meshes, invalidate]);

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  const controlsRef = () => get().controls as unknown;
  const hist = useMemo(() => new Map<string, { x: number; y: number; z: number; t: number }[]>(), []);
  useEffect(() => { meshes.proxy.userData.hist = hist; }, [meshes, hist]);
  useFrame(() => {
    // pick radius: 5 screen px at the agent's distance
    const ortho = (camera as unknown as THREE.OrthographicCamera).isOrthographicCamera === true;
    meshes.proxy.userData.k = ortho ? 0 : (5 * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, size.height);
    meshes.proxy.userData.r0 = ortho ? Math.max(0.9, 5 / Math.max(0.01, camera.zoom)) : 0.9;
    if (!layout) { rt.crew = []; return; }
    const time = clock.time;
    const R = Math.hypot(layout.bounds.w, layout.bounds.d) / 2;
    const ctl = controlsRef() as { target?: THREE.Vector3 } | null;
    const close = !focused && ctl?.target != null && camera.position.distanceTo(ctl.target) < 0.6 * R;
    const selAgent = useStore.getState().selectedAgentId;
    let list: AgentState[];
    if (interiorView) list = interiorAgents(selId ? estById.get(selId) : undefined, placement, time).filter((s) => !crewFilter || s.agent.crew === crewFilter);
    else {
      const states = agentStates(roster, time, layout.depot);
      list = states.filter((s) => {
        if (s.status === 'off') return false;
        if (crewFilter && s.agent.crew !== crewFilter) return false;
        if (focused) {
          if (!s.job) return false;
          return s.job.kind === 'zone' && attached.has(s.job.targetId); // Grounds tab: the crews on this building's grounds
        }
        // site view: crews inside buildings show through the walls only when the camera is close;
        // at site distance the full labels carry a crew-dot row instead
        return close || !(s.status === 'work' && s.job?.kind === 'facility');
      });
      // per-building crew counts for the label layer's crew dots
      const at = new Map<string, Map<string, number>>();
      for (const s of states) if (s.status === 'work' && s.job?.kind === 'facility') { let m = at.get(s.job.targetId); if (!m) { m = new Map(); at.set(s.job.targetId, m); } m.set(s.agent.crew, (m.get(s.agent.crew) ?? 0) + s.agent.represents); }
      rt.crewAt = at; rt.interiorHidden = !close;
    }
    if (interiorView) { rt.crewAt = new Map(); rt.interiorHidden = false; }
    const t = performance.now() / 1000;
    const crew: CrewPoint[] = [];
    let g = 0;
    const n = Math.min(list.length, cap);
    let xi = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      const sel = s.agent.id === selAgent;
      const xr = !focused && s.status === 'work' && s.job?.kind === 'facility';
      meshes.xray[i] = xr ? 1 : 0;
      if (xr) {
        const sc = sel ? 1.25 : 1;
        e0.set(0, s.heading, 0); q0.setFromEuler(e0);
        m4.compose(v0.set(s.x, s.y + 0.55 * sc, s.z), q0, s0.set(sc, sc, sc)); meshes.xbody.setMatrixAt(xi, m4); meshes.xbody.setColorAt(xi, c0.set(crewColor(s.agent.crew)));
        m4.compose(v0.set(s.x, s.y + 1.12 * sc, s.z), q0, s0.set(sc, sc, sc)); meshes.xhead.setMatrixAt(xi, m4);
        xi++;
        m4.compose(v0.set(s.x, s.y + 0.6, s.z), QI, s0.set(1, 1, 1)); meshes.proxy.setMatrixAt(i, m4);
        m4.makeScale(0, 0, 0); meshes.body.setMatrixAt(i, m4); meshes.head.setMatrixAt(i, m4); meshes.ring.setMatrixAt(i, m4);
        crew.push({ id: s.agent.id, crew: s.agent.crew, wx: s.x, wy: s.y + 0.6 * sc, wz: s.z, state: s, xray: true });
        continue;
      }
      const bob = clock.playing ? (s.status === 'travel' ? Math.abs(Math.sin(t * 9 + i)) * 0.08 : Math.sin(t * 5 + i) * 0.03) : 0;
      const sc = sel ? 1.25 : 1;
      e0.set(0, s.heading, 0); q0.setFromEuler(e0);
      m4.compose(v0.set(s.x, s.y + 0.55 * sc + bob, s.z), q0, s0.set(sc, sc, sc)); meshes.body.setMatrixAt(i, m4);
      const cc = c0.set(crewColor(s.agent.crew));
      if (crewColored || sel) meshes.body.setColorAt(i, cc); else meshes.body.setColorAt(i, NEUTRAL_BODY);
      m4.compose(v0.set(s.x, s.y + 1.12 * sc + bob, s.z), q0, s0.set(sc, sc, sc)); meshes.head.setMatrixAt(i, m4); meshes.head.setColorAt(i, SKIN);
      const rs = sel ? 1.5 : (s.status === 'work' || !crewColored) ? 1 : 0.0001;
      m4.compose(v0.set(s.x, s.y + 0.03, s.z), QI, s0.set(rs, 1, rs)); meshes.ring.setMatrixAt(i, m4); meshes.ring.setColorAt(i, cc);
      m4.compose(v0.set(s.x, s.y + 0.6, s.z), QI, s0.set(1, 1, 1)); meshes.proxy.setMatrixAt(i, m4);
      const gk = gearOf(s.agent.crew);
      if (gk !== 'none') {
        const [gw, gh, gd] = GEAR_SIZE[gk];
        m4.compose(v0.set(s.x + Math.sin(s.heading) * 0.55, s.y + (gk === 'tray' ? 0.75 : 0.25), s.z + Math.cos(s.heading) * 0.55), q0, s0.set(gw, gh, gd)); meshes.gear.setMatrixAt(g, m4); meshes.gear.setColorAt(g, GEAR_COLOR[gk]); g++;
      }
      crew.push({ id: s.agent.id, crew: s.agent.crew, wx: s.x, wy: s.y + 0.6 * sc, wz: s.z, state: s });
    }
    meshes.body.count = n; meshes.head.count = n; meshes.ring.count = n; meshes.proxy.count = n; meshes.gear.count = g;
    meshes.xbody.count = xi; meshes.xhead.count = xi;
    for (const m of [meshes.body, meshes.head, meshes.ring, meshes.proxy, meshes.gear, meshes.xbody, meshes.xhead]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    meshes.ids = crew.map((c) => c.id);
    meshes.proxy.userData.ids = meshes.ids;
    // short position history for picking moving agents
    const now = performance.now();
    for (const c of crew) {
      let h = hist.get(c.id); if (!h) { h = []; hist.set(c.id, h); }
      h.push({ x: c.wx, y: c.wy, z: c.wz, t: now });
      while (h.length && now - h[0].t > 450) h.shift();
    }
    if (hist.size > crew.length * 2 + 64) for (const [id, h] of hist) if (!h.length || now - h[h.length - 1].t > 450) hist.delete(id);
    rt.crew = crew;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId == null) return;
    const id = meshes.ids[e.instanceId]; if (!id) return;
    e.stopPropagation();
    setSelectedAgent(id);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; };
  const onOut = () => { document.body.style.cursor = ''; };

  return (
    <group>
      <primitive object={meshes.ring} />
      <primitive object={meshes.body} />
      <primitive object={meshes.head} />
      <primitive object={meshes.gear} />
      <primitive object={meshes.xbody} />
      <primitive object={meshes.xhead} />
      <primitive object={meshes.proxy} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut} />
    </group>
  );
}
