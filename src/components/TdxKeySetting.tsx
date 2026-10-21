import { useState } from "react";
import { MAX_TDX_KEYS, type TdxKey, loadTdxKeys, saveTdxKeys, tdxHeaders } from "../tdxKey";
import { toast } from "../toast";

/** One key slot: Client Id + Secret, tested before it is saved. */
function KeySlot({ n, saved, onSave, onRemove }: { n: number; saved?: TdxKey; onSave: (k: TdxKey) => void; onRemove: () => void }) {
  const [id, setId] = useState(saved?.id ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const test = async () => {
    const k = { id: id.trim(), secret: secret.trim() || (saved && saved.id === id.trim() ? saved.secret : "") };
    if (!k.id || !k.secret) return toast(`第 ${n} 把：請填入 Client Id 與 Client Secret`, "error");
    setBusy(true);
    try {
      const res = await fetch("/api/tdx-check", { headers: tdxHeaders([k]) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      onSave(k);
      setSecret("");
      toast(`第 ${n} 把金鑰可以使用，已儲存`);
    } catch (e) {
      toast(`第 ${n} 把：${e instanceof Error ? e.message : "無法驗證金鑰"}`, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="key-slot">
      <div className="key-slot-head">
        <b>金鑰 {n}</b>
        <span className="muted small">{saved ? `使用中（${saved.id.slice(0, 6)}…）` : "未設定"}</span>
      </div>
      <div className="ed-add">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Client Id" autoComplete="off" spellCheck={false} aria-label={`金鑰 ${n} Client Id`} />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={saved ? "Client Secret（已儲存，不變可留空）" : "Client Secret"}
          type="password"
          autoComplete="off"
          aria-label={`金鑰 ${n} Client Secret`}
        />
      </div>
      <div className="ed-actions">
        <button className="ed-primary" onClick={test} disabled={busy}>
          {busy ? "驗證中…" : "測試並儲存"}
        </button>
        {saved && (
          <button
            onClick={() => {
              onRemove();
              setId("");
              setSecret("");
              toast(`已移除第 ${n} 把金鑰`);
            }}
          >
            移除
          </button>
        )}
      </div>
    </div>
  );
}

/** Optional: the visitor's own TDX keys (up to three), so their queries don't share the site's quota. */
export function TdxKeySetting() {
  const [keys, setKeys] = useState<TdxKey[]>(loadTdxKeys);
  // Slots keep their position while editing; saved keys are stored without gaps.
  const [slots, setSlots] = useState<(TdxKey | undefined)[]>(() => Array.from({ length: MAX_TDX_KEYS }, (_, i) => keys[i]));
  const update = (next: (TdxKey | undefined)[]) => {
    setSlots(next);
    const list = next.filter((k): k is TdxKey => Boolean(k)).filter((k, i, all) => all.findIndex((x) => x.id === k.id) === i);
    saveTdxKeys(list);
    setKeys(list);
  };

  return (
    <div className="setting">
      <div className="setting-label">選填，建議設定</div>
      <div className="key-why">
        <p>
          <b>為什麼建議設定？</b>公車、火車、停車的即時資料來自交通部 TDX。網站內建的金鑰是<b>所有使用者共用</b>的，每把每分鐘只能查 5 次；
          用的人一多、或大家加了很多路線，就會輪不到而顯示「額度已滿」，到站時間也會延遲更新。
        </p>
        <p>
          <b>為什麼可以填 3 把？</b>TDX 的每個會員帳號可以免費建立 3 把 API 金鑰，每把各有自己的每分鐘 5 次額度。3 把都填上，就有 3 倍的額度，看板會自動輪流使用：
          哪一把這一分鐘用得最少就先用哪一把，某一把用完或失效就自動換下一把。只填 1 把也可以。
        </p>
        <p>
          <b>設定後有什麼好處？</b>
        </p>
        <ul>
          <li>你的公車、火車、停車改用你自己的額度查詢，不必和別人排隊，更新更準時。</li>
          <li>新增公車路線、切換火車路線、查停車場時，比較不會碰到「額度已滿」。</li>
          <li>你查到的資料也會分享給其他使用者，少用共用金鑰的額度，整個看板對大家都更穩定。</li>
        </ul>
        <p>
          <b>怎麼取得？</b>免費，幾分鐘就好：到{" "}
          <a href="https://tdx.transportdata.tw/" target="_blank" rel="noopener noreferrer">
            TDX 網站
          </a>{" "}
          註冊會員 → 在會員中心的「資料服務 → API 金鑰」建立金鑰（最多 3 把）→ 把每把的 Client Id 與 Client Secret 貼到下面，按「測試並儲存」。
        </p>
        <p className="muted">
          <b>隱私：</b>金鑰只存在這台裝置的瀏覽器；每次查詢時送到看板的伺服器代為向 TDX 查詢，伺服器不保存、不記錄。匯出設定檔不包含金鑰，換裝置要重新填。
        </p>
      </div>
      {slots.map((k, i) => (
        <KeySlot
          key={i}
          n={i + 1}
          saved={k}
          onSave={(saved) => update(slots.map((x, j) => (j === i ? saved : x)))}
          onRemove={() => update(slots.map((x, j) => (j === i ? undefined : x)))}
        />
      ))}
      <div className="muted small">
        {keys.length ? `目前輪流使用你的 ${keys.length} 把金鑰（每分鐘共約 ${keys.length * 4} 次查詢）` : "目前使用網站共用的金鑰"}
      </div>
    </div>
  );
}
