-- ChatLink scheduled direct messages.
-- Scheduling is processed inside Postgres so messages can be sent while the sender's app is closed.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','sent','cancelled','failed')),
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text
);

create index if not exists scheduled_messages_due_idx
  on public.scheduled_messages (scheduled_for, id)
  where status = 'pending';

create index if not exists scheduled_messages_sender_idx
  on public.scheduled_messages (sender_id, scheduled_for desc);

alter table public.scheduled_messages enable row level security;

drop policy if exists "Users can view their scheduled messages" on public.scheduled_messages;
create policy "Users can view their scheduled messages"
  on public.scheduled_messages
  for select
  to authenticated
  using (sender_id = (select auth.uid()));

revoke all on public.scheduled_messages from anon, authenticated;
grant select on public.scheduled_messages to authenticated;

create or replace function public.schedule_direct_chat_message(
  p_conversation_id uuid,
  p_recipient_id uuid,
  p_body text,
  p_scheduled_for timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Login required';
  end if;

  if private.is_user_banned(v_user) then
    raise exception 'This account is banned';
  end if;

  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 10000 then
    raise exception 'Message must contain 1 to 10000 characters';
  end if;

  if p_scheduled_for is null
     or p_scheduled_for <= clock_timestamp() + interval '1 second'
     or p_scheduled_for > clock_timestamp() + interval '365 days' then
    raise exception 'Choose a time from more than one second in the future, within one year';
  end if;

  if p_recipient_id is null
     or not exists (
       select 1
       from public.conversations c
       join public.conversation_members sender_member
         on sender_member.conversation_id = c.id
        and sender_member.user_id = v_user
       join public.conversation_members recipient_member
         on recipient_member.conversation_id = c.id
        and recipient_member.user_id = p_recipient_id
       join public.profiles sender_profile
         on sender_profile.id = v_user and not sender_profile.is_banned
       join public.profiles recipient_profile
         on recipient_profile.id = p_recipient_id and not recipient_profile.is_banned
       where c.id = p_conversation_id
         and c.is_direct = true
         and p_recipient_id <> v_user
     ) then
    raise exception 'You must be a member of a direct chat with this recipient';
  end if;

  insert into public.scheduled_messages (
    sender_id, recipient_id, conversation_id, body, scheduled_for
  )
  values (
    v_user, p_recipient_id, p_conversation_id, btrim(p_body), p_scheduled_for
  )
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.schedule_direct_chat_message(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.schedule_direct_chat_message(uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.cancel_scheduled_chat_message(p_scheduled_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_cancelled boolean := false;
begin
  if v_user is null then
    raise exception 'Login required';
  end if;

  update public.scheduled_messages
     set status = 'cancelled',
         cancelled_at = clock_timestamp()
   where id = p_scheduled_message_id
     and sender_id = v_user
     and status = 'pending';

  v_cancelled := found;
  return v_cancelled;
end;
$function$;

revoke all on function public.cancel_scheduled_chat_message(uuid) from public, anon;
grant execute on function public.cancel_scheduled_chat_message(uuid) to authenticated;

create or replace function public.process_scheduled_chat_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.scheduled_messages%rowtype;
  v_now timestamptz;
  v_sent_count integer := 0;
begin
  for v_job in
    select *
    from public.scheduled_messages
    where status = 'pending'
      and scheduled_for <= clock_timestamp()
    order by scheduled_for, id
    for update skip locked
    limit 50
  loop
    begin
      if not exists (
        select 1
        from public.conversations c
        join public.conversation_members sender_member
          on sender_member.conversation_id = c.id
         and sender_member.user_id = v_job.sender_id
        join public.conversation_members recipient_member
          on recipient_member.conversation_id = c.id
         and recipient_member.user_id = v_job.recipient_id
        join public.profiles sender_profile
          on sender_profile.id = v_job.sender_id and not sender_profile.is_banned
        join public.profiles recipient_profile
          on recipient_profile.id = v_job.recipient_id and not recipient_profile.is_banned
        where c.id = v_job.conversation_id
          and c.is_direct = true
          and v_job.sender_id <> v_job.recipient_id
      ) then
        update public.scheduled_messages
           set status = 'failed',
               failure_reason = 'Chat membership or account status changed before delivery'
         where id = v_job.id;
      else
        v_now := clock_timestamp();

        insert into public.messages (conversation_id, sender_id, body, created_at)
        values (v_job.conversation_id, v_job.sender_id, v_job.body, v_now);

        update public.scheduled_messages
           set status = 'sent',
               sent_at = v_now,
               failure_reason = null
         where id = v_job.id
           and status = 'pending';

        v_sent_count := v_sent_count + 1;
      end if;
    exception when others then
      update public.scheduled_messages
         set status = 'failed',
             failure_reason = left(SQLERRM, 500)
       where id = v_job.id;
    end;
  end loop;

  return v_sent_count;
end;
$function$;

revoke all on function public.process_scheduled_chat_messages() from public, anon, authenticated;
grant execute on function public.process_scheduled_chat_messages() to postgres;

select cron.unschedule(jobid)
from cron.job
where jobname = 'chatlink-dispatch-scheduled-messages';

select cron.schedule(
  'chatlink-dispatch-scheduled-messages',
  '2 seconds',
  'select public.process_scheduled_chat_messages();'
);
