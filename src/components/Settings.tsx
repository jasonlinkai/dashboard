import { useEffect, useRef } from "react";
import type { ThemePref } from "../theme";

const THEMES: [ThemePref, string, string][] = [
  ["auto", "自動", "跟隨裝置的深淺色設定"],
  ["light", "淺色", "白天、光線充足的環境"],
  ["dark", "深色", "夜間、放在床頭或牆上"],
];

export function Settings({ theme, onTheme, onClose }: { theme: ThemePref; onTheme: (t: ThemePref) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="settings-title">設定</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        <div className="settings-body">
          <div className="setting">
            <div className="setting-label">外觀</div>
            <div className="segmented" role="radiogroup" aria-label="外觀">
              {THEMES.map(([id, label]) => (
                <button key={id} role="radio" aria-checked={theme === id} onClick={() => onTheme(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="muted small">{THEMES.find(([id]) => id === theme)?.[2]}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
