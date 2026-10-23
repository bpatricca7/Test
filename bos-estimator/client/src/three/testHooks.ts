// window.__bos.three test hooks (UI spec §2.7 / §9.14). The acceptance checks in §12 depend on these.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useDerived } from '../derived';
import { useStore } from '../store';
import type { SiteLayout } from './layout';
import { freeRect } from './insets';
import { rt } from './runtime';
import { readOccluders } from './LabelLayer';

export interface ThreeHooks {
  info(): { calls: number; triangles: number; textures: number; geometries: number; frame: number; dpr: number };
  labels(): { id: string; text: string; lod: 'chip' | 'full' | 'pin'; x: number; y: number; w: number; h: number; isNew: boolean }[];
  project(id: string): { x: number; y: number; visible: boolean } | null;
  centers(): Record<string, [number, number]>;
  agents(): { id: string; crew: string; x: number; y: number; visible: boolean }[];
  camera(): { fits: number; retargets: number; moving: boolean; userMoved: boolean };
  fitError(): number;
}

const _v = new THREE.Vector3();

export function useTestHooks() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { layout } = useDerived();
  const layoutRef = useRef<SiteLayout | null>(layout);
  layoutRef.current = layout;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // gl.info covering one whole frame (shadow pass + scene + post passes): reset manually at frame start
  useFrame(() => {
    rt.info.calls = gl.info.render.calls;
    rt.info.triangles = gl.info.render.triangles;
    gl.info.reset();
    rt.frame++;
  }, -1000);
  useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);

  useEffect(() => {
    const toPx = (p: THREE.Vector3) => {
      const r = gl.domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      _v.copy(p).project(camera);
      const W = sizeRef.current.width, H = sizeRef.current.height;
      return { x: r.left + ((_v.x + 1) / 2) * W, y: r.top + ((1 - _v.y) / 2) * H, front: _v.z > -1 && _v.z < 1 };
    };
    const inFree = (x: number, y: number) => { const fr = freeRect(sizeRef.current.width, sizeRef.current.height); return x >= fr.x0 && x <= fr.x1 && y >= fr.y0 && y <= fr.y1; };
    const hooks: ThreeHooks = {
      info: () => ({ calls: rt.info.calls, triangles: rt.info.triangles, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries, frame: rt.frame, dpr: gl.getPixelRatio() }),
      labels: () => rt.labels.map((l) => ({ ...l })),
      project: (id: string) => {
        const l = layoutRef.current; if (!l) return null;
        const b = l.buildings.find((x) => x.id === id);
        const z = b ? undefined : l.zones.find((x) => x.id === id);
        if (!b && !z) return null;
        const p = b ? new THREE.Vector3(b.box.x, Math.max(0.6, b.height), b.box.z) : new THREE.Vector3(z!.box.x, 0.2, z!.box.z);
        const s = toPx(p);
        return { x: Math.round(s.x), y: Math.round(s.y), visible: s.front && inFree(s.x, s.y) };
      },
      centers: () => {
        const out: Record<string, [number, number]> = {};
        for (const b of layoutRef.current?.buildings ?? []) out[b.id] = [b.box.x, b.box.z];
        return out;
      },
      agents: () => {
        const occ = readOccluders();
        const l = layoutRef.current;
        const st = useStore.getState();
        const hero = st.focusMode === 'building' && st.buildingTab === 'interior' && st.selection.kind === 'facility' ? st.selection.id : null;
        camera.updateMatrixWorld();
        const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        const box = new THREE.Box3(); const ray = new THREE.Ray(); const hit = new THREE.Vector3();
        /** a building between the camera and the agent hides it (and would take the click) */
        const occluded = (p: THREE.Vector3) => {
          if (!l) return false;
          const dist = eye.distanceTo(p) - 0.9;
          ray.origin.copy(eye); ray.direction.copy(p).sub(eye).normalize();
          for (const b of l.buildings) {
            if (b.id === hero) continue;
            box.min.set(b.box.x - b.box.w / 2, 0, b.box.z - b.box.d / 2); box.max.set(b.box.x + b.box.w / 2, Math.max(0.6, b.height), b.box.z + b.box.d / 2);
            if (ray.intersectBox(box, hit) && eye.distanceTo(hit) < dist) return true;
          }
          return false;
        };
        const W = sizeRef.current.width, H = sizeRef.current.height;
        const out: { id: string; crew: string; x: number; y: number; visible: boolean }[] = [];
        for (const c of rt.crew) {
          const s = toPx(_v.set(c.wx, c.wy, c.wz).clone());
          if (!s.front || s.x < 0 || s.y < 0 || s.x > W || s.y > H) continue;
          const underLabel = rt.labelRects.some((r) => s.x >= r.x0 - 2 && s.x <= r.x1 + 2 && s.y >= r.y0 - 2 && s.y <= r.y1 + 2);
          const underOcc = occ.some((r) => s.x >= r.x0 && s.x <= r.x1 && s.y >= r.y0 && s.y <= r.y1);
          const visible = inFree(s.x, s.y) && !underLabel && !underOcc && (c.xray === true || !occluded(new THREE.Vector3(c.wx, c.wy, c.wz)));
          out.push({ id: c.id, crew: c.crew, x: Math.round(s.x), y: Math.round(s.y), visible });
        }
        return out;
      },
      camera: () => ({ fits: rt.cam.fits, retargets: rt.cam.retargets, moving: rt.cam.moving, userMoved: rt.cam.userMoved }),
      fitError: () => Math.round(rt.cam.fitError * 10) / 10,
    };
    const w = window as unknown as { __bos?: Record<string, unknown> };
    w.__bos = Object.assign(w.__bos ?? {}, { three: hooks });
    return () => { if (w.__bos && w.__bos.three === hooks) delete w.__bos.three; };
  }, [gl, camera]);
}
