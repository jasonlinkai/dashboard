import { useEffect, useRef, useState } from "react";
import { REFRESH_SEC, STALE_AFTER_SEC } from "../config";
import { TOPICS, type Topic } from "../news-sources";
import { useSettings } from "../settings";
import { ago } from "../format";
import { getJSON, useNow, usePolling, useScrollHint } from "../hooks";
import type { NewsItem } from "../shared";
import { Section } from "./Section";

export function News() {
  const { settings } = useSettings();
  // Topics with no sources are hidden (set in 設定 → 新聞).
  const visible = TOPICS.filter(([id]) => settings.news[id].length);
  const [chosen, setChosen] = useState<Topic>(() => {
    try {
      const t = localStorage.getItem("newsTopic");
      if (TOPICS.some(([id]) => id === t)) return t as Topic;
    } catch {}
    return "top";
  });
  const topic: Topic | undefined = visible.some(([id]) => id === chosen) ? chosen : visible[0]?.[0];
  const sources = topic ? settings.news[topic].join(",") : "";
  const now = useNow(60_000);
  const state = usePolling(
    () =>
      topic
        ? getJSON<NewsItem[]>(`/api/news?topic=${topic}&sources=${sources}`)
        : Promise.resolve({ data: [] as NewsItem[], dataTime: Date.now(), stale: false }),
    REFRESH_SEC.news,
    [topic, sources],
  );
  const listRef = useScrollHint<HTMLOListElement>();
  const tabsRef = useRef<HTMLDivElement>(null);

  // The tab row scrolls sideways when there are many topics: keep the selected one in view.
  useEffect(() => {
    tabsRef.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [topic]);

  const choose = (t: Topic) => {
    setChosen(t);
    try {
      localStorage.setItem("newsTopic", t);
    } catch {}
  };

  const tabs = (
    <div className="tabs news-tabs" role="tablist" ref={tabsRef}>
      {visible.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={topic === id} onClick={() => choose(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Section
      title="新聞"
      className="news"
      state={state}
      maxAgeSec={STALE_AFTER_SEC.news}
      actions={tabs}
      source="各媒體 RSS 標題與連結，版權屬原媒體，點標題閱讀原文"
    >
      <ol className="news-list scroll" ref={listRef}>
        {!topic && <li className="hint">所有新聞分類都設為不顯示，可在右上角「設定 → 新聞」開啟。</li>}
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
