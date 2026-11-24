import { useEffect, useRef } from "react";

/** Escape belongs to the topmost modal; never dismiss a dirty editor. */
export function useDialogEscape(onClose: () => void, canClose = true) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !ref.current) return;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter((el) => el.getClientRects().length);
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      const layers = Array.from(document.querySelectorAll<HTMLElement>(".modal-backdrop")).filter((el) => el.getClientRects().length);
      if (layers.length && layers[layers.length - 1] !== ref.current.closest(".modal-backdrop")) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("input, textarea, select, [contenteditable=true]")) {
        active.blur(); event.preventDefault(); event.stopPropagation(); return;
      }
      if (!canClose) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose, canClose]);
  return ref;
}
