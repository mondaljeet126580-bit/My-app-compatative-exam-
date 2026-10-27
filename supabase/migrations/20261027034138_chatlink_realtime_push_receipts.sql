-- ChatLink per-recipient message receipts and unread state.
-- This migration preserves existing messages, chat rows, RLS and UI.

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(message_id,recipient_user_id),
  constraint message_receipts_read_after_delivery check(read_at is null or delivered_at is not null)
);
create index if not exists message_receipts_recipient_unread_idx on public.message_receipts(recipient_user_id,read_at,created_at desc);
alter table public.message_receipts enable row level security;
revoke all on public.message_receipts from public,anon;
revoke insert,update,delete,truncate,references,trigger on public.message_receipts from authenticated;
grant select on public.message_receipts to authenticated;
drop policy if exists "Recipients and senders can read message receipts" on public.message_receipts;
create policy "Recipients and senders can read message receipts" on public.message_receipts
for select to authenticated using(
  recipient_user_id=(select auth.uid())
  or exists(select 1 from public.messages m where m.id=message_id and m.sender_id=(select auth.uid()))
);
grant all on public.message_receipts to service_role;

-- Backfill receipts without altering existing messages.
insert into public.message_receipts(message_id,recipient_user_id,delivered_at,read_at,created_at)
select m.id,cm.user_id,
  case when cm.last_read_at is not null and m.created_at<=cm.last_read_at then coalesce(m.delivered_at,cm.last_read_at) else null end,
  case when cm.last_read_at is not null and m.created_at<=cm.last_read_at then coalesce(m.read_at,cm.last_read_at) else null end,
  m.created_at
from public.messages m join public.conversation_members cm on cm.conversation_id=m.conversation_id
where cm.user_id<>m.sender_id
on conflict(message_id,recipient_user_id) do nothing;

create or replace function public.chatlink_on_message_insert()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  insert into public.message_receipts(message_id,recipient_user_id,created_at)
  select new.id,cm.user_id,new.created_at from public.conversation_members cm
  where cm.conversation_id=new.conversation_id and cm.user_id<>new.sender_id
  on conflict(message_id,recipient_user_id) do nothing;
  return new;
end;
$function$;
revoke all on function public.chatlink_on_message_insert() from public,anon,authenticated;
drop trigger if exists chatlink_message_receipts_and_push on public.messages;
drop trigger if exists chatlink_message_receipts on public.messages;
create trigger chatlink_message_receipts after insert on public.messages
for each row execute function public.chatlink_on_message_insert();

create or replace function public.get_total_unread_count()
returns integer language plpgsql stable security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'Login required'; end if;
  if private.is_user_banned(v_user) then raise exception 'This account is banned'; end if;
  select count(*)::integer into v_count
    from public.message_receipts r join public.messages m on m.id=r.message_id
   where r.recipient_user_id=v_user and r.read_at is null and m.sender_id<>v_user
     and m.deleted_at is null and not m.delete_for_everyone;
  return coalesce(v_count,0);
end;
$function$;
revoke all on function public.get_total_unread_count() from public,anon;
grant execute on function public.get_total_unread_count() to authenticated;

create or replace function public.mark_direct_messages_delivered(p_conversation_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
begin
  if v_user is null then raise exception 'Login required'; end if;
  if private.is_user_banned(v_user) then raise exception 'This account is banned'; end if;
  if not exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id
    where cm.conversation_id=p_conversation_id and cm.user_id=v_user and c.is_direct=true)
  then raise exception 'Not a member of this direct chat'; end if;

  update public.message_receipts r set delivered_at=coalesce(r.delivered_at,v_now)
  from public.messages m where r.message_id=m.id and r.recipient_user_id=v_user
    and m.conversation_id=p_conversation_id and m.sender_id<>v_user and m.delivered_at is null
    and m.deleted_at is null and not m.delete_for_everyone;

  update public.messages m set delivered_at=v_now
  where m.conversation_id=p_conversation_id and m.sender_id<>v_user and m.delivered_at is null
    and m.read_at is null and m.deleted_at is null and not m.delete_for_everyone;
end;
$function$;
create or replace function public.mark_direct_chat_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_user uuid:=auth.uid(); v_now timestamptz:=clock_timestamp();
begin
  if v_user is null then raise exception 'Login required'; end if;
  if private.is_user_banned(v_user) then raise exception 'This account is banned'; end if;
  if not exists(select 1 from public.conversation_members cm join public.conversations c on c.id=cm.conversation_id
    where cm.conversation_id=p_conversation_id and cm.user_id=v_user and c.is_direct=true)
  then raise exception 'Not a member of this direct chat'; end if;

  update public.conversation_members set last_read_at=greatest(coalesce(last_read_at,'-infinity'::timestamptz),v_now)
   where conversation_id=p_conversation_id and user_id=v_user;
  update public.message_receipts r set delivered_at=coalesce(r.delivered_at,v_now),read_at=coalesce(r.read_at,v_now)
    from public.messages m where r.message_id=m.id and r.recipient_user_id=v_user
      and m.conversation_id=p_conversation_id and m.sender_id<>v_user
      and m.deleted_at is null and not m.delete_for_everyone;
  update public.messages m set delivered_at=coalesce(m.delivered_at,v_now),read_at=coalesce(m.read_at,v_now)
   where m.conversation_id=p_conversation_id and m.sender_id<>v_user and m.deleted_at is null
     and not m.delete_for_everyone and (m.delivered_at is null or m.read_at is null);
end;
$function$;
revoke all on function public.mark_direct_messages_delivered(uuid) from public,anon;
grant execute on function public.mark_direct_messages_delivered(uuid) to authenticated;
revoke all on function public.mark_direct_chat_read(uuid) from public,anon;
grant execute on function public.mark_direct_chat_read(uuid) to authenticated;

do $publication$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_receipts') then
    alter publication supabase_realtime add table public.message_receipts;
  end if;
end;
$publication$;
