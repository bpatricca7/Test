import { memo, startTransition } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../../store';
import { useDerived } from '../../derived';
import { IconButton, Tabs } from '../ui';
import { InventoryTab } from '../inventory/InventoryTab';
import { DocumentsTab } from '../documents/DocumentsTab';
import { Inspector } from '../inspector/Inspector';
import { EstimateTab } from '../estimate/EstimateTab';

/** Left panel: Inventory | Documents tabs (UI spec §5.3, §5.4). Collapsing is done from the rail or with [. */
export const LeftPanel = memo(function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  const setTab = useStore((s) => s.setLeftTab);
  const docs = useStore((s) => s.project?.documents.length ?? 0);
  const { counts } = useDerived();
  return (
    <div className="panel__inner">
      <Tabs idBase="left" label="Left panel" value={tab} onChange={setTab}
        items={[{ id: 'inventory', label: 'Inventory', count: counts.total || undefined }, { id: 'documents', label: 'Documents', count: docs || undefined }]} />
      <div role="tabpanel" id={`left-panel-${tab}`} aria-labelledby={`left-tab-${tab}`} className="panel__body">
        {tab === 'inventory' ? <InventoryTab /> : <DocumentsTab />}
      </div>
    </div>
  );
});

/** Right panel: Inspector | Estimate (UI spec §5.7, §5.8), with a collapse button (]). */
export const RightPanel = memo(function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const setTab = useStore((s) => s.setRightTab);
  const setOpen = useStore((s) => s.setRightOpen);
  return (
    <div className="panel__inner">
      <Tabs idBase="right" label="Right panel" value={tab} onChange={(t) => startTransition(() => setTab(t))}
        items={[{ id: 'inspector', label: 'Inspector' }, { id: 'estimate', label: 'Estimate' }]}
        end={<IconButton icon={ChevronRight} size="sm" label="Collapse panel" tooltip="Collapse panel (])" onClick={() => setOpen(false, { user: true })} />} />
      <div role="tabpanel" id={`right-panel-${tab}`} aria-labelledby={`right-tab-${tab}`} className="panel__body">
        {tab === 'inspector' ? <Inspector /> : <EstimateTab />}
      </div>
    </div>
  );
});

/** 24×64 handle at the right edge of the free rect while the right panel is collapsed (data-occluder). */
export function RightEdgeHandle() {
  const open = useStore((s) => s.rightOpen);
  const setOpen = useStore((s) => s.setRightOpen);
  if (open) return null;
  return (
    <button type="button" className="edge-handle" data-occluder="" aria-label="Open the right panel" title="Open the right panel (])" onClick={() => setOpen(true, { user: true })}>
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
