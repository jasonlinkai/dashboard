// Any card can open its own page of the settings (the gear next to its title); App listens.

export type ContentSection = "weather" | "markets" | "bus" | "trains" | "news";

const EVENT = "open-settings";

export const openSettings = (section: ContentSection) => window.dispatchEvent(new CustomEvent<ContentSection>(EVENT, { detail: section }));

export function onOpenSettings(handler: (section: ContentSection) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ContentSection>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
