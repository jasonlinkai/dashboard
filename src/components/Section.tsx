import { type ReactNode, useId, useRef } from "react";
import { editLayout, movable as canMove, useLayoutEdit } from "../layoutEdit";
import { PANEL_NAMES, cardName, isPanel, useCard, useSettings } from "../settings";
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

/**
 * A data problem as a red ⚠ instead of a line of red text: hovering shows it (title), a tap opens it
 * in a bubble under the icon (a popover: tapping anywhere else closes it).
 */
function Warning({ text, detail }: { text: string; detail?: string }) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  const label = detail ? `${text}：${detail}` : text;
  return (
    <>
      <button
        className="status-warn"
        popoverTarget={id}
        aria-label={label}
        title={label}
        onClick={(e) => {
          // Under the icon, its right edge lined up with the icon's (the icon sits at the card's right).
          const b = e.currentTarget.getBoundingClientRect();
          tip.current?.style.setProperty("top", `${b.bottom + 6}px`);
          tip.current?.style.setProperty("right", `${Math.max(8, innerWidth - b.right)}px`);
        }}
      >
        ⚠
      </button>
      <div ref={tip} id={id} popover="auto" className="status-tip" role="status">
        <strong>{text}</strong>
        {detail && <div>{detail}</div>}
      </div>
    </>
  );
}

/** Phone: the card before / after this one of its type (none at the ends). */
function SwitchArrow({ to, label, onPick }: { to?: string; label: string; onPick: (id: string) => void }) {
  const { settings } = useSettings();
  return (
    <button className="card-switch-arrow" disabled={!to} onClick={() => to && onPick(to)} aria-label={to ? `${label}：${cardName(settings, to)}` : `沒有${label}`}>
      {label === "上一個" ? "‹" : "›"}
    </button>
  );
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
  /** Without it (a card with no data to fetch) there is no refresh countdown. */
  state?: Polled<unknown>;
  /** Data older than this is flagged as delayed. */
  maxAgeSec?: number;
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
  const fresh = state ? freshness(state, maxAgeSec ?? Infinity, now) : null;
  // Polls run on the page's beat, so the next one is up to 1.5 intervals away (see usePolling).
  const left = state?.nextAt == null ? null : Math.min(state.intervalSec * 1.5, (state.nextAt - now) / 1000);
  const layout = useLayoutEdit();
  const panel = isPanel(className) ? className : null;
  const movable = layout.editing && panel && canMove(layout.mode) && panel;
  // Which card this is: an extra one (天氣 2) has its own id and a number after its title.
  const card = useCard();
  const id = card?.id || className;
  const extra = !!card && card.n > 1;
  // The user's name for this card, if any (設定 → 顯示內容 → the card's page).
  const { settings } = useSettings();
  const custom = settings.names[id];
  // Phone: one card of a type at a time; with several, the title becomes a switch between them.
  const siblings = layout.mode === "phone" ? layout.sameType(id) : [];
  const heading = custom ?? (extra ? `${title} ${card.n}` : title);
  const name = custom ?? (panel ? (extra ? `${PANEL_NAMES[panel]} ${card.n}` : PANEL_NAMES[panel]) : title);
  // Holding the title for half a second starts rearranging the cards.
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const release = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return (
    <section
      className={`card ${className} ${fresh?.warn ? "card-warn" : ""} ${movable ? "card-movable" : ""}`}
      data-card={id}
      style={layout.style(id)}
    >
      <header className="card-head">
        {movable && (
          <button
            className="card-move"
            aria-label={
              layout.mode === "phone"
                ? `移動${name}，目前${layout.where(id)}。按方向鍵和另一張交換位置`
                : `移動${name}，目前${layout.where(id)}。方向鍵移動一格（擋住時和那一邊的板塊交換），Shift 加方向鍵調整大小，Alt 加方向鍵移動右邊或下邊並帶動相鄰板塊`
            }
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
            title="拖動或用方向鍵移動"
            onKeyDown={(e) => {
              if (!e.key.startsWith("Arrow")) return;
              e.preventDefault();
              layout.move(id, e.key, e.altKey ? "line" : e.shiftKey ? "resize" : "move");
            }}
          >
            <svg viewBox="0 0 12 16" aria-hidden>
              {[3, 9].flatMap((cx) => [3, 8, 13].map((cy) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="1.4" />))}
            </svg>
          </button>
        )}
        {siblings.length > 1 ? (
          // Arrows, not a tab per card: names don't fit side by side on a phone.
          <div className="card-switch" role="group" aria-label={`切換${panel ? PANEL_NAMES[panel] : title}`}>
            <SwitchArrow to={siblings[siblings.indexOf(id) - 1]} label="上一個" onPick={layout.pick} />
            <h2 aria-live="polite" title={heading}>
              {heading}
            </h2>
            <span className="muted small card-switch-count">
              {siblings.indexOf(id) + 1}/{siblings.length}
            </span>
            <SwitchArrow to={siblings[siblings.indexOf(id) + 1]} label="下一個" onPick={layout.pick} />
          </div>
        ) : (
          <h2
            onPointerDown={(e) => {
              if (layout.editing || layout.mode === "phone" || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
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
            title={heading}
          >
            {heading}
          </h2>
        )}
        {edit && (
          <button
            className="card-gear"
            onClick={() => openSettings(edit, extra ? id : undefined)}
            aria-label={`${heading}設定`}
            title={`${heading}設定`}
          >
            <GearIcon />
          </button>
        )}
        {actions}
        {layout.editing && panel && layout.mode !== "phone" && (
          <button
            className="card-hide"
            onClick={() => layout.hide(id)}
            aria-label={`隱藏${name}`}
            title="隱藏這個板塊（要刪除請到設定）"
          >
            隱藏
          </button>
        )}
        <span className="muted status">
          {!state ? null : left == null ? (
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
          {fresh && !fresh.warn && <span title={fresh.title}>・{fresh.text}</span>}
          {fresh?.warn && <Warning text={fresh.text.replace(/^⚠\s*/, "")} detail={fresh.title} />}
        </span>
      </header>
      {children}
      {source && <div className="card-source">資料來源：{source}</div>}
      {/* Drag to resize (tablet / desktop); the move button's Shift+arrows do the same from the keyboard. */}
      {movable && layout.mode !== "phone" && (
        <>
          <span className="card-edge card-edge-x" data-resize="x" aria-hidden title="拖動調整寬度（相鄰板塊一起調整）" />
          <span className="card-edge card-edge-y" data-resize="y" aria-hidden title="拖動調整高度（相鄰板塊一起調整）" />
          <span className="card-edge card-edge-x0" data-resize="x0" aria-hidden title="拖動調整寬度（相鄰板塊一起調整）" />
          <span className="card-edge card-edge-y0" data-resize="y0" aria-hidden title="拖動調整高度（相鄰板塊一起調整）" />
          <span className="card-resize" data-resize="corner" aria-hidden title="拖動單獨調整大小" />
        </>
      )}
    </section>
  );
}
