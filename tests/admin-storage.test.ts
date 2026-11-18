import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewConflictError, restorePreview, revisePreview, savePreview } from '../src/admin/data.ts';
import { emptyStore } from '../src/admin/model.ts';
import { resetChangeEntry } from '../src/admin/history.ts';

test('old browser drafts migrate to revision zero without losing images, records or history', () => {
  const old = emptyStore();
  const image = new Blob(['image'], { type: 'image/png' });
  old.people.person = { id: 'person', display_name: '保存した名前', code_name: null, joined_year: null };
  old.images['games:game'] = image;
  old.history.push(resetChangeEntry(old));
  const { revision: _revision, holds: _holds, gameImageUrls: _urls, ...legacy } = old;
  const restored = restorePreview(legacy);
  assert.equal(restored.revision, 0);
  assert.deepEqual(restored.holds, {});
  assert.deepEqual(restored.gameImageUrls, {});
  assert.deepEqual(restored.people, old.people);
  assert.equal(restored.images['games:game'], image);
  assert.deepEqual(restored.history, old.history);
  const { history: _history, ...beforeJournal } = legacy;
  assert.deepEqual(restorePreview(beforeJournal).history, []);
  assert.deepEqual(restorePreview(beforeJournal).people, old.people);
});

test('stale drafts cannot replace newer edits or their journal', () => {
  const first = emptyStore(), stale = emptyStore();
  first.people.person = { id: 'person', display_name: '先に保存', code_name: null, joined_year: null };
  const committed = revisePreview(emptyStore(), first);
  assert.equal(committed.revision, 1);
  assert.throws(() => revisePreview(committed, stale), PreviewConflictError);
  assert.equal(committed.people.person.display_name, '先に保存');
  assert.equal(stale.revision, 0);
  assert.equal(revisePreview(committed, { ...committed, people: {} }).revision, 2);
});

// A transaction fixture, with requests queued until the prior transaction commits.
// The concurrent-save test exercises savePreview's transaction boundary, rather
// than just calling the revision comparator in isolation.
function transactionalDatabase() {
  let stored: unknown, active = false;
  const transactions: Array<() => void> = [], modes: string[] = [];
  function startNext() { if (active) return; const start = transactions.shift(); if (start) { active = true; start(); } }
  const factory = {
    open() {
      const opening = { result: {
        close() {},
        transaction(_name: string, mode: string) {
          modes.push(mode);
          const requests: Array<() => void> = [];
          let aborted = false, finished = false, started = false, write: unknown, hasWrite = false;
          const transaction = {
            oncomplete: undefined as (() => void) | undefined,
            onabort: undefined as (() => void) | undefined,
            onerror: undefined as (() => void) | undefined,
            abort() { aborted = true; },
            objectStore() { return {
              get() {
                const request = { result: undefined as unknown, onsuccess: undefined as (() => void) | undefined };
                requests.push(() => { request.result = structuredClone(stored); request.onsuccess?.(); });
                if (started) queueMicrotask(drain);
                return request;
              },
              put(value: unknown) { requests.push(() => { write = structuredClone(value); hasWrite = true; }); },
            }; },
          };
          function drain() {
            if (finished) return;
            if (!aborted && requests.length) { requests.shift()!(); queueMicrotask(drain); return; }
            finished = true;
            if (aborted) transaction.onabort?.();
            else { if (hasWrite) stored = write; transaction.oncomplete?.(); }
            active = false; startNext();
          }
          transactions.push(() => { started = true; queueMicrotask(drain); });
          queueMicrotask(startNext);
          return transaction;
        },
      }, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => opening.onsuccess?.());
      return opening;
    },
  };
  return { factory, modes, value: () => restorePreview(stored) };
}

test('simultaneous saves from revision zero commit once and reject the stale whole-store overwrite', async () => {
  const database = transactionalDatabase(), previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: database.factory });
  try {
    const left = emptyStore(), right = emptyStore();
    left.people.left = { id: 'left', display_name: '一つ目', code_name: null, joined_year: null };
    right.people.right = { id: 'right', display_name: '二つ目', code_name: null, joined_year: null };
    const results = await Promise.allSettled([savePreview(left), savePreview(right)]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.ok(results[1].reason instanceof PreviewConflictError);
    assert.deepEqual(database.modes, ['readwrite', 'readwrite']);
    assert.equal(database.value().revision, 1);
    assert.deepEqual(Object.keys(database.value().people), ['left']);
    const latest = await savePreview({ ...database.value(), people: { ...database.value().people, ...right.people } });
    assert.equal(latest.revision, 2);
    assert.deepEqual(Object.keys(database.value().people), ['left', 'right']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
