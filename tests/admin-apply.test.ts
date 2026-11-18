import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplyPlan, pendingHistory, uploadPlanImages, validateApplyReceipt } from '../src/admin/apply.ts';
import { emptyStore, type Directory, type PreviewCard } from '../src/admin/model.ts';
import { makeHoldChangeEntry, type ChangeEntry } from '../src/admin/history.ts';
const game = { id: 'game', name: 'ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, theme: null, status: null };
const card: PreviewCard = { id: 'card', event_id: game.id, name: 'カード', source_card_id: '1', source_type: 'defence', card_type: 'guard', rank: 'A', effect_text: '効果', flavor_text: 'フレーバー', publication_status: 'published', created_at: '2026-10-01', imageUrl: 'https://example.com/old.png' };
const directory: Directory = { games: [game], cards: [card], people: [], masters: [], teams: [] };
const entry = (patch: Partial<ChangeEntry> = {}): ChangeEntry => ({ id: 'history', at: '2026-10-01T00:00:00Z', sheet: 'cards', recordId: card.id, recordName: card.name, action: 'update', scope: 'local', actor: 'このブラウザ', changes: [{ label: '名前', before: 'カード', after: '名前を更新' }], ...patch });
test('an existing card applies only edited fields, preserving raw source/publication metadata', () => {
  const store = emptyStore(); store.cards.card = { ...card, name: '名前を更新' }; store.history = [entry()];
  const plan = buildApplyPlan(store, directory);
  assert.deepEqual(plan.operations[0].data, { name: '名前を更新' });
  assert.deepEqual(plan.historyIds, ['history']);
  assert.equal(plan.imageUploads.length, 0);
});
test('explicitly applying new cards publishes them and uses immutable upload batch paths', () => {
  const store = emptyStore(); store.cards.new = { ...card, id: 'new', imageUrl: '' }; store.images['cards:new'] = new Blob(['png'], { type: 'image/png' });
  const plan = buildApplyPlan(store, directory);
  assert.equal(plan.operations[0].data.publication_status, 'published');
  assert.equal(plan.operations[1].table, 'card_images');
  assert.equal(plan.operations[1].data.image_status, 'available');
  assert.equal(plan.operations[1].data.external_url, null);
  assert.equal(plan.imageUploads[0].path, `admin-batches/${plan.batchId}/cards/new.png`);
  assert.equal(plan.operations[1].data.storage_path, plan.imageUploads[0].path);
});
test('a hold is a persisted marker and does not exclude card edits from applying', () => {
  const store = emptyStore(); store.cards.card = { ...card, name: '名前を更新' };
  const hold = makeHoldChangeEntry('cards', card.id, card.name, true);
  store.holds['cards:card'] = { sheet: 'cards', recordId: card.id, at: hold.at };
  store.history = [entry(), hold];
  const plan = buildApplyPlan(store, directory);
  assert.equal(plan.counts.cards, 1); assert.equal(plan.counts.holds, 1);
  assert.deepEqual(plan.operations[1], { table: 'admin_record_flags', id: 'cards:card', action: 'upsert', data: { sheet: 'cards', record_id: 'card', on_hold: true } });
  delete store.holds['cards:card']; store.history.push(makeHoldChangeEntry('cards', card.id, card.name, false));
  assert.equal(buildApplyPlan(store, directory).operations[1].action, 'delete');
});
test('unrelated persisted holds and applied/discarded history are not re-applied', () => {
  const store = emptyStore(); store.holds['games:game'] = { sheet: 'games', recordId: game.id, at: '2026-10-01' };
  store.history = [entry({ id: 'applied', appliedAt: '2026-10-01T01:00:00Z' }), entry({ id: 'discarded', discardedAt: '2026-10-01T02:00:00Z' }), entry({ id: 'pending' })];
  assert.deepEqual(pendingHistory(store).map(row => row.id), ['pending']);
  assert.equal(buildApplyPlan(store, directory).operations.length, 0);
});
test('unapplied hold markers survive a reset of content drafts', () => {
  const store = emptyStore();
  const hold = makeHoldChangeEntry('cards', card.id, card.name, true);
  store.holds['cards:card'] = { sheet: 'cards', recordId: card.id, at: hold.at };
  store.history = [hold, entry({ id: 'reset', sheet: 'all', recordId: null, action: 'reset', discardedAt: '2026-10-01T02:00:00Z' })];
  assert.deepEqual(pendingHistory(store).map(row => row.id), [hold.id]);
  assert.equal(buildApplyPlan(store, directory).operations[0].table, 'admin_record_flags');
});
test('the same removed relation/link is never upserted and deleted in one transaction', () => {
  const store = emptyStore(); store.links.link = { id: 'link', person_id: 'person', event_id: null, kind: 'ブログ', label: 'ブログ', url: 'https://example.com' }; store.removedLinks = ['link'];
  const plan = buildApplyPlan(store, directory);
  assert.deepEqual(plan.operations, [{ table: 'resource_links', id: 'link', action: 'delete', data: {} }]);
});
test('external card/game images are kept as URLs without putting a URL in storage_path', () => {
  const store = emptyStore(); store.cards.new = { ...card, id: 'new', imageUrl: 'https://example.com/new.png' }; store.gameImageUrls[game.id] = 'https://example.com/game.png';
  const images = buildApplyPlan(store, directory).operations.filter(op => ['card_images', 'game_artwork'].includes(op.table));
  assert.equal(images.length, 2); assert.ok(images.every(op => op.data.storage_path === null));
  assert.equal(images[0].data.external_url, 'https://example.com/new.png'); assert.equal(images[1].data.external_url, 'https://example.com/game.png');
  store.gameImageUrls[game.id] = 'javascript:alert(1)'; assert.throws(() => buildApplyPlan(store, directory), /画像URL/);
});
test('an explicit blank image change clears the primary image and game override; a new blank card does not', () => {
  const store = emptyStore(); store.cards.card = { ...card, imageUrl: '' }; store.gameImageUrls[game.id] = '';
  store.history = [entry({ changes: [{ label: '画像', before: '旧画像', after: '未設定' }] })];
  const operations = buildApplyPlan(store, directory).operations;
  assert.equal(operations[0].table, 'card_images'); assert.equal(operations[0].action, 'delete'); assert.deepEqual(operations[0].data, { card_id: card.id });
  assert.equal(operations[1].table, 'game_artwork'); assert.equal(operations[1].action, 'delete');
  const newStore = emptyStore(); newStore.cards.new = { ...card, id: 'new', imageUrl: '' };
  assert.equal(buildApplyPlan(newStore, directory).operations.filter(op => op.table === 'card_images').length, 0);
});
test('only an exact DB receipt can be used to mark the reviewed batch as applied', () => {
  const store = emptyStore(); store.cards.card = { ...card, name: '更新' }; store.history = [entry()]; store.revision = 4;
  const plan = buildApplyPlan(store, directory);
  const result = { batchId: plan.batchId, at: '2026-10-01T01:00:00Z', historyIds: plan.historyIds, storeRevision: plan.storeRevision };
  assert.equal(validateApplyReceipt(result, plan).batchId, plan.batchId);
  assert.throws(() => validateApplyReceipt({ ...result, batchId: 'wrong' }, plan), /反映結果/);
  assert.throws(() => validateApplyReceipt({ ...result, historyIds: [] }, plan), /反映結果/);
  assert.throws(() => validateApplyReceipt({ ...result, storeRevision: 5 }, plan), /反映結果/);
  assert.throws(() => validateApplyReceipt({ ...result, at: 'invalid' }, plan), /反映結果/);
});
test('a large image batch has bounded concurrency and waits for in-flight failures', async () => {
  const images = Array.from({ length: 100 }, (_, index) => ({ path: String(index), blob: new Blob(['image']) }));
  let active = 0, peak = 0, started = 0;
  await uploadPlanImages(images, async () => { started += 1; active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 0)); active -= 1; return { error: null }; });
  assert.equal(started, 100); assert.equal(peak, 4); assert.equal(active, 0);
  started = 0;
  await assert.rejects(uploadPlanImages(images, async path => { started += 1; active += 1; await new Promise(resolve => setTimeout(resolve, 0)); active -= 1; return { error: path === '0' ? { message: '接続失敗' } : null }; }), /DBへの変更は反映していません/);
  assert.equal(started, 4); assert.equal(active, 0);
});
