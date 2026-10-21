import { type ReactNode, useState } from "react";
import { loadTdxKeys } from "../tdxKey";
import { SubPage } from "./SubPage";
import { TdxKeySetting } from "./TdxKeySetting";

/**
 * Settings → 金鑰: one row per service the visitor can bring their own key for, each opening its
 * own page. To support another service, add an entry here.
 */
const SERVICES: { id: string; name: string; uses: string; summary: () => string; page: () => ReactNode }[] = [
  {
    id: "tdx",
    name: "TDX 運輸資料",
    uses: "公車、火車、停車場",
    summary: () => {
      const n = loadTdxKeys().length;
      return n ? `已設定 ${n} 把` : "使用網站共用金鑰";
    },
    page: () => <TdxKeySetting />,
  },
];

export function KeySettings() {
  const [open, setOpen] = useState<string | null>(null);
  const service = SERVICES.find((x) => x.id === open);
  return (
    <div className="setting">
      <div className="setting-label">金鑰</div>
      <div className="muted small">
        都是選填。填了自己的金鑰，查詢就用你自己的免費額度，不必和其他使用者共用，更新更穩定。金鑰只存在這台裝置的瀏覽器。
      </div>
      <ul className="ed-sections">
        {SERVICES.map((x) => (
          <li key={x.id}>
            <button className="ed-section" onClick={() => setOpen(x.id)}>
              <span className="ed-section-name">{x.name}</span>
              <span className="ed-section-sum muted small">
                {x.uses}・{x.summary()}
              </span>
              <span className="ed-section-chev" aria-hidden>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>
      {service && (
        <SubPage title={`${service.name}金鑰`} onClose={() => setOpen(null)}>
          {service.page()}
        </SubPage>
      )}
    </div>
  );
}
