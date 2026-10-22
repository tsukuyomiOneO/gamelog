-- Оценка с шагом 0.5 (было целые 0..5).
alter table public.games drop constraint if exists games_rating_check;
alter table public.games alter column rating drop default;
alter table public.games alter column rating type numeric(2,1) using rating::numeric;
alter table public.games alter column rating set default 0;
alter table public.games add constraint games_rating_check check (rating >= 0 and rating <= 5 and (rating * 2) = round(rating * 2));
