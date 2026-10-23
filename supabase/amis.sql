-- =========================================================
-- Radar : amis, indépendants des groupes (à exécuter APRÈS schema.sql, chat.sql et securite.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- - On ajoute quelqu'un par son pseudo ou son code ami (8 caractères, visible dans Potes).
-- - La personne accepte ou refuse. Tant qu'elle n'a pas accepté, on ne voit RIEN d'elle
--   (ni profil complet, ni liste) : seulement le pseudo qu'on a tapé.
-- - Une fois amis : on voit le profil et la liste de l'autre, et on peut se recommander
--   des titres, même sans groupe commun. Chacun peut supprimer l'amitié à tout moment.
--
-- Tout passe par des fonctions (demander, accepter, refuser, supprimer) : on ne peut pas
-- écrire directement dans la table, donc pas de fausse demande "acceptée" d'office.
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Code ami ----------
-- 8 caractères (chiffres et lettres A à F), tirés au hasard. Les profils existants en
-- reçoivent un tout de suite (la valeur par défaut est recalculée pour chaque ligne).
alter table public.profils add column if not exists code_ami text
  default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
update public.profils set code_ami = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) where code_ami is null;
alter table public.profils alter column code_ami set not null;
alter table public.profils drop constraint if exists profils_code_ami_format;
alter table public.profils add constraint profils_code_ami_format check (code_ami ~ '^[0-9A-F]{8}$');
create unique index if not exists profils_code_ami on public.profils (code_ami);

-- Le site ne peut écrire que le pseudo et l'avatar : le code ami ne se choisit pas
-- (on en tire un nouveau avec nouveau_code_ami()). "id" est nécessaire à l'upsert du site.
revoke insert, update on public.profils from anon, authenticated;
grant insert (id, pseudo, avatar), update (id, pseudo, avatar) on public.profils to authenticated;

-- ---------- 2. Amitiés ----------
-- Une ligne par paire : "de" a demandé, "a" doit accepter.
create table if not exists public.amities (
  de uuid not null references auth.users on delete cascade,
  a uuid not null references auth.users on delete cascade,
  acceptee boolean not null default false,
  cree_le timestamptz not null default now(),
  acceptee_le timestamptz,
  primary key (de, a),
  check (de <> a)
);
-- Une seule ligne par paire, quel que soit le sens (A→B et B→A ne peuvent pas coexister)
create unique index if not exists amities_paire on public.amities (least(de, a), greatest(de, a));
create index if not exists amities_a on public.amities (a);

alter table public.amities enable row level security;
drop policy if exists "amities_lire" on public.amities;
create policy "amities_lire" on public.amities for select using (de = auth.uid() or a = auth.uid());
-- Aucune écriture directe : uniquement par les fonctions ci-dessous
revoke insert, update, delete, truncate on public.amities from anon, authenticated;
revoke all on public.amities from anon;

-- ---------- 3. Fonctions ----------
-- "security definer" : la fonction s'exécute avec les droits de son créateur. Chacune
-- vérifie elle-même qui est connecté (auth.uid()) : on n'agit jamais au nom d'un autre.

-- Sommes-nous amis (demande acceptée) ?
create or replace function public.est_ami(autre uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from amities
    where acceptee and ((de = auth.uid() and a = autre) or (de = autre and a = auth.uid()))
  );
$$;

