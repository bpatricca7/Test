import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { CREWS, crewMeta, type Crew } from '@shared/factors';
import { useStore } from '../store';
import { useDerived } from '../derived';
import { clock } from './clock';
import { agentStates, type Agent, type AgentState } from './sim';

const dummy = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function CrewInstances({ crew, agents, visibleFn }: { crew: Crew; agents: Agent[]; visibleFn: (s: AgentState) => boolean }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const gear = useRef<THREE.InstancedMesh>(null);
  const { layout } = useDerived();
  const meta = crewMeta(crew);
  const setSelectedAgent = useStore((s) => s.setSelectedAgent);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const statesRef = useRef<AgentState[]>([]);
  const count = agents.length;
  const gearKind = meta.domain === 'grounds' ? (crew === 'grounds_mow' ? 'mower' : 'cart') : meta.domain === 'dining' ? 'tray' : crew === 'supervision' ? 'none' : 'cart';

  useFrame(() => {
    if (!body.current || !head.current || !gear.current || !layout) return;
    const states = agentStates(agents, clock.time, layout.depot);
    statesRef.current = states;
    const t = performance.now() / 1000;
    states.forEach((s, i) => {
      if (s.status === 'off' || !visibleFn(s)) { body.current!.setMatrixAt(i, ZERO); head.current!.setMatrixAt(i, ZERO); gear.current!.setMatrixAt(i, ZERO); return; }
      const bob = s.status === 'travel' ? Math.abs(Math.sin(t * 9 + i)) * 0.08 : Math.sin(t * 5 + i) * 0.03;
      const sel = s.agent.id === selectedAgentId ? 1.25 : 1;
      dummy.position.set(s.x, s.y + 0.55 + bob, s.z); dummy.rotation.set(0, s.heading, 0); dummy.scale.setScalar(sel);
      dummy.updateMatrix(); body.current!.setMatrixAt(i, dummy.matrix);
      dummy.position.set(s.x, s.y + 1.12 + bob, s.z); dummy.updateMatrix(); head.current!.setMatrixAt(i, dummy.matrix);
      if (gearKind === 'none') gear.current!.setMatrixAt(i, ZERO);
      else {
        const ahead = 0.55;
        dummy.position.set(s.x + Math.sin(s.heading) * ahead, s.y + (gearKind === 'tray' ? 0.75 : 0.25), s.z + Math.cos(s.heading) * ahead);
        dummy.scale.setScalar(1); dummy.updateMatrix(); gear.current!.setMatrixAt(i, dummy.matrix);
      }
    });
    body.current.instanceMatrix.needsUpdate = true; head.current.instanceMatrix.needsUpdate = true; gear.current.instanceMatrix.needsUpdate = true;
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const i = e.instanceId; if (i == null) return; const s = statesRef.current[i]; if (s) setSelectedAgent(s.agent.id === selectedAgentId ? null : s.agent.id); };
  const hoverOn = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; };
  const hoverOff = () => { document.body.style.cursor = 'auto'; };
  if (count === 0) return null;
  return (
    <group>
      <instancedMesh ref={body} args={[undefined, undefined, count]} frustumCulled={false} castShadow renderOrder={10} onClick={onClick} onPointerOver={hoverOn} onPointerOut={hoverOff}>
        <capsuleGeometry args={[0.22, 0.55, 4, 8]} />
        <meshStandardMaterial color={meta.color} emissive={meta.color} emissiveIntensity={0.45} roughness={0.6} depthTest={false} transparent opacity={0.95} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined, undefined, count]} frustumCulled={false} renderOrder={11} onClick={onClick} onPointerOver={hoverOn} onPointerOut={hoverOff}>
        <sphereGeometry args={[0.2, 10, 10]} />
        <meshStandardMaterial color="#f1d3b3" roughness={0.7} depthTest={false} transparent opacity={0.95} />
      </instancedMesh>
      <instancedMesh ref={gear} args={[undefined, undefined, count]} frustumCulled={false} castShadow>
        {gearKind === 'mower' ? <boxGeometry args={[1.1, 0.5, 1.4]} /> : gearKind === 'tray' ? <boxGeometry args={[0.5, 0.06, 0.35]} /> : <boxGeometry args={[0.55, 0.5, 0.8]} />}
        <meshStandardMaterial color={gearKind === 'mower' ? '#d97706' : gearKind === 'tray' ? '#e2e8f0' : '#fbbf24'} roughness={0.6} />
      </instancedMesh>
    </group>
  );
}

