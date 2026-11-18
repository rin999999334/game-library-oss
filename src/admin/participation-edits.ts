import type { ParticipationRow } from '../database';

const participationFields: readonly (keyof ParticipationRow)[] = ['person_id', 'event_id', 'team_id', 'role_id', 'kind', 'name_at_event', 'status'];
export function changedParticipations(before: readonly ParticipationRow[], after: readonly ParticipationRow[]): ParticipationRow[] {
  const originals = new Map(before.map(row => [row.id, row]));
  return after.filter(row => { const original = originals.get(row.id); return !original || participationFields.some(field => original[field] !== row[field]); });
}

/** Keep the one person/game attendance record while changing its assignment. */
export function convertParticipationKind(row: ParticipationRow, kind: string): ParticipationRow {
  if (row.kind === kind) return row;
  return { ...row, kind, role_id: null, team_id: kind === 'master' ? null : row.team_id };
}

type ParticipationInput = { personId: string; eventId: string; kind: string; nameAtEvent: string | null; id?: string };
export function upsertParticipation(rows: ParticipationRow[], input: ParticipationInput) {
  const matches = rows.filter(row => row.person_id === input.personId && row.event_id === input.eventId);
  if (matches.length > 1) throw new Error('同じ人物・ゲームの参加履歴が重複しています。人シートで参加履歴を確認してください。');
  const original = matches[0];
  if (original) {
    const participation = convertParticipationKind(original, input.kind);
    return { rows: rows.map(row => row.id === original.id ? participation : row), participation, changed: participation !== original, isNew: false };
  }
  const participation: ParticipationRow = { id: input.id ?? crypto.randomUUID(), person_id: input.personId, event_id: input.eventId, kind: input.kind, name_at_event: input.nameAtEvent, team_id: null, role_id: null, status: 'attended' };
  return { rows: [...rows, participation], participation, changed: true, isNew: true };
}

export function participationConflict(rows: ParticipationRow[]): string | null {
  const pairs = new Set<string>();
  for (const row of rows) {
    const pair = JSON.stringify([row.person_id, row.event_id]);
    if (pairs.has(pair)) return '同じ人物・ゲームの参加履歴が重複しています。人シートで参加履歴を確認してください。';
    pairs.add(pair);
  }
  return null;
}
