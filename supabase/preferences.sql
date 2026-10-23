-- =========================================================
-- Radar : préférences d'affichage (à exécuter APRÈS schema.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Une ligne par compte. Contrairement aux listes (visibles par les potes),
-- les préférences ne sont lisibles et modifiables QUE par leur propriétaire.
-- =========================================================
begin;

create table if not exists public.preferences (
  user_id uuid primary key references auth.users on delete cascade,
  rattrapage_masque boolean not null default false,
  maj bigint not null default 0   -- date de la dernière modification (ms) : la plus récente gagne
);

alter table public.preferences enable row level security;

drop policy if exists "preferences_lire" on public.preferences;
drop policy if exists "preferences_creer" on public.preferences;
drop policy if exists "preferences_modifier" on public.preferences;
create policy "preferences_lire" on public.preferences for select using (user_id = auth.uid());
create policy "preferences_creer" on public.preferences for insert with check (user_id = auth.uid());
create policy "preferences_modifier" on public.preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Pas de règle "delete" : la ligne disparaît avec le compte (on delete cascade).

-- Un visiteur non connecté n'a rien à faire ici
revoke all on public.preferences from anon;

commit;
