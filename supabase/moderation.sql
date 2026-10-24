-- =========================================================
-- Radar : modération des groupes (à exécuter APRÈS comptes.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Le créateur d'un groupe peut :
--  - exclure un membre : il perd l'accès (messages, listes, notes des membres) et ne peut
--    plus revenir avec le code d'invitation ;
--  - tirer un nouveau code d'invitation : l'ancien ne marche plus.
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Personnes exclues (lue et écrite uniquement par les fonctions) ----------
create table if not exists public.exclusions (
  groupe_id uuid not null references public.groupes on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  exclu_le timestamptz not null default now(),
  primary key (groupe_id, user_id)
);
alter table public.exclusions enable row level security;
revoke all on public.exclusions from anon, authenticated;

-- ---------- 2. Exclure un membre ----------
create or replace function public.exclure_membre(groupe uuid, membre uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from groupes where id = groupe and cree_par = auth.uid()) then
    raise exception 'Seul le créateur du groupe peut exclure un membre';
  end if;
  if membre = auth.uid() then raise exception 'Tu ne peux pas t''exclure toi-même : quitte le groupe'; end if;
  delete from membres where groupe_id = groupe and user_id = membre;
  if not found then raise exception 'Cette personne n''est pas dans le groupe'; end if;
  insert into exclusions (groupe_id, user_id) values (groupe, membre) on conflict do nothing;
end $$;

-- ---------- 3. Nouveau code d'invitation ----------
create or replace function public.nouvelle_invitation(groupe uuid) returns text
language plpgsql security definer set search_path = public as $$
declare nouveau text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from groupes where id = groupe and cree_par = auth.uid()) then
    raise exception 'Seul le créateur du groupe peut changer le code d''invitation';
  end if;
  loop
    nouveau := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    exit when not exists (select 1 from groupes where invitation = nouveau);
  end loop;
  update groupes set invitation = nouveau where id = groupe;
  return nouveau;
end $$;

-- ---------- 4. Rejoindre : refusé aux personnes exclues ----------
create or replace function public.rejoindre_groupe(code_invitation text) returns uuid
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select id into g from groupes where invitation = lower(trim(code_invitation));
  if g is null then raise exception 'Invitation inconnue'; end if;
  if exists (select 1 from exclusions where groupe_id = g and user_id = auth.uid()) then
    raise exception 'Tu as été exclu de ce groupe';
  end if;
  insert into membres (groupe_id, user_id) values (g, auth.uid()) on conflict do nothing;
  return g;
end $$;

revoke execute on function public.exclure_membre(uuid, uuid), public.nouvelle_invitation(uuid) from public, anon;
grant execute on function public.exclure_membre(uuid, uuid), public.nouvelle_invitation(uuid) to authenticated;

commit;
