import type { CardRow, PersonRow, EventRow, TeamRow } from './database';
export type Card = CardRow & { imageUrl: string; originalImageUrl: string };
export type CardSort = 'game' | 'number' | 'newest' | 'rank';
export type CardParams = { eventId?: string; type: string; sort: CardSort; q?: string };
export type ResultItem = { id: string; kind: 'game' | 'card' | 'person'; title: string; subtitle: string; image?: string; originalImageUrl?: string };
export const PAGE_SIZE = 24;
export const typeLabels: Record<string, string> = { attack: '攻撃', defence: '防御', defense: '防御', guard: '防御', quick: '即時', spell: '魔法', special: '特殊', other: 'その他' };
export const cardTypes = ['', 'attack', 'defence', 'quick', 'spell', 'special', 'other'];
export const typeLabel = (value: string | null) => value ? typeLabels[value] ?? value : '種類未登録';
export const rankLabel = (value: string | null) => value ? value.toUpperCase() : '未登録';
export const rankBuckets = ['ss', 's', 'a', 'b', 'c', 'd', 'unknown'] as const;
export function normaliseSearch(value: string) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja'); }
// Strip PostgREST expression delimiters and SQL LIKE wildcards from user text.
export function searchLiteral(value: string) { return normaliseSearch(value).replace(/[,().%_*"'\\:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }
export function searchClassifier(value: string) {
  const q = normaliseSearch(value);
  const type = Object.entries(typeLabels).find(([, label]) => label === q)?.[0];
  const rank = q.match(/^(?:ランク\s*)?(ss|s|a|b|c|d)$/i)?.[1].toLowerCase();
  return { q: searchLiteral(q), type, rank };
}
export function safeExternalUrl(value: string) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function personSubtitle(person: PersonRow) { return person.joined_year ? `${person.joined_year}年参加` : '参加者'; }
export function cardSubtitle(card: CardRow) { return [typeLabel(card.card_type), card.rank ? `ランク ${rankLabel(card.rank)}` : ''].filter(Boolean).join(' · '); }
export function eventTag(name: string) { return name.replace(/\d{4}/g, '').trim().slice(0, 3) || name.slice(0, 3); }
export function pageSlices(counts: number[], page: number, pageSize = PAGE_SIZE) {
  const start = page * pageSize, end = start + pageSize;
  let offset = 0;
  return counts.flatMap((count, bucket) => {
    const from = Math.max(0, start - offset), to = Math.min(count, end - offset);
    offset += count;
    return from < to ? [{ bucket, from, to: to - 1 }] : [];
  });
}

export function orderGames(events: EventRow[]): EventRow[] {
  const year=(event:EventRow)=>event.fiscal_year ?? Number(event.start_date?.slice(0,4) ?? 0);
  return [...events].sort((a,b)=>year(b)-year(a)||(b.start_date ?? '').localeCompare(a.start_date ?? '')||a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));
}
export type CardOrderRow = Pick<CardRow,'id'|'name'> & Partial<Pick<CardRow,'source_card_id'|'rank'|'card_type'>>;
export type CardDirectoryRow = Pick<CardRow,'id'|'event_id'|'source_card_id'|'name'|'rank'|'card_type'>;
const cardNameCollator = new Intl.Collator('ja', { sensitivity: 'accent', numeric: true });
const cardTypePriorities: Record<string, number> = { attack: 0, guard: 1, defence: 1, defense: 1, quick: 2, spell: 3, special: 4, other: 5 };
const normaliseCardValue = (value: string | null | undefined) => value?.normalize('NFKC').trim().toLowerCase() ?? '';
export function cardRankOrder(value: string | null | undefined) {
  const index = rankBuckets.indexOf(normaliseCardValue(value) as typeof rankBuckets[number]);
  return index < 0 ? rankBuckets.length - 1 : index;
}
export function cardTypeOrder(value: string | null | undefined) { return cardTypePriorities[normaliseCardValue(value)] ?? 6; }
export function compareCards(a: CardOrderRow, b: CardOrderRow) {
  return cardRankOrder(a.rank) - cardRankOrder(b.rank) || cardTypeOrder(a.card_type) - cardTypeOrder(b.card_type) ||
    cardNameCollator.compare(a.name.normalize('NFKC').trim(), b.name.normalize('NFKC').trim()) || a.id.localeCompare(b.id);
}
export function compareCardIds(a: string | null | undefined, b: string | null | undefined) {
  const left = a?.normalize('NFKC').trim() ?? '', right = b?.normalize('NFKC').trim() ?? '';
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return cardNameCollator.compare(left, right);
}
export function compareCardsInGame(a: CardOrderRow, b: CardOrderRow) {
  return compareCardIds(a.source_card_id, b.source_card_id) || compareCards(a, b);
}
export function orderCardDirectory(cards:CardDirectoryRow[],events:EventRow[]):CardDirectoryRow[] {
  const eventOrder=new Map(orderGames(events).map((event,index)=>[event.id,index]));
  return [...cards].sort((a,b)=>(eventOrder.get(a.event_id) ?? Number.MAX_SAFE_INTEGER)-(eventOrder.get(b.event_id) ?? Number.MAX_SAFE_INTEGER)||
    compareCardsInGame(a,b));
}

// Legacy records can use a named last place instead of a numeric rank.
export function rankedTeams(teams:TeamRow[]):TeamRow[] {
  return teams.filter(team=>team.rank_value!==null||team.rank_note?.trim()==='最下位')
    .sort((a,b)=>(a.rank_value ?? Infinity)-(b.rank_value ?? Infinity));
}

export function gameYear(event:EventRow):number|null {
  if(event.fiscal_year!==null&&Number.isFinite(event.fiscal_year))return event.fiscal_year;
  const year=event.start_date?.match(/^(\d{4})-/)?.[1];
  return year ? Number(year) : null;
}
export function gameYears(events:EventRow[]):number[] {
  return [...new Set(events.flatMap(event=>{const year=gameYear(event);return year===null ? [] : [year];}))].sort((a,b)=>b-a);
}
