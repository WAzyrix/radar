-- =========================================================
-- Radar : un code perso = un seul compte (à exécuter APRÈS securite-2.sql)
-- SQL Editor → New query → coller → Run. Peut être relancé sans risque.
--
-- Avant la correction de l'appareil partagé, un compte pouvait adopter le code perso d'un
-- autre (même liste, mêmes notifications). Cette règle l'interdit désormais.
-- S'il existe encore des codes en double, RIEN n'est modifié : le script s'arrête et dit
-- combien il y en a (les doublons se règlent d'abord, compte par compte).
-- =========================================================
begin;

do $$
declare doublons int;
begin
  select count(*) into doublons from (select code from public.codes group by code having count(*) > 1) d;
  if doublons > 0 then
    raise exception '% code(s) perso en double : rien n''a été modifié. Règle-les d''abord, puis relance ce fichier.', doublons;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'codes_code_unique') then
    alter table public.codes add constraint codes_code_unique unique (code);
  end if;
end $$;

commit;
