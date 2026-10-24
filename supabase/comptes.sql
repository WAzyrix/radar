-- =========================================================
-- Radar : supprimer son compte (à exécuter APRÈS dates-recommandations.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- - supprimer_mon_compte() : bouton « Supprimer mon compte » de la page Potes. Efface le
--   compte et TOUTES ses données (profil, code, liste, notes, préférences, amitiés,
--   recommandations, messages, appartenance aux groupes) grâce aux "on delete cascade".
-- - Avant la suppression d'un compte (par le bouton OU depuis le tableau de bord Supabase),
--   chacun de ses groupes passe au membre le plus ancien : le groupe et les messages des
--   autres restent. Un groupe où il était seul disparaît avec lui.
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Transmission des groupes ----------
create or replace function public.transmettre_groupes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g record;
  heritier uuid;
begin
  for g in select id from groupes where cree_par = old.id loop
    select user_id into heritier from membres
      where groupe_id = g.id and user_id <> old.id
      order by rejoint_le, user_id limit 1;
    if heritier is not null then
      update groupes set cree_par = heritier where id = g.id;
    end if;
    -- Sinon : groupe vide sans lui, supprimé par "on delete cascade"
  end loop;
  return old;
end $$;
revoke execute on function public.transmettre_groupes() from public, anon, authenticated;

drop trigger if exists comptes_transmettre_groupes on auth.users;
create trigger comptes_transmettre_groupes before delete on auth.users
  for each row execute function public.transmettre_groupes();

-- ---------- 2. Supprimer mon compte ----------
create or replace function public.supprimer_mon_compte() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.supprimer_mon_compte() from public, anon;
grant execute on function public.supprimer_mon_compte() to authenticated;

commit;
