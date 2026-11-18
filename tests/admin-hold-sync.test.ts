import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeRemoteHolds } from '../src/admin/hold-sync.ts';
import { emptyStore } from '../src/admin/model.ts';
import { makeHoldChangeEntry } from '../src/admin/history.ts';
test('cloud flags hydrate without restoring markers another admin released', () => {
  const store = emptyStore(); store.holds['people:old'] = { sheet: 'people', recordId: 'old', at: '2026-10-01' };
  const remote = { 'cards:remote': { sheet: 'cards' as const, recordId: 'remote', at: '2026-10-01' } };
  assert.deepEqual(mergeRemoteHolds(store, remote).holds, remote); assert.ok(store.holds['people:old']);
});
test('local unapplied hold/release overrides cloud state in chronological editing order', () => {
  const store = emptyStore(); store.history = [makeHoldChangeEntry('people', 'local', '人物', true), makeHoldChangeEntry('cards', 'remote', 'カード', false)];
  const remote = { 'cards:remote': { sheet: 'cards' as const, recordId: 'remote', at: '2026-10-01' } };
  const next = mergeRemoteHolds(store, remote);
  assert.equal(next.holds['cards:remote'], undefined); assert.equal(next.holds['people:local'].sheet, 'people');
  store.history.push(makeHoldChangeEntry('people', 'local', '人物', false)); assert.equal(mergeRemoteHolds(store, remote).holds['people:local'], undefined);
});
