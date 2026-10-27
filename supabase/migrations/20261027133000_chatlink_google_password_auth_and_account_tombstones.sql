alter table public.profiles
  add column if not exists password_login_enabled boolean not null default false;

create table if not exists public.account_tombstones (
  id uuid primary key default gen_random_uuid(),
  original_user_id uuid not null unique,
  username text,
  username_norm text unique,
  display_name text,
  email text,
  email_norm text unique,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  deletion_reason text
);

create index if not exists account_tombstones_deleted_at_idx
  on public.account_tombstones (deleted_at desc);

alter table public.account_tombstones enable row level security;
revoke all on table public.account_tombstones from anon, authenticated;

comment on table public.account_tombstones is
  'Service-role-only record of administrator-deleted ChatLink identities. Stores login identifiers solely to show a deletion notice and prevent the deleted account identifier from being silently reused.';
comment on column public.profiles.password_login_enabled is
  'True only after a signed-in user has completed Google-backed account setup and set a password for username/password login.';
