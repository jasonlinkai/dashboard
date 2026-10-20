// Short confirmation bubbles at the bottom of the screen ("已匯入設定", "已更新順序" …).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Kind = "ok" | "error" | "info";
interface Toast {
  id: number;
  text: string;
  kind: Kind;
}

let next = 0;
const listeners = new Set<(t: Toast) => void>();

/** Show a bubble from anywhere (no React context needed). */
export function toast(text: string, kind: Kind = "ok") {
  const t = { id: ++next, text, kind };
  for (const l of listeners) l(t);
}

const ICON: Record<Kind, string> = { ok: "✓", error: "⚠", info: "ℹ︎" };

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      // Keep at most three; errors stay a little longer so they can be read.
      setItems((list) => [...list.filter((x) => x.text !== t.text).slice(-2), t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.kind === "error" ? 5000 : 2600);
    };
    listeners.add(add);
    return () => void listeners.delete(add);
  }, []);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon" aria-hidden>
            {ICON[t.kind]}
          </span>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}
