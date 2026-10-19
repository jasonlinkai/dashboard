import { INSTRUMENTS, type Instrument, QUOTE_LAG_MIN, REFRESH_SEC, STALE_AFTER_SEC, links } from "../config";
import { clock, fmt, moveClass, signed } from "../format";
import { getJSON, usePolling } from "../hooks";
import type { Quote } from "../shared";
import { Section } from "./Section";

function Sparkline({ points, baseline, className }: { points: number[]; baseline: number | null; className: string }) {
  if (points.length < 2) return <svg className="spark" />;
  const values = baseline == null ? points : [...points, baseline];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const y = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(2)},${y(p).toFixed(2)}`).join("");
  return (
    <svg className={`spark ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      {baseline != null && <line x1="0" x2={w} y1={y(baseline)} y2={y(baseline)} className="spark-base" />}
      <path d={d} />
    </svg>
  );
}

// While a market is open, no trade for this long means the feed is lagging, not that it's quiet.
const LAG_MS = QUOTE_LAG_MIN * 60_000;

/**
 * Last-trade time, marked 收盤 when the session is over. A source with a known fixed delay is
 * labelled 延遲報價; beyond that delay (plus LAG_MS) an open market's feed counts as stuck.
 */
function TradeTime({ q, feedDelayMin = 0 }: { q?: Quote; feedDelayMin?: number }) {
  if (!q) return null;
  const t = clock(q.marketTime);
  if (q.marketOpen === false) return <span className="muted tiny">收盤 {t}</span>;
  if (q.marketOpen && Date.now() - q.marketTime > LAG_MS + feedDelayMin * 60_000) {
    return <span className="error tiny">⚠ 停在 {t}</span>;
  }
  return <span className="muted tiny">{feedDelayMin ? `延遲報價 ${t}` : t}</span>;
}

function Tile({ inst, quote }: { inst: Instrument; quote?: Quote }) {
  const change = quote?.previousClose != null ? quote.price - quote.previousClose : null;
  const cls = moveClass(change);
  let price = "—";
  let delta = "";
  if (quote && inst.format.kind === "price") {
    const { decimals, prefix = "" } = inst.format;
    price = prefix + fmt(quote.price, decimals);
    if (change != null && quote.previousClose) {
      delta = `${signed(change, decimals)}  ${signed((change / quote.previousClose) * 100, 2)}%`;
    }
  }
  return (
    <a className="tile link" href={links.quote(inst)} target="_blank" rel="noopener noreferrer">
      <div className="tile-head">
        <span className="tile-name">{inst.name}</span>
        <span className="muted tiny">{inst.subtitle}</span>
      </div>
      <div className="tile-price">{price}</div>
      <div className="tile-foot">
        <span className={`tile-delta ${cls}`}>{delta || " "}</span>
        <TradeTime q={quote} feedDelayMin={inst.feedDelayMin} />
      </div>
      <Sparkline points={quote?.points ?? []} baseline={quote?.previousClose ?? null} className={cls} />
    </a>
  );
}

/** All treasury yields share one tile so the market row fits on one line on an iPad in landscape. */
function YieldTile({ items, quotes }: { items: Instrument[]; quotes: Map<string, Quote> }) {
  const latest = items.map((i) => quotes.get(i.symbol)).reduce<Quote | undefined>(
    (a, q) => (q && (!a || q.marketTime > a.marketTime) ? q : a),
    undefined,
  );
  return (
    <div className="tile">
      <div className="tile-head">
        <span className="tile-name">美債殖利率</span>
        <TradeTime q={latest} feedDelayMin={Math.max(0, ...items.map((i) => i.feedDelayMin ?? 0))} />
      </div>
      <div className="yields">
        {items.map((inst) => {
          const q = quotes.get(inst.symbol);
          const change = q?.previousClose != null ? q.price - q.previousClose : null;
          return (
            <a key={inst.symbol} className="yield-row link" href={links.quote(inst)} target="_blank" rel="noopener noreferrer">
              <span className="muted">{inst.name.replace("美債", "").trim()}</span>
              <span className="num">{q ? `${fmt(q.price, 3)}%` : "—"}</span>
              <span className={`num small ${moveClass(change)}`}>{change != null ? `${signed(change * 100, 1)}bp` : ""}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

export function Markets() {
  const symbols = INSTRUMENTS.map((i) => i.symbol).join(",");
  const state = usePolling(() => getJSON<Quote[]>(`/api/quotes?symbols=${encodeURIComponent(symbols)}`), REFRESH_SEC.quotes);
  const bySymbol = new Map(state.data?.map((q) => [q.symbol, q]));
  const prices = INSTRUMENTS.filter((i) => i.format.kind !== "yield");
  const yields = INSTRUMENTS.filter((i) => i.format.kind === "yield");
  return (
    <Section title="市場行情" className="markets" state={state} maxAgeSec={STALE_AFTER_SEC.quotes}>
      <div className="tiles">
        {prices.map((inst) => (
          <Tile key={inst.symbol} inst={inst} quote={bySymbol.get(inst.symbol)} />
        ))}
        {yields.length > 0 && <YieldTile items={yields} quotes={bySymbol} />}
      </div>
    </Section>
  );
}
