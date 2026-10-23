-- =========================================================
-- Radar : notes perso et favoris (à exécuter APRÈS schema.sql, chat.sql, securite.sql,
-- preferences.sql et amis.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Un seul système pour les animés, mangas, films, séries et jeux : pour chaque œuvre,
-- ma note sur 100, un petit avis (500 caractères max, optionnel) et/ou un favori ❤️.
--
-- Qui voit quoi :
--   - moi : mes lignes, en lecture et en écriture ;
--   - mes amis (demande acceptée) et les membres de mes groupes : en lecture seule ;
--   - personne d'autre, et rien sans connexion.
-- Les dates "note_le" et "favori_le" (affichées dans l'activité des potes) sont posées
-- par la base elle-même : on ne peut pas antidater ni postdater une note.
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Table ----------
create table if not exists public.notes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null check (type in ('anime', 'manga', 'film', 'serie', 'jeu')),
  oeuvre bigint not null check (oeuvre > 0 and oeuvre < 1000000000000), -- id AniList / TMDB / RAWG
  titre text not null check (char_length(titre) between 1 and 200),
  image text check (image is null or (image ~ '^https://[^\s"''<>]+$' and char_length(image) <= 500)),
  note smallint check (note between 0 and 100),
  avis text check (char_length(avis) between 1 and 500),
  favori boolean not null default false,
  note_le timestamptz,
  favori_le timestamptz,
  maj bigint not null default 0, -- horloge du site (ms) : la modification la plus récente gagne entre appareils
  primary key (user_id, type, oeuvre),
  -- Une ligne sert à quelque chose : une note ou un favori. L'avis accompagne une note.
  constraint notes_utile check (note is not null or favori),
  constraint notes_avis_avec_note check (avis is null or note is not null)
);
create index if not exists notes_oeuvre on public.notes (type, oeuvre);   -- « Tes amis l'ont noté »
create index if not exists notes_activite on public.notes (user_id, maj desc);

-- ---------- 2. Dates posées par la base ----------
create or replace function public.notes_dates() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.note is null then
    new.note_le := null;
  elsif tg_op = 'INSERT' or new.note is distinct from old.note or new.avis is distinct from old.avis then
    new.note_le := now();
  else
    new.note_le := old.note_le;
  end if;
  if not new.favori then
    new.favori_le := null;
  elsif tg_op = 'INSERT' or not old.favori then
    new.favori_le := now();
  else
    new.favori_le := old.favori_le;
  end if;
  return new;
end $$;

drop trigger if exists notes_dates on public.notes;
create trigger notes_dates before insert or update on public.notes
  for each row execute function public.notes_dates();

-- ---------- 3. Règles d'accès (RLS) ----------
alter table public.notes enable row level security;

drop policy if exists "notes_lire" on public.notes;
drop policy if exists "notes_creer" on public.notes;
drop policy if exists "notes_modifier" on public.notes;
drop policy if exists "notes_supprimer" on public.notes;
create policy "notes_lire" on public.notes for select
  using (user_id = auth.uid() or public.partage_un_groupe(user_id) or public.est_ami(user_id));
create policy "notes_creer" on public.notes for insert with check (user_id = auth.uid());
create policy "notes_modifier" on public.notes for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notes_supprimer" on public.notes for delete using (user_id = auth.uid());

-- Rien sans connexion. Connecté : seulement les colonnes que le site a le droit d'écrire
-- (pas les dates, posées par le déclencheur). user_id, type et oeuvre servent à l'upsert du site ;
-- la RLS empêche de mettre le user_id de quelqu'un d'autre.
revoke all on public.notes from anon, authenticated;
grant select, delete on public.notes to authenticated;
grant insert (user_id, type, oeuvre, titre, image, note, avis, favori, maj),
      update (user_id, type, oeuvre, titre, image, note, avis, favori, maj) on public.notes to authenticated;

commit;
