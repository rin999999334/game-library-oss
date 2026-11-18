import assert from 'node:assert/strict';
import test from 'node:test';
import { makeChangeEntry, resetChangeEntry } from '../src/admin/history.ts';
import { emptyStore } from '../src/admin/model.ts';
import type { ParticipationRow, PersonRow } from '../src/database.ts';
const person: PersonRow = { id: 'person', display_name: '元の名前', joined_year: null, code_name: null };
test('history records actual before/after values, and an unchanged save creates no entry', () => {
  const baseline = { row: person, relations: [], links: [] };
  assert.equal(makeChangeEntry('people', baseline, baseline, false, new Map(), false), null);
  const entry = makeChangeEntry('people', baseline, { ...baseline, row: { ...person, display_name: '新しい名前' } }, false, new Map(), false)!;
  assert.equal(entry.scope, 'local'); assert.equal(entry.actor, 'このブラウザ');
  assert.deepEqual(entry.changes, [{ label: '名前', before: '元の名前', after: '新しい名前' }]);
});
test('changing a master relationship records its target name and the actual role change', () => {
  const rel: ParticipationRow = { id: 'rel', person_id: person.id, event_id: 'game', name_at_event: '当時の名前', kind: 'participant', status: 'attended', team_id: null, role_id: null };
  const before = { row: person, relations: [rel], links: [] };
  const entry = makeChangeEntry('people', before, { ...before, relations: [{ ...rel, kind: 'master' }] }, false, new Map([['game', 'センソウ2026']]), false)!;
  assert.deepEqual(entry.changes, [{ label: '参加履歴 · センソウ2026 / 参加区分', before: '参加者', after: 'マスター' }]);
});
test('reset history names the affected draft and does not claim a production change', () => {
  const store = emptyStore(); store.people[person.id] = person;
  const entry = resetChangeEntry(store);
  assert.equal(entry.action, 'reset'); assert.equal(entry.scope, 'local');
  assert.deepEqual(entry.changes, [{ label: '元の名前', before: '保存した下書き', after: '読み込んだデータに戻す' }]);
});
