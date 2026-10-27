create table if not exists public.chatlink_api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  name text not null default 'ChatLink automation',
  scopes text[] not null default array['profile:read','chats:read']::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  request_window_started_at timestamptz,
  request_count integer not null default 0,
  constraint chatlink_api_keys_name_len check (char_length(name) between 1 and 60),
  constraint chatlink_api_keys_prefix_len check (char_length(key_prefix) between 8 and 24),
  constraint chatlink_api_keys_scopes_valid check (
    scopes <@ array['profile:read','chats:read','messages:send']::text[]
    and cardinality(scopes) > 0
  ),
  constraint chatlink_api_keys_request_count_valid check (request_count >= 0)
);

create index if not exists chatlink_api_keys_owner_created_idx
 on public.chatlink_api_keys (owner_id, created_at desc);

alter table public.chatlink_api_keys enable row level security;
revoke all on table public.chatlink_api_keys from anon, authenticated;
grant all on table public.chatlink_api_keys to service_role;
