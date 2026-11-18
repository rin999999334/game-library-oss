import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileApplied } from '../src/admin/apply-local.ts';
import { buildApplyPlan, type ApplyReceipt } from '../src/admin/apply.ts';
import { emptyStore, type Directory } from '../src/admin/model.ts';
import { makeHoldChangeEntry, type ChangeEntry } from '../src/admin/history.ts';
const directory: Directory = { cards: [], people: [], games: [], teams: [], masters: [] };
const person = { id: 'person', display_name: '最初の名前', code_name: null, joined_year: 2020 };
const edit: ChangeEntry = { id: 'edit', at: '2026-10-01T01:00:00Z', sheet: 'people', recordId: person.id, recordName: person.display_name, action: 'create', changes: [{ label: '名前', before: '未登録', after: person.display_name }], actor: 'このブラウザ', scope: 'local' };
const receipt = (plan: ReturnType<typeof buildApplyPlan>): ApplyReceipt => ({ batchId: plan.batchId, at: '2026-10-01T02:00:00Z', historyIds: plan.historyIds, storeRevision: plan.storeRevision, counts: plan.counts });
test('committed snapshot clears drafts and preserves holds and applied audit', async () => {
  const store = emptyStore(); store.revision = 5; store.people.person = person; store.history = [edit];
  store.holds['people:person'] = { sheet: 'people', recordId: person.id, at: edit.at };
  const plan = buildApplyPlan(store, directory), next = await reconcileApplied(structuredClone(store), plan, receipt(plan));
  assert.deepEqual(next.people, {}); assert.deepEqual(next.holds, store.holds); assert.equal(next.history[0].applyBatchId, plan.batchId); assert.equal(next.revision, 5);
});
test('other tab changes while DB commits survive with their own unapplied history', async () => {
  const store = emptyStore(); store.revision = 1; store.people.person = person; store.history = [edit];
  const plan = buildApplyPlan(store, directory), latest = structuredClone(store); latest.revision = 2;
  latest.people.person = { ...person, display_name: '反映中に変更した名前' };
  latest.people.another = { ...person, id: 'another' };
  latest.history.push({ ...edit, id: 'later', action: 'update' });
  const next = await reconcileApplied(latest, plan, receipt(plan));
  assert.equal(next.people.person.display_name, '反映中に変更した名前'); assert.ok(next.people.another);
  assert.equal(next.history[0].appliedAt, receipt(plan).at); assert.equal(next.history[1].appliedAt, undefined); assert.equal(next.revision, 2);
});
test('same-sized replacement image is retained, while unchanged image is cleared', async () => {
  const store = emptyStore(); store.revision = 1; store.images['games:one'] = new Blob(['old'], { type: 'image/png' }); store.images['games:two'] = new Blob(['same'], { type: 'image/png' });
  const plan = buildApplyPlan(store, directory), latest = structuredClone(store); latest.revision = 2; latest.images['games:one'] = new Blob(['new'], { type: 'image/png' });
  const next = await reconcileApplied(latest, plan, receipt(plan));
  assert.equal(await next.images['games:one'].text(), 'new'); assert.equal(next.images['games:two'], undefined);
});
test('server receipt overrides a concurrent local discard and keeps new hold edits pending', async () => {
  const store = emptyStore(); store.revision = 1; store.people.person = person; store.history = [edit];
  const plan = buildApplyPlan(store, directory), latest = { ...emptyStore(), revision: 2, history: [{ ...edit, discardedAt: '2026-10-01T01:30:00Z' }, makeHoldChangeEntry('people', person.id, person.display_name, true)] };
  const next = await reconcileApplied(latest, plan, receipt(plan));
  assert.equal(next.history[0].discardedAt, null); assert.equal(next.history[0].appliedAt, receipt(plan).at); assert.equal(next.history[1].appliedAt, undefined);
});
test('restoring a link or participation in another tab while its deletion commits retains the restore', async () => {
  const store = emptyStore(); store.revision = 1;
  store.links.link = { id: 'link', person_id: person.id, event_id: null, kind: 'ブログ', label: 'ブログ', url: 'https://example.com' }; store.removedLinks = ['link'];
  store.relations.rel = { id: 'rel', person_id: person.id, event_id: 'game', kind: 'participant', status: 'attended', name_at_event: null, role_id: null, team_id: null }; store.removedRelations = ['rel'];
  const plan = buildApplyPlan(store, directory), latest = structuredClone(store); latest.revision = 2; latest.removedLinks = []; latest.removedRelations = [];
  const next = await reconcileApplied(latest, plan, receipt(plan));
  assert.deepEqual(next.links.link, store.links.link); assert.deepEqual(next.relations.rel, store.relations.rel);
  assert.deepEqual(next.removedLinks, []); assert.deepEqual(next.removedRelations, []);
});

test('an intentional later reversion to the same snapshot stays queued', async () => {
  const store = emptyStore(); store.revision = 1; store.people.person = person; store.history = [edit];
  const plan = buildApplyPlan(store, directory), latest = structuredClone(store); latest.revision = 3;
  latest.history.push({ ...edit, id: 'later-reversion', action: 'update', changes: [{ label: '名前', before: '別の名前', after: person.display_name }] });
  const next = await reconcileApplied(latest, plan, receipt(plan));
  assert.deepEqual(next.people.person, person); assert.equal(next.history[1].appliedAt, undefined);
});
