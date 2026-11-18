-- Run only after admin-bulk-apply.sql has been reviewed and applied.
-- All domain IDs are random. Existing rows are read, never edited.
-- This verifies PostgreSQL/RPC permissions and transactions, not Storage HTTP uploads.
-- A failed assertion raises an error and stops this script. Success ends in ROLLBACK.
begin;
do $verification$
<<verify>>
declare
  administrator uuid;
  game_id uuid := gen_random_uuid();
  person_id uuid := gen_random_uuid();
  team_id uuid := gen_random_uuid();
  participation_id uuid := gen_random_uuid();
  link_id uuid := gen_random_uuid();
  batch_id uuid := gen_random_uuid();
  convert_batch uuid := gen_random_uuid();
  remove_master_batch uuid := gen_random_uuid();
  conflict_batch uuid := gen_random_uuid();
  failure_batch uuid := gen_random_uuid();
  cancel_batch uuid := gen_random_uuid();
  cancelled_person uuid := gen_random_uuid();
  failed_game uuid := gen_random_uuid();
  failed_card uuid := gen_random_uuid();
  conflict_person uuid := gen_random_uuid();
  card_ids uuid[] := array[]::uuid[];
  image_ids uuid[] := array[]::uuid[];
  card_id uuid;
  image_id uuid;
  operations jsonb := '[]'::jsonb;
  reviewed jsonb;
  payload jsonb;
  first_receipt jsonb;
  second_receipt jsonb;
  stale_review jsonb;
  audit jsonb;
  failure_observed boolean;
  counter integer;
  expected_master_role uuid;
