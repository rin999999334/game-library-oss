import type { CardPage, SearchPage } from '../api';
import { PAGE_SIZE, cardSubtitle, compareCards, normaliseSearch, orderCardDirectory, orderGames, personSubtitle, searchClassifier, type CardParams, type ResultItem } from '../model';
import { attendance, cards, events, people, teams } from './data';

const matches = (values: unknown[], query: string) => values.some(value => normaliseSearch(String(value ?? '')).includes(query));
export async function loadEvents() { return orderGames(events); }
export async function loadCardPage(params: CardParams, page: number): Promise<CardPage> {
  const query = searchClassifier(params.q ?? '');
  const isDefence = (value: string) => ['defence', 'defense', 'guard'].includes(value);
  let rows = cards.filter(card => (!params.eventId || card.event_id === params.eventId) &&
    (!params.type || card.card_type === params.type || isDefence(params.type) && isDefence(card.card_type ?? '')) &&
    (query.type ? card.card_type === query.type || isDefence(query.type) && isDefence(card.card_type ?? '') :
      query.rank ? card.rank === query.rank : !query.q || matches([card.name, card.effect_text, card.flavor_text, card.source_card_id, events.find(event => event.id === card.event_id)?.name], query.q)));
  if (params.sort === 'game') {
    const ids = new Map(orderCardDirectory(rows, events).map((row, index) => [row.id, index]));
    rows.sort((a, b) => ids.get(a.id)! - ids.get(b.id)!);
  } else if (params.sort === 'rank') rows.sort(compareCards);
  else rows.sort((a, b) => (params.sort === 'newest' ? b.created_at.localeCompare(a.created_at) : (a.source_card_id ?? '').localeCompare(b.source_card_id ?? '')) || a.id.localeCompare(b.id));
  return { items: rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), total: rows.length };
}
export async function loadCard(id: string) {
  const card = cards.find(card => card.id === id);
  if (!card) throw new Error('カードが見つかりませんでした。');
  return card;
}
export async function loadEventDetail(id: string) {
  const event = events.find(event => event.id === id);
  if (!event) throw new Error('ゲームが見つかりませんでした。');
  return { event, teams: teams.filter(team => team.event_id === id), attendance: attendance.filter(row => row.event_id === id), links: [], preview: await loadCardPage({ eventId: id, type: '', sort: 'game' }, 0) };
}
export async function loadPerson(id: string) {
  const person = people.find(person => person.id === id);
  if (!person) throw new Error('参加者が見つかりませんでした。');
  return { person, history: attendance.filter(row => row.person_id === id).map(row => ({ ...row, event: events.find(event => event.id === row.event_id) })), names: person.code_name ? [{ person_id: id, name: person.code_name }] : [], links: [], dp: null };
}
export async function loadSearch(kind: ResultItem['kind'], value: string, page = 0): Promise<SearchPage> {
  const q = normaliseSearch(value);
  if (!q) return { items: [], total: 0 };
  let items: ResultItem[];
  if (kind === 'card') {
    const result = await loadCardPage({ type: '', sort: 'number', q: value }, page);
    return { items: result.items.map(card => ({ id: card.id, kind, title: card.name, subtitle: cardSubtitle(card) })), total: result.total };
  }
  if (kind === 'game') items = orderGames(events).filter(event => matches([event.name, event.fiscal_year, event.theme], q)).map(event => ({ id: event.id, kind, title: event.name, subtitle: event.schedule_note ?? '' }));
  else items = people.filter(person => matches([person.display_name, person.code_name, ...attendance.filter(row => row.person_id === person.id).map(row => row.team?.display_name)], q)).map(person => ({ id: person.id, kind, title: person.display_name, subtitle: personSubtitle(person) }));
  return { items: items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), total: items.length };
}
