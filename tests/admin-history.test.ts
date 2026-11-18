import assert from 'node:assert/strict';
import test from 'node:test';
import { discardUnappliedHistory, mergeAuditHistory, historyStatus, makeChangeEntry, makeHoldChangeEntry, markHistoryApplied, resetChangeEntry, unappliedHistory, workHoldKey, type ChangeEntry } from '../src/admin/history.ts';
import { emptyStore, type Directory, type PreviewCard } from '../src/admin/model.ts';
import { listPendingRecords } from '../src/admin/PendingSheet.tsx';
import type { EventRow, PersonRow } from '../src/database.ts';

const at = '2026-10-01T01:00:00.000Z';
const game: EventRow = { id: 'game', name: '新ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
const person: PersonRow = { id: 'person', display_name: '人物', code_name: null, joined_year: 2020 };
const change = (id: string): ChangeEntry => ({ id, at, sheet: 'cards', recordId: 'card', recordName: 'カード', action: 'update', changes: [{ label: '名前', before: '旧', after: '新' }], scope: 'local', actor: 'このブラウザ' });

test('legacy local entries are unapplied, and reset entries never appear as changes awaiting publication', () => {
  assert.equal(historyStatus(change('legacy')), 'unapplied');
  const reset = resetChangeEntry(emptyStore());
  assert.equal(historyStatus(reset), 'discarded');
  assert.deepEqual(unappliedHistory([change('legacy'), reset]).map(entry => entry.id), ['legacy']);
});

test('only IDs confirmed in the receipt are marked applied; retry leaves the original receipt intact', () => {
  const entries = [change('a'), change('b'), { ...change('c'), discardedAt: at }];
  const first = markHistoryApplied(entries, ['a', 'c'], 'batch-1', at);
  assert.equal(historyStatus(first[0]), 'applied');
  assert.equal(historyStatus(first[1]), 'unapplied');
  assert.equal(historyStatus(first[2]), 'discarded');
  const retry = markHistoryApplied(first, ['a'], 'batch-2', '2026-10-02T01:00:00.000Z');
  assert.equal(retry[0].applyBatchId, 'batch-1');
  assert.equal(retry[0].appliedAt, at);
  assert.equal(entries[0].appliedAt, undefined);
  assert.throws(() => markHistoryApplied(entries, ['a'], '', at));
  assert.throws(() => markHistoryApplied(entries, ['a'], 'batch', 'invalid date'));
});

test('discarding drafts preserves applied audit and makes a later edit unapplied again', () => {
  const applied = markHistoryApplied([change('a')], ['a'], 'batch', at)[0];
  const discarded = discardUnappliedHistory([applied, change('b')], '2026-10-01T02:00:00.000Z');
  assert.equal(discarded[0], applied);
  assert.equal(historyStatus(discarded[1]), 'discarded');
  assert.deepEqual(unappliedHistory([...discarded, change('next')]).map(entry => entry.id), ['next']);
});

test('hold and release are work markers eligible for apply, with sheet-qualified IDs', () => {
  const hold = makeHoldChangeEntry('cards', 'same-id', 'カード', true);
  const release = makeHoldChangeEntry('people', 'same-id', '人物', false);
  assert.equal(historyStatus(hold), 'unapplied');
  assert.equal(historyStatus(release), 'unapplied');
  assert.deepEqual(hold.changes, [{ label: '作業ステータス', before: 'なし', after: '保留' }]);
  assert.deepEqual(release.changes, [{ label: '作業ステータス', before: '保留', after: 'なし' }]);
  assert.notEqual(workHoldKey('cards', 'same-id'), workHoldKey('people', 'same-id'));
});

test('pending list uses current draft names and games and keeps missing records releasable', () => {
  const directory: Directory = { games: [game], people: [person], cards: [{ id: 'card', event_id: 'game', name: '旧カード', source_card_id: '1', rank: 'A', publication_status: 'published' }], masters: [], teams: [] };
  const store = emptyStore();
  store.cards.card = { ...directory.cards[0], name: '編集したカード' } as PreviewCard;
  store.games.game = { ...game, name: '編集したゲーム' };
  store.holds = {
    [workHoldKey('cards', 'card')]: { sheet: 'cards', recordId: 'card', at },
    [workHoldKey('people', 'missing')]: { sheet: 'people', recordId: 'missing', at },
    [workHoldKey('people', 'person')]: { sheet: 'people', recordId: 'person', at },
  };
  const records = listPendingRecords(directory, store);
  assert.equal(records.length, 3);
  assert.equal(records.find(row => row.recordId === 'card')?.name, '編集したカード');
  assert.equal(records.find(row => row.recordId === 'card')?.gameName, '編集したゲーム');
  assert.equal(records.find(row => row.recordId === 'missing')?.exists, false);
  assert.equal(records.find(row => row.recordId === 'person')?.gameId, null);
});

test('person histories include admission year, keeping the entered order explainable', () => {
  const before = { row: person, relations: [], links: [] };
  const entry = makeChangeEntry('people', before, { ...before, row: { ...person, joined_year: 2021 } }, false, new Map(), false)!;
  assert.deepEqual(entry.changes, [{ label: '入学年', before: '2020', after: '2021' }]);
});

test('shared audit wins over stale local status and retains newer local changes', () => {
  const local = [{ ...change('committed'), discardedAt: at }, change('pending')];
  const remote = [{ ...change('committed'), appliedAt: at, actor: '管理者', applyBatchId: 'batch' }, { ...change('remote'), appliedAt: at }];
  const result = mergeAuditHistory(local, remote);
  assert.equal(result.length, 3);
  assert.equal(historyStatus(result.find(row => row.id === 'committed')!), 'applied');
  assert.equal(result.find(row => row.id === 'committed')?.actor, '管理者');
  assert.equal(historyStatus(result.find(row => row.id === 'pending')!), 'unapplied');
  assert.deepEqual(mergeAuditHistory(result, remote), result);
});
