import { type ReactNode } from "react";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({ title, onClose, children }: SheetProps) {
  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="sheet-close" onClick={onClose} aria-label="關閉">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="sheet-list">{children}</div>
      </div>
    </>
  );
}

interface SheetItemProps {
  flag: string;
  name: string;
  nativeName: string;
  selected: boolean;
  onClick: () => void;
}

export function SheetItem({ flag, name, nativeName, selected, onClick }: SheetItemProps) {
  return (
    <button className={`sheet-item ${selected ? "selected" : ""}`} onClick={onClick}>
      <span className="sheet-item-flag">{flag}</span>
      <div className="sheet-item-text">
        <span className="sheet-item-name">{name}</span>
        <span className="sheet-item-native">{nativeName}</span>
      </div>
      {selected && (
        <span className="sheet-item-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}
