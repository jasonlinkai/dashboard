// Any card can open its own page of the settings (the gear next to its title); App listens.

export type ContentSection = "weather" | "markets" | "bus" | "trains" | "news" | "todo";

const EVENT = "open-settings";

type Detail = { section: ContentSection; card?: string };

/** `card`: which card of the type (an extra one's id); the first card when left out. */
export const openSettings = (section: ContentSection, card?: string) =>
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { section, card } }));

export function onOpenSettings(handler: (section: ContentSection, card?: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<Detail>).detail.section, (e as CustomEvent<Detail>).detail.card);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
