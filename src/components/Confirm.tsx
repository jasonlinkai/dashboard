import { type ReactNode, useEffect, useRef } from "react";

/** A yes / no question over the page (native modal dialog: focus stays inside, Esc cancels). */
export function Confirm({
  title,
  ok,
  onOk,
  onCancel,
  children,
}: {
  title: string;
  ok: string;
  onOk: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      className="modal modal-small confirm"
      aria-labelledby="confirm-title"
      onCancel={(e) => (e.preventDefault(), onCancel())}
      onClick={(e) => e.target === ref.current && onCancel()}
    >
      <h2 id="confirm-title">{title}</h2>
      <p>{children}</p>
      <div className="confirm-actions">
        <button autoFocus onClick={onCancel}>
          取消
        </button>
        <button className="confirm-ok" onClick={onOk}>
          {ok}
        </button>
      </div>
    </dialog>
  );
}
