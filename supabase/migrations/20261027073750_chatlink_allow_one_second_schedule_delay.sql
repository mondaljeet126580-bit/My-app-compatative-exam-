-- Allow relative scheduled-message delays down to one second.
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
     or p_scheduled_for <= clock_timestamp()
     or p_scheduled_for > clock_timestamp() + interval '365 days' then
    raise exception 'Choose a future time within one year';
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