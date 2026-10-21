import { type ReactNode, useEffect, useRef } from "react";
import { BUS_ESTIMATE_STALE_MIN, QUOTE_LAG_MIN, REFRESH_SEC, STALE_AFTER_SEC, STATION_MAX_AGE_MIN } from "../config";
import { NEWS_BY_ID, TOPICS } from "../news-sources";
import { type Settings, instrumentOf, useSettings } from "../settings";

const dur = (sec: number) => (sec < 60 ? `${sec} 秒` : `${Math.round(sec / 60)} 分鐘`);


interface Block {
  title: string;
  source: ReactNode;
  refresh: ReactNode;
  notes: ReactNode[];
}

// Keep this honest: say what is verified, what is a known limitation, and what is not verified.
// Built from the current settings, so it describes what is actually on screen.
function blocks(settings: Settings): Block[] {
  const yieldDelay = Math.max(0, ...settings.markets.map(instrumentOf).map((i) => (i.format.kind === "yield" ? (i.feedDelayMin ?? 0) : 0)));
  const fixedStations = settings.weather.filter((l) => l.station).map((l) => `${l.name}→${l.station}站`);
  const townStations = settings.weather.filter((l) => !l.station).map((l) => l.name);
  const newsLine = (topic: (typeof TOPICS)[number]) =>
    `${topic[1]}：${settings.news[topic[0]].map((id) => NEWS_BY_ID.get(id)?.name ?? id).join("、") || "（不顯示）"}`;
  return [
  {
    title: "市場行情",
    source: "Yahoo Finance 的公開網頁介面（非官方 API，未經交易所授權，可能隨時變更或中斷）",
    refresh: `每 ${dur(REFRESH_SEC.quotes)}；超過 ${dur(STALE_AFTER_SEC.quotes)} 未取得新資料即警示`,
    notes: [
      "台股、那斯達克等是否為即時報價、延遲多久未經驗證；交易請以券商報價為準。",
      `美債殖利率（CBOE 13 週、5 年、10 年、30 年指數）實測固定延遲約 ${yieldDelay} 分鐘，標示為「延遲報價」。`,
      "黃金是 COMEX 期貨近月合約（美元/盎司），不是現貨或銀行黃金牌價。",
      "美元/台幣是 Yahoo 報價，不是銀行牌告價。",
      "漲跌以 Yahoo 的前一日收盤為基準（比特幣 24 小時交易，基準點不同）。",
      `收盤後顯示「收盤 HH:MM」；開盤中超過 ${QUOTE_LAG_MIN} 分鐘沒有新成交（扣除固定延遲）顯示紅色「停在 HH:MM」。`,
    ],
  },
  {
    title: "天氣",
    source: (
      <>
        現在溫度、濕度、天氣：氣象署測站實測。
        <br />
        高低溫、降雨、體感、24 小時預報：Open-Meteo 模型。
      </>
    ),
    refresh: `每 ${dur(REFRESH_SEC.weather)}；測站約每 10 分鐘一筆，發布會晚幾分鐘；超過 ${dur(STALE_AFTER_SEC.weather)} 未更新即警示`,
    notes: [
      `使用的測站：${[...fixedStations, ...(townStations.length ? [`${townStations.join("、")}用同區測站`] : [])].join("；")}。同區沒有一般測站時會用國道旁的測站（例如南港區只有「國三S016K」），可能和住宅區有落差。`,
      `測站超過 ${STATION_MAX_AGE_MIN} 分鐘沒新資料就改用模型數值，卡片底部會註明。`,
      "模型格點約數公里，相鄰的區（例如內湖、南港、汐止）預報幾乎相同；只有現在溫度（實測）會不同。",
      "第一個地點的天氣決定整頁的天氣動畫。地點可在設定新增、刪除、排序。",
      "高低溫是預報值不是實測，也不是氣象署官方預報；點卡片可開氣象署鄉鎮預報對照。",
    ],
  },
  {
    title: "公車",
    source: "交通部 TDX 運輸資料流通服務（新北市公車預估到站）",
    refresh: `每 ${dur(REFRESH_SEC.bus)}；超過 ${dur(STALE_AFTER_SEC.bus)} 未更新即警示`,
    notes: [
      "預估由業者系統依車輛位置推算（TDX 約每分鐘更新），塞車、改道、脫班時可能不準。",
      "直接顯示 TDX 最新一筆預估，不自行倒數：少於 1 分鐘「進站中」、少於 3 分鐘「將到站」，其他顯示分鐘（無條件捨去）；用語類似大台北公車 App（門檻是常見用法，未與該 App 逐一核對）。",
      "尚未發車的車次，TDX 的預估是依時刻表推算，顯示「尚未發車・約 N 分」。",
      `單一路線預估超過 ${BUS_ESTIMATE_STALE_MIN} 分鐘沒更新，該列會顯示紅色警告。`,
      "「往台北」的車依路線的「往 XX」站名自動判斷；「往日月光社區」的車只列會開到日月光社區的那一側站牌（F913 是環狀線，汐科站北站去回各有一個站牌）。",
      "TDX 每把金鑰每分鐘限查 5 次（公車、火車、停車共用；網站輪流使用多把金鑰分散查詢），額度用完時沿用上一筆並標示延遲。",
      "TDX 標示為當日末班的車次，會加註紅字「末班車」。",
    ],
  },
  {
    title: settings.trains.length ? `火車（${settings.trains.map((t) => `${t.from}→${t.to}`.replace(/臺/g, "台")).join("、")}）` : "火車",
    source: "交通部 TDX：臺鐵每日時刻表＋列車即時位置（誤點）＋車站即時看板（停駛、月台）＋營運公告",
    refresh: `時刻表每天抓一次；誤點每 ${dur(REFRESH_SEC.train)}；超過 ${dur(STALE_AFTER_SEC.train)} 未更新即警示`,
    notes: [
      "左側大字是列車從上車站（例如汐科）開出的表定時間，不是列車起點站的時間；抵達時間在第二行。",
      "剩餘分鐘是「表定開車時間＋誤點分鐘」到現在的時間（無條件捨去），不到 1 分鐘顯示「即將發車」；有誤點時抵達時間也一併延後，標「約」。",
      "誤點取自全臺行駛中列車的即時位置；還沒從起站發車的班次沒有即時資料，顯示「無即時資訊」，不代表準點。",
      "停駛與月台只有車站即時看板有，而 TDX 只提供較大車站的看板（例如臺北、松山有，汐科沒有）；看板標示停駛的車次會加刪除線並標「停駛」。汐科上車的班次無法得知停駛，請留意上方的臺鐵公告。",
      "臺鐵營運公告（颱風、事故、路段通阻）每 5 分鐘查一次，有異常時顯示在火車區塊最上方；查不到時會明白標示無法確認。",
      "只有展開的路線會更新；切換路線時會重新查詢（TDX 額度與公車共用）。",
      "公告只顯示全線性的文字，不會自動判斷影響哪些班次；改點、加開等時刻變動以臺鐵官網為準（點班次可開車次頁）。",
    ],
  },
  {
    title: "新聞",
    source: (
      <>
        多家媒體 RSS 混合（可在設定調整來源與順序）：
        {TOPICS.map((t) => (
          <span key={t[0]}>
            <br />
            {newsLine(t)}
          </span>
        ))}
      </>
    ),
    refresh: `每 ${dur(REFRESH_SEC.news)}；超過 ${dur(STALE_AFTER_SEC.news)} 未更新即警示`,
    notes: [
      "依發布時間排列，最新的在最上面；每家最多 8 則，避免單一媒體洗版；超過 36 小時的不列；沒有發布時間的排在最後。不是編輯挑選的頭條，也沒有判斷重要性。",
      "多家媒體轉載同一則中央社稿件時，標題相同的只留一則（標題被改寫就無法辨識）。",
      "某家來源暫時連不上時，其他來源照常顯示。",
      "TVBS 沒有 RSS，改讀它提供給 Google 新聞的網站地圖，依網址分類（政治、社會、生活、國際、財經、科技…）放進各分頁。",
      "外媒標題照原文顯示（簡體中文或英文），不做翻譯或轉換。",
      "Google 新聞、中時、風傳媒、關鍵評論會拒絕來自 Cloudflare 機房的請求，聯合新聞網的 RSS 目前是空的，所以沒有收錄。",
      "「X 小時前」是 RSS 裡的發布時間。",
    ],
  },
];
}

