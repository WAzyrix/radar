-- =========================================================
-- Radar : durcissement n° 2 (à exécuter APRÈS moderation.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Fonctions : rien pour les visiteurs non connectés ----------
-- PostgreSQL donne le droit d'exécuter une fonction à tout le monde ("public") : retirer ce
-- droit au seul rôle "anon" ne suffisait pas (securite.sql). On le retire à "public" et on le
-- rend aux seuls comptes connectés quand le site en a besoin.
revoke execute on function public.est_membre(uuid), public.partage_un_groupe(uuid),
  public.creer_groupe(text), public.rejoindre_groupe(text),
  public.item_valide(jsonb), public.liste_valide(jsonb) from public, anon;
grant execute on function public.est_membre(uuid), public.partage_un_groupe(uuid),
  public.creer_groupe(text), public.rejoindre_groupe(text),
  public.item_valide(jsonb), public.liste_valide(jsonb) to authenticated;
-- Fonctions de déclencheur : jamais appelées directement
revoke execute on function public.notes_dates(), public.date_serveur() from public, anon, authenticated;

-- ---------- 2. Demandes d'ami : refus respecté, pseudos uniques, essais limités ----------
-- a) Après un refus, la même personne ne peut pas redemander pendant 30 jours.
create table if not exists public.refus_amitie (
  de uuid not null references auth.users on delete cascade, -- celui qui avait demandé
  a uuid not null references auth.users on delete cascade,  -- celui qui a refusé
  refuse_le timestamptz not null default now(),
  primary key (de, a)
);
-- b) Recherches ratées (pseudo ou code ami inconnu) : 20 par heure au plus, contre
--    l'énumération des pseudos et la force brute sur les codes ami.
create table if not exists public.essais_ami (
  user_id uuid not null references auth.users on delete cascade,
  le timestamptz not null default now()
);
create index if not exists essais_ami_user on public.essais_ami (user_id, le);
alter table public.refus_amitie enable row level security;
alter table public.essais_ami enable row level security;
revoke all on public.refus_amitie, public.essais_ami from anon, authenticated;

