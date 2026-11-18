import type { ParticipationRow, TeamRow } from '../database';
import { type ChangeEntry, type ChangeField } from './history';
import { mergeRows, type Directory, type PreviewStore } from './model';

const metadata = ['person_id', 'event_id', 'role_id', 'kind', 'name_at_event', 'status'] as const;
export function teamAssignmentCandidates(rows: ParticipationRow[], eventId: string, teamId: string) {
  return rows.filter(row => row.event_id === eventId && row.team_id !== teamId && row.kind !== 'master');
}
export function planTeamMemberEdits(store: PreviewStore, before: ReadonlyMap<string, ParticipationRow>, edits: Record<string, ParticipationRow>, team: TeamRow, directory: Directory) {
  const teams = new Map(mergeRows(directory.teams ?? [], { ...store.teams, [team.id]: team }).map(row => [row.id, row]));
  const people = new Map(mergeRows(directory.people, store.people).map(row => [row.id, row]));
  const changed: ParticipationRow[] = [], changes: ChangeField[] = [];
  const teamLabel = (id: string | null) => id ? teams.get(id)?.display_name ?? 'チーム未登録' : 'チーム未所属';
  for (const [id, row] of Object.entries(edits)) {
    const original = before.get(id);
    if (id !== row.id) throw new Error('参加履歴の識別子を確認してください。');
    if (original) {
      if (metadata.some(key => original[key] !== row[key])) throw new Error('参加者の所属変更では、参加履歴の名前・役割・区分を保持してください。');
      if (original.team_id === row.team_id) continue;
    } else {
      // Adding and removing an unsaved new member should leave no attendance behind.
      if (!row.team_id) continue;
      if (!people.has(row.person_id) || row.event_id !== team.event_id || row.kind !== 'participant' || row.status !== 'attended' || row.role_id !== null) throw new Error('新しい参加者の人物・ゲームを確認してください。');
    }
    if (row.team_id) {
      if (row.kind === 'master') throw new Error('マスターはチームに所属できません。人シートで参加区分を確認してください。');
      const target = teams.get(row.team_id);
      if (!target || target.event_id !== row.event_id) throw new Error('参加者の所属チームは、参加ゲームと同じゲームから選んでください。');
    }
    changed.push(row);
    changes.push({ label: `参加者 · ${row.name_at_event || people.get(row.person_id)?.display_name || '人物未登録'}`, before: original ? teamLabel(original.team_id) : '参加履歴なし', after: teamLabel(row.team_id) });
  }
  if (!changed.length) return null;
  const entry: ChangeEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), sheet: 'teams', recordId: team.id, recordName: team.display_name, action: 'update', changes, actor: 'このブラウザ', scope: 'local' };
  const removed = new Set(store.removedRelations); changed.forEach(row => removed.delete(row.id));
  return { next: { ...store, relations: { ...store.relations, ...Object.fromEntries(changed.map(row => [row.id, row])) }, removedRelations: [...removed] }, entry };
}
