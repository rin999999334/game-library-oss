import test from 'node:test';
import assert from 'node:assert/strict';
import type { EventRow, PersonRow } from '../src/database.ts';
import { emptyStore, type Directory } from '../src/admin/model.ts';
import { createBlankRecord, gamePasteBaseline, gameReferenceId, hasRecordChanges, mapPasteHeader, matchImageFiles, parseDelimited, personPasteBaseline, planRecordBulk, recordValues, RecordBulkValidationError, type RecordBaseline, type RecordCells } from '../src/admin/bulk-records.ts';
const game: EventRow = { id: 'g', name: 'HAL2026', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
const person: PersonRow = { id: 'p', display_name: '人物', code_name: '昔の名前', joined_year: 2020 };
const directory: Directory = { games: [game], people: [person], cards: [], masters: [], teams: [] };

test('100 cards are planned together, game scope preserved and blank rows excluded', () => {
  const before = new Map<string, RecordBaseline>(), edits = {} as Parameters<typeof planRecordBulk>[3];
  for (let index = 0; index < 100; index++) {
    const blank = createBlankRecord('cards', game.id, `card-${index}`); before.set(blank.row.id, blank);
    edits[blank.row.id] = { id: blank.row.id, values: { ...blank.values, source_card_id: String(index + 1), name: `カード${index + 1}`, card_type: 'attack', effect_text: '効果\n2行目' } };
  }
  const unused = createBlankRecord('cards', game.id, 'unused'); before.set(unused.row.id, unused); edits.unused = { id: unused.row.id, values: unused.values };
  const store = emptyStore(), plan = planRecordBulk('cards', store, before, edits, directory)!;
  assert.equal(plan.changedIds.length, 100);
  assert.equal(plan.next.history.length, 100);
  assert.equal(plan.next.cards['card-0'].event_id, game.id);
  assert.equal(plan.next.cards['card-0'].effect_text, '効果\n2行目');
  assert.equal(plan.next.cards['card-0'].publication_status, 'draft');
  assert.equal(plan.next.cards.unused, undefined);
  assert.deepEqual(store, emptyStore());
});
test('invalid type or duplicate source IDs abort the complete batch and preserve raw inputs', () => {
  const one = createBlankRecord('cards', game.id, 'one'), two = createBlankRecord('cards', game.id, 'two'), before = new Map([['one', one], ['two', two]]);
  const store = emptyStore(), edits = { one: { id: 'one', values: { ...one.values, name: '一', source_card_id: '001', card_type: 'attack' } }, two: { id: 'two', values: { ...two.values, name: '二', source_card_id: '001', card_type: 'quick' } } };
  assert.throws(() => planRecordBulk('cards', store, before, edits, directory), error => error instanceof RecordBulkValidationError && error.issues.some(issue => issue.field === 'source_card_id'));
  edits.two.values.card_type = 'あたっく';
  assert.throws(() => planRecordBulk('cards', store, before, edits, directory), RecordBulkValidationError);
  assert.equal(edits.two.values.card_type, 'あたっく');
  assert.deepEqual(store, emptyStore());
});
test('people mass input normalises X and preserves secondary links and team assignments', () => {
  const snapshot: RecordBaseline = { row: person, links: [
    { id: 'x1', person_id: 'p', event_id: null, kind: 'twitter', label: 'X', url: 'https://x.com/old' },
    { id: 'x2', person_id: 'p', event_id: null, kind: 'twitter', label: 'サブ', url: 'https://x.com/secondary' },
  ], relations: [{ id: 'r', person_id: 'p', event_id: 'g', kind: 'participant', status: 'attended', name_at_event: '当時名', team_id: 'team', role_id: 'role' }], values: {}, isNew: false };
  snapshot.values = recordValues('people', snapshot, new Map([[game.id, game.name]]));
  const edit = { id: 'p', values: { ...snapshot.values, display_name: '改名', x: '@new_name', joined_year: '2021' } };
  const plan = planRecordBulk('people', emptyStore(), new Map([['p', snapshot]]), { p: edit }, directory)!;
  assert.equal(plan.next.people.p.code_name, '昔の名前');
  assert.equal(plan.next.people.p.joined_year, 2021);
  assert.equal(plan.next.links.x1.url, 'https://x.com/new_name');
  assert.equal(plan.next.links.x2, undefined);
  assert.equal(snapshot.links[1].url, 'https://x.com/secondary');
  assert.deepEqual(plan.next.relations, {});
  assert.equal(snapshot.relations[0].team_id, 'team');
  assert.equal(snapshot.relations[0].name_at_event, '当時名');
});
test('invalid years and impossible dates remain strings and reject the full save', () => {
  const blank = createBlankRecord('games', '', 'game'), before = new Map([['game', blank]]), values: RecordCells = { ...blank.values, name: '新ゲーム', fiscal_year: '202a' };
  assert.throws(() => planRecordBulk('games', emptyStore(), before, { game: { id: 'game', values } }, directory), RecordBulkValidationError);
  assert.equal(values.fiscal_year, '202a'); values.fiscal_year = '2026'; values.start_date = '2026-02-30';
  assert.throws(() => planRecordBulk('games', emptyStore(), before, { game: { id: 'game', values } }, directory), RecordBulkValidationError);
});
test('changing masters only preserves ordinary participants and relation metadata', () => {
  const second: PersonRow = { ...person, id: 'p2', display_name: '別人' };
  const third: PersonRow = { ...person, id: 'p3', display_name: '参加者' };
  const baseline: RecordBaseline = { row: game, values: {}, isNew: false, links: [], relations: [
    { id: 'm', person_id: 'p', event_id: 'g', kind: 'master', status: 'attended', name_at_event: '主催時の名前', team_id: null, role_id: null },
    { id: 'r', person_id: 'p3', event_id: 'g', kind: 'participant', status: 'attended', name_at_event: '参加時', team_id: 'team', role_id: 'role' },
  ] };
  baseline.values = recordValues('games', baseline, new Map([['p', '人物'], ['p2', '別人']]));
  const plan = planRecordBulk('games', emptyStore(), new Map([['g', baseline]]), { g: { id: 'g', values: { ...baseline.values, master_ids: '別人' } } }, { ...directory, people: [person, second, third] })!;
  assert.deepEqual(plan.next.removedRelations, []);
  assert.equal(plan.next.relations.m.kind, 'participant');
  assert.equal(plan.next.relations.m.name_at_event, '主催時の名前');
  assert.equal(plan.next.relations.r, undefined);
  assert.equal(baseline.relations[1].team_id, 'team');
  assert.equal(Object.values(plan.next.relations).filter(rel => rel.kind === 'master')[0].person_id, 'p2');
});
test('promoting an existing attendee reuses its person-event participation instead of inserting a duplicate', () => {
  const participation = { id: 'existing', person_id: person.id, event_id: game.id, kind: 'participant', status: 'withdrawn', name_at_event: '当時の名前', team_id: 'team', role_id: 'participant-role' };
  const snapshot: RecordBaseline = { row: game, values: {}, isNew: false, links: [], relations: [participation] };
  snapshot.values = recordValues('games', snapshot, new Map([[person.id, person.display_name]]));
  const plan = planRecordBulk('games', emptyStore(), new Map([[game.id, snapshot]]), { [game.id]: { id: game.id, values: { ...snapshot.values, master_ids: person.display_name } } }, directory)!;
  assert.deepEqual(Object.keys(plan.next.relations), ['existing']);
  assert.deepEqual(plan.next.relations.existing, { ...participation, kind: 'master', team_id: null, role_id: null });
  assert.deepEqual(snapshot.relations, [participation]);
  assert.deepEqual(plan.next.removedRelations, []);
});
test('a game paste fallback preserves saved game data and merges complete attendance with local overrides', () => {
  const store = emptyStore(); store.games.g = { ...game, name: '下書きのゲーム名' };
  const participant = { id: 'r', person_id: person.id, event_id: game.id, kind: 'participant', status: 'attended', name_at_event: '当時の名前', team_id: 'team', role_id: 'role' };
  store.relations.r = { ...participant, name_at_event: '下書きの参加名' };
  const baseline = gamePasteBaseline(game.id, directory, store, [participant], new Map([[person.id, person.display_name]]))!;
  const plan = planRecordBulk('games', store, new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, master_ids: person.display_name } } }, directory)!;
  assert.equal(plan.next.games.g.name, '下書きのゲーム名');
  assert.deepEqual(Object.keys(plan.next.relations), ['r']);
  assert.equal(plan.next.relations.r.kind, 'master');
  assert.equal(plan.next.relations.r.name_at_event, '下書きの参加名');
});
test('clipboard table preserves quoted newlines, leading zero IDs and reordered headers', () => {
  const rows = parseDelimited('名前\t効果\tID\nカード\t"効果1\n効果2"\t001\n');
  assert.deepEqual(rows, [['名前', '効果', 'ID'], ['カード', '効果1\n効果2', '001']]);
  assert.deepEqual(mapPasteHeader('cards', rows[0]), ['name', 'effect_text', 'source_card_id']);
  assert.equal(mapPasteHeader('cards', ['実際のカード名', '効果内容']), null);
  assert.throws(() => parseDelimited('"未完了'), /引用符/);
});
test('image filenames match unique source IDs and refuse ambiguous/oversized files', () => {
  const files = [{ name: '001.png', type: 'image/png', size: 1 }, { name: '002.webp', type: 'image/webp', size: 1 }, { name: '003.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 }];
  const result = matchImageFiles(files, [{ id: 'one', sourceId: '001' }, { id: 'two', sourceId: '002' }, { id: 'other', sourceId: '002' }, { id: 'three', sourceId: '003' }]);
  assert.deepEqual(result.matches, [{ id: 'one', fileIndex: 0 }]);
  assert.deepEqual(result.unmatched, ['002.webp', '003.jpg']);
});
test('pasted card game names use the same reference resolution as saving when associating images', () => {
  assert.equal(gameReferenceId(game.id, directory.games), game.id);
  assert.equal(gameReferenceId(` ${game.name} `, directory.games), game.id);
  assert.throws(() => gameReferenceId(game.name, [game, { ...game, id: 'another-game' }]), /同名/);
});
test('a blank row with only scoped game membership is not saved as an empty person', () => {
  const baseline = createBlankRecord('people', game.id, 'blank');
  assert.equal(hasRecordChanges(baseline, { id: 'blank', values: baseline.values }), false);
  const edit = { id: 'blank', values: { ...baseline.values, display_name: '新しい人' } };
  const plan = planRecordBulk('people', emptyStore(), new Map([['blank', baseline]]), { blank: edit }, directory)!;
  assert.equal(Object.values(plan.next.relations)[0].event_id, game.id);
});
test('a changed remote image replaces an earlier local file and is recorded in history', () => {
  const store = emptyStore(); store.images['games:g'] = new Blob(['old'], { type: 'image/png' });
  const snapshot: RecordBaseline = { row: game, values: {}, links: [], relations: [], isNew: false };
  snapshot.values = recordValues('games', snapshot, new Map(), 'https://example.com/old.png');
  const plan = planRecordBulk('games', store, new Map([['g', snapshot]]), { g: { id: 'g', values: { ...snapshot.values, imageUrl: 'https://example.com/new.png' } } }, directory)!;
  assert.equal(plan.next.images['games:g'], undefined);
  assert.equal(plan.next.gameImageUrls.g, 'https://example.com/new.png');
  assert.equal(plan.next.history[0].changes[0].label, '画像');
  assert.ok(store.images['games:g']);
});
test('date range and invalid blog errors identify the cell requiring correction', () => {
  const baseline = createBlankRecord('games', '', 'new-game');
  assert.throws(() => planRecordBulk('games', emptyStore(), new Map([['new-game', baseline]]), { 'new-game': { id: 'new-game', values: { ...baseline.values, name: '新しいゲーム', start_date: '2026-10-02', end_date: '2026-10-01' } } }, directory), error => error instanceof RecordBulkValidationError && error.issues[0].field === 'end_date');
  const personBaseline = createBlankRecord('people', '', 'new-person');
  assert.throws(() => planRecordBulk('people', emptyStore(), new Map([['new-person', personBaseline]]), { 'new-person': { id: 'new-person', values: { ...personBaseline.values, display_name: '新しい人', blog: 'not-a-url' } } }, directory), error => error instanceof RecordBulkValidationError && error.issues[0].field === 'blog');
});
test('CSV import preserves quoted commas and enforces a bounded batch size', () => {
  assert.deepEqual(parseDelimited('名前,効果\n"カード,その1","効果\n続き"', ','), [['名前', '効果'], ['カード,その1', '効果\n続き']]);
  assert.throws(() => parseDelimited(Array.from({ length: 5001 }, () => 'カード').join('\n')), /5,000/);
});
test('pasting into a loading person preserves a saved local rename and admission year', () => {
  const store = emptyStore(); store.people.p = { ...person, display_name: '下書きの新しい名前', joined_year: 2025 };
  const fetched = { links: [{ id: 'x', person_id: 'p', event_id: null, kind: 'twitter', label: 'X', url: 'https://x.com/old_name' }], relations: [] };
  const baseline = personPasteBaseline('p', directory, store, fetched, new Map())!;
  const edit = { id: 'p', values: { ...baseline.values, x: '@updated' } };
  const plan = planRecordBulk('people', store, new Map([['p', baseline]]), { p: edit }, directory)!;
  assert.equal(plan.next.people.p.display_name, '下書きの新しい名前');
  assert.equal(plan.next.people.p.joined_year, 2025);
  assert.equal(plan.next.links.x.url, 'https://x.com/updated');
  assert.equal(Object.keys(plan.next.links).length, 1);
  assert.deepEqual(plan.next.history[0].changes.map(change => change.label), ['リンク · X']);
});
test('a fully fetched paste fallback preserves existing links and participation identities', () => {
  const store = emptyStore(), fetched = { links: [{ id: 'x', person_id: 'p', event_id: null, kind: 'twitter', label: 'X', url: 'https://x.com/old_name' }], relations: [{ id: 'r', person_id: 'p', event_id: game.id, kind: 'participant', status: 'attended', name_at_event: '当時の名前', team_id: 'team', role_id: 'role' }] };
  const baseline = personPasteBaseline('p', directory, store, fetched, new Map([[game.id, game.name]]))!;
  const edit = { id: 'p', values: { ...baseline.values, display_name: '新しい名前', x: '@updated', event_ids: game.id } };
  const plan = planRecordBulk('people', store, new Map([['p', baseline]]), { p: edit }, directory)!;
  assert.deepEqual(Object.keys(plan.next.links), ['x']);
  assert.deepEqual(plan.next.relations, {});
  assert.equal(baseline.relations[0].id, 'r');
  assert.equal(baseline.relations[0].team_id, 'team');
  assert.equal(baseline.relations[0].name_at_event, '当時の名前');
});
test('renaming a game with 100 attendees stages no unchanged participation rows and retains existing draft deltas', () => {
  const store = emptyStore(), local = { id: 'local-change', person_id: person.id, event_id: 'other-game', kind: 'participant', status: 'attended', name_at_event: '下書きの参加名', team_id: null, role_id: null };
  store.relations[local.id] = local; store.removedRelations = ['earlier-deletion'];
  const baseline: RecordBaseline = { row: game, values: {}, isNew: false, links: [], relations: Array.from({ length: 100 }, (_, index) => ({ ...local, id: `attendance-${index}`, person_id: `person-${index}`, event_id: game.id, name_at_event: '当時の名前' })) };
  baseline.values = recordValues('games', baseline, new Map());
  const plan = planRecordBulk('games', store, new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, name: 'ゲーム名を変更' } } }, directory)!;
  assert.deepEqual(plan.next.relations, { [local.id]: local });
  assert.deepEqual(plan.next.removedRelations, ['earlier-deletion']);
  assert.equal(plan.next.games.g.name, 'ゲーム名を変更');
  assert.deepEqual(plan.next.history[0].changes.map(change => change.label), ['ゲーム名']);
});
test('renaming a person with 100 links keeps prior draft changes and deletion markers without copying unchanged links', () => {
  const store = emptyStore(), previous = { id: 'earlier-link', person_id: 'other-person', event_id: null, kind: 'ブログ', label: '個人ブログ', url: 'https://example.com/previous-draft' };
  store.links[previous.id] = previous; store.removedLinks = ['earlier-deletion'];
  const baseline: RecordBaseline = { row: person, values: {}, isNew: false, relations: [], links: Array.from({ length: 100 }, (_, index) => ({ ...previous, id: `link-${index}`, person_id: person.id, url: `https://example.com/blog-${index}` })) };
  baseline.values = recordValues('people', baseline, new Map());
  const plan = planRecordBulk('people', store, new Map([[person.id, baseline]]), { [person.id]: { id: person.id, values: { ...baseline.values, display_name: '人の名前を変更' } } }, directory)!;
  assert.deepEqual(plan.next.links, { [previous.id]: previous });
  assert.deepEqual(plan.next.removedLinks, ['earlier-deletion']);
  assert.deepEqual(plan.next.history[0].changes.map(change => change.label), ['名前']);
});
test('explicitly clearing an image with an already empty URL removes a saved local file', () => {
  const store = emptyStore(), blank = createBlankRecord('cards', game.id, 'card');
  const row = { ...blank.row, name: '画像付きカード' } as import('../src/admin/model.ts').PreviewCard;
  const baseline: RecordBaseline = { ...blank, row, isNew: false }; baseline.values = recordValues('cards', baseline, new Map());
  store.images['cards:card'] = new Blob(['file'], { type: 'image/png' });
  const edit = { id: 'card', values: baseline.values, removeImage: true };
  assert.ok(hasRecordChanges(baseline, edit));
  const plan = planRecordBulk('cards', store, new Map([['card', baseline]]), { card: edit }, { ...directory, cards: [{ id: 'card', event_id: game.id, name: row.name, rank: null, source_card_id: null, publication_status: 'published' }] })!;
  assert.equal(plan.next.images['cards:card'], undefined);
  assert.equal(plan.next.cards.card.imageUrl, '');
  assert.deepEqual(plan.next.history[0].changes.map(change => change.label), ['画像']);
  assert.ok(store.images['cards:card']);
});
test('game image clear records an empty URL and deletes the earlier selected file', () => {
  const store = emptyStore(); store.images['games:g'] = new Blob(['file'], { type: 'image/png' });
  const baseline: RecordBaseline = { row: game, values: {}, links: [], relations: [], isNew: false }; baseline.values = recordValues('games', baseline, new Map());
  const plan = planRecordBulk('games', store, new Map([['g', baseline]]), { g: { id: 'g', values: baseline.values, removeImage: true } }, directory)!;
  assert.equal(plan.next.images['games:g'], undefined);
  assert.equal(plan.next.gameImageUrls.g, '');
  assert.equal(plan.next.history[0].changes[0].label, '画像');
});
