# 晨報看板

天氣、市場行情、公車、火車、新聞一頁看完。網頁 App（PWA），iPad、iPhone、Android、電腦都能用。

| 區塊 | 資料來源 | 需要金鑰 |
| --- | --- | --- |
| 市場行情（台股、那斯達克、BTC、黃金、美元/台幣、美債殖利率） | Yahoo Finance | 不用 |
| 新聞 | 中央社 RSS | 不用 |
| 天氣預報 | Open-Meteo | 不用 |
| 天氣即時實測（各區測站） | 中央氣象署 | `CWA_API_KEY` |
| 公車到站、區間車時刻與誤點 | 交通部 TDX | `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` |

沒有金鑰也能跑，只是公車、火車那兩張卡會顯示「尚未設定」，天氣則改用模型資料。

## 取得金鑰（免費）

1. **TDX**：到 https://tdx.transportdata.tw 註冊 → 會員中心 → API 金鑰，取得 Client Id 與 Client Secret
2. **氣象署**：到 https://opendata.cwa.gov.tw 註冊 → 取得授權碼

## 本機執行

```bash
npm install
cp .dev.vars.example .dev.vars   # 把金鑰填進 .dev.vars
npm run dev
```

用 iPad 或手機開終端機顯示的 `Network:` 網址（要跟電腦連同一個 Wi-Fi）。

## 部署（Cloudflare，免費方案即可）

網址：https://dashboard.jasonlinkai.workers.dev

**自動部署**：這個 repo 已經連結 Cloudflare Workers Builds，push 到 `main` 就會自動執行
`npm run build` 和 `npx wrangler deploy`。建置進度在 Cloudflare 後台 Workers & Pages → dashboard → Deployments。

**手動部署**（第一次設定，或要跳過 GitHub 時）：

```bash
npx wrangler login
npx wrangler secret bulk .dev.vars   # 上傳金鑰（只需一次，之後會保留）
npm run deploy
```

部署注意事項：

- TDX 金鑰每分鐘只能查 5 次。所有公車與火車查詢都經過同一個 Durable Object（`TdxGate`），
  共用快取與額度；本機開發伺服器用同一組金鑰時會互搶額度，正式版在用時建議關掉本機的。
- Google 新聞會拒絕 Cloudflare 機房的請求，所以新聞改用中央社 RSS。

## 加到 iPad 主畫面

用 Safari 開網址 → 分享 → **加入主畫面**。之後從主畫面圖示打開，就會全螢幕執行，沒有網址列。
右上角的「螢幕常亮」打開後，看板開著時 iPad 不會自動休眠。

## 修改設定

全部都在 [`src/config.ts`](src/config.ts)：

- `LOCATIONS`：天氣地點與對應的氣象署行政區
- `INSTRUMENTS`：行情項目（Yahoo Finance 代號）
- `BUS_STOPS`：公車路線、上車站、方向（`"auto"` 會自動選往台北的方向；選錯的話改成 `0` 或 `1`）
- `TRAIN`：火車上車站、目的地、車種
- `RED_IS_UP`：紅漲綠跌
