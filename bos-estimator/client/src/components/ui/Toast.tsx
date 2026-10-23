import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useStore } from '../../store';
import { cx } from '../lib/cx';

const ICON = { info: Info, ok: CircleCheck, warn: TriangleAlert, error: CircleAlert } as const;

/**
 * Toasts (UI spec §5.10): bottom-centre of the free rect, above the dock; at most 3, 5 s, optional action.
 * Mount once inside .vp-area. Push with useStore.getState().pushToast({ text, tone, action }).
 */
export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone ?? 'info'];
        return (
          <div key={t.id} className={cx('toast', `toast--${t.tone ?? 'info'}`)} data-occluder="">
            <Icon size={16} strokeWidth={1.75} aria-hidden className="toast__icon" />
            <span className="toast__text">{t.text}</span>
            {t.action && <button type="button" className="toast__action" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
            <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={14} aria-hidden /></button>
          </div>
        );
      })}
    </div>
  );
}
