// Hover coming from the 3D scene or the label layer (as opposed to the shell's list rows).
// The hover tooltip only shows for scene-originated hovers.
// Fingers have no hover: while the user works with touch, pointer-over / -out events (which a touch fires on
// press and release) never set or clear the hover. A tap sets it explicitly (`touch: true`), which is how the
// tooltip is reached on touch screens; the tap recognizer lives in TouchControls.
import { useStore } from '../store';
import { input } from './device';

export const hoverSrc = { sceneId: null as string | null, at: 0, touch: false };

export function hoverFromScene(id: string | null, opts?: { touch?: boolean }) {
  const fromTap = opts?.touch === true;
  if (!fromTap && input.touch) return;
  hoverSrc.sceneId = id; hoverSrc.at = performance.now(); hoverSrc.touch = fromTap && id != null;
  const s = useStore.getState();
  if (typeof s.setHover === 'function') s.setHover(id);
}

/**
 * What a synthesized tap click landed on. TouchControls sets `active` around the click it dispatches; the
 * scene's click handlers report the first (nearest) thing they handle.
 */
export const tapCtx = {
  active: false, hit: null as null | { kind: 'facility' | 'grounds' | 'agent' | 'ground'; id?: string },
  /** crew pick radius (px) for this tap: a fingertip's slack only when the tap is not on a building or pad */
  agentPx: null as number | null,
  /** performance.now() when TouchControls resolved a tap on a label to something else (the label's click is void) */
  labelTapAt: -Infinity,
};
export function noteTap(kind: 'facility' | 'grounds' | 'agent' | 'ground', id?: string) {
  if (tapCtx.active && !tapCtx.hit) tapCtx.hit = { kind, id };
}
