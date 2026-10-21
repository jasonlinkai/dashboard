import { useEffect, useRef } from "react";

/** How layout mode works, opened from its bar (native modal dialog: Esc closes only this). */
export function LayoutHelp({ mode, onClose }: { mode: "wide" | "tall" | "phone"; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      className="modal modal-small confirm layout-help"
      aria-labelledby="layout-help-title"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <h2 id="layout-help-title">排版怎麼運作</h2>
      {mode === "phone" ? (
        <div className="layout-help-body">
          <p>手機的分頁固定，這裡不能移動、調整大小、隱藏或新增板塊；新增或刪除請到「設定 → 顯示內容」，調整版面請在平板或電腦上操作。</p>
          <h3>恢復預設</h3>
          <p>被刪除的預設板塊會用預設內容補回，每個分頁回到顯示第一個板塊。平板與電腦的版面不受影響。</p>
        </div>
      ) : (
        <div className="layout-help-body">
          <h3>橫向、直向各一份</h3>
          <p>
            電腦與平板橫放用「橫向」版面，平板直放用「直向」版面，兩份各自記住板塊的位置、大小和隱藏了哪些；你現在在
            <strong>{mode === "wide" ? "橫向" : "直向"}</strong>。手機的分頁固定，排版模式只能恢復預設。
          </p>
          <p>板塊本身（有哪些、內容、名稱）兩份共用：新增或刪除會同時影響兩邊。</p>

          <h3>移動與調整大小</h3>
          <ul>
            <li>拖到另一個板塊上：兩個交換位置和大小。</li>
            <li>拖到空位：移過去，大小不變。</li>
            <li>拖右下角：只調整這個板塊的寬高。</li>
            <li>拖邊線：相鄰的板塊跟著一起調整，擠到最小時會再推下一個。</li>
            <li>鍵盤：聚焦板塊左上角的 ⠿，方向鍵移動，Shift＋方向鍵調整大小，Alt＋方向鍵移動右邊或下邊。</li>
          </ul>

          <h3>最小尺寸</h3>
          <p>每個板塊至少約 280×170 像素，所有種類都一樣，所以任兩個板塊都能直接交換。新增的板塊就是這個大小。</p>

          <h3>隱藏和刪除</h3>
          <p>
            「隱藏」只是把板塊從這個方向的版面拿掉，內容還在，從上方的「＋名稱」顯示回來（放大到至少最小尺寸）。
            要連內容一起刪除，請到「設定 → 顯示內容」。
          </p>

          <h3>新增板塊</h3>
          <p>
            從上方「新增板塊…」選種類，每種最多 3
            個。新板塊從精簡內容開始，兩個方向都會找空位放；沒有空位就先隱藏，騰出空間後再從「＋名稱」顯示。
          </p>

          <h3>恢復預設</h3>
          <p>只重設現在這個方向：板塊回到預設位置、隱藏的都顯示回來；預設版面裡被你刪掉的板塊會用預設內容補回。另一個方向不受影響。</p>

          <p className="muted small">版面存在這台裝置的瀏覽器裡；要搬到別台，用「設定 → 備份」匯出、匯入。</p>
        </div>
      )}
      <div className="confirm-actions">
        <button autoFocus onClick={onClose}>
          知道了
        </button>
      </div>
    </dialog>
  );
}
