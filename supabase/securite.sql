-- =========================================================
-- Radar : durcissement de la base (à exécuter APRÈS schema.sql et chat.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- 1. Les éléments partagés (listes, recommandations, chat) doivent être bien formés :
--    un membre ne peut plus glisser du HTML ou un faux identifiant dans la base.
-- 2. Le destinataire d'une recommandation ne peut modifier QUE la case "vue".
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- Les lignes déjà en base qui ne respectent pas les règles ne bloquent pas le script :
-- il les compte (messages "NOTICE" dans l'onglet Results) et les laisse en place.
-- =========================================================
begin;

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

-- Une recommandation non conforme déjà en base ne pourrait plus être marquée "vue"
-- (un check est revérifié à chaque mise à jour de la ligne) : le site réessaierait
-- à chaque visite. On les marque donc "vues" AVANT de poser la règle. Le site ne les
-- affiche pas comme des liens (élément invalide) ; rien n'est supprimé.
update public.recommandations set vue = true where not vue and not public.item_valide(item);

-- "not valid" : la règle s'applique à toute nouvelle écriture, sans bloquer le script
-- si d'anciennes lignes ne la respectent pas. Elle est validée juste après si tout est propre.
alter table public.listes drop constraint if exists listes_items_valides;
alter table public.listes add constraint listes_items_valides check (public.liste_valide(items)) not valid;

alter table public.recommandations drop constraint if exists reco_item_valide;
alter table public.recommandations add constraint reco_item_valide check (public.item_valide(item)) not valid;

alter table public.messages drop constraint if exists message_item_valide;
alter table public.messages add constraint message_item_valide check (item is null or public.item_valide(item)) not valid;

-- Bilan des lignes existantes. Table propre : la règle est validée (vérifiée sur tout l'existant).
-- Sinon elle reste "not valid" : les anciennes lignes restent lisibles (le site ignore leurs
-- éléments invalides) et une liste redevient conforme dès que son propriétaire la republie.
do $$
declare
  regle record;
  nombre int;
begin
  for regle in select * from (values
    ('listes', 'listes_items_valides', 'not public.liste_valide(items)'),
    ('recommandations', 'reco_item_valide', 'not public.item_valide(item)'),
    ('messages', 'message_item_valide', 'item is not null and not public.item_valide(item)')
  ) as r(nom_table, contrainte, condition) loop
    execute format('select count(*) from public.%I where %s', regle.nom_table, regle.condition) into nombre;
    if nombre = 0 then
      execute format('alter table public.%I validate constraint %I', regle.nom_table, regle.contrainte);
      raise notice '% : aucune ligne non conforme, règle validée', regle.nom_table;
    else
      raise notice '% : % ligne(s) ancienne(s) non conforme(s), laissée(s) en place (règle active pour les nouvelles écritures)', regle.nom_table, nombre;
    end if;
  end loop;
end $$;

-- ---------- 2. Recommandations : seulement "vue" ----------
-- La règle RLS "reco_marquer_vue" dit QUELLES lignes on peut modifier (celles reçues) ;
-- les droits par colonne disent QUELLES colonnes : uniquement "vue".
revoke update on public.recommandations from anon, authenticated;
grant update (vue) on public.recommandations to authenticated;

-- ---------- Hygiène : les fonctions internes ne servent à rien sans connexion ----------
revoke execute on function public.est_membre(uuid) from anon;
revoke execute on function public.partage_un_groupe(uuid) from anon;

commit;
