import { validateApplyReceipt, type ApplyPlan, type ApplyReceipt } from './apply';
import { emptyStore, type PreviewStore } from './model';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function sameImage(left: Blob, right: Blob) {
  if (left.size !== right.size || left.type !== right.type) return false;
  const a = new Uint8Array(await left.arrayBuffer()), b = new Uint8Array(await right.arrayBuffer());
  return a.every((value, index) => value === b[index]);
}
// An external tab can save while the remote transaction is in flight. Clear
// only the snapshot that committed; subsequent edits stay in the local queue.
export async function reconcileApplied(current: PreviewStore, plan: ApplyPlan, receipt: ApplyReceipt): Promise<PreviewStore> {
  validateApplyReceipt(receipt, plan);
  const before = plan.localSnapshot, included = new Set(receipt.historyIds);
  const laterEdits = new Set(current.history.filter(entry => !included.has(entry.id) && !entry.appliedAt && !entry.discardedAt && ['create', 'update'].includes(entry.action)).map(entry => `${entry.sheet}:${entry.recordId}`));
  const touchedLater = (sheet: string, id: string) => {
    if (sheet === 'gameImageUrls') return laterEdits.has(`games:${id}`);
    if (sheet === 'relations' || sheet === 'links') {
      const row = (current[sheet as 'relations' | 'links'][id] ?? before[sheet as 'relations' | 'links'][id]) as { person_id?: string | null; event_id?: string | null; team_id?: string | null } | undefined;
      return Boolean(row && (laterEdits.has(`people:${row.person_id}`) || laterEdits.has(`games:${row.event_id}`) || laterEdits.has(`teams:${row.team_id}`)));
    }
    return laterEdits.has(`${sheet}:${id}`);
  };
  const entries = new Map(current.history.map(entry => [entry.id, entry]));
  for (const entry of before.history) if (included.has(entry.id) && !entries.has(entry.id)) entries.set(entry.id, entry);
  const history = [...entries.values()].map(entry => included.has(entry.id) ? { ...entry, appliedAt: receipt.at, applyBatchId: receipt.batchId, discardedAt: null } : entry);
  if (current.revision === before.revision) return { ...emptyStore(), revision: current.revision, holds: current.holds, history, savedAt: receipt.at };
  const next: PreviewStore = { ...current, history, images: { ...current.images }, savedAt: receipt.at };
  for (const sheet of ['cards', 'people', 'games', 'teams', 'relations', 'links', 'gameImageUrls'] as const) {
    const kept = { ...current[sheet] } as Record<string, unknown>;
    for (const [id, value] of Object.entries(before[sheet])) {
      const restored = sheet === 'links' ? before.removedLinks.includes(id) && !current.removedLinks.includes(id) : sheet === 'relations' ? before.removedRelations.includes(id) && !current.removedRelations.includes(id) : false;
      if (!restored && !touchedLater(sheet, id) && equal(current[sheet][id], value)) delete kept[id];
    }
    Object.assign(next, { [sheet]: kept });
  }
  next.removedRelations = current.removedRelations.filter(id => !before.removedRelations.includes(id) || touchedLater('relations', id));
  next.removedLinks = current.removedLinks.filter(id => !before.removedLinks.includes(id) || touchedLater('links', id));
  for (const [id, image] of Object.entries(before.images)) if (!laterEdits.has(id) && current.images[id] && await sameImage(current.images[id], image)) delete next.images[id];
  return next;
}
