-- Global server-side Automation API switch.
-- A missing or unset value defaults to OFF. Only allowlisted admins may change it.

insert into public.app_settings(key, value, updated_at)
values ('chatlink_automation', jsonb_build_object('enabled', false), now())
on conflict (key) do update
set value = jsonb_build_object('enabled', false),
    updated_at = now();

create or replace function public.get_chatlink_automation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $function$
declare
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Admin login required';
  end if;

  select lower(trim(email))
    into v_email
    from auth.users
   where id = auth.uid();

  if not exists (
    select 1
      from public.admin_allowlist
     where lower(trim(email)) = v_email
       and enabled = true
  ) then
    raise exception 'Admin access denied';
  end if;

  return coalesce(
    (select value from public.app_settings where key = 'chatlink_automation'),
    jsonb_build_object('enabled', false)
  );
end;
$function$;

create or replace function public.admin_set_chatlink_automation(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to public
as $function$
declare
  v_email text;
  v_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'Admin login required';
  end if;

  select lower(trim(email))
    into v_email
    from auth.users
   where id = auth.uid();

  if not exists (
    select 1
      from public.admin_allowlist
     where lower(trim(email)) = v_email
       and enabled = true
  ) then
    raise exception 'Admin access denied';
  end if;

  v_value := jsonb_build_object('enabled', coalesce(p_enabled, false));

  insert into public.app_settings(key, value, updated_at)
  values ('chatlink_automation', v_value, now())
  on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

  return v_value;
end;
$function$;

revoke all on function public.get_chatlink_automation_status() from public, anon;
grant execute on function public.get_chatlink_automation_status() to authenticated;

revoke all on function public.admin_set_chatlink_automation(boolean) from public, anon;
grant execute on function public.admin_set_chatlink_automation(boolean) to authenticated;
