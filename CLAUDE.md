# 晨報看板

React + Vite PWA，後端是 Cloudflare Worker（`worker/`）。使用說明與部署見 `README.md`。

**開始改任何東西前，先讀 [`docs/DECISIONS.md`](docs/DECISIONS.md)**：板塊資料模型（第一個板塊在頂層欄位、`extras`、`absent`）、
預設版型、兩個方向的版面、最小尺寸、手機分頁等決定與理由都在那裡。做出新的決定時，同一個改動裡更新那份文件。

- 型別檢查與建置：`npm run build`
- 版面系統端對端測試：`npm run test:e2e`（改到版面、板塊新增／刪除／隱藏、恢復預設、手機分頁時要跑）
- 介面文字繁體中文，程式碼註解英文。
