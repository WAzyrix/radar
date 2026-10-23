// =========================================================
// Envoi de notifications web (Web Push), sans bibliothèque externe.
//
// Deux mécanismes de sécurité imposés par la norme :
//  1. VAPID (RFC 8292) : on signe une "carte d'identité" (jeton JWT) avec notre clé
//     privée, pour que le service de push (Google, Apple, Mozilla) sache qui envoie.
//  2. Chiffrement du contenu (RFC 8291) : le message est chiffré avec les clés du
//     navigateur abonné ; seul lui peut le lire, pas le service de push.
// Tout se fait avec WebCrypto (crypto.subtle), disponible dans les Workers.
// =========================================================

const encodeur = new TextEncoder();

// ---------- Base64 "URL" (sans + / =) ----------
export function versB64url(octets) {
  let binaire = '';
  for (const o of new Uint8Array(octets)) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisB64url(texte) {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texte.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const concat = (...morceaux) => {
  const total = new Uint8Array(morceaux.reduce((n, m) => n + m.length, 0));
  let position = 0;
  for (const m of morceaux) { total.set(m, position); position += m.length; }
  return total;
};

// ---------- 1. Jeton VAPID ----------
async function jetonVapid(env, endpoint) {
  const entete = { typ: 'JWT', alg: 'ES256' };
  const contenu = {
    aud: new URL(endpoint).origin,                  // le service de push visé
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // valable 12 h
    sub: env.SITE,                                  // qui nous contacter
  };
  const aSigner = `${versB64url(encodeur.encode(JSON.stringify(entete)))}.${versB64url(encodeur.encode(JSON.stringify(contenu)))}`;
  const clePrivee = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clePrivee, encodeur.encode(aSigner));
  return `${aSigner}.${versB64url(signature)}`;
}

// ---------- 2. Chiffrement "aes128gcm" ----------
async function hkdf(sel, matiere, info, longueur) {
  const cle = await crypto.subtle.importKey('raw', matiere, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info }, cle, longueur * 8));
}

export async function chiffrer(abonnement, texte) {
  const clePubliqueNavigateur = depuisB64url(abonnement.keys.p256dh); // 65 octets
  const secretAuth = depuisB64url(abonnement.keys.auth);              // 16 octets

  // Paire de clés éphémère, utilisée pour ce seul message
  const paire = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const notreClePublique = new Uint8Array(await crypto.subtle.exportKey('raw', paire.publicKey));
  const cleNavigateur = await crypto.subtle.importKey('raw', clePubliqueNavigateur, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secretPartage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: cleNavigateur }, paire.privateKey, 256));

  // Dérivations de clés décrites dans la RFC 8291
  const infoCle = concat(encodeur.encode('WebPush: info\0'), clePubliqueNavigateur, notreClePublique);
  const matiere = await hkdf(secretAuth, secretPartage, infoCle, 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cleContenu = await hkdf(sel, matiere, encodeur.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sel, matiere, encodeur.encode('Content-Encoding: nonce\0'), 12);

  // Message + octet 0x02 (= "dernier bloc"), chiffré en AES-GCM
  const cleAes = await crypto.subtle.importKey('raw', cleContenu, 'AES-GCM', false, ['encrypt']);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cleAes, concat(encodeur.encode(texte), new Uint8Array([2]))));

  // En-tête : sel (16) | taille de bloc (4) | longueur de clé (1) | notre clé publique (65)
  const entete = new Uint8Array(21);
  entete.set(sel, 0);
  new DataView(entete.buffer).setUint32(16, 4096);
  entete[20] = notreClePublique.length;
  return concat(entete, notreClePublique, chiffre);
}

/**
 * Envoie une notification à un abonnement.
 * Renvoie "ok", ou "expire" si le navigateur s'est désabonné (à supprimer).
 */
export async function envoyerPush(env, abonnement, notification) {
  const corps = await chiffrer(abonnement, JSON.stringify(notification));
  const reponse = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${await jetonVapid(env, abonnement.endpoint)}, k=${env.VAPID_PUBLIQUE}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',       // le service garde la notif 24 h si le téléphone est éteint
      Urgency: 'normal',
    },
    body: corps,
  });
  if (reponse.status === 404 || reponse.status === 410) return 'expire';
  if (!reponse.ok) throw new Error(`Push refusé (${reponse.status}) : ${(await reponse.text()).slice(0, 200)}`);
  return 'ok';
}