/** Who the data comes from and on what terms (the licences require crediting the source). */
const SOURCES: [name: string, href: string, use: string, licence: string][] = [
  ["交通部 TDX 運輸資料流通服務", "https://tdx.transportdata.tw/", "公車到站、臺鐵時刻／即時／營運公告、停車場與即時空位、地點搜尋", "政府資料開放授權條款－第 1 版"],
  ["中央氣象署開放資料", "https://opendata.cwa.gov.tw/", "測站實測、鄉鎮清單與座標", "政府資料開放授權條款－第 1 版"],
  ["臺灣證券交易所 OpenAPI", "https://openapi.twse.com.tw/", "上市股票、ETF 中文名稱", "政府資料開放授權條款－第 1 版"],
  ["Open-Meteo", "https://open-meteo.com/", "天氣預報（逐時、高低溫、降雨機率）", "CC BY 4.0，免費 API 限非商業使用"],
  ["Yahoo Finance", "https://finance.yahoo.com/", "行情報價與走勢", "非官方介面，僅供個人參考，報價以券商為準"],
  ["各新聞媒體", "https://www.cna.com.tw/", "新聞標題與連結（RSS、TVBS 網站地圖）", "版權屬各媒體；只顯示標題並連回原文"],
  ["內政部國土測繪中心 電子地圖", "https://maps.nlsc.gov.tw/", "停車場搜尋的底圖", "政府資料開放授權條款－第 1 版，標示來源"],
  ["OpenStreetMap（Nominatim）", "https://www.openstreetmap.org/copyright", "停車場搜尋的店家／地點查詢", "© OpenStreetMap 貢獻者，ODbL；遵守每秒 1 次與快取規範"],
  ["Leaflet", "https://leafletjs.com/", "互動地圖元件", "BSD-2-Clause 開源授權"],
  ["Google 地圖", "https://www.google.com/maps", "公車路線、停車場導航連結", "僅開啟網址連結，不使用 API"],
];

