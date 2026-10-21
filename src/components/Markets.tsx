import { type Instrument, QUOTE_LAG_MIN, REFRESH_SEC, STALE_AFTER_SEC, links } from "../config";
import { instrumentOf, useSettings } from "../settings";
import type React from "react";
import { clock, clockDay, fmt, moveClass, signed } from "../format";
import { getBatched, moveTo, usePolling, useReorder } from "../hooks";
import type { Quote } from "../shared";
import { Flip } from "./Flip";
import { Section } from "./Section";
import { SkeletonBar } from "./Skeleton";

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
  if (q.marketOpen === false) return <span className="muted tiny">收盤 {clockDay(q.marketTime)}</span>;
  if (q.marketOpen && Date.now() - q.marketTime > LAG_MS + feedDelayMin * 60_000) {
    return <span className="error tiny">⚠ 停在 {t}</span>;
  }
  return <span className="muted tiny">{feedDelayMin ? `延遲報價 ${t}` : t}</span>;
}

function Tile({ inst, quote, loading }: { inst: Instrument; quote?: Quote; loading: boolean }) {
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
  } else if (quote) {
    // Yields: the level in %, the move in basis points.
    price = `${fmt(quote.price, 3)}%`;
    if (change != null) delta = `${signed(change * 100, 1)}bp`;
  }
  return (
    <a className="tile link" data-reorder href={links.quote(inst)} target="_blank" rel="noopener noreferrer">
      <div className="tile-head">
        <span className="tile-name">{inst.name}</span>
        <span className="muted tiny">{inst.subtitle}</span>
      </div>
      {!quote && loading ? <SkeletonBar className="sk-price" /> : <Flip className="tile-price" value={price} />}
      <div className="tile-foot">
        <Flip className={`tile-delta ${cls}`} value={delta || " "} />
        <TradeTime q={quote} feedDelayMin={inst.feedDelayMin} />
      </div>
      <Sparkline points={quote?.points ?? []} baseline={quote?.previousClose ?? null} className={cls} />
    </a>
  );
}

export function Markets() {
  const { settings, setSettings } = useSettings();
  const items = settings.markets.map(instrumentOf);
  const tilesRef = useReorder<HTMLDivElement>((from, to) => setSettings({ ...settings, markets: moveTo(settings.markets, from, to) }));
  const symbols = items.map((i) => i.symbol).join(",");
  const state = usePolling(() => getBatched<Quote[]>("/api/quotes", "symbols", symbols.split(",")), REFRESH_SEC.quotes, [symbols]);
  const bySymbol = new Map(state.data?.map((q) => [q.symbol, q]));
  const n = items.length;
  return (
    <Section
      title="市場行情"
      edit="markets"
      className="markets"
      state={state}
      maxAgeSec={STALE_AFTER_SEC.quotes}
      source={
        <>
          <a href="https://finance.yahoo.com/" target="_blank" rel="noopener noreferrer">
            Yahoo Finance
          </a>
          （非官方介面，僅供參考）
        </>
      }
    >
      <div
        className="tiles"
        ref={tilesRef}
        style={
          // A wide row is laid out for at least three tiles, so one or two don't stretch across it.
          { "--tile-cols": Math.min(Math.max(n, 3), 6), "--tile-rows-2": Math.ceil(n / 2), "--tile-rows-3": Math.ceil(n / 3) } as React.CSSProperties
        }
      >
        {items.map((inst) => (
          <Tile key={inst.symbol} inst={inst} quote={bySymbol.get(inst.symbol)} loading={state.loading && !state.error} />
        ))}
      </div>
    </Section>
  );
}
