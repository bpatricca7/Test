// Plan view (UI spec §9.13, P1): an orthographic, north-up, top-down camera with rotation disabled. The camera
// rig gives it the same view offset and fit; the label layer raises the chip budget to 200 and centres chips on
// their roofs, so building numbers sit on every roof where they fit.
import { OrthographicCamera } from '@react-three/drei';
import { useStore } from '../store';

export function PlanCamera() {
  const planView = useStore((s) => s.planView ?? false);
  const inside = useStore((s) => s.focusMode === 'building' && s.selection.kind === 'facility');
  if (!planView || inside) return null;
  return <OrthographicCamera makeDefault position={[0, 1500, 0.01]} zoom={1} near={1} far={6000} />;
}
