import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../database';
import type { PreviewCard, PreviewStore, Sheet } from './model';
export type ChangeField = { label: string; before: string; after: string };
export type HistoryTarget = Sheet | 'teams';
export type WorkHold = { sheet: HistoryTarget; recordId: string; at: string };
export type HistoryStatus = 'unapplied' | 'applied' | 'discarded';
export type ChangeEntry = { id: string; at: string; sheet: HistoryTarget | 'all'; recordId: string | null; recordName: string; action: 'create' | 'update' | 'reset' | 'hold' | 'release'; changes: ChangeField[]; scope: 'local'; actor: string; appliedAt?: string | null; applyBatchId?: string; discardedAt?: string | null };
export type ChangeSnapshot = { row: PreviewCard | PersonRow | EventRow; relations: ParticipationRow[]; links: LinkRow[] };
const fieldNames: Record<string, string> = { name: '名前', display_name: '名前', code_name: 'コードネーム', joined_year: '入学年', event_id: '所属ゲーム', source_card_id: 'ID', rank: 'ランク', card_type: 'タイプ', effect_text: '効果', flavor_text: 'カードフレーバー', start_date: '開始日', end_date: '終了日', fiscal_year: '開催年', schedule_note: '期間の補足', kind: '参加区分', name_at_event: '参加時の名前', status: '参加状態' };
const fields: Record<Sheet, string[]> = { cards: ['event_id', 'source_card_id', 'name', 'rank', 'card_type', 'effect_text', 'flavor_text'], people: ['display_name', 'code_name', 'joined_year'], games: ['name', 'fiscal_year', 'start_date', 'end_date', 'schedule_note'] };
export function workHoldKey(sheet: HistoryTarget, recordId: string) { return `${sheet}:${recordId}`; }
export function historyStatus(entry: ChangeEntry): HistoryStatus {
  if (entry.appliedAt) return 'applied';
  if (entry.discardedAt || entry.action === 'reset') return 'discarded';
  return 'unapplied';
}
export function unappliedHistory(entries: readonly ChangeEntry[]) { return entries.filter(entry => historyStatus(entry) === 'unapplied'); }
export function discardUnappliedHistory(entries: readonly ChangeEntry[], at = new Date().toISOString()): ChangeEntry[] {
  return entries.map(entry => historyStatus(entry) === 'unapplied' ? { ...entry, discardedAt: at } : entry);
}
// Call only after the backend confirms this exact batch. Applied history never changes on retry.
export function markHistoryApplied(entries: readonly ChangeEntry[], entryIds: readonly string[], applyBatchId: string, appliedAt: string): ChangeEntry[] {
  if (!applyBatchId || !appliedAt || !Number.isFinite(Date.parse(appliedAt))) throw new Error('反映結果の日時とIDが必要です。');
  const included = new Set(entryIds);
  return entries.map(entry => included.has(entry.id) && historyStatus(entry) === 'unapplied' ? { ...entry, appliedAt, applyBatchId } : entry);
}
export function makeHoldChangeEntry(sheet: HistoryTarget, recordId: string, recordName: string, held: boolean): ChangeEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), sheet, recordId, recordName, action: held ? 'hold' : 'release', changes: [{ label: '作業ステータス', before: held ? 'なし' : '保留', after: held ? '保留' : 'なし' }], scope: 'local', actor: 'このブラウザ' };
}
function text(value: unknown): string { return value === null || value === undefined || value === '' ? '未設定' : String(value); }
function valueLabel(key: string, value: unknown, names: Map<string, string>) { return key === 'event_id' ? names.get(String(value)) ?? text(value) : key === 'kind' ? value === 'master' ? 'マスター' : value === 'participant' ? '参加者' : text(value) : text(value); }
export function makeChangeEntry(sheet: Sheet, before: ChangeSnapshot, after: ChangeSnapshot, isNew: boolean, names: Map<string, string>, imageChanged: boolean): ChangeEntry | null {
  const changes: ChangeField[] = [], oldRow = before.row as unknown as Record<string, unknown>, newRow = after.row as unknown as Record<string, unknown>;
  for (const key of fields[sheet]) if ((isNew && newRow[key] !== null && newRow[key] !== '') || oldRow[key] !== newRow[key]) changes.push({ label: sheet === 'games' && key === 'name' ? 'ゲーム名' : fieldNames[key], before: isNew ? '未登録' : valueLabel(key, oldRow[key], names), after: valueLabel(key, newRow[key], names) });
  const beforeRelations = new Map(before.relations.map(row => [row.id, row])), afterRelations = new Map(after.relations.map(row => [row.id, row]));
  for (const id of new Set([...beforeRelations.keys(), ...afterRelations.keys()])) {
    const oldRel = beforeRelations.get(id), newRel = afterRelations.get(id), rel = newRel ?? oldRel!;
    const target = names.get(sheet === 'people' ? rel.event_id : rel.person_id) ?? '関連する記録';
    const label = `${sheet === 'people' ? '参加履歴' : 'マスター'} · ${target}`;
    if (!oldRel || !newRel) changes.push({ label, before: oldRel ? valueLabel('kind', oldRel.kind, names) : '未登録', after: newRel ? valueLabel('kind', newRel.kind, names) : '解除' });
    else for (const key of ['kind', 'name_at_event', 'status'] as const) if (oldRel[key] !== newRel[key]) changes.push({ label: `${label} / ${fieldNames[key]}`, before: valueLabel(key, oldRel[key], names), after: valueLabel(key, newRel[key], names) });
  }
  const oldLinks = new Map(before.links.map(link => [link.id, link])), newLinks = new Map(after.links.map(link => [link.id, link]));
  for (const id of new Set([...oldLinks.keys(), ...newLinks.keys()])) {
    const oldLink = oldLinks.get(id), newLink = newLinks.get(id);
    if (oldLink?.url !== newLink?.url || oldLink?.label !== newLink?.label) changes.push({ label: `リンク · ${newLink?.label || oldLink?.label || '外部リンク'}`, before: oldLink ? `${oldLink.label} ${oldLink.url}` : '未登録', after: newLink ? `${newLink.label} ${newLink.url}` : '解除' });
  }
  if (imageChanged) changes.push({ label: '画像', before: isNew ? '未登録' : '変更前の画像', after: '画像を差し替え' });
  if (!changes.length) return null;
  return { id: crypto.randomUUID(), at: new Date().toISOString(), sheet, recordId: after.row.id, recordName: 'display_name' in after.row ? after.row.display_name : after.row.name, action: isNew ? 'create' : 'update', changes, actor: 'このブラウザ', scope: 'local' };
}
export function resetChangeEntry(store: PreviewStore): ChangeEntry {
  const changes: ChangeField[] = (['cards', 'people', 'games', 'teams'] as const).flatMap(sheet => Object.values(store[sheet] ?? {}).map(row => ({ label: 'display_name' in row ? row.display_name : row.name, before: '保存した下書き', after: '読み込んだデータに戻す' })));
  const at = new Date().toISOString();
  return { id: crypto.randomUUID(), at, sheet: 'all', recordId: null, recordName: '下書きをすべて解除', action: 'reset', changes, scope: 'local', actor: 'このブラウザ', discardedAt: at };
}

// Server receipts are authoritative; local pending edits remain visible alongside them.
export function mergeAuditHistory(local: readonly ChangeEntry[], remote: readonly ChangeEntry[]): ChangeEntry[] {
  const entries = new Map(local.map(entry => [entry.id, entry]));
  for (const entry of remote) entries.set(entry.id, entry);
  return [...entries.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
