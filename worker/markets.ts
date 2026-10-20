import { DEFAULT_NEWS, type FeedSpec, NEWS_BY_ID, MAX_NEWS_SOURCES, TOPICS, type Topic } from "../src/news-sources";
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

// Several outlets' RSS / Atom feeds (catalog in src/news-sources.ts), mixed so no single newsroom
// sets the agenda; each item shows its outlet.
interface Feed extends FeedSpec {
  source: string;
}
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

async function download(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`news ${res.status}`);
  return res.text();
}

/** All stories in a Google News sitemap, each with its section (first path segment). */
function sitemap(url: string, source: string) {
  // Shared by every topic that uses it, so the ~300 KB file is fetched once per refresh.
  return cached(`sitemap:${url}`, 300, async () =>
    [...(await download(url)).matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, u]) => {
      const link = decode(tag(u, "loc") ?? "");
      const pub = tag(u, "news:publication_date");
      const time = pub ? Date.parse(pub) : NaN;
      return {
        section: link.match(/^https?:\/\/[^/]+\/([^/]+)\//)?.[1] ?? "",
        item: { title: decode(tag(u, "news:title") ?? ""), source, link, published: Number.isNaN(time) ? null : time } as NewsItem,
      };
    }),
  );
}

async function feed({ source, url, sections }: Feed): Promise<NewsItem[]> {
  if (sections) return (await sitemap(url, source)).filter((s) => sections.includes(s.section)).map((s) => s.item);
  const xml = await download(url);
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

/**
 * `sources` are catalog ids in the user's order; unknown ids, and outlets that don't cover this
 * topic, are ignored. Only catalog URLs are ever fetched.
 */
export function news(topicParam: string, sourceIds: string[]): Promise<NewsItem[]> {
  const topic: Topic = TOPICS.some(([id]) => id === topicParam) ? (topicParam as Topic) : "top";
  const ids = [...new Set(sourceIds.length ? sourceIds : DEFAULT_NEWS[topic])]
    .filter((id) => NEWS_BY_ID.get(id)?.feeds[topic]?.length)
    .slice(0, MAX_NEWS_SOURCES);
  if (!ids.length) return Promise.resolve([]);
  const feeds: Feed[] = ids.flatMap((id) => {
    const src = NEWS_BY_ID.get(id)!;
    return src.feeds[topic]!.map((f) => ({ ...f, source: src.name }));
  });
  const order = new Map(ids.map((id, i) => [NEWS_BY_ID.get(id)!.name, i]));
  return cached(`news:${topic}:${ids.join(",")}`, 300, async () => {
    const settled = await Promise.allSettled(feeds.map(feed));
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
    const seen = new Set<string>();
    const perSource = new Map<string, number>();
    const byTime = (a: NewsItem, b: NewsItem) => (b.published ?? 0) - (a.published ?? 0);
    // Rank each story within its outlet, then list round by round (every outlet's newest, then
    // every outlet's second newest …) in the user's outlet order, so outlets alternate instead of
    // whoever publishes most often filling the top.
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
      .sort((a, b) => a.rank - b.rank || (order.get(a.n.source) ?? 99) - (order.get(b.n.source) ?? 99))
      .map(({ n }) => n)
      .slice(0, 40);
  });
}
