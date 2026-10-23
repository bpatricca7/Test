// Hover coming from the 3D scene or the label layer (as opposed to the shell's list rows).
// The hover tooltip only shows for scene-originated hovers.
import { useStore } from '../store';

export const hoverSrc = { sceneId: null as string | null, at: 0 };

export function hoverFromScene(id: string | null) {
  hoverSrc.sceneId = id; hoverSrc.at = performance.now();
  const s = useStore.getState();
  if (typeof s.setHover === 'function') s.setHover(id);
}
