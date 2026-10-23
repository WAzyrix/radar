// =========================================================
// Réglages du site.
// URL_RELAIS : adresse du relais Cloudflare Worker (dossier worker/).
// Ce n'est PAS un secret : la clé RAWG reste stockée chez Cloudflare.
// =========================================================
export const URL_RELAIS = 'https://radar-relais.wazyrix.workers.dev';

// Supabase (comptes et groupe de potes). La clé "anon" est PUBLIQUE par conception :
// la sécurité vient des règles RLS de la base (supabase/schema.sql).
export const SUPABASE_URL = 'A-REMPLACER';
export const SUPABASE_CLE_PUBLIQUE = 'A-REMPLACER';
