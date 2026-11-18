import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApplyPlan } from '../src/admin/apply.ts';
import { gamePasteBaseline, mapPasteHeader, personPasteBaseline, planRecordBulk, RecordBulkValidationError } from '../src/admin/bulk-records.ts';
import { canonicaliseEditedLinks, emptyStore, linkCategory, mergeLinkEdits, validateEditor, type Directory } from '../src/admin/model.ts';
import { makeChangeEntry } from '../src/admin/history.ts';
import { recordSortValues } from '../src/admin/record-sort-values.ts';
import type { EventRow, LinkRow } from '../src/database.ts';
const game: EventRow = { id: 'game', name: 'ゲーム', fiscal_year: 2026, start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
const directory: Directory = { cards: [], people: [], games: [game], masters: [] };
const link = (id: string, kind: string, url: string): LinkRow => ({ id, person_id: null, event_id: game.id, kind, label: kind === 'twitter' ? 'X' : kind, url });

test('game URL columns read existing resources, preserving people and unknown links', () => {
  const resources = [link('blog', 'ブログ', 'https://example.com/blog'), link('board', '掲示板', 'https://example.com/board'), link('x', 'twitter', 'https://x.com/game'), { ...link('person-link', 'ブログ', 'https://example.com/person'), person_id: 'person' }, link('rules', 'ルール', 'https://example.com/rules')];
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', resources)!;
  assert.equal(baseline.values.blog, resources[0].url); assert.equal(baseline.values.board, resources[1].url); assert.equal(baseline.values.x, resources[2].url);
  assert.equal(baseline.links.length, 4); assert.equal(linkCategory(resources[1]), 'board');
  const sortingValues = recordSortValues('games', [game], directory, emptyStore(), { relations: [], links: resources }, new Map());
  assert.equal(sortingValues.get(game.id)?.blog, resources[0].url);
});
test('registered game official sites appear in the blog column and edits reuse their existing identities', () => {
  const original = { ...link('registered-blog', '公式サイト', 'https://example.com/game'), label: 'ゲーム公式サイト' };
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', [original])!;
  assert.equal(baseline.values.blog, original.url);
  const sortingValues = recordSortValues('games', [game], directory, emptyStore(), { relations: [], links: [original] }, new Map());
  assert.equal(sortingValues.get(game.id)?.blog, original.url);
  const plan = planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, blog: 'https://example.com/updated' } } }, directory)!;
  assert.deepEqual(Object.keys(plan.next.links), [original.id]);
  assert.deepEqual(plan.next.links[original.id], { ...original, url: 'https://example.com/updated' });
  const operations = buildApplyPlan(plan.next, directory).operations.filter(operation => operation.table === 'resource_links');
  assert.equal(operations.length, 1); assert.equal(operations[0].id, original.id); assert.equal(operations[0].data.kind, '公式サイト');
  const formLinks = canonicaliseEditedLinks([{ ...original, url: 'https:example.com/form update' }], [original]);
  const formDraft = mergeLinkEdits(emptyStore(), [original], formLinks);
  assert.equal(formDraft.links[original.id].url, 'https://example.com/form%20update');
  assert.equal(formDraft.links[original.id].kind, original.kind); assert.equal(formDraft.links[original.id].label, original.label);
});
test('link categorization matches public game icons, prioritizing boards and retaining invalid legacy inputs', () => {
  assert.equal(linkCategory({ ...link('label-board', '公式サイト', 'https://example.com/game'), label: '掲示板' }), 'board');
  assert.equal(linkCategory(link('path-board', '公式サイト', 'https://example.com/bbs/threads')), 'board');
  assert.equal(linkCategory({ ...link('legacy-board', '', 'old.invalid/bbs'), label: '掲示板ブログ' }), 'board');
  assert.equal(linkCategory({ ...link('legacy-blog', '', 'old.invalid/blog'), label: 'ブログ' }), 'blog');
  assert.equal(linkCategory(link('legacy-official', '公式サイト', 'old.invalid/game')), 'blog');
  assert.equal(linkCategory({ ...link('personal', '個人サイト', 'https://example.com/profile'), person_id: 'person', event_id: null }), 'blog');
  assert.equal(linkCategory({ ...link('legacy-x', '', '@game_x'), label: 'Twitter / X' }), 'x');
});
test('game URL edits reuse existing IDs, canonicalize X, record history and become apply operations', () => {
  const resources = [link('blog', 'ブログ', 'https://example.com/old'), link('rules', 'ルール', 'https://example.com/rules')];
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', resources)!;
  const plan = planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, blog: 'https://example.com/new', board: 'https://example.com/board', x: '@game_x' } } }, directory)!;
  assert.equal(plan.next.links.blog.id, 'blog'); assert.equal(plan.next.links.blog.url, 'https://example.com/new');
  const added = Object.values(plan.next.links).filter(row => row.id !== 'blog');
  assert.equal(added.length, 2); assert.ok(added.every(row => row.event_id === game.id && row.person_id === null));
  assert.equal(added.find(row => linkCategory(row) === 'x')?.url, 'https://x.com/game_x');
  assert.equal(plan.next.links.rules, undefined);
  assert.equal(plan.next.history[0].sheet, 'games'); assert.equal(plan.next.history[0].changes.length, 3);
  const operations = buildApplyPlan(plan.next, directory).operations.filter(operation => operation.table === 'resource_links');
  assert.equal(operations.length, 3); assert.ok(operations.every(operation => operation.data.event_id === game.id && operation.data.person_id === null));
});
test('clearing a game URL stages exactly that deletion while unrelated and legacy links survive', () => {
  const resources = [link('blog', 'ブログ', 'https://example.com/blog'), link('legacy', '掲示板', 'legacy.example.com/board'), link('rules', 'ルール', 'https://example.com/rules')];
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', resources)!;
  const result = planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, blog: '' } } }, directory)!;
  assert.deepEqual(result.next.removedLinks, ['blog']); assert.deepEqual(result.next.links, {});
  const operations = buildApplyPlan(result.next, directory).operations.filter(operation => operation.table === 'resource_links');
  assert.deepEqual(operations.map(operation => [operation.id, operation.action]), [['blog', 'delete']]);
});
test('unsafe game URLs flag their exact column; existing legacy URLs permit unrelated edits', () => {
  const resources = [link('legacy', '掲示板', 'legacy.example.com/board')];
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', resources)!;
  assert.throws(() => planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, board: 'javascript:alert(1)' } } }, directory), error => error instanceof RecordBulkValidationError && error.issues[0].field === 'board');
  const renamed = planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, name: '新しいゲーム名' } } }, directory)!;
  assert.deepEqual(renamed.next.links, {});
  assert.equal(planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values } } }, directory), null);
});
test('spreadsheet headers map all three game URLs and local drafts overlay the fetched baseline', () => {
  assert.deepEqual(mapPasteHeader('games', ['ゲーム名', 'ブログURL', '掲示板URL', 'XURL']), ['name', 'blog', 'board', 'x']);
  const store = emptyStore(); store.links.local = link('local', 'ブログ', 'https://example.com/local'); store.removedLinks = ['removed'];
  const baseline = gamePasteBaseline(game.id, directory, store, [], new Map(), '', [link('removed', 'ブログ', 'https://example.com/removed')])!;
  assert.equal(baseline.values.blog, store.links.local.url); assert.deepEqual(baseline.links, [store.links.local]);
});
test('game bulk URLs store canonical hrefs, preserving IDs and recording the exact apply values', () => {
  const baseline = gamePasteBaseline(game.id, directory, emptyStore(), [], new Map(), '', [link('board', '掲示板', 'https://example.com/old')])!;
  const plan = planRecordBulk('games', emptyStore(), new Map([[game.id, baseline]]), { [game.id]: { id: game.id, values: { ...baseline.values, blog: ' https:Example.COM ', board: 'https:Example.com/path with space', x: 'https:X.COM/new name' } } }, directory)!;
  assert.equal(plan.next.links.board.id, 'board'); assert.equal(plan.next.links.board.url, 'https://example.com/path%20with%20space');
  const operations = buildApplyPlan(plan.next, directory).operations.filter(operation => operation.table === 'resource_links');
  assert.equal(operations.find(operation => operation.data.kind === 'ブログ')?.data.url, 'https://example.com/');
  assert.equal(operations.find(operation => operation.data.kind === 'twitter')?.data.url, 'https://x.com/new%20name');
  for (const operation of operations) {
    assert.match(String(operation.data.url), /^https?:\/\/\S+$/);
    assert.ok(plan.next.history[0].changes.some(change => change.after.endsWith(String(operation.data.url))));
  }
});
test('person bulk blog and X URLs also store canonical hrefs and leave untouched legacy URLs alone', () => {
  const person = { id: 'person', display_name: '人物', joined_year: null, code_name: null }, data = { ...directory, people: [person] };
  const blog = { ...link('person-blog', 'ブログ', 'legacy.example.com'), event_id: null, person_id: person.id };
  const baseline = personPasteBaseline(person.id, data, emptyStore(), { relations: [], links: [blog] }, new Map())!;
  const plan = planRecordBulk('people', emptyStore(), new Map([[person.id, baseline]]), { [person.id]: { id: person.id, values: { ...baseline.values, blog: 'https:Example.com/path with space', x: ' https:X.COM/new name ' } } }, data)!;
  assert.equal(plan.next.links[blog.id].id, blog.id); assert.equal(plan.next.links[blog.id].url, 'https://example.com/path%20with%20space');
  assert.equal(Object.values(plan.next.links).find(row => row.kind === 'twitter')?.url, 'https://x.com/new%20name');
  const unrelated = planRecordBulk('people', emptyStore(), new Map([[person.id, baseline]]), { [person.id]: { id: person.id, values: { ...baseline.values, display_name: '新しい名前' } } }, data)!;
  assert.deepEqual(unrelated.next.links, {});
});
test('detail form normalizes only new or URL-edited links and history matches saved values for both sheets', () => {
  const legacy = link('legacy', 'ブログ', ' legacy.example.com/path '), board = link('board', '掲示板', 'https://example.com/old');
  const beforeLinks = [legacy, board], newX = link('new-x', 'twitter', '@game_x');
  const afterLinks = canonicaliseEditedLinks([{ ...legacy, label: '旧ブログ' }, { ...board, url: 'https:Example.com/a b' }, newX], beforeLinks);
  assert.equal(afterLinks[0].url, legacy.url); assert.equal(afterLinks[1].id, board.id); assert.equal(afterLinks[1].url, 'https://example.com/a%20b'); assert.equal(afterLinks[2].url, 'https://x.com/game_x');
  for (const sheet of ['games', 'people'] as const) {
    const row = sheet === 'games' ? game : { id: 'person', display_name: '人物', joined_year: null, code_name: null };
    const before = { row, relations: [], links: beforeLinks }, after = { ...before, links: afterLinks };
    assert.equal(validateEditor(sheet, row, afterLinks, [], directory, before), null);
    const draft = mergeLinkEdits(emptyStore(), beforeLinks, afterLinks), history = makeChangeEntry(sheet, before, after, false, new Map(), false)!;
    assert.equal(draft.links.board.url, afterLinks[1].url);
    assert.ok(history.changes.some(change => change.after === `掲示板 ${afterLinks[1].url}`));
    assert.ok(history.changes.some(change => change.after === `X ${afterLinks[2].url}`));
    const invalidEdit = canonicaliseEditedLinks([{ ...legacy, url: 'legacy.example.com/path' }], [legacy]);
    assert.match(validateEditor(sheet, row, invalidEdit, [], directory, before)!, /URL/);
  }
});
