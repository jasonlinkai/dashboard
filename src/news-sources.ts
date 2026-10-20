// News sources the dashboard can use, shared by the Worker (which fetches them) and the settings
// screen (which lists them). Every feed here was checked to answer requests from Cloudflare's
// network; imported settings may only name sources by these ids, never by URL.

export const TOPICS = [
  ["top", "綜合"],
  ["politics", "政治"],
  ["business", "財經"],
  ["world", "國際"],
  ["china", "兩岸"],
  ["society", "社會"],
  ["life", "生活"],
  ["health", "健康"],
  ["tech", "科技"],
  ["sports", "運動"],
  ["entertainment", "娛樂"],
] as const;
export type Topic = (typeof TOPICS)[number][0];

export interface FeedSpec {
  url: string;
  /** Google News sitemap instead of RSS: keep only these sections (first path segment of the link). */
  sections?: string[];
}

export interface NewsSource {
  id: string;
  name: string;
  /** Shown in settings: language / script when it isn't traditional Chinese. */
  note?: string;
  feeds: Partial<Record<Topic, FeedSpec[]>>;
}

const cna = (feed: string): FeedSpec => ({ url: `https://feeds.feedburner.com/rsscna/${feed}` });
const ltn = (feed: string): FeedSpec => ({ url: `https://news.ltn.com.tw/rss/${feed}.xml` });
// TVBS has no RSS; its Google News sitemap (last ~2 days, every section) is the next best thing.
const tvbs = (...sections: string[]): FeedSpec => ({ url: "https://news.tvbs.com.tw/sitemap/news-sitemap", sections });
const one = (url: string): FeedSpec[] => [{ url }];

