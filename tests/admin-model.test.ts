import assert from 'node:assert/strict';
import test from 'node:test';
import { changedLinks, emptyStore, mergeLinkEdits, mergeRelationEdits, normaliseLink, scopedRelations, sortedDirectory, validateEditor, type Directory, type PreviewCard } from '../src/admin/model.ts';
import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../src/database.ts';
import { convertParticipationKind } from '../src/admin/participation-edits.ts';
const game = (id: string, year: number): EventRow => ({ id, name: id, fiscal_year: year, start_date: null, end_date: null, schedule_note: null, theme: null, status: null });
const person: PersonRow = { id: 'person', display_name: '人物', code_name: null, joined_year: null };
const relation = (id: string, kind = 'participant'): ParticipationRow => ({ id, person_id: person.id, event_id: 'old', kind, name_at_event: '当時の名前', status: 'attended', team_id: 'team', role_id: 'role' });
const directory: Directory = { games: [game('old', 2025), game('new', 2026)], people: [person], masters: [], cards: [{ id: 'old-card', event_id: 'old', source_card_id: '2', name: '旧カード', rank: 'A', publication_status: 'published' }, { id: 'new-card', event_id: 'new', source_card_id: '10', name: '新カード', rank: 'S', publication_status: 'published' }] };
test('people default to admission year ascending, missing years last, with explicit name sorting available', () => {
  const data = { ...directory, people: [{ ...person, id: 'older', display_name: 'わ', joined_year: 2015 }, { ...person, id: 'newer', display_name: 'あ', joined_year: 2026 }, { ...person, id: 'unknown', display_name: 'い' }] };
  assert.deepEqual(sortedDirectory(data, emptyStore(), 'people', '', '', '', 'default', []).map(row => row.id), ['older', 'newer', 'unknown']);
  assert.deepEqual(sortedDirectory(data, emptyStore(), 'people', '', '', '', 'name', []).map(row => row.id), ['newer', 'unknown', 'older']);
  const store = emptyStore(); store.people.unknown = { ...data.people[2], joined_year: 2010 };
  assert.equal(sortedDirectory(data, store, 'people', '', '', '', 'default', [])[0].id, 'unknown');
});
test('removing a legacy duplicate attendance keeps the surviving history and its old name/team', () => {
  const rows = [relation('participant'), relation('master', 'master')];
  const next = mergeRelationEdits(emptyStore(), rows, [rows[0]]);
  assert.deepEqual(scopedRelations(rows, next, 'person_id', person.id), [rows[0]]);
  assert.deepEqual(scopedRelations(rows, next, 'event_id', 'old'), [rows[0]]);
});
test('changing a participation to master is visible from both sheets', () => {
  const original = relation('attendance');
  const next = mergeRelationEdits(emptyStore(), [original], [convertParticipationKind(original, 'master')]);
  assert.equal(scopedRelations([original], next, 'event_id', 'old')[0].kind, 'master');
  assert.equal(scopedRelations([original], next, 'person_id', person.id)[0].kind, 'master');
  assert.equal(scopedRelations([original], next, 'person_id', person.id)[0].team_id, null);
  assert.equal(scopedRelations([original], next, 'person_id', person.id)[0].role_id, null);
  assert.equal(scopedRelations([], next, 'person_id', 'someone-else').length, 0);
});
test('locally renamed and moved cards participate in filtering and newest game order', () => {
  assert.equal(sortedDirectory(directory, emptyStore(), 'cards', '', '', '', 'default', [])[0].id, 'new-card');
  const store = emptyStore();
  store.cards['old-card'] = { ...directory.cards[0], name: '移動したカード', event_id: 'new' } as PreviewCard;
  assert.equal(sortedDirectory(directory, store, 'cards', '移動', 'new', '', 'default', [])[0].id, 'old-card');
  assert.equal(sortedDirectory(directory, store, 'cards', '', 'old', '', 'default', []).length, 0);
});
test('link edits preserve the ID and game relation and leave unrelated links alone', () => {
  const before = { id: 'link', person_id: person.id, event_id: 'old', kind: '公式SNS', label: 'X', url: 'https://x.com/old' };
  const next = mergeLinkEdits(emptyStore(), [before], [{ ...before, url: 'https://x.com/new' }]);
  assert.equal(next.links.link.event_id, 'old');
  assert.equal(next.links.link.id, 'link');
  assert.deepEqual(next.removedLinks, []);
});
test('unchanged editor links do not become new draft changes and old changes/deletions remain intact', () => {
  const store = emptyStore(), old: LinkRow = { id: 'old', person_id: person.id, event_id: null, kind: 'ブログ', label: 'ブログ', url: 'https://example.com/old' }, prior = { ...old, id: 'prior', url: 'https://example.com/saved-draft' };
  store.links.prior = prior; store.removedLinks = ['earlier-deletion'];
  const next = mergeLinkEdits(store, [old, prior], [{ ...old }, { url: prior.url, label: prior.label, kind: prior.kind, event_id: prior.event_id, person_id: prior.person_id, id: prior.id }]);
  assert.deepEqual(next.links, { prior });
  assert.deepEqual(next.removedLinks, ['earlier-deletion']);
  const removed = mergeLinkEdits(next, [old, prior], [prior]);
  assert.deepEqual(removed.links, { prior });
  assert.deepEqual(removed.removedLinks, ['earlier-deletion', 'old']);
  assert.deepEqual(store.removedLinks, ['earlier-deletion']);
});
test('link deltas cover every editable field and new identities', () => {
  const original: LinkRow = { id: 'link', person_id: person.id, event_id: 'old', kind: 'ブログ', label: 'ブログ', url: 'https://example.com/old' };
  const patches: Partial<LinkRow>[] = [{ person_id: null }, { event_id: null }, { kind: 'twitter' }, { label: '変更したラベル' }, { url: 'https://example.com/new' }];
  for (const patch of patches) { const updated = { ...original, ...patch }; assert.deepEqual(changedLinks([original], [updated]), [updated]); }
  const added = { ...original, id: 'new-link' };
  assert.deepEqual(changedLinks([original], [original, added]), [added]);
});
test('invalid date ranges, unknown references and executable links cannot be saved', () => {
  const invalidRange = { ...game('old', 2025), start_date: '2025-02-02', end_date: '2025-02-01' };
  assert.match(validateEditor('games', invalidRange, [], [], directory)!, /終了日/);
  assert.match(validateEditor('games', game('old', 2025), [], [relation('unknown', 'master')].map(row => ({ ...row, person_id: 'unknown' })), directory)!, /関連付け/);
  const link = { id: 'link', person_id: person.id, event_id: null, kind: 'ブログ', label: 'ブログ', url: 'javascript:alert(1)' };
  assert.match(validateEditor('people', person, [link], [], directory)!, /URL/);
  assert.equal(normaliseLink('@kakurenbo', 'twitter'), 'https://x.com/kakurenbo');
});
test('unrelated edits preserve unchanged legacy links and references; changing them is still validated', () => {
  const legacyLink = { id: 'link', person_id: person.id, event_id: 'missing-game', kind: 'ブログ', label: '旧ブログ', url: 'old.example.invalid/blog' };
  const legacyRelation = { ...relation('legacy'), event_id: 'missing-game' };
  const baseline = { row: person, links: [legacyLink], relations: [legacyRelation] };
  const renamed = { ...person, display_name: '名前を更新' };
  assert.equal(validateEditor('people', renamed, [legacyLink], [legacyRelation], directory, baseline), null);
  assert.match(validateEditor('people', renamed, [{ ...legacyLink, url: 'javascript:alert(1)' }], [legacyRelation], directory, baseline)!, /URL/);
  assert.match(validateEditor('people', renamed, [legacyLink], [{ ...legacyRelation, person_id: 'another-missing-person' }], directory, baseline)!, /関連付け/);
  assert.match(validateEditor('people', renamed, [...baseline.links, { ...legacyLink, id: 'new-link' }], [legacyRelation], directory, baseline)!, /URL/);
  assert.match(validateEditor('people', renamed, [legacyLink], [...baseline.relations, { ...legacyRelation, id: 'new-relation' }], directory, baseline)!, /関連付け/);
});
