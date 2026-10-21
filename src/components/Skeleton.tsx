// Grey placeholder shapes shown while a card's data is on its way, so a tap (e.g. another news
// topic) visibly does something and the layout doesn't jump when the data arrives.

/** List items (to put inside an existing list): a long and a short bar each, like a title over a caption. */
export function SkeletonItems({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={`sk${i}`} className="sk-item" aria-hidden>
          <span className="sk" style={{ width: `${88 - ((i * 17) % 30)}%` }} />
          <span className="sk sk-sub" style={{ width: `${30 + ((i * 11) % 20)}%` }} />
        </li>
      ))}
    </>
  );
}

/** A standalone list of placeholder rows. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <ol className="sk-rows" aria-busy="true" aria-label="載入中">
      <SkeletonItems rows={rows} />
    </ol>
  );
}

/** One bar, e.g. where a price or an arrival time will go. */
export function SkeletonBar({ className = "" }: { className?: string }) {
  return <span className={`sk ${className}`} aria-hidden />;
}

/** Stops of a bus route (inside `.bus-stops`): tick box, arrival time, stop name. */
export function SkeletonStops({ rows = 12 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={`sk${i}`} aria-hidden>
          <span className="sk sk-box" />
          <span className="sk sk-eta-wide" />
          <span className="sk" style={{ width: `${30 + ((i * 13) % 35)}%` }} />
        </li>
      ))}
    </>
  );
}

/** Car parks (inside `.pk-lots`): a name line over a details line. */
export function SkeletonLots({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={`sk${i}`} className="pk-lot sk-lot" aria-hidden>
          <span className="sk" style={{ width: `${55 + ((i * 17) % 30)}%` }} />
          <span className="sk sk-sub" style={{ width: `${35 + ((i * 11) % 25)}%` }} />
          <span className="sk sk-sub" style={{ width: `${45 + ((i * 7) % 20)}%` }} />
        </li>
      ))}
    </>
  );
}

/** Choices in a settings list (inside `.pick-list`), e.g. bus routes or stops. */
export function SkeletonPicks({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <li key={`sk${i}`} className="sk-pick" aria-hidden>
          <span className="sk sk-chip" />
          <span className="sk" style={{ width: `${30 + ((i * 13) % 40)}%` }} />
        </li>
      ))}
    </>
  );
}
