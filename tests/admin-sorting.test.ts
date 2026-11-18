import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSheetValues, recordSortKind, sortSheetRows } from '../src/admin/sorting.ts';
import { compareRecordCards, recordSortValues } from '../src/admin/record-sort-values.ts';
import { emptyStore, sortedDirectory, type Directory } from '../src/admin/model.ts';
import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../src/database.ts';
const game: EventRow = { id: 'game', name: 'ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
const person = (id: string, name: string, year: number | null): PersonRow => ({ id, display_name: name, joined_year: year, code_name: null });
const relation = (id: string, person_id: string, event_id: string): ParticipationRow => ({ id, person_id, event_id, team_id: null, role_id: null, kind: 'participant', name_at_event: null, status: 'attended' });

test('numeric years/scores and dates sort semantically, with empty cells last in either direction', () => {
  assert.ok(compareSheetValues('2', '10', 'ASC', 'number') < 0);
  assert.ok(compareSheetValues('-3', '1.5', 'DESC', 'number') > 0);
  assert.ok(compareSheetValues('2026/02/01', '2026-10-01', 'ASC', 'date') < 0);
  for (const direction of ['ASC', 'DESC'] as const) {
    assert.equal(compareSheetValues('', '2026', direction, 'number'), 1);
    assert.equal(compareSheetValues(null, 'あ', direction), 1);
    assert.equal(compareSheetValues(' ', undefined, direction), 0);
  }
});
test('rank DESC means strongest first; type and kana sorting match the public card order', () => {
  assert.ok(compareSheetValues('SS', 'D', 'DESC', 'rank') < 0);
  assert.ok(compareSheetValues('S', 'legacy', 'DESC', 'rank') < 0);
  assert.ok(compareSheetValues('quick', 'spell', 'ASC', 'type') < 0);
  assert.equal(compareSheetValues('ｱ', 'あ', 'ASC'), 0);
  assert.ok(compareSheetValues('か', 'が', 'ASC') < 0);
});
test('sorting covers the entire dataset with stable ID ties without mutating source rows', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ id: String(index).padStart(3, '0'), value: index === 149 ? 'あ' : 'い' }));
  const sorted = sortSheetRows(rows, [{ columnKey: 'value', direction: 'ASC' }], row => row.value, () => 'text', (a, b) => a.id.localeCompare(b.id));
  assert.equal(sorted[0].id, '149'); assert.equal(sorted[1].id, '000'); assert.equal(rows[0].id, '000');
  assert.deepEqual(sortSheetRows(rows, [], row => row.value), rows);
});
test('relation and link sort values include offscreen records, local additions and removals', () => {
  const people = [person('visible', 'い', 2025), person('offscreen', 'あ', 2026)];
  const directory: Directory = { cards: [], people, games: [game, { ...game, id: 'other', name: 'あのゲーム' }], masters: [] };
  const store = emptyStore();
  store.relations.local = relation('local', 'offscreen', 'other');
  store.removedRelations = ['removed'];
  const x: LinkRow = { id: 'x', person_id: 'offscreen', event_id: null, kind: 'twitter', label: 'X', url: 'https://x.com/alpha' };
  const names = new Map(directory.games.map(row => [row.id, row.name]));
  const values = recordSortValues('people', people, directory, store, { links: [x], relations: [relation('visible-game', 'visible', 'game'), relation('removed', 'offscreen', 'game')] }, names);
  assert.equal(values.get('offscreen')?.event_ids, 'あのゲーム');
  assert.equal(values.get('offscreen')?.x, x.url);
  const sorted = sortSheetRows(people, [{ columnKey: 'event_ids', direction: 'ASC' }], (row, key) => values.get(row.id)?.[key], recordSortKind);
  assert.deepEqual(sorted.map(row => row.id), ['offscreen', 'visible']);
});
test('admin default card order prioritizes display ID while explicit rank and name presets keep their priorities', () => {
  const card = (id: string, rank: string, card_type: string, name: string) => ({ id, name, rank, card_type, event_id: game.id, source_card_id: id, publication_status: 'published' });
  const directory: Directory = { people: [], games: [game], masters: [], cards: [card('1', 'A', 'attack', 'あ'), card('2', 'S', 'spell', 'あ'), card('3', 'S', 'quick', 'い'), card('4', 'S', 'attack', 'い'), card('5', 'S', 'attack', 'あ')] };
  assert.deepEqual(sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'default', []).map(row => row.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'rank', []).map(row => row.id), ['5', '4', '3', '2', '1']);
  assert.deepEqual(sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'name', []).map(row => row.id), ['5', '2', '1', '4', '3']);
});

test('admin game order normalizes human IDs and breaks equal-ID ties by rank, type and Japanese name', () => {
  const card = (id: string, source_card_id: string | null, rank: string, card_type: string, name: string) => ({ id, source_card_id, name, rank, card_type, event_id: game.id, publication_status: 'published' });
  const directory: Directory = { people: [], masters: [], games: [game], cards: [
    card('uuid-a', 'C10', 'SS', 'attack', 'あ'),
    card('uuid-z', 'C2', 'D', 'attack', 'あ'),
    card('tie-i', 'C2', 'SS', 'attack', 'い'),
    card('tie-a', 'Ｃ２', 'SS', 'attack', 'あ'),
    card('tie-guard', 'C2', 'SS', 'guard', 'あ'),
    card('tie-quick', 'C2', 'SS', 'quick', 'あ'),
    card('tie-spell', 'C2', 'SS', 'spell', 'あ'),
    card('blank', null, 'SS', 'attack', 'あ'),
  ] };
  assert.deepEqual(sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'default', []).map(row => row.id), ['tie-a', 'tie-i', 'tie-guard', 'tie-quick', 'tie-spell', 'uuid-z', 'uuid-a', 'blank']);
});
test('a single rank header sort breaks cross-game ties by card type then name, including staged edits', () => {
  const card = (id: string, event_id: string, card_type: string, name: string) => ({ id, event_id, card_type, name, rank: 'S', source_card_id: id, publication_status: 'published' });
  const newer = { ...game, id: 'newer', fiscal_year: 2027 };
  const directory: Directory = { people: [], masters: [], games: [newer, game], cards: [card('new-quick', newer.id, 'quick', 'い'), card('old-guard', game.id, 'guard', 'い'), card('old-attack', game.id, 'attack', 'う'), card('new-guard', newer.id, 'guard', 'あ')] };
  const defaults = sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'default', []) as typeof directory.cards;
  assert.deepEqual(defaults.map(row => row.id), ['new-guard', 'new-quick', 'old-attack', 'old-guard']);
  const columns = [{ columnKey: 'rank', direction: 'DESC' as const }];
  const sorted = sortSheetRows(defaults, columns, row => row.rank, recordSortKind, (a, b) => compareRecordCards(a, b));
  assert.deepEqual(sorted.map(row => row.id), ['old-attack', 'new-guard', 'old-guard', 'new-quick']);
  const staged = { 'new-quick': { name: 'あ', card_type: 'attack', rank: 'S' } };
  const withEdits = sortSheetRows(defaults, columns, row => row.rank, recordSortKind, (a, b) => compareRecordCards(a, b, staged));
  assert.deepEqual(withEdits.map(row => row.id), ['new-quick', 'old-attack', 'new-guard', 'old-guard']);
});
