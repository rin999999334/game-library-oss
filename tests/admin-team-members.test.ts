import test from 'node:test';
import assert from 'node:assert/strict';
import { planTeamMemberEdits, teamAssignmentCandidates } from '../src/admin/team-members.ts';
import { buildApplyPlan } from '../src/admin/apply.ts';
import { emptyStore, type Directory } from '../src/admin/model.ts';
import type { ParticipationRow, TeamRow } from '../src/database.ts';

const one: TeamRow = { id: 'one', event_id: 'game', display_name: '一組', rank_value: 1, rank_note: null, final_score: 0 };
const two: TeamRow = { ...one, id: 'two', display_name: '二組' };
const member: ParticipationRow = { id: 'attendance', person_id: 'person', event_id: 'game', team_id: 'one', role_id: 'special-role', kind: 'participant', name_at_event: '当時の名前', status: 'cancelled' };
const directory: Directory = { cards: [], games: [], masters: [], teams: [one, two], people: [{ id: 'person', display_name: '現在の名前', joined_year: 2020, code_name: null }, { id: 'new-person', display_name: '新しい人', joined_year: 2026, code_name: null }] };
const before = new Map([[member.id, member]]);

test('moving a member preserves the exact participation and every attendance field', () => {
  const store = emptyStore(), moved = { ...member, team_id: 'two' };
  const result = planTeamMemberEdits(store, before, { [member.id]: moved }, one, directory)!;
  assert.deepEqual(result.next.relations[member.id], moved);
  assert.deepEqual(result.entry.changes, [{ label: '参加者 · 当時の名前', before: '一組', after: '二組' }]);
  assert.equal(result.entry.recordId, one.id); assert.deepEqual(store.relations, {});
});

test('removing a team assignment keeps the person in the game and leaves other roles alone', () => {
  const other = { ...member, id: 'other-history', kind: 'participant' }, store = emptyStore(); store.relations[other.id] = other;
  const result = planTeamMemberEdits(store, before, { [member.id]: { ...member, team_id: null } }, one, directory)!;
  assert.equal(result.next.relations.attendance.team_id, null); assert.equal(result.next.relations.attendance.event_id, 'game');
  assert.deepEqual(result.next.removedRelations, []); assert.equal(result.next.relations[other.id], other);
});

test('an unsaved team and person can create one attendance, while cancelling the assignment leaves none', () => {
  const store = emptyStore(), team = { ...one, id: 'new-team' };
  store.people['new-person'] = directory.people[1];
  const remote = { ...directory, people: directory.people.slice(0, 1) };
  const relation: ParticipationRow = { id: 'new-attendance', person_id: 'new-person', event_id: 'game', team_id: team.id, role_id: null, kind: 'participant', status: 'attended', name_at_event: '新しい人' };
  const result = planTeamMemberEdits(store, new Map(), { [relation.id]: relation }, team, remote)!;
  assert.equal(result.next.relations[relation.id].team_id, team.id);
  assert.equal(planTeamMemberEdits(store, new Map(), { [relation.id]: { ...relation, team_id: null } }, team, directory), null);
});

test('membership-only saves generate a participation update without overwriting the team', () => {
  const result = planTeamMemberEdits(emptyStore(), before, { attendance: { ...member, team_id: two.id } }, one, directory)!;
  const persisted = { ...result.next, teams: { [one.id]: one }, history: [result.entry] };
  const plan = buildApplyPlan(persisted, directory);
  assert.deepEqual(plan.operations, [{ table: 'participations', id: member.id, action: 'upsert', data: { person_id: member.person_id, event_id: member.event_id, team_id: two.id, role_id: member.role_id, kind: member.kind, name_at_event: member.name_at_event, status: member.status } }]);
  assert.deepEqual(plan.historyIds, [result.entry.id]);
});

test('a cross-game move or rewriting old role/name/status aborts every membership edit', () => {
  const badTeam = { ...two, id: 'another-game', event_id: 'other-game' }, store = emptyStore();
  const initial = structuredClone(store);
  assert.throws(() => planTeamMemberEdits(store, before, { attendance: { ...member, team_id: badTeam.id } }, one, { ...directory, teams: [...directory.teams!, badTeam] }), /同じゲーム/);
  for (const patch of [{ name_at_event: '現在の名前' }, { role_id: null }, { kind: 'master' }, { status: 'attended' }]) assert.throws(() => planTeamMemberEdits(store, before, { attendance: { ...member, ...patch, team_id: two.id } }, one, directory), /保持/);
  assert.deepEqual(store, initial);
});

test('unchanged assignments produce no operation; a legacy wrong-game member can be detached', () => {
  assert.equal(planTeamMemberEdits(emptyStore(), before, { attendance: member }, one, directory), null);
  const legacy = { ...member, event_id: 'legacy-game' };
  const result = planTeamMemberEdits(emptyStore(), new Map([[legacy.id, legacy]]), { attendance: { ...legacy, team_id: null } }, one, directory)!;
  assert.equal(result.next.relations.attendance.event_id, 'legacy-game');
});

test('masters cannot be assigned or moved to a team, while an old invalid assignment can be detached', () => {
  const master = { ...member, id: 'master', kind: 'master', team_id: null }, legacy = { ...master, team_id: one.id };
  assert.throws(() => planTeamMemberEdits(emptyStore(), new Map([[master.id, master]]), { master: { ...master, team_id: one.id } }, one, directory), /マスター/);
  assert.throws(() => planTeamMemberEdits(emptyStore(), new Map([[legacy.id, legacy]]), { master: { ...legacy, team_id: two.id } }, one, directory), /マスター/);
  const detached = planTeamMemberEdits(emptyStore(), new Map([[legacy.id, legacy]]), { master: { ...legacy, team_id: null } }, one, directory)!;
  assert.deepEqual(detached.next.relations.master, master);
  assert.equal(planTeamMemberEdits(emptyStore(), new Map([[legacy.id, legacy]]), { master: legacy }, one, directory), null);
  const available = { ...member, id: 'available', team_id: null }, otherGame = { ...available, id: 'other-game', event_id: 'other-game' };
  assert.deepEqual(teamAssignmentCandidates([master, legacy, member, available, otherGame], 'game', one.id), [available]);
});
