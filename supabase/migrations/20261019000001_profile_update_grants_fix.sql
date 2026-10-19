-- Профиль не сохранялся: у authenticated не было права UPDATE на avatar, bio, fav_game.
grant update (nick, share_collection, avatar, bio, fav_game) on public.profiles to authenticated;
