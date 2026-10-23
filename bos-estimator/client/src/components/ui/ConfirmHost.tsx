import { useStore } from '../../store';
import { ConfirmDialog } from './Dialog';

/** Renders the oldest pending store.confirm() request. Mount once (App). */
export function ConfirmHost() {
  const req = useStore((s) => s.confirms[0]);
  const resolve = useStore((s) => s.resolveConfirm);
  if (!req) return null;
  const { id, resolve: _r, ...opts } = req;
  void _r;
  return <ConfirmDialog key={id} open {...opts} onResolve={(v) => resolve(id, v)} />;
}
