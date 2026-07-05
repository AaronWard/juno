import React, { useEffect, useId, useRef, useState } from "react";

export interface DropdownItem {
  id: string;
  label: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface Props {
  trigger: React.ReactNode;
  items?: DropdownItem[];
  /** Free-form menu content (checkbox filters etc). */
  children?: React.ReactNode;
  align?: "left" | "right";
  triggerClass?: string;
  ariaLabel?: string;
}

/** Keyboard-navigable dropdown: Escape closes, click-outside closes,
 *  Arrow keys move between items, selected item is highlighted. */
export function Dropdown({
  trigger,
  items,
  children,
  align = "right",
  triggerClass = "btn",
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const focusables = menuRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input"
        );
        if (!focusables || !focusables.length) return;
        e.preventDefault();
        const list = Array.from(focusables);
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "ArrowDown"
            ? list[(i + 1) % list.length]
            : list[(i - 1 + list.length) % list.length];
        next.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className={triggerClass}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={ariaLabel}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`dropdown-menu${align === "left" ? " left" : ""}`}
          role="menu"
          id={menuId}
          ref={menuRef}
        >
          {items?.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              className={`menu-item${item.selected ? " selected" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
              }}
            >
              {item.label}
              {item.selected && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {children}
        </div>
      )}
    </div>
  );
}