/** Follows the selected agent with a floating info card and a ground ring. */
function SelectedAgentCard({ agents }: { agents: Agent[] }) {
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const { layout } = useDerived();
  const ring = useRef<THREE.Mesh>(null);
  const [card, setCard] = useState<{ x: number; y: number; z: number; s: AgentState } | null>(null);
  const last = useRef(0);
  const agent = useMemo(() => agents.find((a) => a.id === selectedAgentId), [agents, selectedAgentId]);
  useEffect(() => { if (!agent) setCard(null); }, [agent]);
  useFrame(() => {
    if (!agent || !layout) return;
    const [s] = agentStates([agent], clock.time, layout.depot);
    if (ring.current) { ring.current.position.set(s.x, s.y + 0.03, s.z); ring.current.visible = s.status !== 'off'; }
    const now = performance.now();
    if (now - last.current > 120) { last.current = now; setCard({ x: s.x, y: s.y + 1.9, z: s.z, s }); }
  });
  if (!agent) return null;
  const meta = crewMeta(agent.crew);
  return (
    <group>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.45, 0.6, 32]} /><meshBasicMaterial color={meta.color} transparent opacity={0.9} /></mesh>
      {card && (
        <Html position={[card.x, card.y, card.z]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className="worker-card" style={{ borderColor: meta.color }}>
            <b>{meta.label}{agent.represents > 1 ? ` ×${agent.represents}` : ''} · #{agent.index + 1}</b>
            {card.s.status === 'off' && <span className="c">Off shift (works {String(Math.floor(meta.shift.start)).padStart(2, '0')}:{String(Math.round((meta.shift.start % 1) * 60)).padStart(2, '0')}–{String(Math.floor(meta.shift.end)).padStart(2, '0')}:{String(Math.round((meta.shift.end % 1) * 60)).padStart(2, '0')})</span>}
            {card.s.status === 'travel' && card.s.job && <span className="c">Walking to {card.s.job.targetName}</span>}
            {card.s.status === 'work' && card.s.job && (
              <>
                <span>{card.s.job.task}</span><br />
                <span className="c">{card.s.job.targetName}{card.s.job.floors > 1 ? ` · floor ${card.s.floor + 1}` : ''} · {Math.round(card.s.progress * 100)}% · {card.s.job.hours.toFixed(1)} h/day</span>
              </>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

export function Workers() {
  const { roster } = useDerived();
  const crewFilter = useStore((s) => s.crewFilter);
  const focusMode = useStore((s) => s.focusMode);
  const selection = useStore((s) => s.selection);
  const buildingTab = useStore((s) => s.buildingTab);
  const grounds = useStore((s) => s.project?.inventory.grounds ?? []);
  const attached = useMemo(() => new Set(grounds.filter((g) => selection.kind === 'facility' && g.facilityId === selection.id).map((g) => g.id)), [grounds, selection]);
  const visibleFn = useMemo(() => (s: AgentState) => {
    if (crewFilter && s.agent.crew !== crewFilter) return false;
    if (focusMode === 'building' && selection.kind === 'facility') {
      if (!s.job) return false;
      if (buildingTab === 'interior') return s.job.kind === 'facility' && s.job.targetId === selection.id;
      return (s.job.kind === 'zone' && attached.has(s.job.targetId)) || (s.job.kind === 'facility' && s.job.targetId === selection.id);
    }
    return true;
  }, [crewFilter, focusMode, selection, buildingTab, attached]);
  const byCrew = useMemo(() => CREWS.map((c) => ({ crew: c.id, agents: roster.filter((a) => a.crew === c.id) })).filter((x) => x.agents.length), [roster]);
  return (
    <group>
      {byCrew.map((c) => <CrewInstances key={c.crew} crew={c.crew} agents={c.agents} visibleFn={visibleFn} />)}
      <SelectedAgentCard agents={roster} />
    </group>
  );
}
