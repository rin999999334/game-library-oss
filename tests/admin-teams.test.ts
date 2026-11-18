import assert from 'node:assert/strict';
import test from 'node:test';
import type { EventRow, ParticipationRow, TeamRow } from '../src/database.ts';
import { restorePreview } from '../src/admin/data.ts';
import { emptyStore, changedCount, type Directory } from '../src/admin/model.ts';
import { resetChangeEntry } from '../src/admin/history.ts';
import { makeTeamChangeEntry, sortedTeams, teamMembers, validateTeam } from '../src/admin/team-model.ts';

const game = (id: string): EventRow => ({ id, name: `ゲーム${id}`, fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, theme: null, status: null });
const games = [game('new'), game('old')];
const team = (id: string, eventId = 'old', rank: number | null = 1): TeamRow => ({ id, event_id: eventId, display_name: `チーム${id}`, rank_value: rank, rank_note: null, final_score: 0 });
const member: ParticipationRow = { id: 'member', person_id: 'person', event_id: 'old', team_id: 'one', role_id: 'role', name_at_event: '当時の名前', kind: 'participant', status: 'attended' };
const directory: Directory = { games, teams: [team('one'), team('two', 'new'), team('three', 'old', 2)], people: [], cards: [], masters: [] };

test('teams sort by their game order and rank, with draft names and games reflected in filters', () => {
  const store = emptyStore();
  assert.deepEqual(sortedTeams(directory, store, games, '', '', 'default').map(row => row.id), ['two', 'one', 'three']);
  store.teams.one = { ...team('one'), display_name: '修正したチーム', event_id: 'new' };
  assert.equal(sortedTeams(directory, store, games, '修正', 'new', 'default')[0].id, 'one');
  assert.deepEqual(sortedTeams(directory, store, games, '', 'old', 'default').map(row => row.id), ['three']);
});

test('an existing team with members cannot move to another game or invalidate the existing relationships', () => {
  const original = team('one');
  assert.match(validateTeam({ ...original, event_id: 'new' }, games, [member], original)!, /所属ゲームは変更できません/);
  assert.equal(validateTeam({ ...original, display_name: '名前だけ変更' }, games, [member], original), null);
  assert.equal(validateTeam({ ...original, event_id: 'new' }, games, [], original), null);
});

test('rank and score validation permits unknown rank, final score zero and unchanged legacy rank zero', () => {
  const original = { ...team('one'), rank_value: 0, rank_note: '最下位' };
  assert.equal(validateTeam(original, games, [], original), null);
  assert.match(validateTeam({ ...original, rank_value: -1 }, games, [], original)!, /1以上/);
  assert.match(validateTeam({ ...original, rank_value: 1.5 }, games, [], original)!, /整数/);
  assert.match(validateTeam({ ...original, final_score: Infinity }, games, [], original)!, /数値/);
  assert.equal(validateTeam({ ...original, rank_value: null, final_score: 0 }, games, [], original), null);
});

test('team members preserve participation IDs, old names and roles while respecting local relation removals', () => {
  const store = emptyStore();
  store.relations.additional = { ...member, id: 'additional', person_id: 'second' };
  store.removedRelations.push(member.id);
  const rows = teamMembers([member], store, 'one');
  assert.deepEqual(rows.map(row => row.id), ['additional']);
  assert.equal(rows[0].role_id, 'role');
  assert.equal(rows[0].name_at_event, '当時の名前');
});

test('team history records exact fields and game labels under the team sheet; no-op edits add nothing', () => {
  const original = team('one');
  assert.equal(makeTeamChangeEntry(original, original, false, games), null);
  const entry = makeTeamChangeEntry(original, { ...original, event_id: 'new', rank_note: '最下位' }, false, games)!;
  assert.equal(entry.sheet, 'teams');
  assert.equal(entry.scope, 'local');
  assert.deepEqual(entry.changes, [{ label: '所属ゲーム', before: 'ゲームold', after: 'ゲームnew' }, { label: '順位補足', before: '未設定', after: '最下位' }]);
});

test('legacy draft restore gains an empty team store without removing records and reset history includes teams', () => {
  const original = emptyStore();
  original.revision = 4; original.people.person = { id: 'person', display_name: '人物', code_name: null, joined_year: null };
  const { teams: omittedTeams, ...legacy } = original; void omittedTeams;
  const restored = restorePreview(legacy);
  assert.deepEqual(restored.teams, {});
  assert.equal(restored.people.person.display_name, '人物');
  assert.equal(restored.revision, 4);
  restored.teams.one = team('one');
  assert.equal(changedCount(restored), 2);
  assert.ok(resetChangeEntry(restored).changes.some(change => change.label === 'チームone'));
});
