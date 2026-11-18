-- Production administration setup. Review and run in the SQL Editor separately.
-- No existing domain rows are changed by this migration.
begin;
create schema if not exists kakurenbo_admin;
revoke all on schema kakurenbo_admin from public, anon, authenticated;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- Membership is managed by the database owner, never through client grants.
revoke all on public.admin_users from public, anon, authenticated;
-- Table-level REVOKE does not remove independently granted column privileges.
do $membership_columns$
declare columns text;
begin
  select string_agg(format('%I',attname),',') into columns from pg_attribute
  where attrelid='public.admin_users'::regclass and attnum>0 and not attisdropped;
  execute format('revoke all (%s) on public.admin_users from public,anon,authenticated', columns);
end;
$membership_columns$;
create or replace function public.is_game_db_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.admin_users where user_id = auth.uid());
$$;
revoke all on function public.is_game_db_admin() from public, anon;
grant execute on function public.is_game_db_admin() to authenticated;

alter table public.card_images add column if not exists external_url text;
-- Verified production constraints. Retain every legacy type while allowing the
-- five choices used by the current editor. Existing domain rows are untouched.
alter table public.cards drop constraint if exists cards_card_type_check;
alter table public.cards add constraint cards_card_type_check check (card_type in ('attack','defence','quick','special','guard','spell','other'));
alter table public.card_images drop constraint if exists card_images_check;
alter table public.card_images add constraint card_images_check check (image_status <> 'available' or storage_path is not null or external_url is not null);
create table if not exists public.game_artwork (
  id uuid primary key references public.events(id) on delete cascade,
  storage_path text,
  external_url text,
  updated_at timestamptz not null default now(),
  constraint game_artwork_has_source check (storage_path is not null or external_url is not null)
);
alter table public.game_artwork enable row level security;
drop policy if exists kakurenbo_public_artwork on public.game_artwork;
create policy kakurenbo_public_artwork on public.game_artwork for select to anon, authenticated using (true);
grant select on public.game_artwork to anon, authenticated;

create table if not exists public.admin_record_flags (
  id text primary key,
  sheet text not null check (sheet in ('cards','people','games','teams')),
  record_id uuid not null,
  on_hold boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint admin_record_flags_key check (id = sheet || ':' || record_id::text)
);
alter table public.admin_record_flags enable row level security;
drop policy if exists kakurenbo_admin_flags_read on public.admin_record_flags;
create policy kakurenbo_admin_flags_read on public.admin_record_flags for select to authenticated using ((select public.is_game_db_admin()));
grant select on public.admin_record_flags to authenticated;
revoke all on public.admin_record_flags from anon;

create table if not exists kakurenbo_admin.apply_batches (
  id uuid primary key,
  actor uuid not null references auth.users(id),
  committed_at timestamptz not null default now(),
  payload jsonb not null,
  receipt jsonb not null
);
create index if not exists apply_batches_committed_order on kakurenbo_admin.apply_batches (committed_at desc,id desc);
revoke all on kakurenbo_admin.apply_batches from public, anon, authenticated;
create table if not exists kakurenbo_admin.cancelled_batches (
  id uuid primary key,
  actor uuid not null references auth.users(id),
  cancelled_at timestamptz not null default now()
);
revoke all on kakurenbo_admin.cancelled_batches from public, anon, authenticated;

create or replace function kakurenbo_admin.allowed_columns(target text) returns text[] language sql immutable set search_path = '' as $$
  select case target
    when 'events' then array['name','fiscal_year','start_date','end_date','schedule_note']
    when 'people' then array['display_name','code_name','joined_year']
    when 'teams' then array['event_id','display_name','rank_value','rank_note','final_score']
    when 'cards' then array['event_id','source_card_id','name','rank','card_type','effect_text','flavor_text','publication_status']
    when 'participations' then array['person_id','event_id','team_id','role_id','kind','name_at_event','status']
    when 'resource_links' then array['person_id','event_id','kind','label','url']
    when 'card_images' then array['card_id','role','display_order','image_status','storage_path','external_url']
    when 'game_artwork' then array['storage_path','external_url']
    when 'admin_record_flags' then array['sheet','record_id','on_hold']
    else null end;
$$;

