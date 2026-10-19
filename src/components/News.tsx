import { useState } from "react";
import { REFRESH_SEC, STALE_AFTER_SEC } from "../config";
import { ago } from "../format";
import { getJSON, useNow, usePolling } from "../hooks";
import type { NewsItem } from "../shared";
import { Section } from "./Section";

const TOPICS = [
  ["top", "綜合"],
  ["business", "財經"],
  ["world", "國際"],
  ["tech", "科技"],
] as const;

export function News() {
  const [topic, setTopic] = useState<string>(() => {
    try {
      return localStorage.getItem("newsTopic") ?? "top";
    } catch {
      return "top";
    }
  });
  const now = useNow(60_000);
  const state = usePolling(() => getJSON<NewsItem[]>(`/api/news?topic=${topic}`), REFRESH_SEC.news, [topic]);

  const choose = (t: string) => {
    setTopic(t);
    try {
      localStorage.setItem("newsTopic", t);
    } catch {}
  };

  const tabs = (
    <div className="tabs" role="tablist">
      {TOPICS.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={topic === id} onClick={() => choose(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Section title="新聞" className="news" state={state} maxAgeSec={STALE_AFTER_SEC.news} actions={tabs}>
      <ol className="news-list scroll">
        {state.data?.map((n) => (
          <li key={n.link}>
            <a className="link" href={n.link} target="_blank" rel="noopener noreferrer">
              <div className="news-title">{n.title}</div>
              <div className="muted small">
                {n.source}
                {n.published ? `・${ago(n.published, now)}` : ""}
              </div>
            </a>
          </li>
        ))}
      </ol>
    </Section>
  );
}
