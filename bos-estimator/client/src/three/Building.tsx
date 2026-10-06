import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { FacilityEstimate } from '@shared/estimate';
import type { Facility, FacilityCategory } from '@shared/types';
import { useStore } from '../store';
import type { BuildingPlacement } from './layout';
import { n0, pct } from '../fmt';
import { clock } from './clock';

const FINISH_COLORS: Record<string, string> = { carpet: '#7c6a52', resilient: '#aab1bb', hardTile: '#e5e7eb', concrete: '#5f6670', wood: '#b7793f' };
const INDUSTRIAL: FacilityCategory[] = ['warehouse', 'maintenance', 'hangar'];

const seeded = (seed: string) => { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };

/** Facade textures: a diffuse map with window glass and an emissive map with the lit windows (seeded per building). */
function makeFacade(baseColor: string, style: 'office' | 'barracks' | 'industrial', seed: string) {
  const W = 256, H = 256, bays = style === 'barracks' ? 10 : 8, floors = 4;
  const diffuse = document.createElement('canvas'); diffuse.width = W; diffuse.height = H;
  const emis = document.createElement('canvas'); emis.width = W; emis.height = H;
  const d = diffuse.getContext('2d')!; const e = emis.getContext('2d')!;
  const rnd = seeded(seed);
  d.fillStyle = baseColor; d.fillRect(0, 0, W, H);
  // subtle panel joints
  d.strokeStyle = 'rgba(0,0,0,0.12)'; d.lineWidth = 1;
  for (let f = 0; f <= floors; f++) { d.beginPath(); d.moveTo(0, (H / floors) * f + 0.5); d.lineTo(W, (H / floors) * f + 0.5); d.stroke(); }
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const fh = H / floors, bw = W / bays;
  for (let f = 0; f < floors; f++) {
    for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      let wx: number, wy: number, ww: number, wh: number;
      if (style === 'industrial') {
        if (f !== floors - 1 && !(f === 0 && b % 4 === 1)) continue; // strip windows up top, a bay door at grade
        if (f === 0) { wx = x + 2; wy = y + fh * 0.2; ww = bw * 2 - 4; wh = fh * 0.8; d.fillStyle = '#46505c'; d.fillRect(wx, wy, ww, wh); d.strokeStyle = 'rgba(0,0,0,.35)'; for (let k = 1; k < 5; k++) { d.beginPath(); d.moveTo(wx, wy + (wh / 5) * k); d.lineTo(wx + ww, wy + (wh / 5) * k); d.stroke(); } continue; }
        wx = x + 3; wy = y + fh * 0.25; ww = bw - 6; wh = fh * 0.3;
      } else if (style === 'barracks') { wx = x + bw * 0.28; wy = y + fh * 0.22; ww = bw * 0.44; wh = fh * 0.5; }
      else { wx = x + bw * 0.14; wy = y + fh * 0.2; ww = bw * 0.72; wh = fh * 0.56; }
      // glass
      const g = d.createLinearGradient(wx, wy, wx + ww, wy + wh); g.addColorStop(0, '#1d2a44'); g.addColorStop(1, '#3b5a86');
      d.fillStyle = g; d.fillRect(wx, wy, ww, wh);
      d.fillStyle = 'rgba(255,255,255,0.12)'; d.fillRect(wx, wy, ww, 2);
      // lit?
      const lit = rnd() < 0.58;
      if (lit) { const warm = rnd(); e.fillStyle = warm < 0.7 ? `rgba(255,${205 + Math.floor(rnd() * 40)},${120 + Math.floor(rnd() * 60)},${0.75 + rnd() * 0.25})` : `rgba(${200 + Math.floor(rnd() * 55)},${225 + Math.floor(rnd() * 30)},255,${0.7 + rnd() * 0.3})`; e.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); }
    }
  }
  const mk = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { diffuse, emis, mk };
}