create or replace function kakurenbo_admin.validate_operation(operation jsonb) returns void language plpgsql set search_path = '' as $$
declare target text := operation->>'table'; field text; allowed text[]; identifier text := operation->>'id';
begin
  allowed := kakurenbo_admin.allowed_columns(target);
  if allowed is null or coalesce(operation->>'action','') not in ('upsert','delete') or identifier is null or jsonb_typeof(operation->'data') is distinct from 'object' then
    raise exception using errcode='22023', message='変更の形式が正しくありません。';
  end if;
  if target <> 'admin_record_flags' then perform identifier::uuid;
  elsif identifier !~ '^(cards|people|games|teams):[0-9a-fA-F-]{36}$' then raise exception using errcode='22023', message='保留の識別子が正しくありません。';
  end if;
  if operation->>'action' = 'delete' and target not in ('participations','resource_links','admin_record_flags','card_images','game_artwork') then
    raise exception using errcode='22023', message='この情報の削除は対応していません。';
  end if;
  for field in select jsonb_object_keys(operation->'data') loop
    if not field = any(allowed) then raise exception using errcode='22023', message='編集できない項目が含まれています。'; end if;
  end loop;
  if target='card_images' then
    if coalesce(operation->'data'->>'card_id','')='' then raise exception using errcode='22023', message='画像のカードを選んでください。'; end if;
    perform (operation->'data'->>'card_id')::uuid;
    if operation->>'action'='upsert' and coalesce(operation->'data'->>'role','')<>'front' then raise exception using errcode='22023', message='この画面では表面画像を編集してください。'; end if;
  end if;
  if operation->>'action' = 'upsert' and operation->'data' = '{}'::jsonb then raise exception using errcode='22023', message='変更する項目がありません。'; end if;
  if operation->'data' ? 'name' and nullif(btrim(operation->'data'->>'name'),'') is null then raise exception using errcode='22023', message='名前を入力してください。'; end if;
  if operation->'data' ? 'display_name' and nullif(btrim(operation->'data'->>'display_name'),'') is null then raise exception using errcode='22023', message='名前を入力してください。'; end if;
  if operation->'data' ? 'publication_status' and coalesce(operation->'data'->>'publication_status','') not in ('draft','published') then raise exception using errcode='22023', message='公開状態が正しくありません。'; end if;
  if operation->'data' ? 'external_url' and operation->'data'->>'external_url' is not null and operation->'data'->>'external_url' !~ '^https?://' then raise exception using errcode='22023', message='画像URLは http / https で入力してください。'; end if;
  if operation->'data' ? 'storage_path' and operation->'data'->>'storage_path' is not null and operation->'data'->>'storage_path' !~ '^admin-batches/[0-9a-f-]{36}/(cards|games)/[0-9a-f-]{36}\.(png|jpg|webp)$' then raise exception using errcode='22023', message='画像の保存先が正しくありません。'; end if;
end;
$$;

-- Normalize fields against the reviewed row, rather than writing UI placeholders
-- over required production values. The resulting data is returned in the review.
create or replace function kakurenbo_admin.normalize_operation(operation jsonb, expected jsonb) returns jsonb language plpgsql set search_path='' as $$
declare data jsonb := operation->'data'; target text := operation->>'table'; desired_kind text; role_identifier uuid; role_kind text;
begin
  if operation->>'action'='delete' then return operation; end if;
  if target='cards' and data->>'rank' is not null then data := jsonb_set(data,'{rank}',to_jsonb(lower(data->>'rank'))); end if;
  if target='card_images' then
    data := jsonb_set(data,'{display_order}',coalesce(expected->'display_order','1'::jsonb));
  end if;
  if target='participations' then
    desired_kind := coalesce(data->>'kind',expected->>'kind');
    role_identifier := (case when data ? 'role_id' then data->>'role_id' else expected->>'role_id' end)::uuid;
    select kind into role_kind from public.roles where id=role_identifier;
    if desired_kind='master' then
      if role_kind is distinct from 'master' then
        select id into role_identifier from public.roles where kind='master' order by (label='マスター') desc,id limit 1;
        if role_identifier is null then raise exception using errcode='23503',message='マスターの役割をデータベースに登録してください。'; end if;
      end if;
      data := data || jsonb_build_object('role_id',role_identifier,'team_id',null);
    elsif desired_kind='participant' and role_identifier is not null and role_kind is distinct from 'participant' and expected->>'kind'='master' then
      data := data || jsonb_build_object('role_id',null);
    end if;
  end if;
  return jsonb_set(operation,'{data}',data);
