import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { ApplyOperation } from '../src/admin/apply.ts';

const db = new PGlite();
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const adminId = id(1), otherId = id(2), originalGame = id(10), originalPerson = id(20), originalCard = id(30);
const fixture = `
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.events(id uuid primary key default gen_random_uuid(),name text not null,fiscal_year integer,start_date date,end_date date,schedule_note text,status text,theme text);
  create table public.people(id uuid primary key default gen_random_uuid(),display_name text not null,code_name text,joined_year integer);
  create table public.teams(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),display_name text not null,rank_value integer check(rank_value>0),rank_note text,final_score numeric check(final_score::text not in('NaN','Infinity','-Infinity')));
  create table public.cards(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),name text not null,source_card_id text,source_type text not null check(btrim(source_type)<>''),card_type text constraint cards_card_type_check check(card_type in('attack','defence','quick','special')),rank text check(rank in('d','c','b','a','s','ss')),effect_text text,flavor_text text,publication_status text not null default 'draft',created_at timestamptz not null default now(),theme_color text not null default '#fff');
  create table public.card_images(id uuid primary key default gen_random_uuid(),card_id uuid not null references public.cards(id),storage_path text,role text not null default 'front',display_order smallint not null default 1 check(display_order>0),image_status text not null default 'available',constraint card_images_check check(image_status<>'available' or storage_path is not null),unique(card_id,role,display_order));
  create table public.roles(id uuid primary key,label text,kind text,unique(id,kind));
  create table public.participations(id uuid primary key default gen_random_uuid(),person_id uuid not null references public.people(id),event_id uuid not null references public.events(id),team_id uuid references public.teams(id),role_id uuid,kind text,name_at_event text,status text not null default 'attended',unique(person_id,event_id),foreign key(role_id,kind) references public.roles(id,kind),check(kind<>'master' or(team_id is null and role_id is not null)));
  create table public.resource_links(id uuid primary key default gen_random_uuid(),person_id uuid references public.people(id),event_id uuid references public.events(id),team_id uuid references public.teams(id),participation_id uuid references public.participations(id),kind text,label text,url text check(url ~ '^https?://[^[:space:]]+$'),check(num_nonnulls(person_id,event_id,team_id,participation_id)=1),unique nulls not distinct(person_id,event_id,team_id,participation_id,kind,url));
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
`;
async function role(user = adminId, target = 'authenticated') { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec(`set role ${target}`); }
async function owner() { await db.exec('reset role'); }
async function review(operations: ApplyOperation[]): Promise<ApplyOperation[]> {
  const result = await db.query<{ operations: ApplyOperation[] }>('select public.kakurenbo_review_changes($1::jsonb) as operations', [JSON.stringify(operations)]);
  return result.rows[0].operations;
}
async function apply(batchId: string, operations: ApplyOperation[], historyIds = ['history']) {
  const payload = { storeRevision: 7, historyIds, counts: { cards: operations.filter(op => op.table === 'cards').length }, operations };
  return db.query<{ receipt: { batchId: string; historyIds: string[]; storeRevision: number; at: string } }>('select public.kakurenbo_apply_changes($1::uuid,$2::jsonb) as receipt', [batchId, JSON.stringify(payload)]);
}
before(async () => {
  await db.exec(fixture);
  // Simulate a pre-existing permissive grant; migration must remove it.
  await db.exec(`create table public.admin_users(user_id uuid primary key references auth.users(id) on delete cascade,created_at timestamptz not null default now());
    alter table public.admin_users enable row level security;
    create policy preexisting_permissive_membership on public.admin_users for all to authenticated using (true) with check (true);
    grant all on public.admin_users to public,anon,authenticated;
    grant insert(user_id),update(user_id),select(user_id) on public.admin_users to public,anon,authenticated;`);
  const sql = await readFile(new URL('../supabase/admin-bulk-apply.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.query('insert into auth.users(id) values($1),($2)', [adminId, otherId]);
  await db.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  await db.query('insert into public.roles(id,label,kind) values($1,$2,$3),($4,$5,$6)', [id(3), 'マスター', 'master', id(4), 'リーダー', 'participant']);
  await db.query('insert into public.events(id,name) values($1,$2)', [originalGame, '元ゲーム']);
  await db.query('insert into public.people(id,display_name) values($1,$2)', [originalPerson, '人物']);
  await db.query('insert into public.cards(id,event_id,name,source_type,publication_status,rank) values($1,$2,$3,$4,$5,$6)', [originalCard, originalGame, '元カード', 'defence', 'published', 'a']);
});
after(async () => { await db.close(); });

test('the actual SQL commits a game, 100 cards/images and related records atomically with an idempotent receipt', async () => {
  await role();
  const gameId = id(100), batchId = id(101);
  const operations: ApplyOperation[] = [{ table: 'events', id: gameId, action: 'upsert', data: { name: '100枚のゲーム', fiscal_year: 2026 } }];
  for (let index = 0; index < 100; index++) operations.push({ table: 'cards', id: id(1000 + index), action: 'upsert', data: { event_id: gameId, name: `カード${index}`, source_card_id: String(index), card_type: 'guard', publication_status: 'published' } });
  operations.push({ table: 'participations', id: id(300), action: 'upsert', data: { person_id: originalPerson, event_id: gameId, kind: 'master', status: 'attended', name_at_event: 'マスターの名前' } });
  operations.push({ table: 'resource_links', id: id(301), action: 'upsert', data: { person_id: originalPerson, event_id: null, kind: 'ブログ', label: 'ブログ', url: 'https://example.com' } });
  for (let index = 0; index < 100; index++) operations.push({ table: 'card_images', id: id(5000 + index), action: 'upsert', data: { card_id: id(1000 + index), role: 'front', display_order: 0, image_status: 'available', storage_path: `admin-batches/${batchId}/cards/${id(1000 + index)}.png`, external_url: null } });
  operations.push({ table: 'game_artwork', id: gameId, action: 'upsert', data: { external_url: 'https://example.com/game.png', storage_path: null } });
  operations.push({ table: 'admin_record_flags', id: `cards:${id(1000)}`, action: 'upsert', data: { sheet: 'cards', record_id: id(1000), on_hold: true } });
  const reviewed = await review(operations);
  assert.ok(reviewed.every(op => op.expected === null));
  const first = await apply(batchId, reviewed), retry = await apply(batchId, reviewed);
  assert.deepEqual(first.rows[0], retry.rows[0]);
  assert.equal(first.rows[0].receipt.batchId, batchId); assert.equal(first.rows[0].receipt.storeRevision, 7);
  await owner();
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.cards where event_id=$1 and publication_status=$2', [gameId, 'published'])).rows[0].count, 100);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.card_images where card_id in(select id from public.cards where event_id=$1)', [gameId])).rows[0].count, 100);
  assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.cards where event_id=$1 and source_type='manual'", [gameId])).rows[0].count, 100);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from kakurenbo_admin.apply_batches where id=$1', [batchId])).rows[0].count, 1);
});
test('a narrow UPDATE preserves required and hidden fields instead of failing INSERT constraints', async () => {
  await role();
  const reviewed = await review([{ table: 'cards', id: originalCard, action: 'upsert', data: { rank: 'S' } }]);
  await apply(id(102), reviewed);
  await owner();
  const row = (await db.query<{ name: string; rank: string; source_type: string; publication_status: string; theme_color: string }>('select name,rank,source_type,publication_status,theme_color from public.cards where id=$1', [originalCard])).rows[0];
  assert.deepEqual(row, { name: '元カード', rank: 's', source_type: 'defence', publication_status: 'published', theme_color: '#fff' });
});
test('one invalid foreign key rolls back every operation and creates no successful receipt', async () => {
  await role();
  const gameId = id(200), cardId = id(201), batchId = id(202);
  const reviewed = await review([{ table: 'events', id: gameId, action: 'upsert', data: { name: '失敗するゲーム' } }, { table: 'cards', id: cardId, action: 'upsert', data: { event_id: gameId, name: 'ロールバックするカード', publication_status: 'published' } }, { table: 'participations', id: id(203), action: 'upsert', data: { event_id: gameId, person_id: id(999999), kind: 'master' } }]);
  await assert.rejects(apply(batchId, reviewed), (error: unknown) => (error as { code: string }).code === '23503');
  await owner();
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.events where id=$1', [gameId])).rows[0].count, 0);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.cards where id=$1', [cardId])).rows[0].count, 0);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from kakurenbo_admin.apply_batches where id=$1', [batchId])).rows[0].count, 0);
});
test('a row changed after review aborts the whole batch before saving any new records', async () => {
  await role();
  const gameId = id(400);
  const reviewed = await review([{ table: 'events', id: gameId, action: 'upsert', data: { name: '保存されないゲーム' } }, { table: 'cards', id: originalCard, action: 'upsert', data: { rank: 'SS' } }]);
  await owner(); await db.query('update public.cards set effect_text=$1 where id=$2', ['他の編集者が変更した効果', originalCard]); await role();
  await assert.rejects(apply(id(401), reviewed), (error: unknown) => (error as { code: string }).code === '40001');
  await owner(); assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.events where id=$1', [gameId])).rows[0].count, 0);
});
test('a new front image created after review is a conflict instead of a duplicate', async () => {
  await role();
  const reviewed = await review([{ table: 'card_images', id: id(600), action: 'upsert', data: { card_id: originalCard, role: 'front', display_order: 0, image_status: 'available', external_url: 'https://example.com/a.png', storage_path: null } }]);
  await owner(); await db.query('insert into public.card_images(id,card_id,external_url) values($1,$2,$3)', [id(601), originalCard, 'https://example.com/b.png']); await role();
  await assert.rejects(apply(id(602), reviewed), (error: unknown) => (error as { code: string }).code === '40001');
  await owner(); assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.card_images where card_id=$1', [originalCard])).rows[0].count, 1);
  await role();
  const latest = await review([{ table: 'card_images', id: id(603), action: 'upsert', data: { card_id: originalCard, role: 'front', display_order: 0, image_status: 'available', external_url: 'https://example.com/a.png', storage_path: null } }]);
  assert.equal(latest[0].id, id(601));
  await apply(id(604), latest);
  await owner();
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.card_images where card_id=$1', [originalCard])).rows[0].count, 1);
  assert.equal((await db.query<{ external_url: string }>('select external_url from public.card_images where id=$1', [id(601)])).rows[0].external_url, 'https://example.com/a.png');
});
test('an admin cannot send arbitrary tables, hidden columns, or reuse a receipt for a changed batch', async () => {
  await role();
  await assert.rejects(review([{ table: 'cards', id: originalCard, action: 'upsert', data: { source_type: 'overwrite' } }]), (error: unknown) => (error as { code: string }).code === '22023');
  await assert.rejects(db.query('select public.kakurenbo_review_changes($1::jsonb)', [JSON.stringify([{ table: 'admin_users', id: otherId, action: 'upsert', data: { user_id: otherId } }])]), (error: unknown) => (error as { code: string }).code === '22023');
  const reviewed = await review([{ table: 'people', id: id(800), action: 'upsert', data: { display_name: 'バッチの人物' } }]);
  await apply(id(801), reviewed, ['old-history']);
  await assert.rejects(apply(id(801), reviewed, ['changed-history']), (error: unknown) => (error as { code: string }).code === '22023');
});
test('clearing a primary image removes exactly the reviewed front and preserves the back', async () => {
  const gameId = id(900), cardId = id(901), frontId = id(902), backId = id(903);
  await owner();
  await db.query('insert into public.events(id,name) values($1,$2)', [gameId, '画像解除のゲーム']);
  await db.query('insert into public.cards(id,event_id,name,source_type) values($1,$2,$3,$4)', [cardId, gameId, '画像解除のカード', 'manual']);
  await db.query('insert into public.card_images(id,card_id,role,external_url) values($1,$3,$4,$6),($2,$3,$5,$6)', [frontId, backId, cardId, 'front', 'back', 'https://example.com/image.png']);
  await db.query('insert into public.game_artwork(id,external_url) values($1,$2)', [gameId, 'https://example.com/game.png']);
  await role();
  const operations = await review([{ table: 'card_images', id: id(904), action: 'delete', data: { card_id: cardId } }, { table: 'game_artwork', id: gameId, action: 'delete', data: {} }]);
  assert.equal(operations[0].id, frontId); assert.ok(operations[0].expected);
  await apply(id(905), operations);
  await owner();
  assert.deepEqual((await db.query<{ id: string }>('select id from public.card_images where card_id=$1', [cardId])).rows, [{ id: backId }]);
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.game_artwork where id=$1', [gameId])).rows[0].count, 0);
  await role();
  const alreadyEmpty = await review([{ table: 'card_images', id: id(906), action: 'delete', data: { card_id: cardId } }]);
  assert.equal(alreadyEmpty[0].expected, null); await apply(id(907), alreadyEmpty);
});
test('receipt recovery and cursor audit work in a fresh admin session and remain private', async () => {
  await role();
  const result = await db.query<{ receipt: { batchId: string } }>('select public.kakurenbo_get_apply_receipt($1::uuid) as receipt', [id(101)]);
  assert.equal(result.rows[0].receipt.batchId, id(101));
  assert.equal((await db.query<{ receipt: unknown }>('select public.kakurenbo_get_apply_receipt($1::uuid) as receipt', [id(999990)])).rows[0].receipt, null);
  const first = (await db.query<{ batches: { batchId: string; at: string; operations: unknown[] }[] }>('select public.kakurenbo_list_apply_batches(null,null,2) as batches')).rows[0].batches;
  assert.equal(first.length, 2); assert.ok(Array.isArray(first[0].operations));
  const last = first[first.length - 1];
  const next = (await db.query<{ batches: { batchId: string }[] }>('select public.kakurenbo_list_apply_batches($1::timestamptz,$2::uuid,2) as batches', [last.at, last.batchId])).rows[0].batches;
  assert.equal(next.length, 2); assert.ok(next.every(batch => !first.some(old => old.batchId === batch.batchId)));
  await role(otherId);
  await assert.rejects(db.query('select public.kakurenbo_list_apply_batches(null,null,2)'), (error: unknown) => (error as { code: string }).code === '42501');
  await assert.rejects(db.query('select public.kakurenbo_get_apply_receipt($1::uuid)', [id(101)]), (error: unknown) => (error as { code: string }).code === '42501');
  await role('', 'anon');
  await assert.rejects(db.query('select public.kakurenbo_list_apply_batches(null,null,2)'), (error: unknown) => (error as { code: string }).code === '42501');
});
test('members can move/remove within an event or join a new team, without destroying their attendance', async () => {
  await role();
  const gameId = id(10000), personId = id(10001), teamId = id(10002), relationId = id(10003);
  const reviewed = await review([{ table: 'events', id: gameId, action: 'upsert', data: { name: '所属ゲーム' } }, { table: 'people', id: personId, action: 'upsert', data: { display_name: '新しい人物' } }, { table: 'teams', id: teamId, action: 'upsert', data: { event_id: gameId, display_name: '新しいチーム' } }, { table: 'participations', id: relationId, action: 'upsert', data: { person_id: personId, event_id: gameId, team_id: teamId, role_id: null, kind: 'participant', status: 'attended', name_at_event: '参加名' } }]);
  await apply(id(10004), reviewed);
  const remove = await review([{ table: 'participations', id: relationId, action: 'upsert', data: { team_id: null } }]);
  await apply(id(10005), remove);
  await owner();
  assert.deepEqual((await db.query<{ team_id: null; status: string; name_at_event: string }>('select team_id,status,name_at_event from public.participations where id=$1', [relationId])).rows[0], { team_id: null, status: 'attended', name_at_event: '参加名' });
  await role();
  const wrongEvent = await review([{ table: 'participations', id: relationId, action: 'upsert', data: { team_id: id(10002), event_id: originalGame } }]);
  await assert.rejects(apply(id(10006), wrongEvent), (error: unknown) => (error as { code: string }).code === '23503');
});
test('master conversion normalizes required roles in the reviewed diff and preserves attendance identity', async () => {
  await role();
  const gameId = id(11000), personId = id(11001), relationId = id(11002);
  const original = await review([{ table: 'events', id: gameId, action: 'upsert', data: { name: '役割のゲーム' } }, { table: 'people', id: personId, action: 'upsert', data: { display_name: '役割の人物' } }, { table: 'participations', id: relationId, action: 'upsert', data: { person_id: personId, event_id: gameId, kind: 'participant', role_id: id(4), status: 'attended', name_at_event: '参加名の保持' } }]);
  await apply(id(11003), original);
  const master = await review([{ table: 'participations', id: relationId, action: 'upsert', data: { kind: 'master', role_id: null } }]);
  assert.equal(master[0].data.role_id, id(3)); assert.equal(master[0].data.team_id, null);
  await assert.rejects(apply(id(11004), [{ ...master[0], data: { kind: 'master', role_id: null } }]), (error: unknown) => (error as { code: string }).code === '22023');
  await apply(id(11005), master);
  const participant = await review([{ table: 'participations', id: relationId, action: 'upsert', data: { kind: 'participant' } }]);
  assert.equal(participant[0].data.role_id, null);
  await apply(id(11006), participant);
  await owner();
  assert.deepEqual((await db.query<{ id: string; kind: string; role_id: null; name_at_event: string; status: string }>('select id,kind,role_id,name_at_event,status from public.participations where id=$1', [relationId])).rows[0], { id: relationId, kind: 'participant', role_id: null, name_at_event: '参加名の保持', status: 'attended' });
});
test('image updates keep a verified non-first display order and new image ordering is positive', async () => {
  const cardId = id(12000), imageId = id(12001);
  await owner();
  await db.query('insert into public.cards(id,event_id,name,source_type) values($1,$2,$3,$4)', [cardId, originalGame, '並び順保持', 'manual']);
  await db.query('insert into public.card_images(id,card_id,display_order,external_url) values($1,$2,3,$3)', [imageId, cardId, 'https://example.com/three.png']);
  await role();
  const images = await review([{ table: 'card_images', id: id(12002), action: 'upsert', data: { card_id: cardId, role: 'front', display_order: 1, image_status: 'available', external_url: 'https://example.com/new.png', storage_path: null } }]);
  assert.equal(images[0].id, imageId); assert.equal(images[0].data.display_order, 3);
  await apply(id(12003), images);
  await owner();
  assert.equal((await db.query<{ display_order: number }>('select display_order from public.card_images where id=$1', [imageId])).rows[0].display_order, 3);
});
test('cancelling a failed attempt prevents a late transaction, while committed attempts keep their receipt', async () => {
  await role();
  const batchId = id(13000), personId = id(13001);
  const operations = await review([{ table: 'people', id: personId, action: 'upsert', data: { display_name: '未反映の下書き' } }]);
  const cancelled = await db.query<{ receipt: unknown }>('select public.kakurenbo_cancel_apply_batch($1::uuid) as receipt', [batchId]);
  assert.equal(cancelled.rows[0].receipt, null);
  await assert.rejects(apply(batchId, operations), (error: unknown) => (error as { code: string }).code === '55000');
  const committed = await db.query<{ receipt: { batchId: string } }>('select public.kakurenbo_cancel_apply_batch($1::uuid) as receipt', [id(101)]);
  assert.equal(committed.rows[0].receipt.batchId, id(101));
  await role(otherId);
  await assert.rejects(db.query('select public.kakurenbo_cancel_apply_batch($1::uuid)', [batchId]), (error: unknown) => (error as { code: string }).code === '42501');
  await owner();
  assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.people where id=$1', [personId])).rows[0].count, 0);
});
test('the production rollback verification script passes and leaves domain/audit records unchanged', async () => {
  await owner();
  // Production grants already allow registered admins to read these tables.
  // Mirror those read privileges without granting any INSERT/DELETE privileges.
  await db.exec('grant select on public.events,public.people,public.teams,public.cards,public.card_images,public.roles,public.participations,public.resource_links to authenticated');
  const counts = () => db.query<{ counts: unknown }>(`select jsonb_build_object('events',(select count(*) from public.events),'people',(select count(*) from public.people),'teams',(select count(*) from public.teams),'cards',(select count(*) from public.cards),'images',(select count(*) from public.card_images),'relations',(select count(*) from public.participations),'links',(select count(*) from public.resource_links),'artwork',(select count(*) from public.game_artwork),'flags',(select count(*) from public.admin_record_flags),'batches',(select count(*) from kakurenbo_admin.apply_batches),'cancelled',(select count(*) from kakurenbo_admin.cancelled_batches)) counts`);
  const before = (await counts()).rows[0];
  const sql = await readFile(new URL('../supabase/verify-admin-rollback.sql', import.meta.url), 'utf8');
  const results = await db.exec(sql);
  assert.match(String((results.at(-1)?.rows[0] as { result: string }).result), /^PASS:/);
  assert.deepEqual((await counts()).rows[0], before);
});
test('anonymous and signed-in non-admin callers cannot execute the write route or private helpers', async () => {
  const operation: ApplyOperation = { table: 'people', id: id(700), action: 'upsert', data: { display_name: '許可されない人物' } };
  await role(otherId);
  await assert.rejects(review([operation]), (error: unknown) => (error as { code: string }).code === '42501');
  await assert.rejects(apply(id(701), [{ ...operation, expected: null }]), (error: unknown) => (error as { code: string }).code === '42501');
  await assert.rejects(db.query("select kakurenbo_admin.allowed_columns('people')"), (error: unknown) => (error as { code: string }).code === '42501');
  await role('', 'anon');
  await assert.rejects(review([operation]), (error: unknown) => (error as { code: string }).code === '42501');
  await assert.rejects(apply(id(702), [{ ...operation, expected: null }]), (error: unknown) => (error as { code: string }).code === '42501');
  await owner(); assert.equal((await db.query<{ count: number }>('select count(*)::int as count from public.people where id=$1', [id(700)])).rows[0].count, 0);
});

