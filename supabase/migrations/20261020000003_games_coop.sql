-- Совместные игры (2P): с каким другом играешь в эту игру.
alter table public.games add column if not exists coop_with uuid references public.profiles(user_id) on delete set null;
create index if not exists games_coop_idx on public.games (coop_with) where coop_with is not null;
