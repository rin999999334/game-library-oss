import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore } from '../src/admin/model.ts';
import { backupCounts, exportDraftBackup, MAX_BACKUP_BYTES, readDraftBackup } from '../src/admin/draft-backup.ts';
const cardId = '10000000-0000-4000-8000-000000000001', gameId = '10000000-0000-4000-8000-000000000002', personId = '10000000-0000-4000-8000-000000000003', relationId = '10000000-0000-4000-8000-000000000004', historyId = '10000000-0000-4000-8000-000000000005', batchId = '10000000-0000-4000-8000-000000000006';
function fixture() {
  const store = emptyStore(); store.revision = 19;
  store.games[gameId] = { id: gameId, name: 'ゲーム', fiscal_year: 2026, start_date: '2026-10-01', end_date: null, schedule_note: null, theme: null, status: null };
  store.cards[cardId] = { id: cardId, event_id: gameId, name: 'カード', source_card_id: '001', source_type: '原文', card_type: 'quick', rank: 'A', effect_text: '効果\n2行目', flavor_text: null, publication_status: 'draft', created_at: '2026-10-01T00:00:00.000Z', imageUrl: '' };
  store.people[personId] = { id: personId, display_name: '人', code_name: null, joined_year: 2020 };
  store.relations[relationId] = { id: relationId, event_id: gameId, person_id: personId, team_id: null, role_id: null, kind: 'participant', status: 'attended', name_at_event: '当時の名前' };
  store.history = [{ id: historyId, at: '2026-10-01T00:00:00.000Z', sheet: 'cards', recordId: cardId, recordName: 'カード', action: 'update', changes: [{ label: '名前', before: '以前', after: 'カード' }], scope: 'local', actor: 'このブラウザ', appliedAt: '2026-10-01T01:00:00.000Z', applyBatchId: batchId }];
  store.holds[`cards:${cardId}`] = { sheet: 'cards', recordId: cardId, at: '2026-10-01T00:00:00.000Z' };
  store.images[`cards:${cardId}`] = new Blob([new Uint8Array([0, 127, 255, 10, 42])], { type: 'image/png' });
  return store;
}
test('backup round trip retains raw fields, relationship identity, work markers, history and image bytes', async () => {
  const store = fixture(), file = await exportDraftBackup(store), restored = await readDraftBackup(file, 42);
  assert.deepEqual(restored.cards, store.cards);
  assert.deepEqual(restored.people, store.people);
  assert.deepEqual(restored.games, store.games);
  assert.deepEqual(restored.relations, store.relations);
  assert.deepEqual(restored.holds, store.holds);
  assert.deepEqual(restored.history, store.history);
  assert.equal(restored.revision, 42);
  assert.deepEqual(new Uint8Array(await restored.images[`cards:${cardId}`].arrayBuffer()), new Uint8Array([0, 127, 255, 10, 42]));
  assert.equal(restored.images[`cards:${cardId}`].type, 'image/png');
  assert.deepEqual(backupCounts(restored), { cards: 1, people: 1, games: 1, teams: 0, images: 1, history: 1, holds: 1 });
  assert.equal(store.revision, 19);
});
test('export excludes session-like extra properties from the store and its rows', async () => {
  const store = fixture() as ReturnType<typeof fixture> & { access_token?: string };
  store.access_token = 'secret-session-token';
  Object.assign(store.people[personId], { refresh_token: 'another-session-token' });
  const text = await (await exportDraftBackup(store)).text();
  assert.ok(!text.includes('secret-session-token')); assert.ok(!text.includes('another-session-token'));
  const restored = await readDraftBackup(new Blob([text]), 0);
  assert.equal('refresh_token' in restored.people[personId], false);
});
test('a broken map identity or invalid version is rejected without mutating the current store', async () => {
  const store = fixture(), root = JSON.parse(await (await exportDraftBackup(store)).text());
  root.store.cards[cardId].id = personId;
  await assert.rejects(readDraftBackup(new Blob([JSON.stringify(root)]), store.revision), /識別子/);
  assert.equal(store.cards[cardId].id, cardId);
  root.store.cards[cardId].id = cardId; root.version = 9;
  await assert.rejects(readDraftBackup(new Blob([JSON.stringify(root)]), 0), /形式/);
});
test('malformed image content, unsupported MIME and mismatched work marker identities are rejected', async () => {
  const encoded = await (await exportDraftBackup(fixture())).text();
  for (const mutate of [
    (root: any) => { root.store.images[`cards:${cardId}`].data = '@@@@'; },
    (root: any) => { root.store.images[`cards:${cardId}`].size = 100; },
    (root: any) => { root.store.images[`cards:${cardId}`].type = 'text/html'; },
    (root: any) => { root.store.holds[`cards:${cardId}`].recordId = personId; },
  ]) {
    const root = JSON.parse(encoded); mutate(root);
    await assert.rejects(readDraftBackup(new Blob([JSON.stringify(root)]), 0));
  }
});
test('oversized imports are rejected before reading their content', async () => {
  let read = false;
  const file = { size: MAX_BACKUP_BYTES + 1, text: async () => { read = true; return '{}'; } } as Blob;
  await assert.rejects(readDraftBackup(file, 0), /100MB/);
  assert.equal(read, false);
});
test('a maximum-size supported image decodes without regular-expression stack growth', async () => {
  const store = fixture(), bytes = new Uint8Array(10 * 1024 * 1024); bytes[0] = 255; bytes[bytes.length - 1] = 42;
  store.images[`cards:${cardId}`] = new Blob([bytes], { type: 'image/webp' });
  const restored = await readDraftBackup(await exportDraftBackup(store), 0);
  const result = new Uint8Array(await restored.images[`cards:${cardId}`].arrayBuffer());
  assert.equal(result.length, bytes.length); assert.equal(result[0], 255); assert.equal(result[result.length - 1], 42);
});
test('complete drafts never invoke the optional remote hydrator', async () => {
  let requested = false;
  await exportDraftBackup(fixture(), async () => { requested = true; throw new Error('must not fetch'); });
  assert.equal(requested, false);
});
test('legacy missing fields are filled for export only while existing null, empty and raw source values survive', async () => {
  const store = fixture(), remote = { ...store.cards[cardId], effect_text: 'DBの効果', flavor_text: 'DBのフレーバー', imageUrl: 'https://example.com/db-image.png', created_at: '2025-01-01T00:00:00.000Z', source_type: 'DBの原文種別' };
  const raw = { ...store.cards[cardId], effect_text: null, flavor_text: '', source_type: '未整理の原文種別' } as Record<string, unknown>;
  delete raw.created_at; delete raw.imageUrl;
  Object.assign(store.cards, { [cardId]: raw });
  const requested: { table: string; ids: string[] }[] = [];
  const restored = await readDraftBackup(await exportDraftBackup(store, async (table, ids) => { requested.push({ table, ids }); return [remote]; }), 0);
  assert.deepEqual(requested, [{ table: 'cards', ids: [cardId] }]);
  assert.equal(restored.cards[cardId].created_at, remote.created_at);
  assert.equal(restored.cards[cardId].imageUrl, remote.imageUrl);
  assert.equal(restored.cards[cardId].effect_text, null);
  assert.equal(restored.cards[cardId].flavor_text, '');
  assert.equal(restored.cards[cardId].source_type, '未整理の原文種別');
  assert.equal(Object.hasOwn(store.cards[cardId], 'created_at'), false);
  assert.equal(Object.hasOwn(store.cards[cardId], 'imageUrl'), false);
});
test('unreadable or nonexistent legacy rows fail concretely instead of inventing missing values', async () => {
  const store = fixture(), raw = { ...store.cards[cardId] } as Record<string, unknown>; delete raw.created_at; Object.assign(store.cards, { [cardId]: raw });
  for (const hydrate of [undefined, async () => [], async () => { throw new Error('network unavailable'); }]) await assert.rejects(exportDraftBackup(store, hydrate), /カード.*保存し直してください/);
  assert.equal(Object.hasOwn(store.cards[cardId], 'created_at'), false);
});