test('clients cannot promote themselves by inserting membership, even with an accidentally permissive RLS policy', async () => {
  await owner();
  await db.exec('create policy security_test_permissive_membership on public.admin_users for all to authenticated using (true) with check (true)');
  try {
    await role(otherId);
    await assert.rejects(db.query('insert into public.admin_users(user_id) values($1)', [otherId]), (error: unknown) => (error as { code: string }).code === '42501');
    assert.equal((await db.query<{ allowed: boolean }>('select public.is_game_db_admin() as allowed')).rows[0].allowed, false);
    await assert.rejects(db.query('select user_id from public.admin_users'), (error: unknown) => (error as { code: string }).code === '42501');
    await assert.rejects(db.query('select * from public.admin_users'), (error: unknown) => (error as { code: string }).code === '42501');
    await role();
    await assert.rejects(db.query('select public.kakurenbo_list_apply_batches(null,null,null)'), (error: unknown) => (error as { code: string }).code === '22023');
  } finally {
    await owner();
    await db.exec('drop policy security_test_permissive_membership on public.admin_users');
  }
});

test('standalone security migration is repeatable and removes independently granted column privileges', async () => {
  await owner();
  await db.exec('grant insert(user_id),select(user_id),update(user_id) on public.admin_users to public,anon,authenticated');
  const sql = await readFile(new URL('../supabase/security-hardening.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  await db.exec(sql);
  await role(otherId);
  await assert.rejects(db.query('insert into public.admin_users(user_id) values($1)', [otherId]), (error: unknown) => (error as { code: string }).code === '42501');
  await assert.rejects(db.query('select user_id from public.admin_users'), (error: unknown) => (error as { code: string }).code === '42501');
  await role();
  assert.equal((await db.query<{ allowed: boolean }>('select public.is_game_db_admin() as allowed')).rows[0].allowed, true);
});

test('standalone hardening refuses inherited membership grants instead of reporting success', async () => {
  await owner();
  await db.exec('create role security_test_inherited; grant select(user_id) on public.admin_users to security_test_inherited; grant security_test_inherited to authenticated');
  const sql = await readFile(new URL('../supabase/security-hardening.sql', import.meta.url), 'utf8');
  try {
    await assert.rejects(db.exec(sql), /Membership access remains/);
    await db.exec('rollback');
  } finally {
    await owner();
    await db.exec('revoke security_test_inherited from authenticated; revoke select(user_id) on public.admin_users from security_test_inherited; drop role security_test_inherited');
  }
});
