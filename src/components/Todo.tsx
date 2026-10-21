import { useState } from "react";
import { LIMITS, MAX_TODO, useSettings } from "../settings";
import { useScrollHint } from "../hooks";
import { Section } from "./Section";

/** A to-do list kept on this device: add, tick off and delete items right on the card. */
export function Todo() {
  const { settings, setSettings } = useSettings();
  const items = settings.todos;
  const [draft, setDraft] = useState("");
  const listRef = useScrollHint<HTMLUListElement>();
  const set = (todos: typeof items) => setSettings({ ...settings, todos });
  const add = () => {
    const text = draft.trim();
    if (!text || items.length >= LIMITS.todos) return;
    set([...items, { text, done: false }]);
    setDraft("");
  };
  const left = items.filter((t) => !t.done).length;
  return (
    <Section title="待辦事項" edit="todo" className="todo" actions={items.length > 0 && <span className="muted small">剩 {left} 項</span>}>
      <ul className="todo-list scroll" ref={listRef}>
        {!items.length && <li className="hint">還沒有待辦事項，在下面輸入後按 Enter 新增。</li>}
        {items.map((t, i) => (
          <li key={i} className={`todo-item ${t.done ? "todo-done" : ""}`}>
            <label>
              <input type="checkbox" checked={t.done} onChange={() => set(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <span>{t.text}</span>
            </label>
            <button className="todo-del" onClick={() => set(items.filter((_, j) => j !== i))} aria-label={`刪除「${t.text}」`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form className="todo-add" onSubmit={(e) => (e.preventDefault(), add())}>
        <input
          value={draft}
          maxLength={MAX_TODO}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={items.length >= LIMITS.todos ? `最多 ${LIMITS.todos} 項` : "新增待辦…"}
          disabled={items.length >= LIMITS.todos}
          aria-label="新增待辦事項"
        />
        <button disabled={!draft.trim()}>新增</button>
      </form>
    </Section>
  );
}
