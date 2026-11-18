import { discardUnappliedHistory, historyStatus, resetChangeEntry, workHoldKey, type HistoryTarget } from './history';
import { emptyStore, type Directory, type PreviewStore } from './model';

export function resetDraftStore(store: PreviewStore, directory: Directory, at = new Date().toISOString()): PreviewStore {
  const removedLocalRecords = new Set<string>();
  const appliedCreates = new Set(store.history.filter(entry => entry.action === 'create' && historyStatus(entry) === 'applied' && entry.sheet !== 'all' && entry.recordId).map(entry => workHoldKey(entry.sheet as HistoryTarget, entry.recordId!)));
  const known = {
    cards: new Set(directory.cards.map(row => row.id)), people: new Set(directory.people.map(row => row.id)),
    games: new Set(directory.games.map(row => row.id)), teams: new Set((directory.teams ?? []).map(row => row.id)),
  };
  for (const entry of store.history) {
    if (entry.action !== 'create' || historyStatus(entry) !== 'unapplied' || entry.sheet === 'all' || !entry.recordId) continue;
    const key = workHoldKey(entry.sheet, entry.recordId);
    if (!known[entry.sheet].has(entry.recordId) && store[entry.sheet][entry.recordId] && !appliedCreates.has(key)) removedLocalRecords.add(key);
  }
  const holds = Object.fromEntries(Object.entries(store.holds).filter(([key]) => !removedLocalRecords.has(key)));
  const history = store.history.map(entry => {
    const marker = entry.action === 'hold' || entry.action === 'release';
    const orphanedMarker = marker && entry.sheet !== 'all' && entry.recordId && removedLocalRecords.has(workHoldKey(entry.sheet, entry.recordId));
    return marker && !orphanedMarker ? entry : discardUnappliedHistory([entry], at)[0];
  });
  history.push({ ...resetChangeEntry(store), at, discardedAt: at });
  return { ...emptyStore(), revision: store.revision, holds, history, savedAt: at };
}
