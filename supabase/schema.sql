-- House Upkeep Log: cloud sync and push reminders.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- Every record the app keeps (tasks, Home info items, homes, preferences, attachment details),
-- one row per record per user. updated_at is the client's edit time in ms, used for last-writer-wins.
create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  id         text    not null,
  kind       text    not null check (kind in ('task', 'info', 'home', 'prefs', 'file')),
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  server_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists items_user_server_at on public.items (user_id, server_at);

alter table public.items enable row level security;
drop policy if exists "Users manage their own items" on public.items;
create policy "Users manage their own items" on public.items
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- server_at moves on every write so devices can ask for "what changed since".
create or replace function public.items_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.server_at = now();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.items_touch();

-- Upload a batch of records; a row only replaces the stored one if it is newer.
create or replace function public.push_items(rows jsonb) returns void
language sql security invoker set search_path = '' as $$
  insert into public.items (user_id, id, kind, data, deleted, updated_at)
  select auth.uid(), r->>'id', r->>'kind', r->'data', coalesce((r->>'deleted')::boolean, false), (r->>'updated_at')::bigint
  from jsonb_array_elements(rows) as r
  on conflict (user_id, id) do update
    set kind = excluded.kind, data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at
    where public.items.updated_at < excluded.updated_at;
$$;
grant execute on function public.push_items(jsonb) to authenticated;

-- One row per device that wants reminders.
create table if not exists public.push_subs (
  endpoint     text primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh       text not null,
  auth         text not null,
  tz           text not null default 'UTC',
  created_at   timestamptz not null default now(),
  last_sent_on date,
  last_nag_on  date
);
create index if not exists push_subs_user on public.push_subs (user_id);
alter table public.push_subs enable row level security;
drop policy if exists "Users manage their own devices" on public.push_subs;
create policy "Users manage their own devices" on public.push_subs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Private storage for photos and PDFs: each user can only touch files under a folder named with their id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 15728640, array['image/*', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "Users read their own attachments" on storage.objects;
create policy "Users read their own attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users add their own attachments" on storage.objects;
create policy "Users add their own attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users replace their own attachments" on storage.objects;
create policy "Users replace their own attachments" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete their own attachments" on storage.objects;
create policy "Users delete their own attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