create or replace function public.refuser_ami(autre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from amities where de = autre and a = auth.uid() and not acceptee;
  if not found then raise exception 'Demande introuvable'; end if;
  insert into refus_amitie (de, a) values (autre, auth.uid())
    on conflict (de, a) do update set refuse_le = now();
end $$;

create or replace function public.demande_ami_interne(cible uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  moi uuid := auth.uid();
  existante amities;
begin
  if moi is null then raise exception 'Connexion requise'; end if;
  if cible is null or not exists (select 1 from profils where id = cible) then raise exception 'Personne ne correspond à ce pseudo ou ce code ami'; end if;
  if cible = moi then raise exception 'C''est toi !'; end if;

  select * into existante from amities where (de = moi and a = cible) or (de = cible and a = moi);
  if found then
    if existante.acceptee then return 'deja_amis'; end if;
    if existante.de = moi then return 'deja_demande'; end if;
    update amities set acceptee = true, acceptee_le = now() where de = cible and a = moi;
    delete from refus_amitie where (de = cible and a = moi) or (de = moi and a = cible);
    return 'acceptee';
  end if;

  if exists (select 1 from refus_amitie where de = moi and a = cible and refuse_le > now() - interval '30 days') then
    raise exception 'Cette personne a refusé ta demande : tu pourras réessayer dans 30 jours.';
  end if;
  -- Contre le spam : 30 demandes sans réponse au maximum
  if (select count(*) from amities where de = moi and not acceptee) >= 30 then
    raise exception 'Trop de demandes en attente : attends qu''on te réponde';
  end if;
  insert into amities (de, a) values (moi, cible);
  -- Je demande à quelqu'un que j'avais refusé : mon refus ne compte plus
  delete from refus_amitie where de = cible and a = moi;
  return 'envoyee';
end $$;

-- Renvoie 'introuvable' (au lieu d'une erreur) pour que l'essai raté soit enregistré
-- (une erreur annulerait tout), et 'trop_essais' au-delà de 20 essais ratés en une heure.
create or replace function public.demander_ami(pseudo_ou_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  texte text := trim(coalesce(pseudo_ou_code, ''));
  cible uuid;
  nombre int;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if char_length(texte) not between 2 and 24 then raise exception 'Pseudo ou code ami invalide'; end if;
  delete from essais_ami where le < now() - interval '1 hour';
  if (select count(*) from essais_ami where user_id = auth.uid()) >= 20 then return 'trop_essais'; end if;
  select id into cible from profils where code_ami = upper(texte);
  if cible is null then
    select count(*), min(id::text)::uuid into nombre, cible from profils where lower(pseudo) = lower(texte);
    if nombre > 1 then raise exception 'Plusieurs comptes ont ce pseudo : demande-lui son code ami'; end if;
  end if;
  if cible is null then
    insert into essais_ami (user_id) values (auth.uid());
    return 'introuvable';
  end if;
  return demande_ami_interne(cible);
end $$;

-- Mêmes droits qu'avant (create or replace les garde ; redit ici pour un premier passage)
revoke execute on function public.demande_ami_interne(uuid) from public, anon, authenticated;
revoke execute on function public.demander_ami(text), public.refuser_ami(uuid) from public, anon;
grant execute on function public.demander_ami(text), public.refuser_ami(uuid) to authenticated;

-- c) Pseudo unique (sans tenir compte des majuscules). Si la base contient déjà des pseudos
--    en double, on n'efface rien : le script le signale (onglet Results) et ne pose pas la règle.
do $$
declare doublons int;
begin
  select count(*) into doublons from (select lower(pseudo) from profils group by 1 having count(*) > 1) d;
  if doublons = 0 then
    create unique index if not exists profils_pseudo_unique on public.profils (lower(pseudo));
  else
    raise notice '% pseudo(s) en double : pseudo unique NON appliqué. Renomme-les puis relance ce fichier.', doublons;
  end if;
end $$;

-- ---------- 3. Un groupe sans membre disparaît ----------
-- Sinon il restait pour toujours, rejoignable avec l'ancien code, et plus personne ne pouvait le
-- supprimer. "security definer" : le dernier membre qui part n'a pas le droit de supprimer le groupe.
create or replace function public.supprimer_groupe_vide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from groupes g where g.id = old.groupe_id and not exists (select 1 from membres where groupe_id = old.groupe_id);
  return null;
end $$;
revoke execute on function public.supprimer_groupe_vide() from public, anon, authenticated;

drop trigger if exists membres_groupe_vide on public.membres;
create trigger membres_groupe_vide after delete on public.membres
  for each row execute function public.supprimer_groupe_vide();

-- Les groupes déjà vides (avec leurs messages, que plus personne ne peut lire)
do $$
declare vides int;
begin
  delete from public.groupes g where not exists (select 1 from public.membres where groupe_id = g.id);
  get diagnostics vides = row_count;
  raise notice '% groupe(s) vide(s) supprimé(s)', vides;
end $$;

-- ---------- 4. Images des éléments partagés : même règle que les notes ----------
-- Avant : "commence par https://" suffisait (https://x"onerror=… passait). Maintenant : https://,
-- sans espace, guillemet, chevron ni antislash, 500 caractères au plus. Les contraintes existantes
-- (listes, recommandations, messages) utilisent cette fonction : elles suivent d'elles-mêmes.
-- Une ancienne ligne non conforme reste lisible ; le site renvoie des images propres.
create or replace function public.item_valide(i jsonb) returns boolean
language sql immutable as $$
  select coalesce(
    jsonb_typeof(i) = 'object'
    and coalesce(i->>'type', '') in ('anime', 'manga', 'film', 'serie', 'jeu')
    and coalesce(jsonb_typeof(i->'id'), '') = 'number'
    and coalesce(i->>'id', '') ~ '^[1-9][0-9]{0,11}$'
    and coalesce(jsonb_typeof(i->'titre'), 'null') in ('string', 'null')
    and char_length(coalesce(i->>'titre', '')) <= 200
    and (coalesce(i->>'image', '') = '' or (i->>'image' ~ '^https://[^\s"''<>\\]+$' and char_length(i->>'image') <= 500))
    and (coalesce(i->>'couleur', '') = '' or i->>'couleur' ~ '^#[0-9a-fA-F]{6}$'),
  false);
$$;
revoke execute on function public.item_valide(jsonb) from public, anon;
grant execute on function public.item_valide(jsonb) to authenticated;

do $$
declare n int;
begin
  select count(*) into n from public.listes where not public.liste_valide(items);
  raise notice '% liste(s) avec une image non conforme (corrigées à leur prochaine publication)', n;
end $$;

commit;