export const NEWS_SOURCES: NewsSource[] = [
  {
    id: "cna",
    name: "中央社",
    feeds: {
      top: [cna("politics"), cna("social"), cna("lifehealth")],
      politics: [cna("politics")],
      business: [cna("finance")],
      world: [cna("intworld")],
      china: [cna("mainland")],
      society: [cna("social")],
      life: [cna("lifehealth")],
      tech: [cna("technology")],
      sports: [cna("sport")],
      entertainment: [cna("stars")],
    },
  },
  {
    id: "tvbs",
    name: "TVBS",
    feeds: {
      top: [tvbs("politics", "local", "life", "world", "china", "money")],
      politics: [tvbs("politics")],
      business: [tvbs("money")],
      world: [tvbs("world", "china")],
      china: [tvbs("china")],
      society: [tvbs("local")],
      life: [tvbs("life")],
      health: [tvbs("health")],
      tech: [tvbs("tech")],
      sports: [tvbs("sports")],
      entertainment: [tvbs("entertainment")],
    },
  },
  {
    id: "ettoday",
    name: "ETtoday",
    feeds: {
      top: one("https://feeds.feedburner.com/ettoday/realtime"),
      business: one("https://feeds.feedburner.com/ettoday/finance"),
      china: one("https://feeds.feedburner.com/ettoday/china"),
      society: one("https://feeds.feedburner.com/ettoday/society"),
      life: one("https://feeds.feedburner.com/ettoday/lifestyle"),
      health: one("https://feeds.feedburner.com/ettoday/health"),
      sports: one("https://feeds.feedburner.com/ettoday/sport"),
      entertainment: one("https://feeds.feedburner.com/ettoday/star"),
    },
  },
  {
    id: "ltn",
    name: "自由時報",
    feeds: {
      top: [ltn("all")],
      politics: [ltn("politics")],
      business: [ltn("business")],
      world: [ltn("world")],
      society: [ltn("society")],
      life: [ltn("life")],
      sports: [ltn("sports")],
      entertainment: [ltn("entertainment")],
    },
  },
  { id: "pts", name: "公視", feeds: { top: one("https://news.pts.org.tw/xml/newsfeed.xml") } },
  { id: "newtalk", name: "新頭殼", feeds: { top: one("https://newtalk.tw/rss/all") } },
  { id: "udn-money", name: "經濟日報", feeds: { business: one("https://money.udn.com/rssfeed/news/1001/5591?ch=money") } },
  { id: "ithome", name: "iThome", feeds: { tech: one("https://www.ithome.com.tw/rss") } },
  { id: "technews", name: "科技新報", feeds: { tech: one("https://technews.tw/feed/") } },
  { id: "inside", name: "INSIDE", feeds: { tech: one("https://www.inside.com.tw/feed/rss") } },
  {
    id: "bbc-zh",
    name: "BBC 中文",
    feeds: { top: one("https://feeds.bbci.co.uk/zhongwen/trad/rss.xml"), world: one("https://feeds.bbci.co.uk/zhongwen/trad/rss.xml") },
  },
  {
    id: "nyt-zh",
    name: "紐約時報中文",
    feeds: { top: one("https://cn.nytimes.com/rss/zh-hant/"), world: one("https://cn.nytimes.com/rss/zh-hant/") },
  },
  { id: "rfi-zh", name: "法廣 RFI", feeds: { world: one("https://www.rfi.fr/tw/rss") } },
  {
    id: "dw-zh",
    name: "德國之聲",
    note: "簡體",
    feeds: { top: one("https://rss.dw.com/xml/rss-chi-all"), world: one("https://rss.dw.com/xml/rss-chi-all") },
  },
  {
    id: "voa-zh",
    name: "美國之音",
    note: "簡體",
    feeds: { top: one("https://www.voachinese.com/api/"), world: one("https://www.voachinese.com/api/") },
  },
  { id: "rfa-zh", name: "自由亞洲", note: "簡體", feeds: { world: one("https://www.rfa.org/mandarin/RSS") } },
  { id: "kyodo-zh", name: "共同社", note: "簡體", feeds: { world: one("https://china.kyodonews.net/rss/news.xml") } },
  { id: "yna-zh", name: "韓聯社", note: "簡體", feeds: { world: one("https://cn.yna.co.kr/RSS/news.xml") } },
  { id: "ft-zh", name: "FT 中文網", note: "簡體", feeds: { business: one("https://www.ftchinese.com/rss/news") } },
  { id: "aljazeera", name: "Al Jazeera", note: "英文", feeds: { world: one("https://www.aljazeera.com/xml/rss/all.xml") } },
  { id: "bbc-en", name: "BBC News", note: "英文", feeds: { world: one("https://feeds.bbci.co.uk/news/world/rss.xml") } },
  { id: "guardian", name: "The Guardian", note: "英文", feeds: { world: one("https://www.theguardian.com/world/rss") } },
  { id: "nyt-en", name: "New York Times", note: "英文", feeds: { world: one("https://rss.nytimes.com/services/xml/rss/nyt/World.xml") } },
  { id: "npr", name: "NPR", note: "英文", feeds: { world: one("https://feeds.npr.org/1004/rss.xml") } },
  { id: "cnbc", name: "CNBC", note: "英文", feeds: { business: one("https://www.cnbc.com/id/100003114/device/rss/rss.html") } },
  { id: "wsj", name: "WSJ", note: "英文", feeds: { business: one("https://feeds.content.dowjones.io/public/rss/RSSMarketsMain") } },
  { id: "marketwatch", name: "MarketWatch", note: "英文", feeds: { business: one("https://feeds.content.dowjones.io/public/rss/mw_topstories") } },
  { id: "ft", name: "Financial Times", note: "英文", feeds: { business: one("https://www.ft.com/world?format=rss") } },
  { id: "techcrunch", name: "TechCrunch", note: "英文", feeds: { tech: one("https://techcrunch.com/feed/") } },
  { id: "arstechnica", name: "Ars Technica", note: "英文", feeds: { tech: one("https://feeds.arstechnica.com/arstechnica/index") } },
  { id: "verge", name: "The Verge", note: "英文", feeds: { tech: one("https://www.theverge.com/rss/index.xml") } },
];

export const NEWS_BY_ID = new Map(NEWS_SOURCES.map((s) => [s.id, s]));

/** Sources that publish in this topic, in catalog order. */
export const sourcesFor = (topic: Topic) => NEWS_SOURCES.filter((s) => s.feeds[topic]?.length);

export const MAX_NEWS_SOURCES = 12;

/** Default outlets per topic, in priority order (no 自由時報 by request; it can be added in settings). */
export const DEFAULT_NEWS: Record<Topic, string[]> = {
  top: ["cna", "tvbs", "ettoday", "pts", "newtalk", "bbc-zh", "dw-zh"],
  politics: ["cna", "tvbs"],
  business: ["cna", "tvbs", "udn-money", "ettoday", "cnbc"],
  world: ["cna", "tvbs", "bbc-zh", "dw-zh", "aljazeera"],
  china: ["cna", "tvbs", "ettoday"],
  society: ["cna", "tvbs", "ettoday"],
  life: ["cna", "tvbs", "ettoday"],
  health: ["tvbs", "ettoday"],
  tech: ["cna", "tvbs", "ithome", "technews", "inside", "techcrunch"],
  sports: ["cna", "tvbs", "ettoday"],
  entertainment: ["cna", "tvbs", "ettoday"],
};
