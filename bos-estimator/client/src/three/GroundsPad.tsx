import { useEffect, useMemo, useState } from 'react';
import { Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { GroundsEstimate } from '@shared/estimate';
import type { GroundsArea, GroundsKind } from '@shared/types';
import { useStore } from '../store';
import { ZONE_COLORS, ZONE_LABELS, type ZonePlacement } from './layout';
import { n0, n1 } from '../fmt';

function patternTexture(kind: GroundsKind, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
  const rnd = (i: number) => (Math.sin(i * 12.9898 + kind.length) * 43758.5453) % 1;
  if (kind === 'improved_turf' || kind === 'athletic_field') {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 128; i += 32) ctx.fillRect(0, i, 128, 16);
    if (kind === 'athletic_field') { ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 4; ctx.strokeRect(10, 10, 108, 108); ctx.beginPath(); ctx.moveTo(64, 10); ctx.lineTo(64, 118); ctx.stroke(); ctx.beginPath(); ctx.arc(64, 64, 14, 0, Math.PI * 2); ctx.stroke(); }
  } else if (kind === 'parking') {
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(0, 56, 128, 16);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
    for (let x = 8; x < 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, 50); ctx.moveTo(x, 78); ctx.lineTo(x, 122); ctx.stroke(); }
  } else if (kind === 'shrub_bed') {
    for (let i = 0; i < 46; i++) { ctx.fillStyle = `rgba(${90 + Math.abs(rnd(i)) * 80},${170 + Math.abs(rnd(i + 7)) * 60},90,0.9)`; ctx.beginPath(); ctx.arc(Math.abs(rnd(i * 3)) * 128, Math.abs(rnd(i * 5)) * 128, 5 + Math.abs(rnd(i * 11)) * 7, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'tree_canopy') {
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 20; i++) { ctx.fillStyle = `rgba(${40 + Math.abs(rnd(i)) * 40},${140 + Math.abs(rnd(i + 3)) * 80},60,0.95)`; ctx.beginPath(); ctx.arc(Math.abs(rnd(i * 3)) * 128, Math.abs(rnd(i * 5)) * 128, 10 + Math.abs(rnd(i * 7)) * 9, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'semi_improved' || kind === 'unimproved') {
    for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.abs(rnd(i)) * 0.18})`; ctx.fillRect(Math.abs(rnd(i * 3)) * 128, Math.abs(rnd(i * 5)) * 128, 2, 5); }
  } else if (kind === 'sidewalk') {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; for (let x = 0; x < 128; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 128); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

export function GroundsPad({ zone: z, area: g, estimate }: { zone: ZonePlacement; area: GroundsArea; estimate?: GroundsEstimate }) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const focusMode = useStore((s) => s.focusMode);
  const buildingTab = useStore((s) => s.buildingTab);
  const recentAt = useStore((s) => s.extraction.recent[g.id]);
  const [hover, setHover] = useState(false);
  const selected = selection.kind === 'grounds' && selection.id === g.id;
  const parentSelected = selection.kind === 'facility' && z.facilityId === selection.id;
  const highlighted = selected || (parentSelected && focusMode === 'building' && buildingTab === 'grounds');
  const isRecent = recentAt != null && Date.now() - recentAt < 8000;
  const tex = useMemo(() => patternTexture(z.kind, Math.max(1, Math.round(z.box.w / 5)), Math.max(1, Math.round(z.box.d / 5))), [z.kind, z.box.w, z.box.d]);
  useEffect(() => () => tex.dispose(), [tex]);
  const y = z.facilityId ? 0.012 : 0.02;
  const qty = g.unit === 'each' ? `${n0(g.quantity)} trees` : g.unit === 'acres' ? `${n1(g.quantity)} ac` : `${n0(g.quantity)} ${g.unit === 'sqyd' ? 'SY' : g.unit === 'lf' ? 'LF' : 'SF'}`;
  const trees = useMemo(() => (z.kind === 'tree_canopy' || (z.kind === 'improved_turf' && !z.facilityId)) ? Array.from({ length: Math.min(z.kind === 'tree_canopy' ? 24 : 6, Math.max(3, Math.round(z.box.w * z.box.d / 60))) }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 0.5) * z.box.w * 0.85, z: (Math.cos(i * 78.233) * 0.5) * z.box.d * 0.85, s: 0.7 + ((i * 7) % 5) * 0.12 })) : [], [z]);

  return (
    <group position={[z.box.x, 0, z.box.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow
        onClick={(ev) => { ev.stopPropagation(); select({ kind: 'grounds', id: g.id }); }}
        onPointerOver={(ev) => { ev.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = 'auto'; }}>
        <planeGeometry args={[z.box.w, z.box.d]} />
        <meshStandardMaterial map={tex} color={ZONE_COLORS[z.kind]} roughness={1} emissive={highlighted ? '#38bdf8' : isRecent ? '#facc15' : hover ? '#ffffff' : '#000'} emissiveIntensity={highlighted ? 0.1 : isRecent ? 0.12 : hover ? 0.05 : 0} />
        {(highlighted || isRecent) && <Edges color={highlighted ? '#38bdf8' : '#facc15'} />}
      </mesh>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={t.s}>
          <mesh position={[0, 0.6, 0]} castShadow><cylinderGeometry args={[0.12, 0.16, 1.2, 6]} /><meshStandardMaterial color="#5b3a1f" /></mesh>
          <mesh position={[0, 1.7, 0]} castShadow><sphereGeometry args={[0.9, 8, 8]} /><meshStandardMaterial color="#2f7a33" roughness={0.9} /></mesh>
        </group>
      ))}
      {(selected || hover || (isRecent && !z.facilityId) || (!z.facilityId && Math.max(z.box.w, z.box.d) > 14)) && (
        <Html position={[0, 1.2, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[2, 0]}>
          <div className={`label3d ${isRecent ? 'ai' : ''}`}>
            {ZONE_LABELS[z.kind]}<span className="sf">{qty}</span>{estimate && estimate.fte > 0 && <span className="sf" style={{ color: '#4ade80' }}>{estimate.fte.toFixed(2)} FTE</span>}
          </div>
        </Html>
      )}
    </group>
  );
}
