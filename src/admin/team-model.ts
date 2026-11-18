import type { EventRow, ParticipationRow, TeamRow } from '../database';
import { normaliseSearch } from '../model';
import type { ChangeEntry, ChangeField } from './history';
import { mergeRows, type Directory, type PreviewStore } from './model';

export function sortedTeams(directory: Directory, store: PreviewStore, games: EventRow[], query: string, gameId: string, sort: string) {
  const gameOrder = new Map(games.map((game, index) => [game.id, index]));
  const gameNames = new Map(games.map(game => [game.id, game.name]));
  const needle = normaliseSearch(query), compare = new Intl.Collator('ja', { numeric: true }).compare;
  return mergeRows(directory.teams ?? [], store.teams).filter(team => (!gameId || team.event_id === gameId) && (!needle || normaliseSearch(`${team.display_name} ${gameNames.get(team.event_id) ?? ''}`).includes(needle)))
    .sort((a, b) => (sort === 'name' ? compare(a.display_name, b.display_name) : (gameOrder.get(a.event_id) ?? Infinity) - (gameOrder.get(b.event_id) ?? Infinity)) || (a.rank_value ?? Infinity) - (b.rank_value ?? Infinity) || compare(a.display_name, b.display_name) || compare(a.id, b.id));
}

export function teamMembers(rows: ParticipationRow[], store: PreviewStore, teamId: string) {
  return mergeRows(rows, store.relations, store.removedRelations).filter(row => row.team_id === teamId);
}

export function validateTeam(team: TeamRow, games: EventRow[], members: ParticipationRow[], baseline?: TeamRow): string | null {
  if (!team.display_name.trim()) return 'チーム名を入力してください。';
  if (!games.some(game => game.id === team.event_id) && baseline?.event_id !== team.event_id) return '所属ゲームを選んでください。';
  if (team.rank_value !== null && (!Number.isInteger(team.rank_value) || team.rank_value < 1) && baseline?.rank_value !== team.rank_value) return '順位は1以上の整数で入力してください。';
  if (team.final_score !== null && !Number.isFinite(team.final_score)) return '最終得点は数値で入力してください。';
  if (baseline && baseline.event_id !== team.event_id && members.length) return '参加者が登録されているチームの所属ゲームは変更できません。';
  return null;
}

export function makeTeamChangeEntry(before: TeamRow, after: TeamRow, isNew: boolean, games: EventRow[]): ChangeEntry | null {
  const changes: ChangeField[] = [], gameNames = new Map(games.map(game => [game.id, game.name]));
  const labels = { event_id: '所属ゲーム', display_name: 'チーム名', rank_value: '順位', rank_note: '順位補足', final_score: '最終得点' };
  const value = (key: keyof typeof labels, item: unknown) => item === null || item === '' ? '未設定' : key === 'event_id' ? gameNames.get(String(item)) ?? String(item) : String(item);
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) if ((isNew && after[key] !== null && after[key] !== '') || before[key] !== after[key]) changes.push({ label: labels[key], before: isNew ? '未登録' : value(key, before[key]), after: value(key, after[key]) });
  if (!changes.length) return null;
  return { id: crypto.randomUUID(), at: new Date().toISOString(), sheet: 'teams', recordId: after.id, recordName: after.display_name, action: isNew ? 'create' : 'update', changes, scope: 'local', actor: 'このブラウザ' };
}
