-- Pagekeeper: run this once in your Supabase project (SQL Editor → New query → paste → Run).
-- It creates a private table for your library and a private storage bucket for book and audio files.
-- Every row and file is locked to the signed-in user, so the public "anon" key is safe to ship in the app.

create table if not exists public.books (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists books_user_updated on public.books (user_id, updated_at);

alter table public.books enable row level security;

drop policy if exists "own rows" on public.books;
create policy "own rows" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The server stamps every change, so devices can ask for "everything since my last sync".
create or replace function public.pk_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end $$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before insert or update on public.books
  for each row execute function public.pk_touch();

-- Private bucket for files, 50 MB per file (the free plan's maximum).
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Each user can only touch files inside a folder named after their own user id.
drop policy if exists "pk own files read"   on storage.objects;
drop policy if exists "pk own files insert" on storage.objects;
drop policy if exists "pk own files update" on storage.objects;
drop policy if exists "pk own files delete" on storage.objects;

create policy "pk own files read" on storage.objects for select
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pk own files insert" on storage.objects for insert
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pk own files update" on storage.objects for update
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "pk own files delete" on storage.objects for delete
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
