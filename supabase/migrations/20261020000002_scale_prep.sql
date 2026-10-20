-- Подготовка к росту числа пользователей.

-- 1) Индексы на внешних ключах (быстрое удаление аккаунтов и выборки).
create index if not exists friendships_requester_idx on public.friendships (requester);
create index if not exists recommendations_from_idx on public.recommendations (from_user);

-- 2) Одна политика чтения игр вместо двух (быстрее на больших таблицах).
drop policy if exists games_select_own on public.games;
drop policy if exists games_select_friends on public.games;
create policy games_select_visible on public.games for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.friendships f
    join public.profiles p on p.user_id = games.user_id
    where f.status = 'accepted' and p.share_collection
      and ((f.requester = (select auth.uid()) and f.addressee = games.user_id)
        or (f.addressee = (select auth.uid()) and f.requester = games.user_id))
  )
);

-- 3) Триггерная функция регистрации не должна вызываться через API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
