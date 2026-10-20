import { useEffect, useRef } from "react";
import { useSettings } from "../settings";
import { toast } from "../toast";
import { Backup } from "./Backup";
import { ContentEditor } from "./ContentEditor";
import type { ThemePref } from "../theme";

const THEMES: [ThemePref, string, string][] = [
  ["auto", "自動", "跟隨裝置的深淺色設定"],
  ["light", "淺色", "白天、光線充足的環境"],
  ["dark", "深色", "夜間、放在床頭或牆上"],
];

export function Settings({
  theme,
  onTheme,
  fx,
  onFx,
  wake,
  onClose,
}: {
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  fx: boolean;
  onFx: (on: boolean) => void;
  wake: { supported: boolean; enabled: boolean; toggle: () => void };
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { settings } = useSettings();
  // The page re-renders every second (clock, countdowns) and passes a new onClose each time, so
  // keep it in a ref: re-running this effect would pull focus away from whatever input is in use.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-settings" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
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
          <div className="setting">
            <div className="setting-label">天氣動畫</div>
            <div className="segmented" role="radiogroup" aria-label="天氣動畫">
              {([true, false] as const).map((v) => (
                <button key={String(v)} role="radio" aria-checked={fx === v} onClick={() => onFx(v)}>
                  {v ? "開" : "關"}
                </button>
              ))}
            </div>
            <div className="muted small">依照{settings.weather[0]?.name}（天氣的第一個地點）現在的天氣，在整個畫面背景顯示晴、雲、雨、雷等動畫。系統開啟「減少動態效果」時不會播放。</div>
          </div>
          <div className="setting">
            <div className="setting-label">螢幕常亮</div>
            <div className="segmented" role="radiogroup" aria-label="螢幕常亮">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  role="radio"
                  aria-checked={wake.enabled === v}
                  disabled={!wake.supported}
                  onClick={() => {
                    if (wake.enabled !== v) wake.toggle();
                    toast(v ? "已開啟螢幕常亮" : "已關閉螢幕常亮，螢幕會照系統設定自動休眠");
                  }}
                >
                  {v ? "開" : "關"}
                </button>
              ))}
            </div>
            <div className="muted small">
              {wake.supported
                ? "開啟後，看板開著時螢幕不會自動關閉（適合放在桌上或牆上）；切到其他 App 或鎖定螢幕後就會恢復，回來時自動重新開啟。"
                : "這個瀏覽器不支援螢幕常亮（需要 iOS／iPadOS 16.4 以上的 Safari 或新版 Chrome）。"}
            </div>
          </div>
          <ContentEditor />
          <Backup theme={theme} fx={fx} onTheme={onTheme} onFx={onFx} />
        </div>
      </div>
    </div>
  );
}
