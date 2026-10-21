-- GameLOG Beta v2.0: профили с уникальными никами, друзья, доступ друзей к коллекции.
-- Только добавляет новое, существующие данные не трогает. Можно запускать повторно.

-- 1. Профили -------------------------------------------------------------------
-- Ник: 3-20 символов, латиница, кириллица, цифры и "_". Уникален без учёта регистра.

create table if not exists public.profiles (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  nick              text not null check (nick ~ '^[A-Za-z0-9_А-Яа-яЁё]{3,20}$'),
  share_collection  boolean not null default true,
  created_at        timestamptz not null default now(),
  nick_changed_at   timestamptz not null default now()
);

create unique index if not exists profiles_nick_lower_idx on public.profiles (lower(nick));

create or replace function public.gen_nick()
returns text
language plpgsql
set search_path = ''
as $$
declare
  n text;
begin
  loop
    n := 'Player' || (floor(random() * 900000) + 100000)::int::text;
    exit when not exists (select 1 from public.profiles p where lower(p.nick) = lower(n));
  end loop;
  return n;
end;
$$;

-- Новому аккаунту сразу выдаётся ник Player123456, потом его можно сменить.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, nick) values (new.id, public.gen_nick())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Ники для уже существующих аккаунтов
do $$
declare r record;
begin
  for r in select u.id from auth.users u where not exists (select 1 from public.profiles p where p.user_id = u.id) loop
    insert into public.profiles (user_id, nick) values (r.id, public.gen_nick());
  end loop;
end;
$$;

create or replace function public.profiles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nick is distinct from old.nick then
    new.nick_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.profiles_touch();

alter table public.profiles enable row level security;

-- Ники видны всем вошедшим (по ним ищут друзей). Почты в профиле нет.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nick, share_collection, avatar, bio, fav_game) on public.profiles to authenticated;

-- 2. Друзья --------------------------------------------------------------------

create table if not exists public.friendships (
  id          uuid primary key default gen_random_uuid(),
  requester   uuid not null references auth.users (id) on delete cascade,
  addressee   uuid not null references auth.users (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  check (requester <> addressee)
);

create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;

drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- Отменить заявку, отклонить её или убрать из друзей может любая из сторон.
drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

revoke all on public.friendships from anon, authenticated;
grant select, delete on public.friendships to authenticated;

-- Отправить заявку по нику. Если человек уже отправил заявку вам, вы сразу станете друзьями.
create or replace function public.friend_request(p_nick text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
  existing public.friendships%rowtype;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  select p.user_id into target from public.profiles p where lower(p.nick) = lower(trim(p_nick));
  if target is null then raise exception 'no_such_nick'; end if;
  if target = me then raise exception 'self'; end if;

  select * into existing from public.friendships f
   where least(f.requester, f.addressee) = least(me, target)
     and greatest(f.requester, f.addressee) = greatest(me, target);
  if found then
    if existing.status = 'accepted' then raise exception 'already_friends'; end if;
    if existing.requester = me then raise exception 'already_sent'; end if;
    update public.friendships set status = 'accepted' where id = existing.id;
    return 'accepted';
  end if;

  if (select count(*) from public.friendships f where me in (f.requester, f.addressee)) >= 200 then
    raise exception 'friends_limit';
  end if;
  insert into public.friendships (requester, addressee) values (me, target);
  return 'sent';
end;
$$;

-- Принять (p_accept = true) или отклонить входящую заявку.
create or replace function public.friend_respond(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if p_accept then
    update public.friendships set status = 'accepted'
     where id = p_id and addressee = me and status = 'pending';
  else
    delete from public.friendships where id = p_id and addressee = me and status = 'pending';
  end if;
  if not found then raise exception 'no_such_request'; end if;
end;
$$;

revoke all on function public.friend_request(text) from public, anon;
revoke all on function public.friend_respond(uuid, boolean) from public, anon;
grant execute on function public.friend_request(text) to authenticated;
grant execute on function public.friend_respond(uuid, boolean) to authenticated;

-- 3. Друзья видят коллекцию друг друга (только чтение) -------------------------
-- Человек может закрыть доступ переключателем share_collection в профиле.

drop policy if exists games_select_friends on public.games;
create policy games_select_friends on public.games
  for select to authenticated
  using (
    exists (
      select 1
        from public.friendships f
        join public.profiles p on p.user_id = games.user_id
       where f.status = 'accepted'
         and p.share_collection
         and ((f.requester = (select auth.uid()) and f.addressee = games.user_id)
           or (f.addressee = (select auth.uid()) and f.requester = games.user_id))
    )
  );
