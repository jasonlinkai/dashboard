import { useRef } from "react";

/**
 * Text whose changed characters flip in like a split-flap board when the value updates.
 * Numbers are compared right-aligned (so 9.99 → 10.01 flips the right digits); unchanged
 * characters stay still, and nothing flips on the first render or when data first arrives.
 */
export function Flip({ value, className }: { value: string; className?: string }) {
  const state = useRef({ value, flipped: [] as boolean[], gen: 0 });
  if (state.current.value !== value) {
    const old = state.current.value;
    const pad = value.length - old.length;
    // The first real value replacing a placeholder (— while loading) just appears.
    const placeholder = old.trim() === "" || old === "—";
    state.current = {
      value,
      flipped: [...value].map((ch, i) => !placeholder && old[i - pad] !== ch),
      gen: state.current.gen + 1,
    };
  }
  const { flipped, gen } = state.current;
  return (
    <span className={className} aria-label={value}>
      {[...value].map((ch, i) => (
        // A new key restarts the animation for the characters that changed this time.
        <span key={flipped[i] ? `${i}-${gen}` : i} className={flipped[i] ? "flip-ch flipping" : "flip-ch"} aria-hidden>
          {ch}
        </span>
      ))}
    </span>
  );
}
