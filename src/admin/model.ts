import type { CardRow, EventRow, PersonRow, ParticipationRow, LinkRow, TeamRow } from '../database';
import type { ChangeEntry, WorkHold } from './history';
import { compareCards, compareCardsInGame, orderGames, safeExternalUrl, normaliseSearch } from '../model';
import { externalLinkIcon } from '../external-link';
import { changedParticipations } from './participation-edits';

export type Sheet = 'cards' | 'people' | 'games';
export const cardTypes = ['attack', 'guard', 'quick', 'spell', 'other'] as const;
export type CardSummary = Pick<CardRow, 'id' | 'event_id' | 'name' | 'source_card_id' | 'rank' | 'publication_status'> & Partial<Pick<CardRow, 'card_type'>>;
export type PreviewCard = CardRow & { imageUrl: string };
export type Directory = { cards: CardSummary[]; people: PersonRow[]; games: EventRow[]; masters: ParticipationRow[]; teams?: TeamRow[] };
export type PreviewStore = {
  version: 1; revision: number; history: ChangeEntry[]; cards: Record<string, PreviewCard>; people: Record<string, PersonRow>; games: Record<string, EventRow>; teams: Record<string, TeamRow>;
  relations: Record<string, ParticipationRow>; removedRelations: string[];
  links: Record<string, LinkRow>; removedLinks: string[]; images: Record<string, Blob>; gameImageUrls: Record<string, string>; holds: Record<string, WorkHold>; savedAt: string | null;
};
export const emptyStore = (): PreviewStore => ({ version: 1, revision: 0, history: [], cards: {}, people: {}, games: {}, teams: {}, relations: {}, removedRelations: [], links: {}, removedLinks: [], images: {}, gameImageUrls: {}, holds: {}, savedAt: null });
export const sheetInfo = { cards: { name: 'カード', singular: 'カード', description: 'ゲームごとのカードと、その効果を整理。' }, people: { name: '人', singular: '人', description: '人物のリンクと参加ゲームを、ひとつの場所で。' }, games: { name: 'ゲーム', singular: 'ゲーム', description: 'ホームに並ぶゲームと、開催情報を整理。' } };
export function mergeRows<T extends { id: string }>(rows: T[], changes: Record<string, T>, removed: string[] = []): T[] {
  const excluded = new Set(removed);
  const result = new Map(rows.filter(row => !excluded.has(row.id)).map(row => [row.id, row]));
  for (const row of Object.values(changes)) if (!excluded.has(row.id)) result.set(row.id, row);
  return [...result.values()];
}
export function scopedRelations(rows: ParticipationRow[], store: PreviewStore, key: 'person_id' | 'event_id', id: string) {
  return mergeRows(rows, store.relations, store.removedRelations).filter(row => row[key] === id);
}
export function mergeRelationEdits(store: PreviewStore, before: ParticipationRow[], after: ParticipationRow[]) {
  const afterIds = new Set(after.map(row => row.id));
  const removed = new Set(store.removedRelations);
  for (const row of before) if (!afterIds.has(row.id)) removed.add(row.id);
  for (const row of after) removed.delete(row.id);
  return { ...store, relations: { ...store.relations, ...Object.fromEntries(changedParticipations(before, after).map(row => [row.id, row])) }, removedRelations: [...removed] };
}
const linkFields: readonly (keyof LinkRow)[] = ['person_id', 'event_id', 'kind', 'label', 'url'];
export function changedLinks(before: readonly LinkRow[], after: readonly LinkRow[]): LinkRow[] {
  const originals = new Map(before.map(row => [row.id, row]));
  return after.filter(row => { const original = originals.get(row.id); return !original || linkFields.some(field => original[field] !== row[field]); });
}
export function mergeLinkEdits(store: PreviewStore, before: LinkRow[], after: LinkRow[]) {
  const ids = new Set(after.map(row => row.id));
  const removed = new Set(store.removedLinks);
  for (const row of before) if (!ids.has(row.id)) removed.add(row.id);
  for (const row of after) removed.delete(row.id);
  return { ...store, links: { ...store.links, ...Object.fromEntries(changedLinks(before, after).map(row => [row.id, row])) }, removedLinks: [...removed] };
}
export function linkCategory(link: LinkRow): 'x' | 'blog' | 'board' | 'other' {
  const canonical = safeExternalUrl(link.url);
  if (canonical) {
    const category = externalLinkIcon(link.kind, link.label, canonical, Boolean(link.event_id));
    if (category !== 'external') return category;
  }
  // Invalid historical URLs still need to appear in their editable columns.
  const description = `${link.kind} ${link.label}`;
  if (/^(x|twitter)$/i.test(link.kind.trim()) || /\b(x|twitter)\b/i.test(link.label)) return 'x';
  if (/掲示板|board|bbs/i.test(description)) return 'board';
  if (/ブログ|個人サイト|blog/i.test(description) || (link.event_id && link.kind === '公式サイト')) return 'blog';
  return 'other';
}
export function normaliseLink(value: string, kind: string) {
  const trimmed = value.trim();
  return /^(x|twitter)$/i.test(kind) && /^@?[a-z\d_]{1,15}$/i.test(trimmed) ? `https://x.com/${trimmed.replace(/^@/, '')}` : trimmed;
}
export function canonicaliseEditedLinks(links: readonly LinkRow[], before: readonly LinkRow[]): LinkRow[] {
  const originals = new Map(before.map(link => [link.id, link]));
  return links.map(link => {
    if (originals.get(link.id)?.url === link.url) return link;
    const normalised = normaliseLink(link.url, link.kind);
    // Keep invalid input for the validator to flag, and leave unchanged legacy URLs intact.
    return { ...link, url: safeExternalUrl(normalised) ?? normalised };
  });
}
export type EditorBaseline = { row: PreviewCard | PersonRow | EventRow; links: LinkRow[]; relations: ParticipationRow[] };
export function validateEditor(sheet: Sheet, row: PreviewCard | PersonRow | EventRow, links: LinkRow[], relations: ParticipationRow[], directory: Directory, baseline?: EditorBaseline): string | null {
  const name = 'display_name' in row ? row.display_name : row.name;
  if (!name.trim()) return '名前を入力してください。';
  if (sheet === 'cards' && 'event_id' in row && !directory.games.some(game => game.id === row.event_id) && !(baseline?.row && 'event_id' in baseline.row && baseline.row.event_id === row.event_id)) return '所属ゲームを選んでください。';
  if ('fiscal_year' in row && row.fiscal_year !== null && (!Number.isInteger(row.fiscal_year) || row.fiscal_year < 1900 || row.fiscal_year > 2100)) return '開催年は1900〜2100の整数で入力してください。';
  if ('joined_year' in row && row.joined_year !== null && (!Number.isInteger(row.joined_year) || row.joined_year < 1900 || row.joined_year > 2100)) return '入学年は1900〜2100の整数で入力してください。';
  if ('start_date' in row && row.start_date && row.end_date && row.start_date > row.end_date) return '終了日は開始日以降にしてください。';
  if (links.some(link => {
    const previous = baseline?.links.find(before => before.id === link.id);
    const unchanged = previous && previous.url === link.url && normaliseLink(previous.url, previous.kind) === normaliseLink(link.url, link.kind);
    return !unchanged && !safeExternalUrl(normaliseLink(link.url, link.kind));
  })) return 'リンクは http / https のURL、またはXの @ID で入力してください。';
  if (relations.some(rel => {
    const previous = baseline?.relations.find(before => before.id === rel.id);
    const unchanged = previous && previous.event_id === rel.event_id && previous.person_id === rel.person_id;
    return !unchanged && (!directory.games.some(game => game.id === rel.event_id) || !directory.people.some(person => person.id === rel.person_id));
  })) return '関連付けるゲーム・人物を選んでください。';
  return null;
}
export function sortedDirectory(directory: Directory, store: PreviewStore, sheet: Sheet, q: string, gameId: string, rank: string, sort: string, attendance: ParticipationRow[]) {
  const games = orderGames(mergeRows(directory.games, store.games)), people = mergeRows(directory.people, store.people);
  const cards = mergeRows<CardSummary>(directory.cards, store.cards);
  const gameMap = new Map(games.map(game => [game.id, game]));
  const gameOrder = new Map(games.map((game, index) => [game.id, index]));
  const needle = normaliseSearch(q), compare = new Intl.Collator('ja', { numeric: true }).compare;
  if (sheet === 'cards') return cards.filter(row => (!gameId || row.event_id === gameId) && (!rank || (row.rank ?? '').toUpperCase() === rank) && (!needle || normaliseSearch(`${row.name} ${row.source_card_id ?? ''} ${gameMap.get(row.event_id)?.name ?? ''}`).includes(needle)))
    .sort((a, b) => (sort === 'name' ? compare(a.name, b.name) : sort === 'rank' ? 0 : (gameOrder.get(a.event_id) ?? Infinity) - (gameOrder.get(b.event_id) ?? Infinity)) || (sort === 'rank' || sort === 'name' ? compareCards(a, b) : compareCardsInGame(a, b)));
  if (sheet === 'people') {
    const allowed = new Set(mergeRows(attendance, store.relations, store.removedRelations).filter(rel => rel.event_id === gameId).map(rel => rel.person_id));
    return people.filter(row => (!gameId || allowed.has(row.id)) && (!needle || normaliseSearch(`${row.display_name} ${row.code_name ?? ''} ${row.joined_year ?? ''}`).includes(needle))).sort((a, b) => (sort === 'name' ? 0 : (a.joined_year ?? Infinity) - (b.joined_year ?? Infinity)) || compare(a.display_name, b.display_name) || compare(a.id, b.id));
  }
  const matches = games.filter(game => !needle || normaliseSearch(`${game.name} ${game.fiscal_year ?? ''}`).includes(needle));
  return sort === 'name' ? matches.sort((a, b) => compare(a.name, b.name)) : matches;
}
export function period(game: EventRow) { return game.schedule_note || [game.start_date?.replaceAll('-', '/'), game.end_date?.replaceAll('-', '/')].filter(Boolean).join(' – ') || (game.fiscal_year ? `${game.fiscal_year}年` : '未設定'); }
export function changedCount(store: PreviewStore) { return Object.keys(store.cards).length + Object.keys(store.people).length + Object.keys(store.games).length + Object.keys(store.teams).length; }
