create or replace function private.guard_profile_moderation_fields()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') not in ('service_role','supabase_admin')
     and auth.uid() is not null
     and (
       new.is_banned is distinct from old.is_banned
       or new.ban_reason is distinct from old.ban_reason
       or new.banned_at is distinct from old.banned_at
       or new.banned_by is distinct from old.banned_by
       or new.password_login_enabled is distinct from old.password_login_enabled
     ) then
    raise exception 'Only the admin moderation/account service may change protected account fields';
  end if;
  return new;
end;
$function$;

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (
    id = (select auth.uid())
    and coalesce(is_banned, false) = false
    and coalesce(password_login_enabled, false) = false
  );
