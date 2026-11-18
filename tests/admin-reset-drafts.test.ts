import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDraftStore } from '../src/admin/reset-drafts.ts';
import { historyStatus, makeHoldChangeEntry, workHoldKey, type ChangeEntry, type HistoryTarget } from '../src/admin/history.ts';
import { emptyStore, type Directory } from '../src/admin/model.ts';
import type { PersonRow } from '../src/database.ts';

const at = '2026-10-01T03:00:00.000Z';
const person: PersonRow = { id: 'person', display_name: '人物', code_name: null, joined_year: 2020 };
const directory: Directory = { cards: [], people: [person], games: [], masters: [], teams: [] };
const entry = (sheet: HistoryTarget, id: string, action: ChangeEntry['action'] = 'create'): ChangeEntry => ({ id: `${sheet}:${id}:${action}`, at: '2026-10-01T02:00:00.000Z', sheet, recordId: id, recordName: id, action, scope: 'local', actor: 'このブラウザ', changes: [{ label: '名前', before: '未登録', after: id }] });

test('reset clears content drafts but keeps existing record work markers and applied audit', () => {
  const store = emptyStore(); store.revision = 7; store.people.person = { ...person, display_name: '編集中の名前' };
  const update = entry('people', person.id, 'update'), hold = makeHoldChangeEntry('people', person.id, person.display_name, true), applied = { ...entry('people', person.id), appliedAt: '2026-10-01T01:00:00Z', applyBatchId: 'confirmed' };
  store.history = [applied, update, hold]; store.holds[workHoldKey('people', person.id)] = { sheet: 'people', recordId: person.id, at: hold.at };
  store.images['games:game'] = new Blob(['image'], { type: 'image/png' }); store.gameImageUrls.game = 'https://example.com/image.png';
  const next = resetDraftStore(store, directory, at);
  assert.deepEqual(next.people, {}); assert.deepEqual(next.images, {}); assert.deepEqual(next.gameImageUrls, {});
  assert.deepEqual(next.holds, store.holds);
  assert.equal(historyStatus(next.history[0]), 'applied'); assert.equal(next.history[0], applied);
  assert.equal(historyStatus(next.history[1]), 'discarded'); assert.equal(historyStatus(next.history[2]), 'unapplied');
  assert.equal(next.history.at(-1)?.action, 'reset'); assert.equal(next.history.at(-1)?.at, at);
  assert.equal(next.revision, 7); assert.equal(next.savedAt, at);
  assert.equal(store.people.person.display_name, '編集中の名前'); assert.equal(update.discardedAt, undefined);
});

test('a newly created local record and its hold history are discarded together', () => {
  const store = emptyStore(), local = { ...person, id: 'new' };
  store.people.new = local; store.history = [entry('people', 'new'), makeHoldChangeEntry('people', 'new', local.display_name, true)];
  store.holds['people:new'] = { sheet: 'people', recordId: 'new', at };
  const next = resetDraftStore(store, directory, at);
  assert.deepEqual(next.people, {}); assert.deepEqual(next.holds, {});
  assert.equal(historyStatus(next.history[0]), 'discarded'); assert.equal(historyStatus(next.history[1]), 'discarded');
  assert.ok(store.holds['people:new']);
});

test('hold and release for a removed new record both leave the apply queue', () => {
  const store = emptyStore(); store.people.new = { ...person, id: 'new' };
  store.history = [entry('people', 'new'), makeHoldChangeEntry('people', 'new', '新しい人', true), makeHoldChangeEntry('people', 'new', '新しい人', false)];
  const next = resetDraftStore(store, directory, at);
  assert.ok(next.history.every(history => historyStatus(history) === 'discarded'));
});

test('directory existence and a confirmed create protect markers from stale directory snapshots', () => {
  for (const applied of [false, true]) {
    const store = emptyStore(), id = applied ? 'remote-created' : person.id;
    store.people[id] = { ...person, id }; store.holds[`people:${id}`] = { sheet: 'people', recordId: id, at };
    store.history = [{ ...entry('people', id), ...(applied ? { appliedAt: at, applyBatchId: 'confirmed' } : {}) }, makeHoldChangeEntry('people', id, '人物', true)];
    const next = resetDraftStore(store, directory, at);
    assert.ok(next.holds[`people:${id}`]); assert.equal(historyStatus(next.history[1]), 'unapplied');
    assert.equal(historyStatus(next.history[0]), applied ? 'applied' : 'discarded');
  }
});

test('record IDs are sheet-qualified, so resetting a new game does not lose a person marker', () => {
  const store = emptyStore(); store.games.person = { id: 'person', name: '新ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
  store.holds = { 'games:person': { sheet: 'games', recordId: 'person', at }, 'people:person': { sheet: 'people', recordId: 'person', at } };
  store.history = [entry('games', 'person'), makeHoldChangeEntry('games', 'person', '新ゲーム', true), makeHoldChangeEntry('people', 'person', person.display_name, true)];
  const next = resetDraftStore(store, directory, at);
  assert.equal(next.holds['games:person'], undefined); assert.ok(next.holds['people:person']);
  assert.equal(historyStatus(next.history[1]), 'discarded'); assert.equal(historyStatus(next.history[2]), 'unapplied');
});
