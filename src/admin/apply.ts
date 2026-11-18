import { assertPublicKey } from '../public-connection';
import { demoMode } from '../supabase';
import { createClient } from '@supabase/supabase-js';
import type { Directory, PreviewStore } from './model';
import { historyStatus, type ChangeEntry, type HistoryTarget } from './history';

type JsonRow = Record<string, unknown>;
export type ApplyOperation = { table: 'events' | 'people' | 'teams' | 'cards' | 'participations' | 'resource_links' | 'card_images' | 'game_artwork' | 'admin_record_flags'; id: string; action: 'upsert' | 'delete'; data: JsonRow; expected?: JsonRow | null };
export type ApplyCounts = { cards: number; people: number; games: number; teams: number; images: number; relations: number; links: number; holds: number };
export type ApplyPlan = { batchId: string; storeRevision: number; historyIds: string[]; operations: ApplyOperation[]; imageUploads: { path: string; blob: Blob }[]; counts: ApplyCounts; localSnapshot: PreviewStore };
export type ReviewedApplyPlan = ApplyPlan & { reviewedAt: string; diffs: { table: string; id: string; before: JsonRow | null; after: JsonRow | null }[] };
export type ApplyReceipt = { batchId: string; at: string; historyIds: string[]; storeRevision: number; counts: ApplyCounts };
type LocalMeta = { holds?: Record<string, { sheet: HistoryTarget; recordId: string; at: string }>; gameImageUrls?: Record<string, string> };
const editableColumns = {
  cards: ['event_id', 'source_card_id', 'name', 'rank', 'card_type', 'effect_text', 'flavor_text'],
  people: ['display_name', 'code_name', 'joined_year'], games: ['name', 'fiscal_year', 'start_date', 'end_date', 'schedule_note'],
  teams: ['event_id', 'display_name', 'rank_value', 'rank_note', 'final_score'],
} as const;
const fieldLabels: Record<string, string> = { '所属ゲーム': 'event_id', 'ID': 'source_card_id', '名前': 'name', 'ゲーム名': 'name', 'チーム名': 'display_name', 'ランク': 'rank', 'タイプ': 'card_type', '効果': 'effect_text', 'カードフレーバー': 'flavor_text', 'コードネーム': 'code_name', '入学年': 'joined_year', '開催年': 'fiscal_year', '開始日': 'start_date', '終了日': 'end_date', '期間の補足': 'schedule_note', '順位': 'rank_value', '順位補足': 'rank_note', '最終得点': 'final_score' };
const url = demoMode ? undefined : import.meta.env?.VITE_SUPABASE_URL ?? (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined);
const key = demoMode ? undefined : import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY : undefined);
assertPublicKey(key);
export const adminProjectUrl = url ?? '';
// A separate storage key keeps authenticated administration out of the public reader.
export const adminClient = createClient(url || 'https://unconfigured.supabase.co', key || 'unconfigured', { auth: { persistSession: !demoMode, autoRefreshToken: !demoMode, detectSessionInUrl: false, storageKey: 'kakurenbo-admin-auth-v1' }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) }) } });
export function pendingHistory(store: PreviewStore) {
  return store.history.filter(entry => historyStatus(entry) === 'unapplied');
}
function pick(row: object, keys: readonly string[]): JsonRow { const source = row as JsonRow; return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]])); }
function externalImage(value: unknown) { if (typeof value !== 'string' || !value) return null; try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } }
export function buildApplyPlan(store: PreviewStore, directory: Directory): ApplyPlan {
  const entries = pendingHistory(store), meta = store as PreviewStore & LocalMeta;
  const batchId = crypto.randomUUID(), operations: ApplyOperation[] = [], imageUploads: ApplyPlan['imageUploads'] = [];
  const counts: ApplyCounts = { cards: 0, people: 0, games: 0, teams: 0, images: 0, relations: 0, links: 0, holds: 0 };
  const entriesByRecord = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.sheet}:${entry.recordId}`;
    const group = entriesByRecord.get(key);
    if (group) group.push(entry); else entriesByRecord.set(key, [entry]);
  }
  const existingCards = new Set(directory.cards.map(card => card.id));
  for (const sheet of ['games', 'people', 'teams', 'cards'] as const) {
    const known = new Set((directory[sheet] ?? []).map(row => row.id));
    for (const row of Object.values(store[sheet])) {
      const relevant = (entriesByRecord.get(`${sheet}:${row.id}`) ?? []).filter(entry => !['hold', 'release'].includes(entry.action));
      // Drafts from old preview versions may predate change history; they are explicitly reviewed in the dialog.
      const isNew = !known.has(row.id), changedKeys = new Set(relevant.flatMap(entry => entry.changes.map(change => sheet === 'people' && change.label === '名前' ? 'display_name' : fieldLabels[change.label])));
      const keys = isNew || !relevant.length ? [...editableColumns[sheet]] : editableColumns[sheet].filter(key => changedKeys.has(key));
      const data = pick(row, keys);
      if (sheet === 'cards' && typeof data.rank === 'string') data.rank = data.rank.toLowerCase();
      if (isNew && sheet === 'cards') data.publication_status = 'published';
      if (Object.keys(data).length) { operations.push({ table: sheet === 'games' ? 'events' : sheet, id: row.id, action: 'upsert', data }); counts[sheet] += 1; }
    }
  }
  for (const [table, rows, removed, count] of [['participations', store.relations, store.removedRelations, 'relations'], ['resource_links', store.links, store.removedLinks, 'links']] as const) {
    const excluded = new Set(removed);
    for (const row of Object.values(rows)) if (!excluded.has(row.id)) { operations.push({ table, id: row.id, action: 'upsert', data: pick(row, table === 'participations' ? ['person_id', 'event_id', 'team_id', 'role_id', 'kind', 'name_at_event', 'status'] : ['person_id', 'event_id', 'kind', 'label', 'url']) }); counts[count] += 1; }
    for (const id of excluded) { operations.push({ table, id, action: 'delete', data: {} }); counts[count] += 1; }
  }
  const imageKeys = new Set(Object.keys(store.images));
  for (const row of Object.values(store.cards)) {
    const changed = (entriesByRecord.get(`cards:${row.id}`) ?? []).some(entry => entry.changes.some(change => change.label === '画像'));
    if (row.imageUrl && (changed || !existingCards.has(row.id)) || changed && existingCards.has(row.id)) imageKeys.add(`cards:${row.id}`);
  }
  for (const id of Object.keys(meta.gameImageUrls ?? {})) imageKeys.add(`games:${id}`);
  for (const imageKey of imageKeys) {
    const [sheet, id] = imageKey.split(':');
    if (sheet !== 'cards' && sheet !== 'games') throw new Error('画像の保存先を確認してください。');
    const blob = store.images[imageKey];
    let path: string | null = null, external: string | null = null;
    if (blob) {
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[blob.type];
      if (!extension || blob.size > 10 * 1024 * 1024) throw new Error('画像はPNG / JPEG / WebPの10MB以下にしてください。');
      path = `admin-batches/${batchId}/${sheet}/${id}.${extension}`; imageUploads.push({ path, blob });
    } else {
      const value = sheet === 'cards' ? store.cards[id]?.imageUrl : meta.gameImageUrls?.[id];
      if (value === '') {
        operations.push({ table: sheet === 'cards' ? 'card_images' : 'game_artwork', id: sheet === 'cards' ? crypto.randomUUID() : id, action: 'delete', data: sheet === 'cards' ? { card_id: id } : {} });
        counts.images += 1;
        continue;
      }
      external = externalImage(value);
      if (!external) throw new Error('画像URLは http / https で入力してください。');
    }
    operations.push({ table: sheet === 'cards' ? 'card_images' : 'game_artwork', id: sheet === 'cards' ? crypto.randomUUID() : id, action: 'upsert', data: sheet === 'cards' ? { card_id: id, role: 'front', display_order: 1, image_status: 'available', storage_path: path, external_url: external } : { storage_path: path, external_url: external } });
    counts.images += 1;
  }
  const touchedHolds = new Map<string, { sheet: HistoryTarget; id: string }>();
  for (const entry of entries) if (entry.recordId && entry.sheet !== 'all' && ['hold', 'release'].includes(entry.action)) touchedHolds.set(`${entry.sheet}:${entry.recordId}`, { sheet: entry.sheet, id: entry.recordId });
  for (const [id, target] of touchedHolds) { const onHold = Boolean(meta.holds?.[id]); operations.push({ table: 'admin_record_flags', id, action: onHold ? 'upsert' : 'delete', data: onHold ? { sheet: target.sheet, record_id: target.id, on_hold: true } : {} }); counts.holds += 1; }
  return { batchId, storeRevision: store.revision, historyIds: entries.map(entry => entry.id), operations, imageUploads, counts, localSnapshot: store };
}
function explainError(error: { code?: string; message?: string }) {
  if (['PGRST202', 'PGRST205', '42P01', '42883', '42703'].includes(error.code ?? '')) return 'Supabaseの反映機能は未設定です。管理用の設定SQLを適用してから再試行してください。';
  if (error.code === '42501') return 'このアカウントには管理者権限がありません。';
  if (error.code === '40001') return '確認後にデータが変更されました。最新の変更内容を確認し直してください。';
  return error.message || '接続できませんでした。下書きは保持されています。';
}
export async function checkAdmin(): Promise<{ id: string; email: string }> {
  const user = await adminClient.auth.getUser();
  if (user.error || !user.data.user) throw new Error('管理者としてログインしてください。');
  const result = await adminClient.rpc('is_game_db_admin');
  if (result.error) throw new Error(explainError(result.error));
  if (!result.data) throw new Error('このアカウントには管理者権限がありません。');
  return { id: user.data.user.id, email: user.data.user.email ?? '' };
}
export async function reviewApplyPlan(plan: ApplyPlan): Promise<ReviewedApplyPlan> {
  await checkAdmin();
  if (!plan.operations.length) throw new Error('反映する変更がありません。');
  const result = await adminClient.rpc('kakurenbo_review_changes', { operations: plan.operations });
  if (result.error) throw new Error(explainError(result.error));
  if (!Array.isArray(result.data) || result.data.length !== plan.operations.length) throw new Error('変更内容の確認結果を取得できませんでした。');
  const operations = result.data as ApplyOperation[];
  return { ...plan, operations, reviewedAt: new Date().toISOString(), diffs: operations.map(op => ({ table: op.table, id: op.id, before: op.expected ?? null, after: op.action === 'delete' ? null : { ...(op.expected ?? {}), ...op.data } })) };
}
export function validateApplyReceipt(value: unknown, plan: ApplyPlan): ApplyReceipt {
  const row = value as Partial<ApplyReceipt> | null;
  if (!row || row.batchId !== plan.batchId || row.storeRevision !== plan.storeRevision || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)) || !Array.isArray(row.historyIds) || row.historyIds.length !== plan.historyIds.length || row.historyIds.some((id, index) => id !== plan.historyIds[index])) throw new Error('DBの反映結果を確認できませんでした。下書きを保持したまま同じ反映を再試行してください。');
  return { batchId: row.batchId, at: row.at, storeRevision: row.storeRevision, historyIds: row.historyIds, counts: plan.counts };
}
export async function uploadPlanImages(images: ApplyPlan['imageUploads'], upload: (path: string, blob: Blob) => Promise<{ error: { statusCode?: number | string; message: string } | null }>, onProgress?: (message: string) => void) {
  let next = 0, completed = 0, failure: Error | null = null;
  // Bound concurrency for a game with hundreds of images; await every in-flight
  // upload before reporting failure, and never start the DB transaction on failure.
  await Promise.all(Array.from({ length: Math.min(4, images.length) }, async () => {
    while (!failure) {
      const index = next++; if (index >= images.length) return;
      const image = images[index];
      try {
        const result = await upload(image.path, image.blob);
        if (result.error && !['409', 'Duplicate'].includes(String(result.error.statusCode ?? '')) && !/already exists/i.test(result.error.message)) throw new Error(result.error.message);
        completed += 1; onProgress?.(`画像を保存しています… ${completed} / ${images.length}`);
      } catch (cause) { failure = new Error(`画像を保存できませんでした。DBへの変更は反映していません。${cause instanceof Error ? cause.message : ''}`); }
    }
  }));
  if (failure) throw failure;
}
export async function applyReviewedPlan(plan: ReviewedApplyPlan, onProgress?: (message: string) => void): Promise<ApplyReceipt> {
  const confirmed = await fetchApplyReceipt(plan);
  if (confirmed) return confirmed;
  // File paths are unique to the immutable batch. They are never used by the public app before the SQL commit.
  if (plan.imageUploads.length) onProgress?.(`画像を保存しています… 0 / ${plan.imageUploads.length}`);
  // A retry may find the same immutable file after a lost response.
  await uploadPlanImages(plan.imageUploads, (path, blob) => adminClient.storage.from('card-images').upload(path, blob, { upsert: false, contentType: blob.type }), onProgress);
  onProgress?.('変更をまとめて反映しています…');
  const included = new Set(plan.historyIds);
  const result = await adminClient.rpc('kakurenbo_apply_changes', { batch_id: plan.batchId, payload: { storeRevision: plan.storeRevision, historyIds: plan.historyIds, historyEntries: plan.localSnapshot.history.filter(entry => included.has(entry.id)), counts: plan.counts, operations: plan.operations } });
  if (result.error) throw new Error(explainError(result.error));
  return validateApplyReceipt(result.data, plan);
}
export async function fetchApplyReceipt(plan: ApplyPlan): Promise<ApplyReceipt | null> {
  await checkAdmin();
  const result = await adminClient.rpc('kakurenbo_get_apply_receipt', { batch_id: plan.batchId });
  if (result.error) throw new Error(explainError(result.error));
  return result.data === null ? null : validateApplyReceipt(result.data, plan);
}
export async function cancelApplyAttempt(plan: ApplyPlan): Promise<ApplyReceipt | null> {
  await checkAdmin();
  const result = await adminClient.rpc('kakurenbo_cancel_apply_batch', { batch_id: plan.batchId });
  if (result.error) throw new Error(explainError(result.error));
  return result.data === null ? null : validateApplyReceipt(result.data, plan);
}
export type AdminHistoryCursor = { at: string; id: string };
type AuditBatch = { batchId: string; at: string; actor: string; historyEntries?: unknown[]; operations?: ApplyOperation[]; receipt?: ApplyReceipt };
const auditNames: Record<string, string> = { events: 'ゲーム', cards: 'カード', people: '人', teams: 'チーム', card_images: 'カード画像', game_artwork: 'ゲーム画像', participations: '参加履歴', resource_links: 'リンク', admin_record_flags: '保留' };
const auditFields = Object.fromEntries(Object.entries(fieldLabels).map(([label, field]) => [field, label]));
function auditText(value: unknown) { return value === undefined || value === null || value === '' ? '未設定' : typeof value === 'object' ? JSON.stringify(value) : String(value); }
export function auditBatchEntries(batch: AuditBatch): ChangeEntry[] {
  if (!batch.batchId || !Number.isFinite(Date.parse(batch.at))) throw new Error('変更履歴の形式を確認できませんでした。');
  const stored = (batch.historyEntries ?? []).filter((value): value is ChangeEntry => {
    const entry = value as Partial<ChangeEntry> | null;
    return Boolean(entry && typeof entry.id === 'string' && ['cards', 'people', 'games', 'teams'].includes(entry.sheet ?? '') && typeof entry.recordId === 'string' && typeof entry.recordName === 'string' && ['create', 'update', 'hold', 'release'].includes(entry.action ?? '') && Array.isArray(entry.changes) && entry.changes.every(change => typeof change.label === 'string' && typeof change.before === 'string' && typeof change.after === 'string'));
  });
  if (stored.length) return stored.map(entry => ({ ...entry, actor: batch.actor, appliedAt: batch.at, applyBatchId: batch.batchId, discardedAt: null }));
  // Earlier receipts have operations but no UI history snapshots. Show their
  // database changes so a fresh browser still has a complete audit trail.
  return (batch.operations ?? []).flatMap((operation, index): ChangeEntry[] => {
    const data = operation.data, before = operation.expected ?? {}, table = operation.table;
    const flag = operation.id.split(':');
    const relationPerson = data.person_id ?? before.person_id, relationEvent = data.event_id ?? before.event_id;
    const sheet: HistoryTarget | 'all' = table === 'events' || table === 'game_artwork' ? 'games' : table === 'cards' || table === 'card_images' ? 'cards' : table === 'teams' ? 'teams' : table === 'admin_record_flags' ? (data.sheet ?? before.sheet ?? flag[0]) as HistoryTarget : table === 'participations' || table === 'resource_links' ? relationPerson ? 'people' : relationEvent ? 'games' : 'all' : 'people';
    const recordId = table === 'card_images' ? String(data.card_id ?? before.card_id) : table === 'admin_record_flags' ? String(data.record_id ?? before.record_id ?? flag[1]) : table === 'participations' || table === 'resource_links' ? relationPerson || relationEvent ? String(relationPerson ?? relationEvent) : null : operation.id;
    const changes = operation.action === 'delete' ? [{ label: auditNames[table], before: '登録済み', after: '解除' }] : Object.entries(data).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(before[field])).map(([field, value]) => ({ label: auditFields[field] ?? field, before: operation.expected === null ? '未登録' : auditText(before[field]), after: auditText(value) }));
    if (!changes.length) return [];
    return [{ id: `${batch.batchId}:${index}`, at: batch.at, sheet, recordId, recordName: String(data.name ?? data.display_name ?? before.name ?? before.display_name ?? data.label ?? before.label ?? auditNames[table]), action: table === 'admin_record_flags' ? operation.action === 'delete' ? 'release' : 'hold' : ['cards', 'events', 'people', 'teams'].includes(table) && operation.expected === null ? 'create' : 'update', changes, scope: 'local', actor: batch.actor, appliedAt: batch.at, applyBatchId: batch.batchId }];
  });
}
export async function fetchAdminHistoryPage(cursor?: AdminHistoryCursor, pageSize = 20): Promise<{ entries: ChangeEntry[]; nextCursor: AdminHistoryCursor | null }> {
  await checkAdmin();
  const result = await adminClient.rpc('kakurenbo_list_apply_batches', { before_at: cursor?.at ?? null, before_id: cursor?.id ?? null, page_size: pageSize });
  if (result.error) throw new Error(explainError(result.error));
  if (!Array.isArray(result.data)) throw new Error('変更履歴を取得できませんでした。');
  const batches = result.data as AuditBatch[], last = batches[batches.length - 1];
  return { entries: batches.flatMap(auditBatchEntries), nextCursor: batches.length === pageSize && last ? { at: last.at, id: last.batchId } : null };
}
export async function fetchAdminHolds() {
  await checkAdmin();
  const holds: NonNullable<LocalMeta['holds']> = {};
  for (let from = 0; ; from += 1000) {
    const result = await adminClient.from('admin_record_flags').select('id,sheet,record_id,updated_at').eq('on_hold', true).order('id').range(from, from + 999);
    if (result.error) throw new Error(explainError(result.error));
    const rows = result.data ?? [];
    for (const row of rows) holds[row.id] = { sheet: row.sheet as HistoryTarget, recordId: row.record_id as string, at: row.updated_at as string };
    if (rows.length < 1000) return holds;
  }
}
