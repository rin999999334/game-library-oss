import type { PreviewStore } from './model';
import { emptyStore } from './model';
import type { ChangeEntry, WorkHold } from './history';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FORMAT = 'kakurenbo-admin-draft-backup';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const targets = ['cards', 'people', 'games', 'teams'] as const;
const fail = (message = 'ファイルの形式が正しくありません。かくれんぼから書き出したバックアップを選んでください。'): never => { throw new Error(message); };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown>; }
function id(value: unknown): string { if (typeof value !== 'string' || !uuidPattern.test(value)) fail('記録の識別子が正しくありません。バックアップを確認してください。'); return value as string; }
function string(value: unknown): string { if (typeof value !== 'string') fail(); return value as string; }
function timestamp(value: unknown): string { const result = string(value); if (!Number.isFinite(Date.parse(result))) fail(); return result; }
type FieldKind = 'string' | 'nullableString' | 'number' | 'id' | 'nullableId';
const shapes: Record<'cards' | 'people' | 'games' | 'teams' | 'relations' | 'links', Record<string, FieldKind>> = {
  cards: { id: 'id', event_id: 'id', name: 'string', source_card_id: 'nullableString', source_type: 'nullableString', card_type: 'nullableString', rank: 'nullableString', effect_text: 'nullableString', flavor_text: 'nullableString', publication_status: 'string', created_at: 'string', imageUrl: 'string' },
  people: { id: 'id', display_name: 'string', code_name: 'nullableString', joined_year: 'number' },
  games: { id: 'id', name: 'string', fiscal_year: 'number', start_date: 'nullableString', end_date: 'nullableString', schedule_note: 'nullableString', status: 'nullableString', theme: 'nullableString' },
  teams: { id: 'id', event_id: 'id', display_name: 'string', rank_value: 'number', rank_note: 'nullableString', final_score: 'number' },
  relations: { id: 'id', person_id: 'id', event_id: 'id', team_id: 'nullableId', role_id: 'nullableId', kind: 'nullableString', name_at_event: 'nullableString', status: 'string' },
  links: { id: 'id', person_id: 'nullableId', event_id: 'nullableId', kind: 'string', label: 'string', url: 'string' },
};
export type BackupTable = keyof typeof shapes;
export type BackupHydrator = (table: BackupTable, ids: string[]) => Promise<readonly { id: string }[]>;
function field(value: unknown, kind: FieldKind): unknown {
  if (value === null && ['nullableString', 'nullableId', 'number'].includes(kind)) return null;
  if (kind === 'id' || kind === 'nullableId') return id(value);
  if (kind === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) fail(); return value; }
  return string(value);
}
function rowMap(value: unknown, shape: Record<string, FieldKind>) {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, input] of Object.entries(object(value))) {
    const row = object(input); id(key);
    if (row.id !== key) fail('一覧の識別子と記録の識別子が一致しません。');
    result[key] = Object.fromEntries(Object.entries(shape).map(([key, kind]) => [key, field(row[key], kind)]));
  }
  return result;
}
async function exportRowMap(value: unknown, table: BackupTable, hydrate?: BackupHydrator) {
  const rows = object(value), shape = shapes[table];
  const missing = Object.entries(rows).filter(([key, input]) => { const row = object(input); id(key); if (row.id !== key) fail('一覧の識別子と記録の識別子が一致しません。'); return Object.keys(shape).some(field => row[field] === undefined); });
  if (!missing.length) return rowMap(rows, shape);
  const label = (input: unknown, key: string) => { const row = object(input); return typeof row.display_name === 'string' ? row.display_name : typeof row.name === 'string' ? row.name : key; };
  const incomplete = (input: unknown, key: string): never => fail(`「${label(input, key)}」の不足している項目を補完できませんでした。該当記録を開いて保存し直してください。`);
  if (!hydrate) incomplete(missing[0][1], missing[0][0]);
  let loaded: readonly { id: string }[];
  try { loaded = await hydrate!(table, missing.map(([key]) => key)); } catch { return incomplete(missing[0][1], missing[0][0]); }
  const fetched = new Map(loaded.map(row => [row.id, object(row)])), copies = { ...rows };
  for (const [key, input] of missing) {
    const row = object(input), source = fetched.get(key);
    if (!source) incomplete(input, key);
    const copy = { ...row };
    for (const field of Object.keys(shape)) if (copy[field] === undefined) {
      if (source![field] === undefined) incomplete(input, key);
      copy[field] = source![field];
    }
    copies[key] = copy;
  }
  return rowMap(copies, shape);
}
function ids(value: unknown): string[] { if (!Array.isArray(value)) fail(); return [...new Set((value as unknown[]).map(id))]; }
function historyEntries(value: unknown): ChangeEntry[] {
  if (!Array.isArray(value)) fail();
  const seen = new Set<string>();
  return (value as unknown[]).map(input => {
    const entry = object(input), entryId = id(entry.id);
    if (seen.has(entryId)) fail('変更履歴の識別子が重複しています。'); seen.add(entryId);
    if (![...targets, 'all'].includes(entry.sheet as 'cards') || !['create', 'update', 'reset', 'hold', 'release'].includes(string(entry.action)) || entry.scope !== 'local' || !Array.isArray(entry.changes)) fail();
    const result: ChangeEntry = { id: entryId, at: timestamp(entry.at), sheet: entry.sheet as ChangeEntry['sheet'], recordId: entry.recordId === null ? null : id(entry.recordId), recordName: string(entry.recordName), action: entry.action as ChangeEntry['action'], changes: (entry.changes as unknown[]).map(input => { const change = object(input); return { label: string(change.label), before: string(change.before), after: string(change.after) }; }), scope: 'local', actor: string(entry.actor) };
    if (entry.appliedAt !== undefined) result.appliedAt = entry.appliedAt === null ? null : timestamp(entry.appliedAt);
    if (entry.discardedAt !== undefined) result.discardedAt = entry.discardedAt === null ? null : timestamp(entry.discardedAt);
    if (entry.applyBatchId !== undefined) result.applyBatchId = id(entry.applyBatchId);
    return result;
  });
}
function holds(value: unknown): Record<string, WorkHold> {
  const result: Record<string, WorkHold> = {};
  for (const [key, input] of Object.entries(object(value))) {
    const row = object(input), recordId = id(row.recordId);
    if (!targets.includes(row.sheet as 'cards') || key !== `${row.sheet}:${recordId}`) fail('保留の識別子が一致しません。');
    result[key] = { sheet: row.sheet as WorkHold['sheet'], recordId, at: timestamp(row.at) };
  }
  return result;
}
function imageKey(value: string) { const [sheet, recordId, extra] = value.split(':'); if (!['cards', 'games'].includes(sheet) || extra !== undefined) fail('画像の関連付け先が正しくありません。'); id(recordId); return value; }
function encode(bytes: Uint8Array) { let binary = ''; for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768)); return btoa(binary); }
function decode(value: unknown, expected: number): Uint8Array<ArrayBuffer> {
  const text = string(value);
  if (text.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || text.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(text)) fail('画像のデータが正しくありません。');
  let binary: string; try { binary = atob(text); } catch { return fail('画像のデータを読み込めませんでした。'); }
  if (binary.length !== expected) fail('画像のサイズが一致しません。');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function backupCounts(store: PreviewStore) { return { cards: Object.keys(store.cards).length, people: Object.keys(store.people).length, games: Object.keys(store.games).length, teams: Object.keys(store.teams).length, images: Object.keys(store.images).length, history: store.history.length, holds: Object.keys(store.holds).length }; }
export async function exportDraftBackup(store: PreviewStore, hydrate?: BackupHydrator): Promise<Blob> {
  const imageBytes = Object.values(store.images).reduce((total, blob) => total + blob.size, 0);
  if (imageBytes * 4 / 3 > MAX_BACKUP_BYTES) fail('画像を含めたバックアップが100MBを超えます。');
  const rows = Object.fromEntries(await Promise.all((Object.keys(shapes) as BackupTable[]).map(async table => [table, await exportRowMap(store[table], table, hydrate)])));
  const images: Record<string, { type: string; size: number; data: string }> = {};
  for (const [key, image] of Object.entries(store.images)) {
    imageKey(key);
    if (image.size > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) fail('画像は PNG / JPEG / WebP の10MB以下にしてください。');
    images[key] = { type: image.type, size: image.size, data: encode(new Uint8Array(await image.arrayBuffer())) };
  }
  // Explicit fields keep authentication/session storage outside the backup.
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), store: { version: 1, revision: store.revision, ...rows, removedRelations: ids(store.removedRelations), removedLinks: ids(store.removedLinks), gameImageUrls: store.gameImageUrls, holds: holds(store.holds), history: historyEntries(store.history), images, savedAt: store.savedAt } };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) fail('バックアップが100MBを超えます。');
  return blob;
}
export async function readDraftBackup(file: Blob, currentRevision: number): Promise<PreviewStore> {
  if (file.size > MAX_BACKUP_BYTES) fail('バックアップは100MB以下のファイルを選んでください。');
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) fail();
  let parsed: unknown; try { parsed = JSON.parse(await file.text()); } catch { return fail(); }
  const root = object(parsed);
  if (root.format !== FORMAT || root.version !== 1) fail();
  timestamp(root.exportedAt);
  const saved = object(root.store); if (saved.version !== 1) fail();
  const result = emptyStore(); result.revision = currentRevision;
  for (const key of Object.keys(shapes) as (keyof typeof shapes)[]) Object.assign(result, { [key]: rowMap(saved[key], shapes[key]) });
  result.removedRelations = ids(saved.removedRelations); result.removedLinks = ids(saved.removedLinks); result.history = historyEntries(saved.history); result.holds = holds(saved.holds ?? {});
  result.gameImageUrls = Object.fromEntries(Object.entries(object(saved.gameImageUrls ?? {})).map(([key, value]) => [id(key), string(value)]));
  for (const [key, input] of Object.entries(object(saved.images))) {
    const row = object(input), type = string(row.type), size = row.size;
    imageKey(key);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type) || typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_IMAGE_BYTES) fail('画像の形式やサイズが正しくありません。');
    result.images[key] = new Blob([decode(row.data, size as number)], { type });
  }
  result.savedAt = new Date().toISOString();
  return result;
}