export function Building({ placement: b, facility: f, estimate: e, total }: { placement: BuildingPlacement; facility: Facility; estimate: FacilityEstimate; total: number }) {
  const selection = useStore((s) => s.selection);
  const focusMode = useStore((s) => s.focusMode);
  const select = useStore((s) => s.select);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const recentAt = useStore((s) => s.extraction.recent[f.id]);
  const running = useStore((s) => s.extraction.running);
  const [hover, setHover] = useState(false);
  const selected = selection.kind === 'facility' && selection.id === f.id;
  const focused = selected && focusMode === 'building';
  const dimmed = focusMode === 'building' && !selected;
  const group = useRef<THREE.Group>(null);
  const spawnRing = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now());
  const h = Math.max(0.6, b.height);
  const isRecent = recentAt != null && Date.now() - recentAt < 8000;
  const style: 'office' | 'barracks' | 'industrial' = INDUSTRIAL.includes(b.category) ? 'industrial' : b.category === 'barracks' ? 'barracks' : 'office';

  // --- materials: two facade materials (x faces / z faces) so window bays keep their proportions, plus a roof
  const mats = useMemo(() => {
    const { diffuse, emis, mk } = makeFacade(b.color, style, f.id);
    const bayW = style === 'barracks' ? 1.3 : style === 'industrial' ? 2.4 : 1.7;
    const floorsPerTile = 4;
    const make = (faceW: number) => {
      const map = mk(diffuse), em = mk(emis);
      const rx = Math.max(0.5, faceW / (bayW * (style === 'barracks' ? 10 : 8))), ry = Math.max(0.25, b.floors / floorsPerTile);
      map.repeat.set(rx, ry); em.repeat.set(rx, ry);
      return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.75, metalness: 0.05, transparent: true });
    };
    const sideX = make(b.box.d), sideZ = make(b.box.w);
    const roof = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color).multiplyScalar(0.55), roughness: 0.95, transparent: true });
    return { sideX, sideZ, roof, all: [sideX, sideX, roof, roof, sideZ, sideZ] as THREE.Material[] };
  }, [b.color, b.box.w, b.box.d, b.floors, style, f.id]);
  useEffect(() => () => { for (const m of [mats.sideX, mats.sideZ, mats.roof]) { (m as THREE.MeshStandardMaterial).map?.dispose(); (m as THREE.MeshStandardMaterial).emissiveMap?.dispose(); m.dispose(); } }, [mats]);

  const baseColor = useMemo(() => new THREE.Color('#ffffff'), []);
  const tintSel = useMemo(() => new THREE.Color('#7dd3fc'), []);
  const tintNew = useMemo(() => new THREE.Color('#fde68a'), []);
  const tintHover = useMemo(() => new THREE.Color('#e2e8f0'), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!group.current) return;
    const age = (performance.now() - born.current) / 1000;
    const rise = age < 0.9 ? 1 - Math.pow(1 - Math.min(1, age / 0.9), 3) : 1;
    group.current.scale.y = Math.max(0.001, rise);
    const night = (() => { const d = Math.max(0, Math.sin(((clock.time - 6) / 12) * Math.PI)); return d > 0.25 ? 0 : 1 - d / 0.25; })();
    const pulse = isRecent ? 0.5 + 0.5 * Math.sin(performance.now() / 140) : 0;
    const spawnGlow = age < 1.6 ? 1 - age / 1.6 : 0;
    tmp.copy(baseColor);
    if (selected) tmp.lerp(tintSel, 0.45); else if (isRecent) tmp.lerp(tintNew, 0.35 * pulse + 0.15); else if (hover) tmp.lerp(tintHover, 0.2);
    const opacity = focused ? 0.1 : dimmed ? 0.35 : age < 1.2 ? 0.25 + 0.75 * Math.min(1, age / 1.2) : 1;
    for (const m of [mats.sideX, mats.sideZ]) {
      m.color.copy(tmp);
      m.emissiveIntensity = focused ? 0 : night * 1.35 + (isRecent ? pulse * 0.6 : 0) + spawnGlow * 0.8;
      m.opacity = opacity; m.depthWrite = !focused;
    }
    mats.roof.opacity = opacity; mats.roof.depthWrite = !focused;
    (mats.roof.color as THREE.Color).copy(tmp).multiply(new THREE.Color(b.color)).multiplyScalar(0.6);
    if (spawnRing.current) {
      const p = Math.min(1, age / 1.4);
      spawnRing.current.visible = p < 1;
      spawnRing.current.scale.setScalar(Math.max(b.box.w, b.box.d) * (0.3 + p * 1.6));
      (spawnRing.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.8;
    }
  });

  const showLabel = selected || hover || isRecent || total <= 40;
  const floorsToDraw = Math.min(b.floors, 12);
  const floorBands = useMemo(() => Array.from({ length: Math.max(0, floorsToDraw - 1) }, (_, i) => (i + 1) * b.floorHeight), [floorsToDraw, b.floorHeight]);
  const mix = e.resolved.floorMix;
  const patches = useMemo(() => {
    const entries = (Object.entries(mix) as [string, number][]).filter(([, v]) => v > 0.02).sort((p, q) => q[1] - p[1]);
    let x = -b.box.w / 2; const out: { k: string; x: number; w: number }[] = [];
    for (const [k, v] of entries) { const w = v * b.box.w; out.push({ k, x: x + w / 2, w }); x += w; }
    return out;
  }, [mix, b.box.w]);
  const restroomsPerFloor = Math.max(1, Math.round(e.resolved.restroomFixtures / Math.max(1, b.floors) / 6));
  const rooftop = useMemo(() => { const rnd = seeded(f.id + 'roof'); const n = b.box.w * b.box.d > 60 ? 1 + Math.floor(rnd() * 3) : 0; return Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * b.box.w * 0.6, z: (rnd() - 0.5) * b.box.d * 0.6, w: 0.8 + rnd() * 1.4, d: 0.8 + rnd() * 1.2, h: 0.5 + rnd() * 0.6 })); }, [f.id, b.box.w, b.box.d]);

  return (
    <group position={[b.box.x, 0, b.box.z]}>
      <group ref={group}>
        {/* main massing */}
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={mats.all}
          onClick={(ev) => { ev.stopPropagation(); select({ kind: 'facility', id: f.id }); }}
          onDoubleClick={(ev) => { ev.stopPropagation(); select({ kind: 'facility', id: f.id }); setFocusMode('building'); }}
          onPointerOver={(ev) => { ev.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}>
          <boxGeometry args={[b.box.w, h, b.box.d]} />
          <Edges threshold={15} color={selected ? '#7dd3fc' : isRecent ? '#fde68a' : '#0f172a'} lineWidth={1} />
        </mesh>
        {/* parapet */}
        {!focused && (
          <mesh position={[0, h + 0.12, 0]}>
            <boxGeometry args={[b.box.w + 0.14, 0.24, b.box.d + 0.14]} />
            <meshStandardMaterial color={new THREE.Color(b.color).multiplyScalar(0.8)} roughness={0.9} transparent opacity={dimmed ? 0.35 : 1} />
          </mesh>
        )}
        {/* floor separation bands */}
        {!focused && floorBands.map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[b.box.w + 0.06, 0.06, b.box.d + 0.06]} />
            <meshStandardMaterial color="#0f172a" roughness={1} transparent opacity={dimmed ? 0.3 : 0.9} />
          </mesh>
        ))}
        {/* rooftop units */}
        {!focused && rooftop.map((u, i) => (
          <mesh key={i} position={[u.x, h + 0.24 + u.h / 2, u.z]} castShadow>
            <boxGeometry args={[u.w, u.h, u.d]} />
            <meshStandardMaterial color="#aab2bd" roughness={0.6} metalness={0.3} transparent opacity={dimmed ? 0.35 : 1} />
          </mesh>
        ))}
        {b.category === 'hangar' && !focused && <mesh position={[0, h + 0.5, 0]} castShadow><boxGeometry args={[b.box.w * 0.9, 0.9, b.box.d * 0.28]} /><meshStandardMaterial color="#475569" transparent opacity={dimmed ? 0.35 : 1} /></mesh>}
        {/* entrance canopy on the south face */}
        {!focused && style !== 'industrial' && (
          <group position={[0, 0, b.box.d / 2]}>
            <mesh position={[0, 1.15, 0.55]} castShadow><boxGeometry args={[Math.min(3.2, b.box.w * 0.4), 0.12, 1.1]} /><meshStandardMaterial color="#cbd5e1" metalness={0.4} roughness={0.4} transparent opacity={dimmed ? 0.35 : 1} /></mesh>
            <mesh position={[0, 0.5, 0.02]}><planeGeometry args={[Math.min(2.2, b.box.w * 0.3), 1.0]} /><meshStandardMaterial color="#0b1220" emissive="#38bdf8" emissiveIntensity={0.25} transparent opacity={dimmed ? 0.35 : 1} /></mesh>
          </group>
        )}
        {/* cut-away interior when focused */}
        {focused && Array.from({ length: Math.max(1, b.floors) }, (_, i) => (
          <group key={i} position={[0, i * b.floorHeight, 0]}>
            {patches.map((p) => (
              <mesh key={p.k} position={[p.x, 0.06, 0]} receiveShadow>
                <boxGeometry args={[p.w, 0.1, b.box.d]} />
                <meshStandardMaterial color={FINISH_COLORS[p.k] ?? '#999'} roughness={0.9} />
              </mesh>
            ))}
            {Array.from({ length: restroomsPerFloor }, (_, r) => (
              <mesh key={r} position={[-b.box.w / 2 + 0.9 + r * 1.6, 0.5, b.box.d / 2 - 0.8]} castShadow>
                <boxGeometry args={[1.4, 0.9, 1.3]} />
                <meshStandardMaterial color="#3b82f6" emissive="#1d4ed8" emissiveIntensity={0.3} transparent opacity={0.8} />
              </mesh>
            ))}
            <mesh position={[0, b.floorHeight / 2, 0]}>
              <boxGeometry args={[Math.min(2.2, b.box.w * 0.18), b.floorHeight, Math.min(2.2, b.box.d * 0.18)]} />
              <meshStandardMaterial color="#1e293b" transparent opacity={0.7} />
            </mesh>
            <mesh position={[0, b.floorHeight / 2, 0]}>
              <boxGeometry args={[b.box.w, b.floorHeight - 0.05, b.box.d]} />
              <meshBasicMaterial color="#7dd3fc" wireframe transparent opacity={0.14} />
            </mesh>
          </group>
        ))}
      </group>
      {/* spawn ripple when the reader registers the building */}
      <mesh ref={spawnRing} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} visible={false}>
        <ringGeometry args={[0.9, 1, 64]} />
        <meshBasicMaterial color="#fde68a" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {(total <= 60 || selected || hover || isRecent) && (
        <Html position={[0, h + 1.4, 0]} center zIndexRange={[2, 0]} style={{ pointerEvents: 'none', display: showLabel && !dimmed ? 'block' : 'none' }}>
          <div className={`label3d ${isRecent && running ? 'ai' : ''} ${selected ? 'sel' : ''}`}>
            {f.buildingNumber && <span className="n">{f.buildingNumber}</span>}
            {f.name.length > 34 ? f.name.slice(0, 32) + '…' : f.name}
            <span className="sf">{n0(f.grossSqft)} SF</span>
            {isRecent && <span className="sf" style={{ color: '#fde68a' }}>{pct(f.confidence)}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
