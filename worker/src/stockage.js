// =========================================================
// Stockage du relais : un Durable Object SQLite (remplace Cloudflare KV).
//
// Pourquoi ? KV gratuit = 1000 écritures par jour : un script, ou une vingtaine
// d'utilisateurs, suffisaient à l'épuiser. Un Durable Object SQLite gratuit, c'est
// 100 000 lignes écrites et 5 millions de lignes lues par jour.
//
// Un seul objet ("radar") garde toutes les données, dans une table clé → valeur (texte JSON),
// avec les mêmes clés qu'avant :
//   liste:<code>  abo:<code>  etat:<code>  histo:<code>  chat:<groupe>:<membre> (avec expiration)
// stockage(env) renvoie un petit objet qui s'utilise comme KV (get / put / delete), plus des
// opérations groupées pour la tâche horaire (un seul appel pour tout lire, un seul pour tout écrire).
//
// Les anciennes données KV sont recopiées automatiquement (migrerDepuisKv), par lots, au
// premier passage ; le binding RADAR_KV n'est plus lu ensuite.
// =========================================================
import { DurableObject } from 'cloudflare:workers';

export class Stockage extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`create table if not exists donnees (
      cle text primary key, valeur text not null, expire integer
    ) without rowid`);
  }

  lire(cle) {
    const [ligne] = this.sql.exec('select valeur, expire from donnees where cle = ?', cle).toArray();
    return ligne && !(ligne.expire && ligne.expire < Date.now()) ? ligne.valeur : null;
  }

  // Écrit seulement si la valeur a changé (une écriture identique ne coûte rien). Renvoie true si écrit.
  ecrire(cle, valeur, expire = null) {
    const [ligne] = this.sql.exec('select valeur, expire from donnees where cle = ?', cle).toArray();
    if (ligne && ligne.valeur === valeur && ligne.expire === expire) return false;
    this.sql.exec(`insert into donnees (cle, valeur, expire) values (?, ?, ?)
      on conflict (cle) do update set valeur = excluded.valeur, expire = excluded.expire`, cle, valeur, expire);
    return true;
  }

  supprimer(cles) {
    for (const cle of cles) this.sql.exec('delete from donnees where cle = ?', cle);
  }

  // Plusieurs écritures d'un coup, tout ou rien : [[cle, valeur], …]
  ecrirePlusieurs(entrees) {
    let ecrites = 0;
    this.ctx.storage.transactionSync(() => {
      for (const [cle, valeur] of entrees) if (this.ecrire(cle, valeur)) ecrites += 1;
    });
    return ecrites;
  }

  // Tâche horaire : chaque liste, avec l'abonnement, l'état et la cloche du même code
  chargerComptes() {
    const lignes = this.sql.exec(`select cle, valeur from donnees
      where (cle like 'liste:%' or cle like 'abo:%' or cle like 'etat:%' or cle like 'histo:%')`).toArray();
    const parCle = new Map(lignes.map((l) => [l.cle, l.valeur]));
    return lignes.filter((l) => l.cle.startsWith('liste:')).map((l) => {
      const code = l.cle.slice(6);
      return { code, liste: l.valeur, abo: parCle.get(`abo:${code}`) ?? null, etat: parCle.get(`etat:${code}`) ?? null, histo: parCle.get(`histo:${code}`) ?? null };
    });
  }

  // Ménage : clés expirées (anti-spam du chat)
  nettoyer() {
    this.sql.exec('delete from donnees where expire is not null and expire < ?', Date.now());
  }

  // ---------- Migration depuis KV ----------
  migrationFinie() {
    return this.lire('meta:migration-kv') === 'finie';
  }

  // Parmi ces clés, celles qui ne sont pas encore copiées
  absentes(cles) {
    return cles.filter((cle) => !this.sql.exec('select 1 from donnees where cle = ?', cle).toArray().length);
  }

  // Copie sans jamais écraser une donnée déjà écrite ici (plus récente que KV)
  importer(entrees, finie) {
    this.ctx.storage.transactionSync(() => {
      for (const { cle, valeur, expire } of entrees) {
        this.sql.exec('insert into donnees (cle, valeur, expire) values (?, ?, ?) on conflict (cle) do nothing', cle, valeur, expire ?? null);
      }
      if (finie) this.ecrire('meta:migration-kv', 'finie');
    });
  }
}

const objet = (env) => env.STOCKAGE.get(env.STOCKAGE.idFromName('radar'));

/** Même usage que KV : get(cle, 'json'), put(cle, texte, { expirationTtl }), delete(cle). */
export function stockage(env) {
  const o = objet(env);
  return {
    async get(cle, type) {
      const valeur = await o.lire(cle);
      return type === 'json' && valeur !== null ? JSON.parse(valeur) : valeur;
    },
    put: (cle, valeur, { expirationTtl } = {}) => o.ecrire(cle, valeur, expirationTtl ? Date.now() + expirationTtl * 1000 : null),
    delete: (cle) => o.supprimer([cle]),
    supprimer: (cles) => o.supprimer(cles),
    ecrirePlusieurs: (entrees) => o.ecrirePlusieurs(entrees),
    chargerComptes: () => o.chargerComptes(),
    nettoyer: () => o.nettoyer(),
  };
}

// Au plus 800 lectures KV par passage (limite de 1000 appels aux services Cloudflare par invocation)
const LOT_MIGRATION = 800;
let migrationVue = false; // une fois finie, on ne redemande plus (par instance du Worker)

/** Recopie les données KV dans le Durable Object, par lots. Sans danger si appelée plusieurs fois. */
export async function migrerDepuisKv(env) {
  if (migrationVue || !env.RADAR_KV) return { migration: 'rien à faire' };
  const o = objet(env);
  if (await o.migrationFinie()) { migrationVue = true; return { migration: 'déjà faite' }; }

  const cles = [];
  let curseur;
  do {
    const page = await env.RADAR_KV.list({ cursor: curseur });
    cles.push(...page.keys);
    curseur = page.list_complete ? undefined : page.cursor;
  } while (curseur);

  const absentes = new Set(await o.absentes(cles.map((k) => k.name)));
  const aCopier = cles.filter((k) => absentes.has(k.name));
  const lot = aCopier.slice(0, LOT_MIGRATION);
  const entrees = (await Promise.all(lot.map(async (k) => ({
    cle: k.name,
    valeur: await env.RADAR_KV.get(k.name),
    expire: k.expiration ? k.expiration * 1000 : null,
  })))).filter((e) => e.valeur !== null);
  const finie = aCopier.length <= LOT_MIGRATION;
  await o.importer(entrees, finie);
  if (finie) migrationVue = true;
  return { migration: finie ? 'finie' : 'en cours', copiees: entrees.length, restantes: aCopier.length - lot.length };
}
