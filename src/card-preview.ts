import type { Card } from './model';

// Short-lived, in-memory handoff from the list to detail. It is never persisted.
const previews = new Map<string, { card: Card; at: number }>();
const sizes = new Map<string, { width: number; height: number }>();
const MAX_PREVIEWS = 120, MAX_SIZES = 400, TTL = 5 * 60 * 1000;

export function rememberCardPreview(card: Card) {
  previews.delete(card.id);
  previews.set(card.id, { card, at: Date.now() });
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
}

export function cardPreview(id: string): Card | undefined {
  const entry = previews.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.at > TTL) { previews.delete(id); return undefined; }
  return entry.card;
}

export function rememberImageSize(key: string, width: number, height: number) {
  if (!key || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  sizes.delete(key);
  sizes.set(key, { width, height });
  while (sizes.size > MAX_SIZES) sizes.delete(sizes.keys().next().value!);
}

export function imageSize(key: string) { return sizes.get(key); }
