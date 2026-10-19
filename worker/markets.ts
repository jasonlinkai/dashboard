import type { NewsItem, Quote } from "../src/shared";
import { UA, cached, fetchJSON } from "./util";

async function loadQuote(symbol: string): Promise<Quote> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`;
  let data: any;
  try {
    data = await fetchJSON(`https://query1.finance.yahoo.com${path}`, { headers: { "User-Agent": UA } });
  } catch {
    data = await fetchJSON(`https://query2.finance.yahoo.com${path}`, { headers: { "User-Agent": UA } });
  }
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`no data for ${symbol}`);
  const meta = result.meta;
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const session = meta.currentTradingPeriod?.regular;
  const nowSec = Date.now() / 1000;
  return {
    symbol,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    marketTime: (meta.regularMarketTime ?? 0) * 1000,
    marketOpen: session ? session.start <= nowSec && nowSec < session.end : null,
    points: closes.filter((c): c is number => typeof c === "number"),
  };
}

export async function quotes(symbols: string[]): Promise<Quote[]> {
  const settled = await Promise.allSettled(symbols.map((s) => cached(`q:${s}`, 15, () => loadQuote(s))));
  return settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

const TOPICS: Record<string, string> = {
  top: "https://news.google.com/rss",
  business: "https://news.google.com/rss/headlines/section/topic/BUSINESS",
  world: "https://news.google.com/rss/headlines/section/topic/WORLD",
  tech: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY",
};

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

export function news(topic: string): Promise<NewsItem[]> {
  const base = TOPICS[topic] ?? TOPICS.top;
  return cached(`news:${topic}`, 300, async () => {
    const res = await fetch(`${base}?hl=zh-TW&gl=TW&ceid=TW:zh-Hant`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`news ${res.status}`);
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30).map(([, item]) => {
      const source = decode(tag(item, "source") ?? "");
      let title = decode(tag(item, "title") ?? "");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const pub = tag(item, "pubDate");
      return { title, source, link: decode(tag(item, "link") ?? ""), published: pub ? Date.parse(pub) : null };
    });
  });
}
