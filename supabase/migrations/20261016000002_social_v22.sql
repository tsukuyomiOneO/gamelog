-- GameLOG Beta v2.2: советы друзьям, реакции на игры, таблица лидеров. Только добавляет новое, можно запускать повторно.

-- 1. Советы игр между друзьями ----------------------------------------------------
create table if not exists public.recommendations (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references auth.users (id) on delete cascade,
  to_user     uuid not null references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  platform    text not null default '' check (char_length(platform) <= 30),
  genre       text not null default '' check (char_length(genre) <= 30),
  msg         text not null default '' check (char_length(msg) <= 80),
  status      text not null default 'new' check (status in ('new', 'added', 'hidden')),
  created_at  timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists recommendations_to_idx on public.recommendations (to_user, status);
alter table public.recommendations enable row level security;

drop policy if exists rec_select on public.recommendations;
create policy rec_select on public.recommendations for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));
drop policy if exists rec_update on public.recommendations;
create policy rec_update on public.recommendations for update to authenticated
  using (to_user = (select auth.uid())) with check (to_user = (select auth.uid()));
drop policy if exists rec_delete on public.recommendations;
create policy rec_delete on public.recommendations for delete to authenticated
  using (to_user = (select auth.uid()));

revoke all on public.recommendations from anon, authenticated;
grant select, delete on public.recommendations to authenticated;
grant update (status) on public.recommendations to authenticated;

create or replace function public.recommend_game(p_to uuid, p_title text, p_platform text, p_genre text, p_msg text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if not exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and ((f.requester = me and f.addressee = p_to) or (f.addressee = me and f.requester = p_to))
  ) then raise exception 'not_friends'; end if;
  if (select count(*) from public.recommendations r
       where r.from_user = me and r.to_user = p_to and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'rec_limit';
  end if;
  insert into public.recommendations (from_user, to_user, title, platform, genre, msg)
  values (me, p_to, left(trim(p_title), 80), left(coalesce(trim(p_platform), ''), 30),
          left(coalesce(trim(p_genre), ''), 30), left(coalesce(trim(p_msg), ''), 80));
end;
$$;
revoke all on function public.recommend_game(uuid, text, text, text, text) from public, anon;
grant execute on function public.recommend_game(uuid, text, text, text, text) to authenticated;

-- 2. Реакции на игры друзей ---------------------------------------------------------
create table if not exists public.reactions (
  game_id    uuid not null references public.games (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('fire', 'want', 'hurry')),
  created_at timestamptz not null default now(),
  primary key (game_id, user_id, kind)
);
create index if not exists reactions_user_idx on public.reactions (user_id);
alter table public.reactions enable row level security;

-- Видны свои реакции и все реакции на свои игры.
drop policy if exists rx_select on public.reactions;
create policy rx_select on public.reactions for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.games g where g.id = reactions.game_id and g.user_id = (select auth.uid()))
  );
-- Ставить можно только на игры друзей, которые открыли коллекцию.
drop policy if exists rx_insert on public.reactions;
create policy rx_insert on public.reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.games g
        join public.profiles p on p.user_id = g.user_id
        join public.friendships f on f.status = 'accepted'
         and ((f.requester = (select auth.uid()) and f.addressee = g.user_id)
           or (f.addressee = (select auth.uid()) and f.requester = g.user_id))
       where g.id = reactions.game_id and p.share_collection
    )
  );
drop policy if exists rx_delete on public.reactions;
create policy rx_delete on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.reactions from anon, authenticated;
grant select, insert, delete on public.reactions to authenticated;

-- 3. Таблица лидеров среди друзей -----------------------------------------------------
-- Цифры закрытых коллекций не отдаются (нули), свои видны всегда.
create or replace function public.friends_board()
returns table (user_id uuid, nick text, avatar smallint, share boolean, n int, beaten int, playing int, hours numeric)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.nick, p.avatar, p.share_collection,
         coalesce(a.n, 0), coalesce(a.beaten, 0), coalesce(a.playing, 0), coalesce(a.hours, 0)
    from public.profiles p
    left join lateral (
      select count(*)::int as n,
             (count(*) filter (where g.status = 'beaten'))::int as beaten,
             (count(*) filter (where g.status = 'playing'))::int as playing,
             coalesce(sum(g.hours), 0) as hours
        from public.games g where g.user_id = p.user_id
    ) a on (p.user_id = auth.uid() or p.share_collection)
   where p.user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
         where f.status = 'accepted'
           and ((f.requester = auth.uid() and f.addressee = p.user_id)
             or (f.addressee = auth.uid() and f.requester = p.user_id))
      );
$$;
revoke all on function public.friends_board() from public, anon;
grant execute on function public.friends_board() to authenticated;
