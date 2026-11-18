import type { EventRow, PersonRow, TeamRow } from '../database';
import type { Attendance } from '../api';
import type { Card } from '../model';

// Entirely fictional fixtures. Never derived from production records.
export const events: EventRow[] = [
  { id: 'demo-spring', name: 'サンプル・春の探索', fiscal_year: 2026, start_date: '2026-04-01', end_date: null, schedule_note: '架空のデモゲーム', status: 'completed', theme: '探索' },
  { id: 'demo-autumn', name: 'サンプル・秋の冒険', fiscal_year: 2025, start_date: '2025-10-01', end_date: null, schedule_note: '架空のデモゲーム', status: 'completed', theme: '冒険' },
];
export const people: PersonRow[] = [
  { id: 'demo-person-1', display_name: 'サンプル参加者A', code_name: 'あお', joined_year: 2025 },
  { id: 'demo-person-2', display_name: 'サンプル参加者B', code_name: 'そら', joined_year: 2026 },
  { id: 'demo-person-3', display_name: 'サンプル進行役', code_name: null, joined_year: null },
];
export const teams: TeamRow[] = events.flatMap(event => [
  { id: event.id + '-team-1', event_id: event.id, display_name: 'サンプル青組', rank_value: 1, rank_note: null, final_score: 120 },
  { id: event.id + '-team-2', event_id: event.id, display_name: 'サンプル空組', rank_value: 2, rank_note: null, final_score: 90 },
]);
const types = ['attack', 'guard', 'quick', 'spell', 'special', 'other'];
export const cards: Card[] = events.flatMap(event => Array.from({ length: 30 }, (_, index) => ({
  id: `${event.id}-card-${index + 1}`, event_id: event.id, name: `サンプルカード${index + 1}`,
  source_card_id: `C${index + 1}`, source_type: 'demo', card_type: types[index % types.length],
  rank: ['ss', 's', 'a', 'b', 'c', 'd'][index % 6], effect_text: '表示確認用の架空の効果です。',
  flavor_text: 'このカードは実際のゲームには存在しません。', publication_status: 'published',
  created_at: `${event.fiscal_year}-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z`,
  imageUrl: '', originalImageUrl: '',
})));
export const attendance: Attendance[] = events.flatMap(event => people.map((person, index) => ({
  id: `${event.id}-${person.id}`, person_id: person.id, event_id: event.id,
  team_id: index < 2 ? `${event.id}-team-${index + 1}` : null,
  role_id: null, kind: index === 2 ? 'master' : 'player', name_at_event: person.display_name,
  status: 'attended', person, team: index < 2 ? teams.find(team => team.id === `${event.id}-team-${index + 1}`) : undefined,
  roleLabel: index === 2 ? 'マスター' : '参加者',
})));
