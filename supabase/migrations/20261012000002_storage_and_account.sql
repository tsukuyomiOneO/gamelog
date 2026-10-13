-- Бакет обложек, правила для файлов и удаление собственного аккаунта.
-- Минимальные права: анонимам ничего, вошедшим только чтение и изменение строк.
revoke all on public.games from anon;
revoke truncate, references, trigger on public.games from authenticated;

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