begin
  select user_id into administrator from public.admin_users order by user_id limit 1;
  if administrator is null then raise exception 'VERIFY: no registered administrator'; end if;
  select id into expected_master_role from public.roles where kind='master' order by (label='マスター') desc,id limit 1;
  if expected_master_role is null then raise exception 'VERIFY: no master role'; end if;
  perform set_config('request.jwt.claim.sub',administrator::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',administrator,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not public.is_game_db_admin() then raise exception 'VERIFY: authenticated administrator gate failed'; end if;

  operations := jsonb_build_array(
    jsonb_build_object('table','events','id',game_id,'action','upsert','data',jsonb_build_object('name','管理画面ロールバック検証','fiscal_year',2026)),
    jsonb_build_object('table','people','id',person_id,'action','upsert','data',jsonb_build_object('display_name','検証用人物','joined_year',2026)),
    jsonb_build_object('table','teams','id',team_id,'action','upsert','data',jsonb_build_object('event_id',game_id,'display_name','検証用チーム','rank_value',1,'final_score',1))
  );
  for counter in 1..100 loop
    card_id := gen_random_uuid(); image_id := gen_random_uuid();
    card_ids := array_append(card_ids,card_id); image_ids := array_append(image_ids,image_id);
    operations := operations || jsonb_build_array(jsonb_build_object('table','cards','id',card_id,'action','upsert','data',jsonb_build_object('event_id',game_id,'source_card_id',counter::text,'name','検証用カード '||counter,'rank','A','card_type',case counter%5 when 0 then 'attack' when 1 then 'guard' when 2 then 'spell' when 3 then 'quick' else 'other' end,'publication_status','published','effect_text','検証用の効果','flavor_text','検証用のフレーバー')));
  end loop;
  operations := operations || jsonb_build_array(
    jsonb_build_object('table','participations','id',participation_id,'action','upsert','data',jsonb_build_object('person_id',person_id,'event_id',game_id,'team_id',team_id,'role_id',null,'kind','participant','name_at_event','保持する参加名','status','attended')),
    jsonb_build_object('table','resource_links','id',link_id,'action','upsert','data',jsonb_build_object('person_id',person_id,'event_id',null,'kind','ブログ','label','検証用ブログ','url','https://example.com/admin-rollback/'||link_id))
  );
  for counter in 1..100 loop
    operations := operations || jsonb_build_array(jsonb_build_object('table','card_images','id',image_ids[counter],'action','upsert','data',jsonb_build_object('card_id',card_ids[counter],'role','front','display_order',1,'image_status','available','storage_path',null,'external_url','https://example.com/admin-rollback/'||image_ids[counter]||'.png')));
  end loop;
  operations := operations || jsonb_build_array(
    jsonb_build_object('table','game_artwork','id',game_id,'action','upsert','data',jsonb_build_object('storage_path',null,'external_url','https://example.com/admin-rollback/'||game_id||'.png')),
    jsonb_build_object('table','admin_record_flags','id','cards:'||card_ids[1],'action','upsert','data',jsonb_build_object('sheet','cards','record_id',card_ids[1],'on_hold',true))
  );
  reviewed := public.kakurenbo_review_changes(operations);
  if jsonb_array_length(reviewed)<>207 or exists(select 1 from jsonb_array_elements(reviewed) operation where operation->'expected'<>'null'::jsonb) then raise exception 'VERIFY: new-row review mismatch'; end if;
  payload := jsonb_build_object('storeRevision',1,'historyIds',jsonb_build_array('verify-'||batch_id),'historyEntries',jsonb_build_array(jsonb_build_object('id','verify-'||batch_id,'at',now(),'sheet','cards','recordId',card_ids[1],'recordName','検証用カード 1','action','create','scope','local','actor','検証','changes',jsonb_build_array(jsonb_build_object('label','名前','before','未登録','after','検証用カード 1')))),'counts',jsonb_build_object('cards',100,'people',1,'games',1,'teams',1,'images',101,'relations',1,'links',1,'holds',1),'operations',reviewed);
  first_receipt := public.kakurenbo_apply_changes(batch_id,payload);
  second_receipt := public.kakurenbo_apply_changes(batch_id,payload);
  if first_receipt is distinct from second_receipt or first_receipt->>'batchId'<>batch_id::text or first_receipt->>'storeRevision'<>'1' then raise exception 'VERIFY: idempotent receipt mismatch'; end if;
  if (select count(*) from public.events where id=game_id)<>1 or (select count(*) from public.people where id=person_id)<>1 or (select count(*) from public.teams where id=team_id)<>1 or (select count(*) from public.participations where id=participation_id)<>1 or (select count(*) from public.resource_links where id=link_id)<>1 then raise exception 'VERIFY: missing domain records'; end if;
  if (select count(*) from public.cards where event_id=game_id and source_type='manual' and publication_status='published' and rank='a')<>100 then raise exception 'VERIFY: new card defaults or normalization failed'; end if;
  if (select count(*) from public.card_images image where image.card_id=any(card_ids) and image_status='available' and external_url is not null and storage_path is null and display_order=1)<>100 then raise exception 'VERIFY: external image records failed'; end if;
  if not exists(select 1 from public.game_artwork where id=game_id) or not exists(select 1 from public.admin_record_flags where id='cards:'||card_ids[1] and on_hold) then raise exception 'VERIFY: artwork or hold missing'; end if;

  -- Convert the same attendance row into a master, then back to a participant.
  reviewed := public.kakurenbo_review_changes(jsonb_build_array(jsonb_build_object('table','participations','id',participation_id,'action','upsert','data',jsonb_build_object('kind','master','role_id',null))));
  if reviewed->0->'data'->>'role_id'<>expected_master_role::text or reviewed->0->'data'->'team_id'<>'null'::jsonb then raise exception 'VERIFY: master review did not normalize role/team'; end if;
  perform public.kakurenbo_apply_changes(convert_batch,jsonb_build_object('storeRevision',2,'historyIds',jsonb_build_array('verify-'||convert_batch),'counts','{}'::jsonb,'operations',reviewed));
  if not exists(select 1 from public.participations participation where participation.id=verify.participation_id and participation.person_id=verify.person_id and kind='master' and role_id=expected_master_role and participation.team_id is null and name_at_event='保持する参加名' and status='attended') then raise exception 'VERIFY: master conversion did not preserve attendance'; end if;
  reviewed := public.kakurenbo_review_changes(jsonb_build_array(jsonb_build_object('table','participations','id',participation_id,'action','upsert','data',jsonb_build_object('kind','participant'))));
  if reviewed->0->'data'->'role_id'<>'null'::jsonb then raise exception 'VERIFY: participant review did not remove incompatible master role'; end if;
  perform public.kakurenbo_apply_changes(remove_master_batch,jsonb_build_object('storeRevision',3,'historyIds',jsonb_build_array('verify-'||remove_master_batch),'counts','{}'::jsonb,'operations',reviewed));
  if not exists(select 1 from public.participations participation where participation.id=verify.participation_id and kind='participant' and role_id is null and name_at_event='保持する参加名' and status='attended') then raise exception 'VERIFY: participant conversion failed'; end if;

  -- A stale review must reject all of its changes, including unrelated new rows.
  stale_review := public.kakurenbo_review_changes(jsonb_build_array(
    jsonb_build_object('table','people','id',conflict_person,'action','upsert','data',jsonb_build_object('display_name','競合時に登録されない人物')),
    jsonb_build_object('table','cards','id',card_ids[1],'action','upsert','data',jsonb_build_object('rank','S'))
  ));
  reviewed := public.kakurenbo_review_changes(jsonb_build_array(jsonb_build_object('table','cards','id',card_ids[1],'action','upsert','data',jsonb_build_object('effect_text','同じ検証内の別編集'))));
  perform public.kakurenbo_apply_changes(gen_random_uuid(),jsonb_build_object('storeRevision',4,'historyIds','[]'::jsonb,'counts','{}'::jsonb,'operations',reviewed));
  failure_observed := false;
  begin
    perform public.kakurenbo_apply_changes(conflict_batch,jsonb_build_object('storeRevision',5,'historyIds','[]'::jsonb,'counts','{}'::jsonb,'operations',stale_review));
  exception when serialization_failure then failure_observed := true;
  end;
  if not failure_observed or exists(select 1 from public.people where id=conflict_person) or public.kakurenbo_get_apply_receipt(conflict_batch) is not null then raise exception 'VERIFY: conflict did not roll back all changes'; end if;
  if (select rank from public.cards where id=card_ids[1])<>'a' then raise exception 'VERIFY: stale rank was unexpectedly applied'; end if;

  -- A genuine FK failure after earlier inserts must also roll back the whole RPC.
  reviewed := public.kakurenbo_review_changes(jsonb_build_array(
    jsonb_build_object('table','events','id',failed_game,'action','upsert','data',jsonb_build_object('name','失敗時に登録されないゲーム')),
    jsonb_build_object('table','cards','id',failed_card,'action','upsert','data',jsonb_build_object('event_id',failed_game,'name','失敗時に登録されないカード','publication_status','published')),
    jsonb_build_object('table','participations','id',gen_random_uuid(),'action','upsert','data',jsonb_build_object('person_id',gen_random_uuid(),'event_id',failed_game,'kind','participant','name_at_event','無効な参照','status','attended'))
  ));
  failure_observed := false;
  begin
    perform public.kakurenbo_apply_changes(failure_batch,jsonb_build_object('storeRevision',6,'historyIds','[]'::jsonb,'counts','{}'::jsonb,'operations',reviewed));
  exception when foreign_key_violation then failure_observed := true;
  end;
  if not failure_observed or exists(select 1 from public.events where id=failed_game) or exists(select 1 from public.cards where id=failed_card) or public.kakurenbo_get_apply_receipt(failure_batch) is not null then raise exception 'VERIFY: FK failure did not roll back all changes'; end if;

  -- Cancelling an uncommitted batch prevents a later request from writing it.
  reviewed := public.kakurenbo_review_changes(jsonb_build_array(jsonb_build_object('table','people','id',cancelled_person,'action','upsert','data',jsonb_build_object('display_name','中止した人物'))));
  if public.kakurenbo_cancel_apply_batch(cancel_batch) is not null then raise exception 'VERIFY: cancellation returned an unexpected receipt'; end if;
  failure_observed := false;
  begin
    perform public.kakurenbo_apply_changes(cancel_batch,jsonb_build_object('storeRevision',7,'historyIds','[]'::jsonb,'counts','{}'::jsonb,'operations',reviewed));
  exception when object_not_in_prerequisite_state then failure_observed := true;
  end;
  if not failure_observed or exists(select 1 from public.people where id=cancelled_person) then raise exception 'VERIFY: cancelled batch was written'; end if;
  if public.kakurenbo_cancel_apply_batch(batch_id) is distinct from first_receipt or public.kakurenbo_get_apply_receipt(batch_id) is distinct from first_receipt then raise exception 'VERIFY: completed receipt recovery mismatch'; end if;
  audit := public.kakurenbo_list_apply_batches(null,null,100);
  if not exists(select 1 from jsonb_array_elements(audit) row where row->>'batchId'=batch_id::text and row->'historyEntries'->0->>'id'='verify-'||batch_id) or exists(select 1 from jsonb_array_elements(audit) row where row->>'batchId' in(conflict_batch::text,failure_batch::text,cancel_batch::text)) then raise exception 'VERIFY: shared audit contains missing/unsuccessful batches'; end if;

  -- A signed-in non-admin and an anonymous caller must both be refused.
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  failure_observed := false;
  begin
    perform public.kakurenbo_review_changes(operations);
  exception when insufficient_privilege then failure_observed := true;
  end;
  if not failure_observed then raise exception 'VERIFY: non-admin caller was permitted'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role anon';
  failure_observed := false;
  begin
    perform public.kakurenbo_list_apply_batches(null,null,1);
  exception when insufficient_privilege then failure_observed := true;
  end;
  if not failure_observed then raise exception 'VERIFY: anonymous audit caller was permitted'; end if;
end;
$verification$;
rollback;
select 'PASS: authenticated bulk apply, 100 cards/images, idempotency, master conversion, rollback, cancellation and private audit verified; all verification writes rolled back' as result;
