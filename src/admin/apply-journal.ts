import { adminProjectUrl, validateApplyReceipt, type ApplyReceipt, type ReviewedApplyPlan } from './apply';

export type ApplyJournal = { version: 1; projectUrl: string; actorId: string; actorEmail: string; startedAt: string; plan: ReviewedApplyPlan; receipt: ApplyReceipt | null };
export class ApplyJournalConflictError extends Error {
  constructor() { super('前回の反映がまだ完了していません。先に前回の反映結果を確認してください。'); this.name = 'ApplyJournalConflictError'; }
}
const DATABASE = 'kakurenbo-admin-apply-v1';
export function restoreApplyJournal(value: unknown): ApplyJournal | null {
  if (value === undefined || value === null) return null;
  const journal = value as Partial<ApplyJournal>;
  const plan = journal.plan;
  if (journal.version !== 1 || typeof journal.projectUrl !== 'string' || typeof journal.actorId !== 'string' || typeof journal.startedAt !== 'string' || !Number.isFinite(Date.parse(journal.startedAt)) || !plan || typeof plan.batchId !== 'string' || !Number.isSafeInteger(plan.storeRevision) || !Array.isArray(plan.operations) || !Array.isArray(plan.historyIds) || !Array.isArray(plan.imageUploads) || !plan.localSnapshot || !Array.isArray(plan.localSnapshot.history) || !plan.imageUploads.every(image => typeof image.path === 'string' && image.blob instanceof Blob)) throw new Error('前回の反映記録を読み込めませんでした。ブラウザのデータを消さず、管理者に確認してください。');
  if (journal.receipt) validateApplyReceipt(journal.receipt, plan);
  return journal as ApplyJournal;
}
export function reviseApplyJournal(current: ApplyJournal | null, next: ApplyJournal): ApplyJournal {
  restoreApplyJournal(next);
  if (current && (current.plan.batchId !== next.plan.batchId || current.actorId !== next.actorId || current.projectUrl !== next.projectUrl)) throw new ApplyJournalConflictError();
  if (current?.receipt && JSON.stringify(current.receipt) !== JSON.stringify(next.receipt)) throw new Error('確認済みの反映結果は変更できません。');
  return next;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('batches');
    request.onerror = () => reject(new Error('反映の再開記録を保存できません。ブラウザの空き容量を確認してください。'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readApplyJournal(projectUrl = adminProjectUrl): Promise<ApplyJournal | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('batches', 'readonly'), request = transaction.objectStore('batches').get(projectUrl);
    let value: ApplyJournal | null = null, failure: unknown;
    request.onsuccess = () => { try { value = restoreApplyJournal(request.result); } catch (cause) { failure = cause; } };
    transaction.oncomplete = () => { db.close(); if (failure) reject(failure); else resolve(value); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(failure ?? new Error('前回の反映記録を読み込めませんでした。')); };
  });
}
export async function saveApplyJournal(journal: ApplyJournal): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('batches', 'readwrite'), records = transaction.objectStore('batches'), request = records.get(journal.projectUrl);
    let failure: unknown;
    request.onsuccess = () => { try { records.put(reviseApplyJournal(restoreApplyJournal(request.result), journal), journal.projectUrl); } catch (cause) { failure = cause; transaction.abort(); } };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(failure ?? new Error('反映の再開記録を保存できません。下書きは保持されています。')); };
  });
}
export async function removeApplyJournal(batchId: string, projectUrl = adminProjectUrl): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('batches', 'readwrite'), records = transaction.objectStore('batches'), request = records.get(projectUrl);
    let failure: unknown;
    request.onsuccess = () => { try { const current = restoreApplyJournal(request.result); if (current && current.plan.batchId !== batchId) throw new ApplyJournalConflictError(); records.delete(projectUrl); } catch (cause) { failure = cause; transaction.abort(); } };
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(failure ?? new Error('反映の再開記録を整理できませんでした。')); };
  });
}
