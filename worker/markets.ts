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

// Several Taiwanese outlets' RSS / Atom feeds, mixed so no single newsroom sets the agenda.
// All of these were checked to answer requests from Cloudflare's network (Google News, 中時,
// 風傳媒 and 關鍵評論 don't; 聯合新聞網's news feeds come back empty), and each item shows its outlet.
interface Feed {
  source: string;
  url: string;
}
const CNA = (feed: string): Feed => ({ source: "中央社", url: `https://feeds.feedburner.com/rsscna/${feed}` });
const LTN = (feed: string): Feed => ({ source: "自由時報", url: `https://news.ltn.com.tw/rss/${feed}.xml` });
const feedOf = (source: string, url: string): Feed => ({ source, url });
// Foreign outlets are shown as published (德國之聲 in simplified Chinese, the rest in English).
const BBC_ZH = feedOf("BBC 中文", "https://feeds.bbci.co.uk/zhongwen/trad/rss.xml");
const DW_ZH = feedOf("德國之聲", "https://rss.dw.com/xml/rss-chi-all");
const TOPICS: Record<string, Feed[]> = {
  top: [
    CNA("politics"),
    CNA("social"),
    CNA("lifehealth"),
    LTN("all"),
    feedOf("ETtoday", "https://feeds.feedburner.com/ettoday/realtime"),
    feedOf("公視", "https://news.pts.org.tw/xml/newsfeed.xml"),
    feedOf("新頭殼", "https://newtalk.tw/rss/all"),
    BBC_ZH,
    DW_ZH,
  ],
  business: [
    CNA("finance"),
    LTN("business"),
    feedOf("經濟日報", "https://money.udn.com/rssfeed/news/1001/5591?ch=money"),
    feedOf("ETtoday", "https://feeds.feedburner.com/ettoday/finance"),
    feedOf("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
  ],
  world: [
    CNA("intworld"),
    LTN("world"),
    BBC_ZH,
    DW_ZH,
    feedOf("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
  ],
  tech: [
    CNA("technology"),
    feedOf("iThome", "https://www.ithome.com.tw/rss"),
    feedOf("科技新報", "https://technews.tw/feed/"),
    feedOf("INSIDE", "https://www.inside.com.tw/feed/rss"),
    feedOf("TechCrunch", "https://techcrunch.com/feed/"),
  ],
};
// A busy feed (some list 100 items) would otherwise fill the whole list by itself.
const PER_SOURCE = 8;
// Slow feeds would otherwise put day-old stories near the top once outlets take turns.
const MAX_AGE_MS = 36 * 3600_000;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];

async function feed({ source, url }: Feed): Promise<NewsItem[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`news ${res.status}`);
  const xml = await res.text();
  // RSS <item> or Atom <entry>; links as <link>url</link> or <link href="url"/>.
  return [...xml.matchAll(/<(item|entry)[\s>]([\s\S]*?)<\/\1>/g)]
    .map(([, , item]): NewsItem => {
      const pub = tag(item, "pubDate") ?? tag(item, "dc:date") ?? tag(item, "published") ?? tag(item, "updated");
      const link = decode(tag(item, "link") ?? item.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "");
      const time = pub ? Date.parse(decode(pub).replace(/,(?=\d)/, ", ")) : NaN;
      return { title: decode(tag(item, "title") ?? ""), source, link, published: Number.isNaN(time) ? null : time };
    })
    .filter((n) => n.title && n.link);
}

// Outlets often run the same wire story word for word; compare titles without spaces/punctuation.
const titleKey = (t: string) => t.replace(/[\s\p{P}\p{S}]/gu, "");

export function news(topic: string): Promise<NewsItem[]> {
  const feeds = TOPICS[topic] ?? TOPICS.top;
  return cached(`news:${topic}`, 300, async () => {
    const settled = await Promise.allSettled(feeds.map(feed));
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    const seen = new Set<string>();
    const perSource = new Map<string, number>();
    const byTime = (a: NewsItem, b: NewsItem) => (b.published ?? 0) - (a.published ?? 0);
    // Rank each story within its outlet, then list round by round (every outlet's newest, then
    // every outlet's second newest …), newest first within a round, so outlets alternate
    // instead of whoever publishes most often filling the top.
    const ranked = ok
      .flat()
      .filter((n) => n.published == null || Date.now() - n.published < MAX_AGE_MS)
      .sort(byTime)
      .filter((n) => {
        const key = titleKey(n.title);
        if (seen.has(n.link) || seen.has(key)) return false;
        seen.add(n.link).add(key);
        return true;
      })
      .map((n) => {
        const rank = perSource.get(n.source) ?? 0;
        perSource.set(n.source, rank + 1);
        return { n, rank };
      })
      .filter(({ rank }) => rank < PER_SOURCE);
    return ranked
      .sort((a, b) => a.rank - b.rank || byTime(a.n, b.n))
      .map(({ n }) => n)
      .slice(0, 40);
  });
}
