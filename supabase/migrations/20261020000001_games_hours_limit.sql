-- Лимит часов на игру: 9999 -> 99999.
alter table public.games drop constraint if exists games_hours_check;
alter table public.games add constraint games_hours_check check (hours >= 0 and hours <= 99999);