const LEGEND: [ReactNode, string][] = [
  ["◯ 0:24 後更新", "下一次向後端要資料的倒數；倒數本身不代表資料是新的。"],
  ["資料 23:51:27", "後端最後一次真正從資料來源取得資料的時間。"],
  [<span className="error">⚠ 資料延遲 N 分鐘</span>, "資料太舊，或後端更新失敗正在用上一份資料；卡片外框同時變紅。"],
  [<span className="error">⚠ 更新失敗</span>, "看板連不到後端（例如網路斷線），畫面上是之前的資料。"],
  [<span className="error">⚠ 無即時資料</span>, "這次只拿到靜態資料（例如火車只有時刻表、沒有誤點）。"],
];

export function Reliability({ onClose }: { onClose: () => void }) {
  const { settings } = useSettings();
  const closeRef = useRef<HTMLButtonElement>(null);
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rel-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="rel-title">資料可靠度說明</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <section className="rel-block rel-legend">
            <h3>右上角的標示怎麼看</h3>
            <dl>
              {LEGEND.map(([k, v], i) => (
                <div key={i}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          {blocks(settings).map((b) => (
            <section key={b.title} className="rel-block">
              <h3>{b.title}</h3>
              <p>
                <b>來源</b>
                {b.source}
              </p>
              <p>
                <b>更新</b>
                {b.refresh}
              </p>
              <ul>
                {b.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </section>
          ))}
          <section className="rel-block rel-sources">
            <h3>資料來源與授權</h3>
            <dl>
              {SOURCES.map(([name, href, use, licence]) => (
                <div key={name}>
                  <dt>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {name}
                    </a>
                  </dt>
                  <dd>
                    {use}・{licence}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="muted">
              政府開放資料依{" "}
              <a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">
                政府資料開放授權條款－第 1 版
              </a>{" "}
              使用並標示來源。本看板為個人、非商業用途。
            </p>
          </section>
          <p className="rel-foot">
            所有數字僅供參考，不構成投資建議；出門、搭車、交易前請以官方來源確認。點任何一筆資料都可以開啟它的來源頁面。
          </p>
        </div>
      </div>
    </div>
  );
}
