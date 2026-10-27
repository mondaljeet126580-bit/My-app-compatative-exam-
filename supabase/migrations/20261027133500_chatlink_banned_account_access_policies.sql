drop policy if exists "Recipients and senders can read message receipts" on public.message_receipts;
create policy "Recipients and senders can read message receipts"
  on public.message_receipts for select
  using (
    not private.is_user_banned((select auth.uid()))
    and (
      recipient_user_id = (select auth.uid())
      or exists (
        select 1 from public.messages m
        where m.id = message_receipts.message_id
          and m.sender_id = (select auth.uid())
      )
    )
  );

drop policy if exists "Users can view their scheduled messages" on public.scheduled_messages;
create policy "Users can view their scheduled messages"
  on public.scheduled_messages for select
  using (
    not private.is_user_banned((select auth.uid()))
    and sender_id = (select auth.uid())
  );
