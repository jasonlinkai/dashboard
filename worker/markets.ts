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

// Central News Agency (中央社) RSS. Google News would be closer to "headlines", but it answers
// requests from Cloudflare's network with 503, so it can't be used once deployed.
const CNA = (feed: string) => `https://feeds.feedburner.com/rsscna/${feed}`;
const TOPICS: Record<string, string[]> = {
  // CNA has no headline feed; "綜合" is the latest stories across its main categories.
  top: ["politics", "intworld", "finance", "technology", "social", "mainland", "lifehealth"].map(CNA),
  business: [CNA("finance")],
  world: [CNA("intworld")],
  tech: [CNA("technology")],
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

async function feed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`news ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const pub = tag(item, "pubDate");
    return { title: decode(tag(item, "title") ?? ""), source: "中央社", link: decode(tag(item, "link") ?? ""), published: pub ? Date.parse(pub) : null };
  });
}

export function news(topic: string): Promise<NewsItem[]> {
  const urls = TOPICS[topic] ?? TOPICS.top;
  return cached(`news:${topic}`, 300, async () => {
    const settled = await Promise.allSettled(urls.map(feed));
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    const seen = new Set<string>();
    return ok
      .flat()
      .filter((n) => n.link && !seen.has(n.link) && seen.add(n.link))
      .sort((a, b) => (b.published ?? 0) - (a.published ?? 0))
      .slice(0, 30);
  });
}
