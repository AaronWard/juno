import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface Props {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Reusable modal: focus-trapped, Escape closes, backdrop click closes.
 *
 *  Rendered through a React portal onto document.body with a very high
 *  z-index. This fixes the bug where song-row thumbnails and other page
 *  content bled through modals opened from inside the sticky Create panel
 *  (position:sticky creates a stacking context, so an inline modal's
 *  z-index only competed within that context). */
export function Modal({ title, open, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    setTimeout(() => {
      ref.current
        ?.querySelector<HTMLElement>("button, input, textarea, select")
        ?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 className="modal-title">{title}</h2>
        {children}
        <div className="modal-footer">
          {footer ?? <Button onClick={onClose}>Close</Button>}
        </div>
      </div>
    </div>,
    document.body
  );
}