end;
$$;

create or replace function public.kakurenbo_review_changes(operations jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation jsonb; result jsonb := '[]'::jsonb; current_row jsonb; identifier text; image_id uuid;
begin
  if not public.is_game_db_admin() then raise exception using errcode='42501', message='管理者権限が必要です。'; end if;
  if jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) < 1 or jsonb_array_length(operations) > 20000 or octet_length(operations::text) > 12000000 then raise exception using errcode='22023', message='変更件数または容量を確認してください。'; end if;
  for operation in select value from jsonb_array_elements(operations) loop
    perform kakurenbo_admin.validate_operation(operation);
    identifier := operation->>'id';
    -- Replace the currently displayed front image without adding a competing front row.
    if operation->>'table' = 'card_images' then
      select id into image_id from public.card_images where card_id = (operation->'data'->>'card_id')::uuid and role = 'front' order by (image_status='available') desc, display_order, id limit 1;
      if image_id is not null then identifier := image_id::text; operation := jsonb_set(operation, '{id}', to_jsonb(identifier)); end if;
    end if;
    if operation->>'table' = 'admin_record_flags' then
      select to_jsonb(t) into current_row from public.admin_record_flags t where t.id = identifier;
    else
      execute format('select to_jsonb(t) from public.%I t where id=$1',operation->>'table') into current_row using identifier::uuid;
    end if;
    operation := kakurenbo_admin.normalize_operation(operation,current_row);
    result := result || jsonb_build_array(operation || jsonb_build_object('expected',current_row));
  end loop;
  return result;
end;
$$;

