-- Квест-лог: схема для Supabase.
-- Выполнить целиком один раз: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Скрипт можно запускать повторно, он ничего не ломает.

-- 1. Таблица игр ---------------------------------------------------------------

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  platform    text not null default '' check (char_length(platform) <= 30),
  genre       text not null default '' check (char_length(genre) <= 30),
  status      text not null default 'queue' check (status in ('playing', 'queue', 'beaten', 'wish', 'dropped')),
  progress    smallint not null default 0 check (progress between 0 and 100),
  hours       numeric(6, 1) not null default 0 check (hours >= 0 and hours <= 9999),
  rating      smallint not null default 0 check (rating between 0 and 5),
  notes       text not null default '' check (char_length(notes) <= 300),
  cover_path  text check (cover_path is null or char_length(cover_path) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists games_user_updated_idx on public.games (user_id, updated_at desc);

-- 2. Служебный триггер: лимит игр, защита полей, путь обложки -------------------

create or replace function public.games_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- не больше 500 игр на человека (защита от злоупотреблений)
    if not exists (select 1 from public.games g where g.id = new.id)
       and (select count(*) from public.games g where g.user_id = new.user_id) >= 500 then
      raise exception 'games_limit_reached' using errcode = 'P0001';
    end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;

  -- обложка может лежать только в папке владельца и под id этой игры
  if new.cover_path is not null
     and new.cover_path <> new.user_id::text || '/' || new.id::text || '.jpg' then
    raise exception 'bad_cover_path' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists games_guard on public.games;
create trigger games_guard
  before insert or update on public.games
  for each row execute function public.games_guard();

-- 3. Row Level Security: каждый видит и меняет только свои игры -----------------

alter table public.games enable row level security;

drop policy if exists games_select_own on public.games;
create policy games_select_own on public.games
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists games_insert_own on public.games;
create policy games_insert_own on public.games
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists games_update_own on public.games;
create policy games_update_own on public.games
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists games_delete_own on public.games;
create policy games_delete_own on public.games
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Анонимные посетители не получают к таблице никакого доступа.
revoke all on public.games from anon;

-- 4. Хранилище обложек ---------------------------------------------------------
-- Бакет публичный на чтение: ссылки содержат два случайных uuid, перебрать их нельзя.
-- Писать и удалять можно только в свою папку <user_id>/. Только JPEG, до 500 КБ.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 512000, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists covers_select_own on storage.objects;
create policy covers_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists covers_insert_own on storage.objects;
create policy covers_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists covers_update_own on storage.objects;
create policy covers_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists covers_delete_own on storage.objects;
create policy covers_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 5. Удаление собственного аккаунта --------------------------------------------
-- Вызывается из приложения (кнопка "Удалить аккаунт"). Игры удаляются каскадом.
-- Файлы обложек приложение стирает до вызова через Storage API.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
