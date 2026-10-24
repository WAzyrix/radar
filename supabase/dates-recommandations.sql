-- =========================================================
-- Radar : dates posées par la base et limite des recommandations (à exécuter APRÈS notes.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- 1. La date d'un message ou d'une recommandation est TOUJOURS celle de la base (now()) :
--    une date envoyée par le site (2099, 2001…) est ignorée. Sinon 100 messages datés de 2099
--    cachaient tout le chat, et une recommandation "future" restait en tête pour toujours.
-- 2. 10 recommandations par heure au plus, envoyées par une personne comme reçues par une
--    personne : contrôlé par la base, même si on contourne le relais.
-- 3. Le destinataire peut supprimer une recommandation reçue.
--
-- Tout est dans une transaction : si une instruction échoue, RIEN n'est appliqué.
-- =========================================================
begin;

-- ---------- 1. Dates posées par la base ----------
-- À l'insertion : maintenant. À une modification (marquer "vue") : la date ne bouge pas.
create or replace function public.date_serveur() returns trigger
language plpgsql set search_path = public as $$
begin
  new.cree_le := case when tg_op = 'INSERT' then now() else old.cree_le end;
  return new;
end $$;

drop trigger if exists messages_date on public.messages;
create trigger messages_date before insert or update on public.messages
  for each row execute function public.date_serveur();

drop trigger if exists recommandations_date on public.recommandations;
create trigger recommandations_date before insert or update on public.recommandations
  for each row execute function public.date_serveur();

-- Les dates déjà en base dans le futur sont ramenées à maintenant
-- (désactivation le temps de la correction : le déclencheur garderait l'ancienne date)
alter table public.messages disable trigger messages_date;
alter table public.recommandations disable trigger recommandations_date;
update public.messages set cree_le = now() where cree_le > now();
update public.recommandations set cree_le = now() where cree_le > now();
alter table public.messages enable trigger messages_date;
alter table public.recommandations enable trigger recommandations_date;

-- ---------- 2. 10 recommandations par heure ----------
-- "security definer" : il faut compter AUSSI les recommandations reçues d'autres personnes,
-- que la RLS cache à l'expéditeur. Le verrou évite que deux envois simultanés passent à 11.
create or replace function public.limite_recommandations() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('reco:' || new.a::text));
  if (select count(*) from recommandations where de = new.de and cree_le > now() - interval '1 hour') >= 10 then
    raise exception 'Tu as déjà envoyé beaucoup de recommandations : réessaie dans une heure.';
  end if;
  if (select count(*) from recommandations where a = new.a and cree_le > now() - interval '1 hour') >= 10 then
    raise exception 'Ce pote a reçu beaucoup de recommandations cette heure-ci : réessaie plus tard.';
  end if;
  return new;
end $$;
revoke execute on function public.limite_recommandations() from public, anon, authenticated;

drop trigger if exists recommandations_limite on public.recommandations;
create trigger recommandations_limite before insert on public.recommandations
  for each row execute function public.limite_recommandations();

-- ---------- 3. Supprimer une recommandation reçue ----------
drop policy if exists "reco_supprimer" on public.recommandations;
create policy "reco_supprimer" on public.recommandations for delete using (a = auth.uid());
grant delete on public.recommandations to authenticated;

commit;
