-- GameLOG Beta v2.1: аватар, «о себе» и любимая игра в профиле. Только добавляет колонки, можно запускать повторно.

alter table public.profiles add column if not exists avatar smallint not null default 0;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists fav_game text not null default '';

alter table public.profiles drop constraint if exists profiles_avatar_range;
alter table public.profiles add constraint profiles_avatar_range check (avatar between 0 and 11);
alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 80);
alter table public.profiles drop constraint if exists profiles_fav_len;
alter table public.profiles add constraint profiles_fav_len check (char_length(fav_game) <= 40);

-- Менять свои новые поля можно, чужие нельзя (политика profiles_update_own уже есть).
grant update (avatar, bio, fav_game) on public.profiles to authenticated;
