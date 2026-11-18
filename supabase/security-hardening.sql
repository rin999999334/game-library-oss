-- Apply only after the catalog review and a tested backup/restore procedure.
-- Existing admin-bulk-apply.sql must already be installed. No domain rows change.
begin;
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public,anon,authenticated;
-- Table-level REVOKE does not remove independently granted column privileges.
do $membership_columns$
declare columns text;
begin
  select string_agg(format('%I',attname),',') into columns from pg_attribute
  where attrelid='public.admin_users'::regclass and attnum>0 and not attisdropped;
  execute format('revoke all (%s) on public.admin_users from public,anon,authenticated', columns);
end;
$membership_columns$;

-- Inherited grants must be investigated rather than silently accepted.
do $effective_membership_access$
declare principal text;
begin
  foreach principal in array array['anon','authenticated'] loop
    if has_any_column_privilege(principal,'public.admin_users','SELECT,INSERT,UPDATE,REFERENCES')
       or has_table_privilege(principal,'public.admin_users','DELETE,TRUNCATE,TRIGGER') then
      raise exception 'Membership access remains through another grant; review inherited roles before applying.';
    end if;
  end loop;
end;
$effective_membership_access$;
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
revoke all on function public.kakurenbo_list_apply_batches(timestamptz,uuid,integer) from public,anon;
grant execute on function public.kakurenbo_list_apply_batches(timestamptz,uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
