// =========================================================
// Limite de débit par adresse IP (Durable Object).
//
// Un "Durable Object" est un petit objet qui vit chez Cloudflare : il y en a UN par
// adresse IP, et toutes les requêtes de cette adresse passent par lui, où qu'elles
// arrivent dans le monde. Le compte est donc exact (contrairement au limiteur intégré
// de Cloudflare, approximatif, qui ne bloquait rien sur l'offre gratuite).
// Les compteurs restent en mémoire : aucune écriture en base. Si l'objet est mis en
// veille, ils repartent de zéro, ce qui est sans gravité pour une limite à la minute.
// =========================================================
import { DurableObject } from 'cloudflare:workers';

const FENETRE = 60_000; // 1 minute

export class Limiteur extends DurableObject {
  heures = new Map(); // catégorie -> heures des requêtes de la dernière minute

  /** Renvoie { ok, attente } : attente = secondes avant de pouvoir réessayer. */
  async autoriser(categorie, limite) {
    const maintenant = Date.now();
    const recentes = (this.heures.get(categorie) || []).filter((t) => maintenant - t < FENETRE);
    const ok = recentes.length < limite;
    if (ok) recentes.push(maintenant);
    this.heures.set(categorie, recentes);
    return { ok, attente: ok ? 0 : Math.ceil((FENETRE - (maintenant - recentes[0])) / 1000) };
  }
}

// IPv6 : un abonné dispose de tout un bloc /64 (des milliards d'adresses) ;
// on compte donc par bloc, sinon changer d'adresse suffirait à contourner la limite.
export function cleIp(ip) {
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}
