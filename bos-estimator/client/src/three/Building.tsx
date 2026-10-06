import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { FacilityEstimate } from '@shared/estimate';
import type { Facility } from '@shared/types';
import { useStore } from '../store';
import type { BuildingPlacement } from './layout';
import { n0, pct } from '../fmt';
import { clock } from './clock';

const FINISH_COLORS: Record<string, string> = { carpet: '#7c6a52', resilient: '#aab1bb', hardTile: '#e5e7eb', concrete: '#5f6670', wood: '#b7793f' };

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
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const born = useRef(performance.now());
  const h = Math.max(0.6, b.height);
  const isRecent = recentAt != null && Date.now() - recentAt < 8000;

  // rise-from-ground on spawn + pulse when the AI just registered it
  useFrame(() => {
    if (!group.current) return;
    const age = (performance.now() - born.current) / 1000;
    const s = age < 0.9 ? 1 - Math.pow(1 - Math.min(1, age / 0.9), 3) : 1;
    group.current.scale.y = Math.max(0.001, s);
    if (mat.current) {
      const pulse = isRecent ? 0.25 + 0.25 * Math.sin(performance.now() / 160) : 0;
      mat.current.emissive.set(selected ? '#38bdf8' : isRecent ? '#facc15' : hover ? '#ffffff' : '#000000');
      mat.current.emissiveIntensity = selected ? 0.25 : isRecent ? pulse : hover ? 0.08 : 0;
      const night = ((useStoreClock() + 24) % 24);
      const isNight = night < 6.5 || night > 18;
      if (!selected && !isRecent && !hover) { mat.current.emissive.set('#ffd9a0'); mat.current.emissiveIntensity = isNight ? 0.16 : 0; }
      mat.current.opacity = focused ? 0.1 : dimmed ? 0.35 : 1;
      mat.current.depthWrite = !focused;
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

  return (
    <group position={[b.box.x, 0, b.box.z]}>
      <group ref={group}>
        {/* main massing */}
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow
          onClick={(ev) => { ev.stopPropagation(); select({ kind: 'facility', id: f.id }); }}
          onDoubleClick={(ev) => { ev.stopPropagation(); select({ kind: 'facility', id: f.id }); setFocusMode('building'); }}
          onPointerOver={(ev) => { ev.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}>
          <boxGeometry args={[b.box.w, h, b.box.d]} />
          <meshStandardMaterial ref={mat} color={b.color} roughness={0.72} metalness={0.05} transparent />
          <Edges threshold={15} color={selected ? '#38bdf8' : isRecent ? '#facc15' : '#1e293b'} lineWidth={1} />
        </mesh>
        {/* floor separation bands */}
        {!focused && floorBands.map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[b.box.w + 0.08, 0.08, b.box.d + 0.08]} />
            <meshStandardMaterial color="#0f172a" roughness={1} />
          </mesh>
        ))}
        {/* roof equipment for big single-story boxes */}
        {b.category === 'hangar' && <mesh position={[0, h + 0.4, 0]} castShadow><boxGeometry args={[b.box.w * 0.9, 0.8, b.box.d * 0.3]} /><meshStandardMaterial color="#475569" /></mesh>}
        {/* cutaway interior when focused */}
        {focused && Array.from({ length: Math.max(1, b.floors) }, (_, i) => (
          <group key={i} position={[0, i * b.floorHeight, 0]}>
            {patches.map((p) => (
              <mesh key={p.k} position={[p.x, 0.06, 0]} receiveShadow>
                <boxGeometry args={[p.w, 0.1, b.box.d]} />
                <meshStandardMaterial color={FINISH_COLORS[p.k] ?? '#999'} roughness={0.9} />
              </mesh>
            ))}
            {/* restroom cores */}
            {Array.from({ length: restroomsPerFloor }, (_, r) => (
              <mesh key={r} position={[-b.box.w / 2 + 0.9 + r * 1.6, 0.5, b.box.d / 2 - 0.8]} castShadow>
                <boxGeometry args={[1.4, 0.9, 1.3]} />
                <meshStandardMaterial color="#3b82f6" transparent opacity={0.75} />
              </mesh>
            ))}
            {/* core / stair */}
            <mesh position={[0, b.floorHeight / 2, 0]}>
              <boxGeometry args={[Math.min(2.2, b.box.w * 0.18), b.floorHeight, Math.min(2.2, b.box.d * 0.18)]} />
              <meshStandardMaterial color="#1e293b" transparent opacity={0.65} />
            </mesh>
            {/* glass walls outline */}
            <mesh position={[0, b.floorHeight / 2, 0]}>
              <boxGeometry args={[b.box.w, b.floorHeight - 0.05, b.box.d]} />
              <meshBasicMaterial color="#38bdf8" wireframe transparent opacity={0.12} />
            </mesh>
          </group>
        ))}
      </group>
      {/* outline of the lot when selected */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.lot.x - b.box.x, 0.03, b.lot.z - b.box.z]}>
          <ringGeometry args={[Math.max(b.lot.w, b.lot.d) * 0.7 - 0.25, Math.max(b.lot.w, b.lot.d) * 0.7, 64]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.45} />
        </mesh>
      )}
      {(total <= 60 || selected || hover || isRecent) && (
        <Html position={[0, h + 1.2, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none', display: showLabel && !dimmed ? 'block' : 'none' }}>
          <div className={`label3d ${isRecent && running ? 'ai' : ''}`}>
            {f.buildingNumber && <span className="n">{f.buildingNumber}</span>}
            {f.name.length > 34 ? f.name.slice(0, 32) + '…' : f.name}
            <span className="sf">{n0(f.grossSqft)} SF</span>
            {isRecent && <span className="sf" style={{ color: '#facc15' }}>{pct(f.confidence)}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

function useStoreClock() { return clock.time; }
