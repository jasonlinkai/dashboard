import { useRef, useState } from "react";
import { NEWS_BY_ID } from "../news-sources";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type Settings, cardName, instrumentOf, orderedTopics, useSettings, validate } from "../settings";
import type { ThemePref } from "../theme";
import { toast } from "../toast";

const THEMES: ThemePref[] = ["auto", "light", "dark"];

/** What an exported file contains: the settings plus appearance. */
interface FileShape extends Settings {
  appearance?: { theme: ThemePref; fx: boolean };
}

interface Pending {
  settings: Settings;
  appearance?: { theme: ThemePref; fx: boolean };
  from: string;
}

/** Which layouts were arranged, and the cards hidden in each. */
const layoutSummary = (s: Settings) =>
  (["wide", "tall"] as const)
    .map((m) => {
      const moved = JSON.stringify(s.layout[m]) !== JSON.stringify(DEFAULT_LAYOUT[m]);
      const off = s.layout.hidden[m].map((p) => cardName(s, p));
      if (!moved && !off.length) return "";
      return `${m === "wide" ? "橫向" : "直向"}：${moved ? "已調整" : "預設"}${off.length ? `，隱藏 ${off.join("、")}` : ""}`;
    })
    .filter(Boolean)
    .join("；") || "預設";

/** Human-readable summary of a settings object, for the confirm step. */
function summary(s: Settings): [string, string][] {
  return [
    ["天氣", s.weather.map((p) => p.name).join("、")],
    ["行情", s.markets.map((m) => instrumentOf(m).name).join("、")],
    ["公車", s.bus.map((b) => `${b.route} ${b.stop}`).join("、") || "（無）"],
    ["火車", s.trains.map((t) => `${t.from}→${t.to}（${t.type}）`).join("、") || "（無）"],
    ...orderedTopics(s).map(([id, label]): [string, string] => [
      `新聞・${label}`,
      s.news[id].map((x) => NEWS_BY_ID.get(x)?.name ?? x).join("、") || "（不顯示）",
    ]),
    ["額外板塊", s.extras.map((e) => cardName(s, e.id)).join("、") || "（無）"],
    ["版面", layoutSummary(s)],
  ];
}

