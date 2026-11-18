import test from 'node:test';
import assert from 'node:assert/strict';
import type { ParticipationRow } from '../src/database.ts';
import { changedParticipations, convertParticipationKind, participationConflict, upsertParticipation } from '../src/admin/participation-edits.ts';
import { buildApplyPlan } from '../src/admin/apply.ts';
import { emptyStore, mergeRelationEdits, type Directory } from '../src/admin/model.ts';

const participant: ParticipationRow = { id: 'attendance', person_id: 'person', event_id: 'game', kind: 'participant', status: 'cancelled', name_at_event: '当時の名前', team_id: 'team', role_id: 'participant-role' };
const other: ParticipationRow = { ...participant, id: 'another', event_id: 'another-game' };

test('adding an existing participant as master reuses the unique person/game attendance', () => {
  const rows = [participant, other];
  const result = upsertParticipation(rows, { personId: 'person', eventId: 'game', kind: 'master', nameAtEvent: '現在の名前' });
  assert.equal(result.isNew, false); assert.equal(result.changed, true); assert.equal(result.rows.length, 2);
  assert.deepEqual(result.participation, { ...participant, kind: 'master', team_id: null, role_id: null });
  assert.equal(result.rows[1], other); assert.equal(rows[0], participant); assert.equal(participationConflict(result.rows), null);
});

test('removing a master assignment keeps attendance identity, old name and status', () => {
  const master = { ...participant, kind: 'master', team_id: null, role_id: 'master-role' };
  const converted = convertParticipationKind(master, 'participant');
  assert.deepEqual(converted, { ...master, kind: 'participant', role_id: null });
  const store = mergeRelationEdits(emptyStore(), [master], [converted]);
  const directory: Directory = { people: [], games: [], cards: [], masters: [master], teams: [] };
  const operations = buildApplyPlan(store, directory).operations;
  assert.equal(operations.length, 1); assert.equal(operations[0].action, 'upsert');
  assert.equal(operations[0].id, master.id); assert.deepEqual(store.removedRelations, []);
  assert.equal(operations[0].data.kind, 'participant'); assert.equal(operations[0].data.role_id, null);
});

test('same-kind edits preserve role/team fields and do not create another attendance', () => {
  assert.equal(convertParticipationKind(participant, 'participant'), participant);
  const master = { ...participant, kind: 'master', team_id: null, role_id: 'master-role' };
  const result = upsertParticipation([master], { personId: 'person', eventId: 'game', kind: 'master', nameAtEvent: '現在の名前' });
  assert.equal(result.changed, false); assert.equal(result.participation, master); assert.equal(result.rows.length, 1);
});

test('new game attendance has a fresh identity and existing histories remain unchanged', () => {
  const result = upsertParticipation([participant], { personId: 'person', eventId: 'new-game', kind: 'master', nameAtEvent: '新しい当時の名前', id: 'new-id' });
  assert.equal(result.isNew, true); assert.equal(result.rows[0], participant);
  assert.deepEqual(result.participation, { id: 'new-id', person_id: 'person', event_id: 'new-game', kind: 'master', name_at_event: '新しい当時の名前', team_id: null, role_id: null, status: 'attended' });
});

test('duplicate attendance from older drafts is rejected instead of silently losing a history', () => {
  const duplicate = { ...participant, id: 'duplicate', kind: 'master', team_id: null };
  assert.match(participationConflict([participant, duplicate])!, /重複/);
  assert.throws(() => upsertParticipation([participant, duplicate], { personId: 'person', eventId: 'game', kind: 'master', nameAtEvent: null }), /重複/);
  assert.equal(participationConflict([participant, other]), null);
});
test('unchanged attendance is excluded even when row objects and property order differ', () => {
  const cloned = { status: participant.status, name_at_event: participant.name_at_event, kind: participant.kind, role_id: participant.role_id, team_id: participant.team_id, event_id: participant.event_id, person_id: participant.person_id, id: participant.id };
  assert.deepEqual(changedParticipations([participant, other], [cloned, { ...other }]), []);
  assert.deepEqual(mergeRelationEdits(emptyStore(), [participant], [cloned]).relations, {});
});
test('participation delta includes every editable field and new identities without mutating originals', () => {
  const patches: Partial<ParticipationRow>[] = [{ person_id: 'another-person' }, { event_id: 'another-event' }, { team_id: null }, { role_id: null }, { kind: 'master' }, { name_at_event: '編集した名前' }, { status: 'attended' }];
  for (const patch of patches) {
    const edited = { ...participant, ...patch };
    assert.deepEqual(changedParticipations([participant, other], [edited, { ...other }]), [edited]);
  }
  const added = { ...participant, id: 'new-attendance' };
  assert.deepEqual(changedParticipations([participant], [participant, added]), [added]);
});
test('editor delta preserves earlier drafts and deletion markers while staging only edited attendance', () => {
  const store = emptyStore(), prior = { ...other, name_at_event: '前回保存した名前' };
  store.relations[prior.id] = prior; store.removedRelations = ['earlier-deletion'];
  const next = mergeRelationEdits(store, [participant, prior], [{ ...participant }, { ...prior }]);
  assert.deepEqual(next.relations, { [prior.id]: prior });
  assert.deepEqual(next.removedRelations, ['earlier-deletion']);
  const removed = mergeRelationEdits(next, [participant, prior], [prior]);
  assert.deepEqual(removed.relations, { [prior.id]: prior });
  assert.deepEqual(removed.removedRelations, ['earlier-deletion', participant.id]);
  assert.deepEqual(store.removedRelations, ['earlier-deletion']);
});
