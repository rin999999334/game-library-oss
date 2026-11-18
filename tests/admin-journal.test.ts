import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBatchEntries, buildApplyPlan, type ReviewedApplyPlan } from '../src/admin/apply.ts';
import { emptyStore, type Directory } from '../src/admin/model.ts';
import { ApplyJournalConflictError, readApplyJournal, removeApplyJournal, restoreApplyJournal, reviseApplyJournal, saveApplyJournal, type ApplyJournal } from '../src/admin/apply-journal.ts';
const directory: Directory = { cards: [], people: [], games: [], teams: [], masters: [] };
function journal(batchId = crypto.randomUUID()): ApplyJournal {
  const store = emptyStore(); store.revision = 3; store.people.person = { id: 'person', display_name: '保存する人物', code_name: null, joined_year: 2020 }; store.images['games:game'] = new Blob(['original'], { type: 'image/png' });
  const plan = buildApplyPlan(store, directory);
  const reviewed: ReviewedApplyPlan = { ...plan, batchId, operations: plan.operations.map(op => ({ ...op, expected: null })), reviewedAt: '2026-10-02T00:00:00Z', diffs: [] };
  return { version: 1, projectUrl: 'https://project.test', actorId: 'admin', actorEmail: 'admin@example.com', startedAt: '2026-10-02T00:00:00Z', plan: reviewed, receipt: null };
}
test('a reloaded journal retains original image bytes and the immutable apply snapshot', async () => {
  const original = journal(), reloaded = restoreApplyJournal(structuredClone(original))!;
  assert.equal(reloaded.plan.batchId, original.plan.batchId); assert.equal(reloaded.plan.localSnapshot.revision, 3);
  assert.equal(await reloaded.plan.imageUploads[0].blob.text(), 'original');
  const confirmed = { ...reloaded, receipt: { batchId: reloaded.plan.batchId, at: '2026-10-02T01:00:00Z', historyIds: reloaded.plan.historyIds, storeRevision: 3, counts: reloaded.plan.counts } };
  assert.equal(restoreApplyJournal(confirmed)!.receipt?.batchId, original.plan.batchId);
  assert.throws(() => restoreApplyJournal({ ...confirmed, receipt: { ...confirmed.receipt, batchId: 'wrong' } }), /反映結果/);
  assert.throws(() => restoreApplyJournal({ version: 0 }), /反映記録/);
});
test('another batch/account cannot replace a pending journal or change a confirmed receipt', () => {
  const current = journal();
  assert.throws(() => reviseApplyJournal(current, journal()), ApplyJournalConflictError);
  assert.throws(() => reviseApplyJournal(current, { ...current, actorId: 'another' }), ApplyJournalConflictError);
  assert.equal(reviseApplyJournal(current, { ...current, actorEmail: 'new@example.com' }).plan.batchId, current.plan.batchId);
  const confirmed = { ...current, receipt: { batchId: current.plan.batchId, at: '2026-10-02T01:00:00Z', historyIds: current.plan.historyIds, storeRevision: 3, counts: current.plan.counts } };
  assert.throws(() => reviseApplyJournal(confirmed, { ...confirmed, receipt: null }), /確認済み/);
});
test('cloud audit uses confirmed actor/date and reconstructs older operation-only batches', () => {
  const batch = { batchId: 'batch', at: '2026-10-02T01:00:00Z', actor: 'admin@example.com' };
  const snapshot = { id: 'entry', at: '2026-10-02T00:00:00Z', sheet: 'people', recordId: 'person', recordName: '人物', action: 'create', changes: [{ label: '名前', before: '未登録', after: '人物' }], scope: 'local', actor: 'このブラウザ' };
  const entry = auditBatchEntries({ ...batch, historyEntries: [snapshot] })[0];
  assert.equal(entry.actor, batch.actor); assert.equal(entry.appliedAt, batch.at); assert.equal(entry.applyBatchId, batch.batchId);
  const old = auditBatchEntries({ ...batch, operations: [{ table: 'cards', id: 'card', action: 'upsert', data: { name: 'カード' }, expected: null }, { table: 'admin_record_flags', id: 'cards:card', action: 'delete', data: {}, expected: null }] });
  assert.equal(old[0].action, 'create'); assert.equal(old[0].recordId, 'card'); assert.equal(old[1].sheet, 'cards'); assert.equal(old[1].action, 'release');
});
function database() {
  let active = false;
  const records = new Map<string, unknown>(), pending: Array<() => void> = [];
  function next() { if (active) return; const start = pending.shift(); if (start) { active = true; start(); } }
  return { open() {
    const request = { result: { close() {}, transaction() {
      const queue: Array<() => void> = []; let aborted = false;
      const changes = new Map(records);
      const tx = { oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined, abort() { aborted = true; }, objectStore() { return {
        get(key: string) { const read = { result: undefined as unknown, onsuccess: undefined as (() => void) | undefined }; queue.push(() => { read.result = structuredClone(changes.get(key)); read.onsuccess?.(); }); return read; },
        put(value: unknown, key: string) { queue.push(() => changes.set(key, structuredClone(value))); },
        delete(key: string) { queue.push(() => { changes.delete(key); }); },
      }; } };
      function drain() { if (!aborted && queue.length) { queue.shift()!(); queueMicrotask(drain); return; } if (aborted) tx.onabort?.(); else { records.clear(); for (const [key, value] of changes) records.set(key, value); tx.oncomplete?.(); } active = false; next(); }
      pending.push(() => { changes.clear(); for (const [key, value] of records) changes.set(key, value); queueMicrotask(drain); }); queueMicrotask(next); return tx;
    } }, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => request.onsuccess?.()); return request;
  } };
}
test('concurrent tabs preserve one pending batch; cleanup requires the matching batch ID', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: database() });
  try {
    const first = journal(), second = journal();
    const results = await Promise.allSettled([saveApplyJournal(first), saveApplyJournal(second)]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
    assert.equal((await readApplyJournal(first.projectUrl))?.plan.batchId, first.plan.batchId);
    await assert.rejects(removeApplyJournal(second.plan.batchId, first.projectUrl), ApplyJournalConflictError);
    assert.equal((await readApplyJournal(first.projectUrl))?.plan.batchId, first.plan.batchId);
    await removeApplyJournal(first.plan.batchId, first.projectUrl); assert.equal(await readApplyJournal(first.projectUrl), null);
  } finally { if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else Reflect.deleteProperty(globalThis, 'indexedDB'); }
});
