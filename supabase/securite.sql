-- =========================================================
-- Radar : durcissement de la base (à exécuter APRÈS schema.sql et chat.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- 1. Les éléments partagés (listes, recommandations, chat) doivent être bien formés :
--    un membre ne peut plus glisser du HTML ou un faux identifiant dans la base.
-- 2. Le destinataire d'une recommandation ne peut modifier QUE la case "vue".
-- =========================================================

-- ---------- 1. Éléments bien formés ----------
-- { type, id, titre, image, couleur… } : type connu, id entier positif,
-- titre texte (200 caractères max), image en https, couleur #RRGGBB.
-- coalesce(…, false) : un champ manquant donne "faux", jamais "inconnu" (qu'un check laisserait passer).
create or replace function public.item_valide(i jsonb) returns boolean
language sql immutable as $$
  select coalesce(
    jsonb_typeof(i) = 'object'
    and coalesce(i->>'type', '') in ('anime', 'manga', 'film', 'serie', 'jeu')
    and coalesce(jsonb_typeof(i->'id'), '') = 'number'
    and coalesce(i->>'id', '') ~ '^[1-9][0-9]{0,11}$'
    and coalesce(jsonb_typeof(i->'titre'), 'null') in ('string', 'null')
    and char_length(coalesce(i->>'titre', '')) <= 200
    and (coalesce(i->>'image', '') = '' or i->>'image' ~ '^https://')
    and (coalesce(i->>'couleur', '') = '' or i->>'couleur' ~ '^#[0-9a-fA-F]{6}$'),
  false);
$$;

create or replace function public.liste_valide(items jsonb) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(items) = 'array'
    then jsonb_array_length(items) <= 2000
      and not exists (select 1 from jsonb_array_elements(items) e where not public.item_valide(e))
    else false end;
$$;

-- "not valid" : les lignes déjà en base ne sont pas revérifiées, mais toute nouvelle
-- écriture (y compris la mise à jour d'une ancienne ligne) doit respecter la règle.
alter table public.listes drop constraint if exists listes_items_valides;
alter table public.listes add constraint listes_items_valides check (public.liste_valide(items)) not valid;

alter table public.recommandations drop constraint if exists reco_item_valide;
alter table public.recommandations add constraint reco_item_valide check (public.item_valide(item)) not valid;

alter table public.messages drop constraint if exists message_item_valide;
alter table public.messages add constraint message_item_valide check (item is null or public.item_valide(item)) not valid;

-- ---------- 2. Recommandations : seulement "vue" ----------
-- La règle RLS "reco_marquer_vue" dit QUELLES lignes on peut modifier (celles reçues) ;
-- les droits par colonne disent QUELLES colonnes : uniquement "vue".
revoke update on public.recommandations from anon, authenticated;
grant update (vue) on public.recommandations to authenticated;

-- ---------- Hygiène : les fonctions internes ne servent à rien sans connexion ----------
revoke execute on function public.est_membre(uuid) from anon;
revoke execute on function public.partage_un_groupe(uuid) from anon;
