const EMAIL = "loveguitar668@gmail.com";

/** Settings → 關於: who runs the board and how to reach them. */
export function About({ onShowSources }: { onShowSources: () => void }) {
  return (
    <>
      <div className="setting">
        <div className="setting-label">晨報看板</div>
        <p className="about-text">
          把行情、天氣、公車、火車、新聞和停車資訊放在同一個畫面的個人看板，適合放在桌上或牆上整天開著。資料都來自公開來源，免費、非商業使用。
        </p>
        <p className="muted small">
          各項資料的來源、授權與限制，請看{" "}
          <button className="link-btn" onClick={onShowSources}>
            資料可靠度說明
          </button>
          。
        </p>
      </div>
      <div className="setting">
        <div className="setting-label">聯絡</div>
        <p className="about-text">使用上有問題、對資料有疑慮，或認為本站內容侵害了你的權利，歡迎來信，我會盡快處理。</p>
        <a className="about-mail" href={`mailto:${EMAIL}?subject=${encodeURIComponent("晨報看板")}`}>
          ✉️ {EMAIL}
        </a>
        <p className="muted small">Jason Lin Kai</p>
      </div>
    </>
  );
}
