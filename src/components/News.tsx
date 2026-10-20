import { useState } from "react";
import { REFRESH_SEC, STALE_AFTER_SEC } from "../config";
import { TOPICS, type Topic } from "../news-sources";
import { useSettings } from "../settings";
import { ago } from "../format";
import { getJSON, useNow, usePolling, useScrollHint } from "../hooks";
import type { NewsItem } from "../shared";
import { Section } from "./Section";


export function News() {
  const { settings } = useSettings();
  const [topic, setTopic] = useState<Topic>(() => {
    try {
      const t = localStorage.getItem("newsTopic");
      if (TOPICS.some(([id]) => id === t)) return t as Topic;
    } catch {}
    return "top";
  });
  const sources = settings.news[topic].join(",");
  const now = useNow(60_000);
  const state = usePolling(() => getJSON<NewsItem[]>(`/api/news?topic=${topic}&sources=${sources}`), REFRESH_SEC.news, [topic, sources]);
  const listRef = useScrollHint<HTMLOListElement>();

  const choose = (t: Topic) => {
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
      <ol className="news-list scroll" ref={listRef}>
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
