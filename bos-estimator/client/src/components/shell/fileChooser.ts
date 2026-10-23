import { useStore } from '../../store';
import { ACCEPT } from '../lib/files';

/**
 * Opens the OS file chooser and adds the picked files to store.pendingFiles (Ctrl/⌘+O, "Choose files",
 * "＋ Add documents"). Opens the Documents tab so the pending list and Analyze are visible. Nothing auto-starts.
 */
export function chooseFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = ACCEPT.join(',');
  input.addEventListener('change', () => {
    const s = useStore.getState();
    if (input.files?.length) { s.addPendingFiles(input.files); s.openLeft('documents'); }
  }, { once: true });
  input.click();
}
