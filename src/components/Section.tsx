import { type ReactNode, useRef } from "react";
import { editLayout, isPanel, movable as canMove, useLayoutEdit } from "../layoutEdit";
import { PANEL_NAMES } from "../settings";
import { mmss } from "../format";
import { type Polled, useNow } from "../hooks";
import { type ContentSection, openSettings } from "../openSettings";
import { GearIcon } from "./GearIcon";

/** HH:MM:SS, for "資料 …" (also on the bus route sheet). */
export const hms = new Intl.DateTimeFormat("zh-TW", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Taipei",
});

const age = (sec: number) => (sec < 60 ? `${Math.floor(sec)} 秒` : `${Math.floor(sec / 60)} 分鐘`);

/** Small ring that empties as the next refresh approaches. */
function Ring({ fraction }: { fraction: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 14 14" aria-hidden>
      <circle cx="7" cy="7" r={r} className="ring-track" />
      <circle cx="7" cy="7" r={r} className="ring-fill" strokeDasharray={`${c * fraction} ${c}`} transform="rotate(-90 7 7)" />
    </svg>
  );
}

/**
 * Whether the data on screen can be trusted as current. A refresh countdown alone can't tell:
 * a refresh may fail, or the backend may hand back its previous copy, so judge by the data's age.
 */
function freshness(state: Polled<unknown>, maxAgeSec: number, now: number): { text: string; warn: boolean; title?: string } | null {
  if (!state.updated && !state.error) return null;
  const ageSec = state.dataTime == null ? null : (now - state.dataTime) / 1000;
  if (state.error) {
    return {
      text: state.data !== undefined && ageSec != null ? `⚠ 更新失敗・資料已 ${age(ageSec)}` : "⚠ 更新失敗",
      warn: true,
      title: state.error,
    };
  }
  if (ageSec == null) return { text: "⚠ 無即時資料", warn: true };
  if (state.stale || ageSec > maxAgeSec) return { text: `⚠ 資料延遲 ${age(ageSec)}`, warn: true };
  return { text: `資料 ${hms.format(state.dataTime!)}`, warn: false };
}

/** Card wrapper: title, refresh countdown, and how fresh the data is (red when it isn't). */
export function Section({
  title,
  className,
  state,
  maxAgeSec,
  actions,
  source,
  edit,
  children,
}: {
  title: string;
  className: string;
  state: Polled<unknown>;
  /** Data older than this is flagged as delayed. */
  maxAgeSec: number;
  actions?: ReactNode;
  /** The settings page for this card, opened by the gear next to the title. */
  edit?: ContentSection;
  /** Attribution line at the bottom of the card (the data licences require crediting the source). */
  source?: ReactNode;
  children: ReactNode;
}) {
  useNow(1000); // re-render every second
  // Read the clock directly: useNow's value can be up to 1 s old when a fetch finishing triggers
  // the render, which made a fresh countdown start at 10:01 instead of 10:00.
  const now = Date.now();
  const fresh = freshness(state, maxAgeSec, now);
  const left = state.nextAt == null ? null : Math.min(state.intervalSec, (state.nextAt - now) / 1000);
  const layout = useLayoutEdit();
  const panel = isPanel(className) ? className : null;
  const movable = layout.editing && panel && canMove(layout.mode, panel) && panel;
  // Holding the title for half a second starts rearranging the cards.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return (
    <section className={`card ${className} ${fresh?.warn ? "card-warn" : ""} ${movable ? "card-movable" : ""}`}>
      <header className="card-head">
        {movable && (
          <button
            className="card-move"
            aria-label={
              layout.mode === "phone"
                ? `移動${PANEL_NAMES[panel]}，目前${layout.where(panel)}。按方向鍵和另一張交換位置`
                : `移動${PANEL_NAMES[panel]}，目前${layout.where(panel)}。方向鍵移動一格（擋住時和那一邊的板塊交換），Shift 加方向鍵調整大小`
            }
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
            title="拖動或用方向鍵移動"
            onKeyDown={(e) => {
              if (!e.key.startsWith("Arrow")) return;
              e.preventDefault();
              layout.move(panel, e.key, e.shiftKey);
            }}
          >
            <svg viewBox="0 0 12 16" aria-hidden>
              {[3, 9].flatMap((cx) => [3, 8, 13].map((cy) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="1.4" />))}
            </svg>
          </button>
        )}
        <h2
          onPointerDown={(e) => {
            if (layout.editing || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
            release();
            press.current = { timer: setTimeout(() => (release(), navigator.vibrate?.(15), editLayout()), 500), x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            const p = press.current;
            if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) release();
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onContextMenu={(e) => layout.editing || e.preventDefault()}
        >
          {title}
        </h2>
        {edit && (
          <button className="card-gear" onClick={() => openSettings(edit)} aria-label={`${title}設定`} title={`${title}設定`}>
            <GearIcon />
          </button>
        )}
        {actions}
        <span className="muted status">
          {left == null ? (
            state.loading ? (
              "載入中…"
            ) : (
              "已暫停"
            )
          ) : (
            <span className="countdown">
              <Ring fraction={Math.min(1, Math.max(0, left / state.intervalSec))} />
              {left <= 0 ? "更新中…" : `${mmss(left)} 後更新`}
            </span>
          )}
          {fresh && (
            <span className={fresh.warn ? "error" : ""} title={fresh.title}>
              ・{fresh.text}
            </span>
          )}
        </span>
      </header>
      {children}
      {source && <div className="card-source">資料來源：{source}</div>}
      {/* Drag to resize (tablet / desktop); the move button's Shift+arrows do the same from the keyboard. */}
      {movable && layout.mode !== "phone" && <span className="card-resize" aria-hidden />}
    </section>
  );
}
