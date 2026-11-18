-- Fictional regression fixture; never run against production.
begin;
do $audit$
declare current_row jsonb; expected jsonb := '{"id": "665f2585-0369-5c79-bfb8-0e9bd9d259ab", "person_id": "68c68d22-e914-5d23-afb7-e2c6da552623", "event_id": "33c495c1-7349-50ad-bd37-7c483d5728c3", "team_id": null, "role_id": null, "kind": "participant", "name_at_event": null, "status": "attended", "grade_at_event": 1}'::jsonb; applied jsonb := '{"id": "665f2585-0369-5c79-bfb8-0e9bd9d259ab", "person_id": "613227a7-986f-5670-b64b-2acaa7feaa29", "event_id": "33c495c1-7349-50ad-bd37-7c483d5728c3", "team_id": null, "role_id": null, "kind": "participant", "name_at_event": null, "status": "attended", "grade_at_event": 1}'::jsonb; target jsonb;
begin
 select to_jsonb(p) into target from public.people p where id='613227a7-986f-5670-b64b-2acaa7feaa29'::uuid for share;
 if target is null or exists(select 1 from jsonb_each('{"id": "613227a7-986f-5670-b64b-2acaa7feaa29", "display_name": "サンプル人物", "code_name": "sample-code", "joined_year": 2015}'::jsonb) e where target->e.key is distinct from e.value) then raise exception 'Verified target person changed; nothing applied.'; end if;
 select to_jsonb(p) into current_row from public.participations p where id='665f2585-0369-5c79-bfb8-0e9bd9d259ab'::uuid for update;
 if current_row is null or (exists(select 1 from jsonb_each(expected) e where current_row->e.key is distinct from e.value) and exists(select 1 from jsonb_each(applied) e where current_row->e.key is distinct from e.value)) then raise exception 'Participation changed since verification; nothing applied.'; end if;
 if exists(select 1 from public.participations where person_id=(applied->>'person_id')::uuid and event_id=(applied->>'event_id')::uuid and id<>'665f2585-0369-5c79-bfb8-0e9bd9d259ab'::uuid) then raise exception 'Target already participates in this event; nothing applied.'; end if;
 update public.participations set person_id=(applied->>'person_id')::uuid where id='665f2585-0369-5c79-bfb8-0e9bd9d259ab'::uuid;
end
$audit$;
select jsonb_build_object('operation','apply','verified_participations',1,'row',to_jsonb(p)) as participation_result from public.participations p where id='665f2585-0369-5c79-bfb8-0e9bd9d259ab'::uuid;
commit;
