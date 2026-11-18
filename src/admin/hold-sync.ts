import { historyStatus, type WorkHold } from './history';
import type { PreviewStore } from './model';
export function mergeRemoteHolds(store: PreviewStore, remote: Record<string, WorkHold>): PreviewStore {
  const holds = { ...remote };
  for (const entry of store.history) {
    if (historyStatus(entry) !== 'unapplied' || !entry.recordId || entry.sheet === 'all' || (entry.action !== 'hold' && entry.action !== 'release')) continue;
    const key = `${entry.sheet}:${entry.recordId}`;
    if (entry.action === 'hold') holds[key] = store.holds[key] ?? { sheet: entry.sheet, recordId: entry.recordId, at: entry.at };
    else delete holds[key];
  }
  return { ...store, holds };
}
