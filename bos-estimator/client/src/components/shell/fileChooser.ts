import { useStore } from '../../store';
import { ACCEPT } from '../lib/files';

/**
 * Opens the OS file chooser and adds the picked files to store.pendingFiles (Ctrl/⌘+O, "Choose files",
 * "＋ Add documents"). Opens the Documents tab (on phones: the Documents sheet) so the pending list and Analyze are
 * visible. Nothing auto-starts. The input is attached to the document while the picker is open: iOS Safari and some
 * Android browsers do not deliver `change` to a detached input.
 */
export function chooseFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT.join(',');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  const done = () => { input.remove(); };
  input.addEventListener('change', () => {
    const s = useStore.getState();
    if (input.files?.length) { s.addPendingFiles(input.files); s.openLeft('documents'); }
    done();
  }, { once: true });
  input.addEventListener('cancel', done, { once: true });
  document.body.appendChild(input);
  input.click();
}
