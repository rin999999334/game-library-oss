import type { EventRow, TeamRow } from '../database';
import type { PreviewStore } from './model';
import { makeTeamChangeEntry, validateTeam } from './team-model';

const editableFields = ['display_name', 'rank_value', 'rank_note', 'final_score'] as const;
export class TeamBulkValidationError extends Error {
  readonly teamId: string;
  constructor(teamId: string, message: string) { super(message); this.name = 'TeamBulkValidationError'; this.teamId = teamId; }
}
export type TeamBulkPlan = { next: PreviewStore; changedIds: string[] };

export function changedTeamIds(before: ReadonlyMap<string, TeamRow>, edits: Record<string, TeamRow>): string[] {
  return Object.entries(edits).filter(([id, edit]) => {
    const original = before.get(id);
    return original && editableFields.some(field => original[field] !== edit[field]);
  }).map(([id]) => id);
}

export function planTeamBulk(store: PreviewStore, before: ReadonlyMap<string, TeamRow>, edits: Record<string, TeamRow>, games: EventRow[]): TeamBulkPlan | null {
  const changed: Array<{ before: TeamRow; after: TeamRow }> = [];
  const changedIds = new Set(changedTeamIds(before, edits));
  for (const [id, edit] of Object.entries(edits)) {
    const original = before.get(id);
    if (!original || edit.id !== id) throw new TeamBulkValidationError(id, '一覧にないチームは一括編集できません。');
    if (edit.event_id !== original.event_id) throw new TeamBulkValidationError(id, `${original.display_name}: 所属ゲームは一括編集では変更できません。`);
    if (!changedIds.has(id)) continue;
    // Only the four editable columns belong to this change. Keep identity and
    // game membership from the snapshot even if the supplied row has extras.
    const after: TeamRow = { ...original, display_name: edit.display_name, rank_value: edit.rank_value, rank_note: edit.rank_note, final_score: edit.final_score };
    const invalid = validateTeam(after, games, [], original);
    if (invalid) throw new TeamBulkValidationError(id, `${original.display_name}: ${invalid}`);
    changed.push({ before: original, after });
  }
  if (!changed.length) return null;
  // Build the complete state only after every edited row has passed validation.
  const entries = changed.flatMap(change => {
    const entry = makeTeamChangeEntry(change.before, change.after, false, games);
    return entry ? [entry] : [];
  });
  return {
    changedIds: changed.map(change => change.after.id),
    next: {
      ...store,
      teams: { ...store.teams, ...Object.fromEntries(changed.map(change => [change.after.id, change.after])) },
      history: [...store.history, ...entries],
      savedAt: new Date().toISOString(),
    },
  };
}
