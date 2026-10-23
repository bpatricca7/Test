import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type Ref, type UIEvent } from 'react';
import { cx } from '../lib/cx';

export interface VirtualListHandle {
  /** 'nearest' scrolls only when the row is outside the viewport */
  scrollToIndex(i: number, align?: 'nearest' | 'start' | 'center'): void;
  element: HTMLDivElement | null;
}

export interface VirtualListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onScroll'> {
  count: number;
  /** fixed row height in CSS px (unzoomed) */
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
  /** stable key per row (defaults to the index) */
  rowKey?: (index: number) => string | number;
  overscan?: number;
  /** rendered inside the scroller above the rows (e.g. a sticky column header); its height is added to the offset */
  header?: ReactNode;
  headerHeight?: number;
  /** rendered when count is 0 */
  empty?: ReactNode;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  ref?: Ref<VirtualListHandle>;
}

/**
 * Fixed-height virtual list (UI spec §5.3): renders [floor(scrollTop/h) − overscan, floor((scrollTop + clientHeight)/h) + overscan].
 * The scroller uses `contain: strict`, so it must get its height from the layout (flex/grid `minmax(0,1fr)`).
 * Rows are absolutely positioned at top = i × h; give them `height: rowHeight`.
 */
export function VirtualList({ count, rowHeight, renderRow, rowKey, overscan = 8, header, headerHeight = 0, empty, className, onScroll, ref, ...rest }: VirtualListProps) {
  const el = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });

  const measure = useCallback(() => {
    const s = el.current; if (!s) return;
    setView((v) => (v.top === s.scrollTop && v.height === s.clientHeight ? v : { top: s.scrollTop, height: s.clientHeight }));
  }, []);
  useLayoutEffect(() => {
    measure();
    const s = el.current; if (!s) return;
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
  }, [measure]);

  useImperativeHandle(ref, () => ({
    element: el.current,
    scrollToIndex(i, align = 'nearest') {
      const s = el.current; if (!s || i < 0 || i >= count) return;
      const top = headerHeight + i * rowHeight, bottom = top + rowHeight;
      const viewTop = s.scrollTop + headerHeight, viewBottom = s.scrollTop + s.clientHeight;
      let next = s.scrollTop;
      if (align === 'start') next = top - headerHeight;
      else if (align === 'center') next = top - (s.clientHeight - rowHeight) / 2;
      else if (top < viewTop) next = top - headerHeight;
      else if (bottom > viewBottom) next = bottom - s.clientHeight;
      s.scrollTop = Math.max(0, next);
      measure();
    },
  }), [count, rowHeight, headerHeight, measure]);

  const first = Math.max(0, Math.floor((view.top - headerHeight) / rowHeight) - overscan);
  const last = Math.min(count - 1, Math.floor((view.top + view.height - headerHeight) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    rows.push(<div key={rowKey ? rowKey(i) : i} className="vlist__row" style={{ top: i * rowHeight, height: rowHeight }}>{renderRow(i)}</div>);
  }
  return (
    <div ref={el} className={cx('vlist', className)} onScroll={(e) => { measure(); onScroll?.(e); }} {...rest}>
      {header}
      {count === 0 && empty ? empty : (
        <div className="vlist__inner" style={{ height: count * rowHeight }}>{rows}</div>
      )}
    </div>
  );
}
