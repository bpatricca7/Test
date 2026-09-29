import { useEffect, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../lib/store";

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={clsx("switch", checked && "on")}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={clsx(o.value === value && "active")} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, subtitle, icon, onClose, children, wide, footer }: {
  title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={clsx("modal", wide && "wide")} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="modal-head">
          {icon && <span className="modal-icon">{icon}</span>}
          <div className="modal-title">
            <h3>{title}</h3>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore(useShallow((s) => ({ toasts: s.toasts, dismissToast: s.dismissToast })));
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = t.kind === "error" ? CircleAlert : t.kind === "success" ? CircleCheck : Info;
        return (
          <div key={t.id} className={clsx("toast", t.kind)} onClick={() => dismissToast(t.id)}>
            <Icon size={16} />
            <span>{t.text}</span>
          </div>
        );
      })}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  return <span className={clsx("status-dot", status)} />;
}