create or replace function public.kakurenbo_apply_changes(batch_id uuid, payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare operations jsonb := payload->'operations'; operation jsonb; current_row jsonb; saved kakurenbo_admin.apply_batches%rowtype; identifier text; target text; columns text; data jsonb; result jsonb; actor uuid := auth.uid(); now_at timestamptz := now(); flag_target text; current_front uuid;
begin
  if not public.is_game_db_admin() then raise exception using errcode='42501', message='管理者権限が必要です。'; end if;
  if batch_id is null or jsonb_typeof(operations) is distinct from 'array' or jsonb_array_length(operations) < 1 or jsonb_array_length(operations) > 20000 or octet_length(payload::text) > 16000000 or jsonb_typeof(payload->'historyIds') is distinct from 'array' then raise exception using errcode='22023', message='変更の形式または容量を確認してください。'; end if;
  -- Serialize duplicate retries; a receipt exists only if every operation committed.
  perform pg_advisory_xact_lock(hashtextextended(batch_id::text,0));
  if exists(select 1 from kakurenbo_admin.cancelled_batches where id=batch_id) then raise exception using errcode='55000',message='この反映は中止されています。下書きから変更内容を確認し直してください。'; end if;
  select * into saved from kakurenbo_admin.apply_batches where id = batch_id;
  if found then
    if saved.actor <> actor or saved.payload <> payload then raise exception using errcode='22023', message='同じ反映IDに異なる変更が含まれています。'; end if;
    return saved.receipt;
  end if;
  if exists(select 1 from jsonb_array_elements(operations) o group by o->>'table',o->>'id' having count(*)>1) then raise exception using errcode='22023', message='同じ情報が重複しています。'; end if;
  -- All image writers through this RPC lock the parent card first. Concurrent
  -- front-image creation cannot silently add two competing images.
  perform 1 from public.cards where id in (
    select distinct (case value->>'table' when 'cards' then value->>'id' else value->'data'->>'card_id' end)::uuid
    from jsonb_array_elements(operations) where value->>'table' in ('cards','card_images')
  ) order by id for update;
  -- Lock and compare all reviewed rows before any mutation. A conflict aborts everything.
  for operation in select value from jsonb_array_elements(operations) order by value->>'table',value->>'id' loop
    perform kakurenbo_admin.validate_operation(operation);
    if not operation ? 'expected' then raise exception using errcode='22023', message='変更内容を確認してから反映してください。'; end if;
    identifier := operation->>'id'; target := operation->>'table';
    if target='card_images' then
      select id into current_front from public.card_images where card_id=(operation->'data'->>'card_id')::uuid and role='front' order by (image_status='available') desc,display_order,id limit 1;
      if (operation->'expected'='null'::jsonb and current_front is not null) or (operation->'expected'<>'null'::jsonb and current_front is distinct from identifier::uuid) then
        raise exception using errcode='40001',message='確認後にカード画像が変更されました。最新の差分を確認し直してください。';
      end if;
    end if;
    if target = 'admin_record_flags' then select to_jsonb(t) into current_row from public.admin_record_flags t where t.id=identifier for update;
    else execute format('select to_jsonb(t) from public.%I t where id=$1 for update',target) into current_row using identifier::uuid;
    end if;
    if coalesce(current_row,'null'::jsonb) <> operation->'expected' then raise exception using errcode='40001', message='確認後に情報が変更されました。最新の変更内容を確認し直してください。'; end if;
    if target='cards' and current_row is not null and operation->'data' ? 'publication_status' then raise exception using errcode='22023', message='既存カードの公開状態はこの画面では変更できません。'; end if;
    if kakurenbo_admin.normalize_operation(operation,current_row)->'data' <> operation->'data' then raise exception using errcode='22023',message='変更内容を確認し直してから反映してください。'; end if;
  end loop;
  -- Preserve input order: games -> people -> teams -> cards -> relationships -> images -> work flags.
  for operation in select value from jsonb_array_elements(operations) loop
    identifier := operation->>'id'; target := operation->>'table'; data := operation->'data';
    if operation->>'action'='delete' then
      if target='admin_record_flags' then delete from public.admin_record_flags where id=identifier;
      else execute format('delete from public.%I where id=$1',target) using identifier::uuid;
      end if;
      continue;
    end if;
    if target='cards' and operation->'expected'='null'::jsonb then data := data || jsonb_build_object('publication_status',coalesce(data->>'publication_status','published'),'source_type','manual'); end if;
    if target='participations' and data->>'team_id' is not null and
      (operation->'expected'='null'::jsonb or operation->'expected'->'team_id' is distinct from data->'team_id' or (data ? 'event_id' and operation->'expected'->'event_id' is distinct from data->'event_id')) then
      select to_jsonb(t) into current_row from public.teams t where id=(data->>'team_id')::uuid;
      if current_row is null or current_row->>'event_id' is distinct from coalesce(data->>'event_id',operation->'expected'->>'event_id') then raise exception using errcode='23503',message='参加者とチームの所属ゲームを揃えてください。'; end if;
    end if;
    if target='game_artwork' then data := data || jsonb_build_object('updated_at',now_at); end if;
    if target='admin_record_flags' then
      flag_target := case data->>'sheet' when 'games' then 'events' when 'cards' then 'cards' when 'people' then 'people' when 'teams' then 'teams' else null end;
      if flag_target is null then raise exception using errcode='22023', message='保留するシートを確認してください。'; end if;
      execute format('select to_jsonb(t) from public.%I t where id=$1',flag_target) into current_row using (data->>'record_id')::uuid;
      if current_row is null then raise exception using errcode='23503', message='保留する情報が見つかりません。'; end if;
      data := data || jsonb_build_object('updated_at',now_at,'updated_by',actor);
    end if;
    select string_agg(format('%I',key),',' order by key) into columns from jsonb_object_keys(data) key;
    data := data || jsonb_build_object('id',identifier);
    if operation->'expected'='null'::jsonb then
      -- Plain INSERT also rejects a concurrent creation with the same ID.
      execute format('insert into public.%1$I (id,%2$s) select id,%2$s from jsonb_populate_record(null::public.%1$I,$1)',target,columns) using data;
    elsif target='admin_record_flags' then
      execute format('update public.%1$I set (%2$s)=(select %2$s from jsonb_populate_record(null::public.%1$I,$1)) where id=$2',target,columns) using data,identifier;
    else
      execute format('update public.%1$I set (%2$s)=(select %2$s from jsonb_populate_record(null::public.%1$I,$1)) where id=$2',target,columns) using data,identifier::uuid;
    end if;
  end loop;
  result := jsonb_build_object('batchId',batch_id,'at',now_at,'historyIds',payload->'historyIds','storeRevision',payload->'storeRevision','counts',payload->'counts');
  insert into kakurenbo_admin.apply_batches(id,actor,committed_at,payload,receipt) values(batch_id,actor,now_at,payload,result);
  return result;
end;
$$;
create or replace function public.kakurenbo_get_apply_receipt(batch_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved kakurenbo_admin.apply_batches%rowtype;
begin
  if not public.is_game_db_admin() then raise exception using errcode='42501',message='管理者権限が必要です。'; end if;
  -- Wait for an earlier transaction using this ID before deciding it did not commit.
  perform pg_advisory_xact_lock(hashtextextended(batch_id::text,0));
  select * into saved from kakurenbo_admin.apply_batches where id=batch_id;
  if not found then return null; end if;
  if saved.actor<>auth.uid() then raise exception using errcode='42501',message='この反映を実行した管理者でログインしてください。'; end if;
  return saved.receipt;
end;
$$;
create or replace function public.kakurenbo_cancel_apply_batch(batch_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved kakurenbo_admin.apply_batches%rowtype; cancelled_actor uuid;
begin
  if not public.is_game_db_admin() then raise exception using errcode='42501',message='管理者権限が必要です。'; end if;
  if batch_id is null then raise exception using errcode='22023',message='反映IDを確認してください。'; end if;
  -- A late apply must acquire this same lock and see the cancellation. If the
  -- earlier apply committed, return its receipt instead of pretending to cancel.
  perform pg_advisory_xact_lock(hashtextextended(batch_id::text,0));
  select * into saved from kakurenbo_admin.apply_batches where id=batch_id;
  if found then
    if saved.actor<>auth.uid() then raise exception using errcode='42501',message='この反映を実行した管理者でログインしてください。'; end if;
    return saved.receipt;
  end if;
  select actor into cancelled_actor from kakurenbo_admin.cancelled_batches where id=batch_id;
  if found and cancelled_actor<>auth.uid() then raise exception using errcode='42501',message='この反映を開始した管理者でログインしてください。'; end if;
  insert into kakurenbo_admin.cancelled_batches(id,actor) values(batch_id,auth.uid()) on conflict(id) do nothing;
  return null;
end;
$$;
create or replace function public.kakurenbo_list_apply_batches(before_at timestamptz default null,before_id uuid default null,page_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_game_db_admin() then raise exception using errcode='42501',message='管理者権限が必要です。'; end if;
  if page_size is null or page_size<1 or page_size>100 or ((before_at is null)<>(before_id is null)) then raise exception using errcode='22023',message='履歴の取得範囲が正しくありません。'; end if;
  select coalesce(jsonb_agg(value order by committed_at desc,id desc),'[]'::jsonb) into result from (
    select b.id,b.committed_at,jsonb_build_object('batchId',b.id,'at',b.committed_at,'actor',coalesce(u.email,'管理者'),'historyEntries',coalesce(b.payload->'historyEntries','[]'::jsonb),'operations',b.payload->'operations','receipt',b.receipt) value
    from kakurenbo_admin.apply_batches b left join auth.users u on u.id=b.actor
    where before_at is null or (b.committed_at,b.id)<(before_at,before_id)
    order by b.committed_at desc,b.id desc limit page_size
  ) rows;
  return result;
end;
$$;
revoke all on function public.kakurenbo_review_changes(jsonb) from public, anon;
revoke all on function public.kakurenbo_apply_changes(uuid,jsonb) from public, anon;
grant execute on function public.kakurenbo_review_changes(jsonb) to authenticated;
grant execute on function public.kakurenbo_apply_changes(uuid,jsonb) to authenticated;
revoke all on function public.kakurenbo_get_apply_receipt(uuid) from public, anon;
revoke all on function public.kakurenbo_cancel_apply_batch(uuid) from public, anon;
revoke all on function public.kakurenbo_list_apply_batches(timestamptz,uuid,integer) from public, anon;
grant execute on function public.kakurenbo_get_apply_receipt(uuid) to authenticated;
grant execute on function public.kakurenbo_cancel_apply_batch(uuid) to authenticated;
grant execute on function public.kakurenbo_list_apply_batches(timestamptz,uuid,integer) to authenticated;
revoke all on all functions in schema kakurenbo_admin from public, anon, authenticated;

-- Storage upload remains separate from the atomic DB transaction. Unique batch paths
-- prevent replacing live files. Failed attempts may leave unused files for manual cleanup.
drop policy if exists kakurenbo_admin_batch_upload on storage.objects;
create policy kakurenbo_admin_batch_upload on storage.objects for insert to authenticated with check (
  bucket_id='card-images' and name like 'admin-batches/%' and (select public.is_game_db_admin())
);
-- Make the new RPCs and columns available through the REST API after commit.
notify pgrst, 'reload schema';
commit;
