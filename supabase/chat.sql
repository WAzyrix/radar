-- =========================================================
-- Radar : chat de groupe (à exécuter APRÈS schema.sql)
-- SQL Editor → New query → coller → Run.
--
-- Le "temps réel" (Realtime) de Supabase pousse chaque nouveau message aux
-- membres connectés, sans recharger la page. Gratuit (offre Free : 200 connexions
-- simultanées, 2 millions de messages par mois).
-- =========================================================

create table public.messages (
  id bigint generated always as identity primary key,
  groupe_id uuid not null references public.groupes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  contenu text check (char_length(contenu) between 1 and 1000),
  -- élément partagé (animé, jeu, film…) : { type, id, titre, image }
  item jsonb,
  cree_le timestamptz not null default now(),
  -- un message a du texte, un élément partagé, ou les deux
  check (contenu is not null or item is not null)
);
create index on public.messages (groupe_id, cree_le desc);

-- Sécurité : seuls les membres du groupe lisent et écrivent ; on ne supprime que ses messages
alter table public.messages enable row level security;
create policy "messages_lire" on public.messages for select using (public.est_membre(groupe_id));
create policy "messages_ecrire" on public.messages for insert with check (user_id = auth.uid() and public.est_membre(groupe_id));
create policy "messages_supprimer" on public.messages for delete using (user_id = auth.uid());

-- Temps réel : Supabase diffuse les nouveaux messages (en respectant les règles ci-dessus)
alter publication supabase_realtime add table public.messages;
