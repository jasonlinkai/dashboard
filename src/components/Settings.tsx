import { useEffect, useRef, useState } from "react";
import { useSettings } from "../settings";
import { toast } from "../toast";
import { SAVER_OPTIONS, type SaverMinutes, type ThemePref } from "../theme";
import { About } from "./About";
import { Backup } from "./Backup";
import type { ContentSection } from "../openSettings";
import { ContentEditor } from "./ContentEditor";
import { KeySettings } from "./KeySettings";

const THEMES: [ThemePref, string, string][] = [
  ["auto", "自動", "跟隨裝置的深淺色設定"],
  ["light", "淺色", "白天、光線充足的環境"],
  ["dark", "深色", "夜間、放在床頭或牆上"],
];

/** Settings are split into pages; the last one opened is remembered. */
const PAGES = [
  ["content", "顯示內容"],
  ["look", "外觀"],
  ["keys", "金鑰"],
  ["backup", "備份"],
  ["about", "關於"],
] as const;
type Page = (typeof PAGES)[number][0];

function loadPage(): Page {
  try {
    const p = localStorage.getItem("settingsPage");
    if (PAGES.some(([id]) => id === p)) return p as Page;
  } catch {}
  return "content";
}

export function Settings({
  theme,
  onTheme,
  fx,
  onFx,
  wake,
  saver,
  onSaver,
  onSaverPreview,
  onEditLayout,
  card,
  section,
  onShowSources,
  onClose,
}: {
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  fx: boolean;
  onFx: (on: boolean) => void;
  wake: { supported: boolean; enabled: boolean; toggle: () => void };
  saver: SaverMinutes;
  onSaver: (m: SaverMinutes) => void;
  onSaverPreview: () => void;
  /** Close the settings and start rearranging the cards. */
  onEditLayout: () => void;
  /** With `section`: which card's page to open (an extra card's id, e.g. 天氣 2's). */
  card?: string;
  /** Open straight to this card's page (from the gear next to the card's title). */
  section?: ContentSection;
  /** Close the settings and open the reliability notes. */
  onShowSources: () => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<Page>(() => (section ? "content" : loadPage()));
  const choose = (p: Page) => {
    setPage(p);
    try {
      localStorage.setItem("settingsPage", p);
    } catch {}
  };
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
      <div
        className="modal modal-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <button ref={closeRef} className="sub-back" onClick={onClose}>
            ‹ 返回
          </button>
          <h2 id="settings-title">設定</h2>
        </header>
        <nav className="settings-tabs" role="tablist" aria-label="設定分類">
          {PAGES.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={page === id} onClick={() => choose(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body" role="tabpanel">
          {page === "look" && (
            <>
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
                <div className="setting-label">版面</div>
                <div className="ed-actions">
                  <button onClick={onEditLayout}>調整版面</button>
                </div>
                <div className="muted small">
                  在平板或電腦上拖動板塊自由擺放、拖右下角調整大小，拖到另一個板塊上就交換位置；也可以長按板塊的標題進入。桌機與平板橫向、平板直向各自記住一份。手機的分頁固定，同類有多個板塊時在標題切換。
                </div>
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
                <div className="muted small">
                  依照{settings.weather[0]?.name}
                  （天氣的第一個地點）現在的天氣，在整個畫面背景顯示晴、雲、雨、雷等動畫。系統開啟「減少動態效果」時不會播放。
                </div>
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
              <div className="setting">
                <div className="setting-label">螢幕保護</div>
                <div className="segmented" role="radiogroup" aria-label="螢幕保護">
                  {SAVER_OPTIONS.map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={saver === m}
                      onClick={() => (onSaver(m), toast(m ? `螢幕保護：每 ${m} 分鐘播放一次` : "已關閉螢幕保護"))}
                    >
                      {m ? `${m} 分` : "關"}
                    </button>
                  ))}
                </div>
                <div className="muted small">
                  長時間顯示固定畫面可能造成烙印（OLED 螢幕較明顯）。開啟後每隔設定的時間，在看板後方播放 20 秒的彩色光帶（看板照常可看），
                  平常整個畫面也會每分鐘微移 1～2 像素。{" "}
                  <button className="link-btn" onClick={onSaverPreview}>
                    預覽
                  </button>
                </div>
              </div>
            </>
          )}
          {page === "content" && <ContentEditor initial={section} initialCard={card} onExit={onClose} />}
          {page === "keys" && <KeySettings />}
          {page === "backup" && <Backup theme={theme} fx={fx} onTheme={onTheme} onFx={onFx} />}
          {page === "about" && <About onShowSources={onShowSources} />}
        </div>
      </div>
    </div>
  );
}
