import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

let subPageIds = 0;
const openSubPages: number[] = [];

/** A page over the settings dialog (or over another such page). Esc / 返回 / tapping outside close only this page. */
export function SubPage({
  title,
  action,
  onClose,
  children,
}: {
  title: string;
  action?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const id = useRef(0);
  if (!id.current) id.current = ++subPageIds;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    backRef.current?.focus();
    openSubPages.push(id.current);
    // Capture phase on window runs before the settings dialog's own Esc handler, which would close
    // everything. Pages stack (list → add), so only the top one answers.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || openSubPages[openSubPages.length - 1] !== id.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      openSubPages.splice(openSubPages.indexOf(id.current), 1);
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop sub-backdrop" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="modal modal-settings" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <button ref={backRef} className="sub-back" onClick={onClose}>
            ‹ 返回
          </button>
          <h2>{title}</h2>
          {action}
        </header>
        <div className="settings-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
