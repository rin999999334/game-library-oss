import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventRow, TeamRow } from '../src/database.ts';
import { emptyStore } from '../src/admin/model.ts';
import { changedTeamIds, planTeamBulk, TeamBulkValidationError } from '../src/admin/team-bulk.ts';
const game: EventRow = { id: 'game', name: 'ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
const team = (id: string, name = id): TeamRow => ({ id, event_id: game.id, display_name: name, rank_value: null, rank_note: null, final_score: null });

test('bulk changes create one complete save state, with history only for rows and fields that actually changed', () => {
  const store = emptyStore(), one = team('one'), two = team('two'), untouched = team('untouched');
  store.revision = 8;
  store.people.person = { id: 'person', display_name: '人物', code_name: null, joined_year: null };
  store.relations.attendance = { id: 'attendance', person_id: 'person', event_id: game.id, team_id: one.id, role_id: 'role', kind: 'participant', name_at_event: '当時の名前', status: 'attended' };
  store.images['games:game'] = new Blob(['image']);
  store.teams.untouched = untouched;
  store.history.push({ id: 'existing-history', at: '2026-10-01T00:00:00.000Z', sheet: 'people', recordId: 'person', recordName: '人物', action: 'update', changes: [{ label: '名前', before: '以前の名前', after: '人物' }], scope: 'local', actor: 'このブラウザ' });
  const before = new Map([one, two, untouched].map(row => [row.id, row]));
  const plan = planTeamBulk(store, before, {
    one: { ...one, display_name: '新しい名前', rank_value: 1 },
    two: { ...two, rank_note: '最下位', final_score: 0 },
    untouched,
  }, [game])!;
  assert.deepEqual(plan.changedIds, ['one', 'two']);
  assert.equal(plan.next.revision, 8);
  assert.equal(plan.next.people, store.people);
  assert.equal(plan.next.cards, store.cards);
  assert.equal(plan.next.games, store.games);
  assert.equal(plan.next.images, store.images);
  assert.equal(plan.next.relations, store.relations);
  assert.equal(plan.next.links, store.links);
  assert.equal(plan.next.removedLinks, store.removedLinks);
  assert.equal(plan.next.removedRelations, store.removedRelations);
  assert.equal(plan.next.teams.untouched, untouched);
  assert.equal(plan.next.teams.one.event_id, one.event_id);
  assert.equal(plan.next.teams.two.final_score, 0);
  assert.equal(plan.next.history[0], store.history[0]);
  assert.deepEqual(plan.next.history.slice(1).map(entry => ({ sheet: entry.sheet, recordId: entry.recordId, fields: entry.changes.map(change => change.label) })), [
    { sheet: 'teams', recordId: 'one', fields: ['チーム名', '順位'] },
    { sheet: 'teams', recordId: 'two', fields: ['順位補足', '最終得点'] },
  ]);
  assert.deepEqual(Object.keys(store.teams), ['untouched']);
  assert.equal(store.history.length, 1);
  assert.equal(one.display_name, 'one');
});

test('an unchanged bulk sheet produces no save, revision increment, draft or history', () => {
  const store = emptyStore(), original = team('one'), before = new Map([[original.id, original]]);
  assert.equal(planTeamBulk(store, before, { one: { ...original } }, [game]), null);
  assert.equal(planTeamBulk(store, before, {}, [game]), null);
  assert.deepEqual(changedTeamIds(before, { one: { ...original } }), []);
  assert.deepEqual(changedTeamIds(before, { one: { ...original, rank_value: 1 } }), ['one']);
  assert.deepEqual(store, emptyStore());
});

test('one invalid rank rejects the complete bulk change without writing valid rows or history', () => {
  const store = emptyStore(), one = team('one'), two = team('two'), before = new Map([[one.id, one], [two.id, two]]);
  assert.throws(() => planTeamBulk(store, before, {
    one: { ...one, display_name: '保存させない名前' }, two: { ...two, rank_value: 1.5 },
  }, [game]), error => error instanceof TeamBulkValidationError && error.teamId === 'two' && /順位/.test(error.message));
  assert.deepEqual(store, emptyStore());
  assert.equal(one.display_name, 'one');
});

test('bulk validation rejects empty names, non-finite scores, game moves and unknown team identity', () => {
  const store = emptyStore(), original = team('one'), before = new Map([[original.id, original]]);
  for (const edit of [
    { ...original, display_name: ' ' }, { ...original, final_score: Infinity },
    { ...original, event_id: 'another-game' }, { ...original, id: 'another-team' },
  ]) assert.throws(() => planTeamBulk(store, before, { one: edit }, [game]), TeamBulkValidationError);
  assert.throws(() => planTeamBulk(store, before, { unknown: team('unknown') }, [game]), TeamBulkValidationError);
  assert.deepEqual(store, emptyStore());
});

test('unchanged legacy rank and game references are preserved during a name edit', () => {
  const store = emptyStore(), legacy = { ...team('legacy'), event_id: 'missing-game', rank_value: 0 }, before = new Map([[legacy.id, legacy]]);
  const plan = planTeamBulk(store, before, { legacy: { ...legacy, display_name: '名前だけ変更' } }, [game])!;
  assert.equal(plan.next.teams.legacy.rank_value, 0);
  assert.equal(plan.next.teams.legacy.event_id, 'missing-game');
  assert.deepEqual(plan.next.history[0].changes, [{ label: 'チーム名', before: 'legacy', after: '名前だけ変更' }]);
});