export function Backup({
  theme,
  fx,
  onTheme,
  onFx,
}: {
  theme: ThemePref;
  fx: boolean;
  onTheme: (t: ThemePref) => void;
  onFx: (on: boolean) => void;
}) {
  const { settings, setSettings } = useSettings();
  const [pending, setPending] = useState<Pending | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const json = () => JSON.stringify({ ...settings, appearance: { theme, fx } } satisfies FileShape, null, 2);

  const fail = (list: string[]) => {
    setErrors(list);
    toast(`無法匯入：${list.length > 1 ? `${list.length} 個問題，請看下方說明` : list[0]}`, "error");
  };

  /** Validate untrusted text; nothing changes until the user confirms the preview. */
  const consider = async (text: string, from: string) => {
    setPending(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      fail(["不是有效的 JSON（可能複製不完整，或檔案不是這個看板匯出的）"]);
      return;
    }
    const { settings: s, errors: errs } = validate(raw);
    if (!s) return fail(errs);
    // Town IDs must be real, or the card's link to the CWA forecast page would be wrong.
    const towns = (await import("../data/towns.json")).default as { county: string; town: string; townId: string }[];
    const bad = s.weather.filter((p) => !towns.some((t) => t.townId === p.townId && t.county === p.county && t.town === p.town));
    if (bad.length) {
      return fail(bad.map((p) => `weather「${p.name}」：${p.county}${p.town} 與 townId ${p.townId} 對不上氣象署的鄉鎮清單`));
    }
    const a = (raw as FileShape).appearance;
    const appearance = a && THEMES.includes(a.theme) && typeof a.fx === "boolean" ? { theme: a.theme, fx: a.fx } : undefined;
    setErrors([]);
    setPending({ settings: s, appearance, from });
    toast("檢查通過，確認內容後按「套用」", "info");
  };

  const exportFile = () => {
    const blob = new Blob([json()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("已匯出設定檔");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      toast("已複製到剪貼簿，可以貼到備忘錄或傳給自己");
    } catch {
      toast("這個瀏覽器不允許複製，請改用「匯出檔案」", "error");
    }
  };

  // What to take from the file: its cards and their content, its layouts, or both.
  const [parts, setParts] = useState({ content: true, layout: true });
  const apply = () => {
    if (!pending) return;
    if (!parts.content && !parts.layout) return toast("請至少勾選一項", "error");
    // One part only: the other comes from this device; validate() fits the two together (new
    // cards get free cells or start hidden; boxes of cards that aren't here are dropped).
    const merged =
      parts.content && parts.layout
        ? pending.settings
        : validate(parts.content ? { ...pending.settings, layout: settings.layout } : { ...settings, layout: pending.settings.layout }).settings;
    if (!merged) return toast("無法只匯入一部分，請兩項都勾選", "error");
    setSettings(merged);
    if (parts.content && pending.appearance) {
      onTheme(pending.appearance.theme);
      onFx(pending.appearance.fx);
    }
    setPending(null);
    setPasting(false);
    setPasted("");
    toast(pending.from === "預設值" ? "已還原成預設設定" : `已匯入「${pending.from}」`);
  };

  return (
    <div className="setting">
      <div className="setting-label">備份與還原</div>
      <div className="ed-actions">
        <button onClick={exportFile}>匯出檔案</button>
        <button onClick={() => fileRef.current?.click()}>匯入檔案</button>
        <button onClick={copy}>複製設定</button>
        <button onClick={() => (setPasting(!pasting), setErrors([]), setPending(null))}>貼上設定</button>
        <button onClick={() => setPending({ settings: DEFAULT_SETTINGS, from: "預設值" })}>還原預設</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow picking the same file again
          if (!file) return;
          if (file.size > 100_000) return fail(["檔案太大，不像是這個看板的設定檔"]);
          consider(await file.text(), file.name);
        }}
      />
      {pasting && (
        <div className="ed-paste">
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="把複製的設定貼在這裡" rows={5} />
          <button className="ed-primary" disabled={!pasted.trim()} onClick={() => consider(pasted, "貼上的內容")}>
            檢查
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <div className="ed-errors" role="alert">
          <b>無法匯入，現有設定沒有變動：</b>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {pending && (
        <div className="ed-preview">
          <b>套用「{pending.from}」之後會是：</b>
          <dl>
            {summary(pending.settings).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {pending.appearance && (
              <div>
                <dt>外觀</dt>
                <dd>
                  {{ auto: "自動", light: "淺色", dark: "深色" }[pending.appearance.theme]}・天氣動畫{pending.appearance.fx ? "開" : "關"}
                </dd>
              </div>
            )}
          </dl>
          <div className="ed-parts">
            <label>
              <input type="checkbox" checked={parts.content} onChange={(e) => setParts({ ...parts, content: e.target.checked })} />
              板塊與內容（地點、行情、站牌、路線、新聞、名稱、外觀）
            </label>
            <label>
              <input type="checkbox" checked={parts.layout} onChange={(e) => setParts({ ...parts, layout: e.target.checked })} />
              版面（桌機與平板的擺放、隱藏的板塊）
            </label>
          </div>
          <div className="ed-actions">
            <button className="ed-primary" onClick={apply}>
              套用
            </button>
            <button onClick={() => (setPending(null), toast("已取消，設定沒有變動", "info"))}>取消</button>
          </div>
        </div>
      )}
      <div className="muted small">設定只存在這台裝置的瀏覽器；換裝置時用匯出／匯入（或複製／貼上）帶過去。</div>
    </div>
  );
}
