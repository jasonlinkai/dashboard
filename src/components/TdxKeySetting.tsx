import { useState } from "react";
import { type TdxKey, loadTdxKey, saveTdxKey, tdxHeaders } from "../tdxKey";
import { toast } from "../toast";

/** Optional: the visitor's own TDX key, so their bus/train queries don't share the site's quota. */
export function TdxKeySetting() {
  const [saved, setSaved] = useState<TdxKey | null>(loadTdxKey);
  const [id, setId] = useState(saved?.id ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const test = async () => {
    const k = { id: id.trim(), secret: secret.trim() || saved?.secret || "" };
    if (!k.id || !k.secret) return toast("請填入 Client Id 與 Client Secret", "error");
    setBusy(true);
    try {
      const res = await fetch("/api/tdx-check", { headers: tdxHeaders(k) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      saveTdxKey(k);
      setSaved(k);
      setSecret("");
      toast("金鑰可以使用，已儲存；公車與火車改用你的金鑰查詢");
    } catch (e) {
      toast(e instanceof Error ? e.message : "無法驗證金鑰", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting">
      <div className="setting-label">TDX 金鑰（選填）</div>
      <div className="muted small">
        公車、火車資料來自交通部 TDX，網站共用的金鑰每分鐘只能查 5 次，人多或路線多時會顯示「額度已滿」。到{" "}
        <a href="https://tdx.transportdata.tw/" target="_blank" rel="noopener noreferrer">
          TDX 網站
        </a>{" "}
        免費註冊會員、申請 API 金鑰（Client Id 與 Client Secret）後填在這裡，你的查詢就用你自己的額度。
        金鑰只存在這台裝置的瀏覽器，每次查詢時送到看板的伺服器代為向 TDX 查詢，伺服器不保存；匯出設定檔不包含金鑰。
      </div>
      <div className="ed-add">
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Client Id" autoComplete="off" spellCheck={false} aria-label="Client Id" />
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={saved ? "Client Secret（已儲存，不變可留空）" : "Client Secret"}
          type="password"
          autoComplete="off"
          aria-label="Client Secret"
        />
      </div>
      <div className="ed-actions">
        <button className="ed-primary" onClick={test} disabled={busy}>
          {busy ? "驗證中…" : "測試並儲存"}
        </button>
        {saved && (
          <button
            onClick={() => {
              saveTdxKey(null);
              setSaved(null);
              setId("");
              setSecret("");
              toast("已移除金鑰，改回使用網站共用的金鑰");
            }}
          >
            移除金鑰
          </button>
        )}
      </div>
      <div className="muted small">{saved ? `目前使用你的金鑰（${saved.id.slice(0, 6)}…）` : "目前使用網站共用的金鑰"}</div>
    </div>
  );
}