-- Cœur de la demande, commun aux deux façons de demander (pseudo/code, ou membre d'un groupe).
-- Renvoie 'envoyee', 'acceptee' (l'autre m'avait déjà demandé), 'deja_demande' ou 'deja_amis'.
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
    return 'acceptee';
  end if;

  -- Contre le spam : 30 demandes sans réponse au maximum
  if (select count(*) from amities where de = moi and not acceptee) >= 30 then
    raise exception 'Trop de demandes en attente : attends qu''on te réponde';
  end if;
  insert into amities (de, a) values (moi, cible);
  return 'envoyee';
end $$;

-- Ajouter par pseudo (sans tenir compte des majuscules) ou par code ami
create or replace function public.demander_ami(pseudo_ou_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  texte text := trim(coalesce(pseudo_ou_code, ''));
  cible uuid;
  nombre int;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if char_length(texte) not between 2 and 24 then raise exception 'Pseudo ou code ami invalide'; end if;
  select id into cible from profils where code_ami = upper(texte);
  if cible is null then
    select count(*), min(id::text)::uuid into nombre, cible from profils where lower(pseudo) = lower(texte);
    if nombre = 0 then raise exception 'Personne ne correspond à ce pseudo ou ce code ami'; end if;
    if nombre > 1 then raise exception 'Plusieurs comptes ont ce pseudo : demande-lui son code ami'; end if;
  end if;
  return demande_ami_interne(cible);
end $$;

-- Ajouter un membre d'un de mes groupes (bouton « Ajouter en ami » dans Potes)
create or replace function public.demander_ami_membre(autre uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not public.partage_un_groupe(autre) then raise exception 'Cette personne n''est pas dans tes groupes'; end if;
  return demande_ami_interne(autre);
end $$;

-- Accepter / refuser une demande reçue
create or replace function public.accepter_ami(autre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update amities set acceptee = true, acceptee_le = now() where de = autre and a = auth.uid() and not acceptee;
  if not found then raise exception 'Demande introuvable'; end if;
end $$;

create or replace function public.refuser_ami(autre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from amities where de = autre and a = auth.uid() and not acceptee;
  if not found then raise exception 'Demande introuvable'; end if;
end $$;

-- Supprimer un ami, ou annuler une demande que j'ai envoyée
create or replace function public.supprimer_ami(autre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from amities where (de = auth.uid() and a = autre) or (de = autre and a = auth.uid());
end $$;

-- Mes amis et mes demandes en cours.
-- Avant acceptation, on ne renvoie que le pseudo (plus l'avatar à celui qui reçoit la
-- demande, pour qu'il reconnaisse la personne) : jamais la liste ni le code ami.
create or replace function public.mes_amis()
returns table (id uuid, pseudo text, avatar text, statut text, depuis timestamptz)
language sql security definer stable set search_path = public as $$
  select autre.id,
         p.pseudo,
         case when f.acceptee or f.a = auth.uid() then p.avatar end,
         case when f.acceptee then 'ami' when f.a = auth.uid() then 'recue' else 'envoyee' end,
         coalesce(f.acceptee_le, f.cree_le)
  from amities f
  cross join lateral (select case when f.de = auth.uid() then f.a else f.de end as id) autre
  join profils p on p.id = autre.id
  where f.de = auth.uid() or f.a = auth.uid()
  order by 4, 2;
$$;

-- Tirer un nouveau code ami (si l'ancien a trop circulé)
create or replace function public.nouveau_code_ami() returns text
language plpgsql security definer set search_path = public as $$
declare nouveau text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  loop
    nouveau := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from profils where code_ami = nouveau);
  end loop;
  update profils set code_ami = nouveau where id = auth.uid();
  return nouveau;
end $$;

-- Rien de tout ça sans connexion ; la fonction interne n'est pas appelable par le site
revoke execute on function public.est_ami(uuid), public.demander_ami(text), public.demander_ami_membre(uuid),
  public.accepter_ami(uuid), public.refuser_ami(uuid), public.supprimer_ami(uuid), public.mes_amis(),
  public.nouveau_code_ami() from public, anon;
grant execute on function public.est_ami(uuid), public.demander_ami(text), public.demander_ami_membre(uuid),
  public.accepter_ami(uuid), public.refuser_ami(uuid), public.supprimer_ami(uuid), public.mes_amis(),
  public.nouveau_code_ami() to authenticated;
revoke execute on function public.demande_ami_interne(uuid) from public, anon, authenticated;

-- ---------- 4. Ce que les amis voient (en plus des membres de mes groupes) ----------
drop policy if exists "profils_lire" on public.profils;
create policy "profils_lire" on public.profils for select
  using (id = auth.uid() or public.partage_un_groupe(id) or public.est_ami(id));

drop policy if exists "listes_lire" on public.listes;
create policy "listes_lire" on public.listes for select
  using (user_id = auth.uid() or public.partage_un_groupe(user_id) or public.est_ami(user_id));

-- Recommander : à un membre de mes groupes OU à un ami
drop policy if exists "reco_envoyer" on public.recommandations;
create policy "reco_envoyer" on public.recommandations for insert
  with check (de = auth.uid() and (public.partage_un_groupe(a) or public.est_ami(a)));

commit;
