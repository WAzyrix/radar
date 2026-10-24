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

commit;
