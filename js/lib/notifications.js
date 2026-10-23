// =========================================================
// Notifications web, côté navigateur.
//
// 1. On demande la permission d'afficher des notifications.
// 2. Le navigateur nous donne un "abonnement" (une adresse unique chez Google,
//    Apple ou Mozilla + des clés de chiffrement).
// 3. On envoie cet abonnement au relais, qui s'en sert pour nous écrire.
// 4. Le service worker (sw.js) reçoit les messages et affiche les notifications,
//    même quand le site est fermé.
// =========================================================
import { codePerso, envoyer, appelRelais } from './ma-liste.js';

export const supporte = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// Sur iPhone, les notifications web ne marchent que si le site est ajouté à l'écran d'accueil
export const estIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export const estAppliInstallee = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export const enregistrerServiceWorker = () => navigator.serviceWorker.register('sw.js');

// La clé publique du relais est en base64 "URL" : le navigateur la veut en octets
function enOctets(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function abonnementActuel() {
  const enregistrement = await navigator.serviceWorker.getRegistration();
  return enregistrement?.pushManager.getSubscription() ?? null;
}

/** État pour l'affichage : notifications possibles ? autorisées ? actives sur cet appareil ? */
export async function etat() {
  if (!supporte()) return { possible: false };
  return { possible: true, permission: Notification.permission, actif: Boolean(await abonnementActuel()) };
}

export async function activer(prefs) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées. Tu peux les réautoriser dans les réglages du navigateur.');

  const enregistrement = await enregistrerServiceWorker();
  await navigator.serviceWorker.ready;
  const { cle } = await appelRelais('GET', '/push/cle');
  const abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: enOctets(cle) });

  await envoyer(); // le relais doit connaître la liste pour savoir quoi surveiller
  return appelRelais('PUT', `/abo/${codePerso()}`, { abonnement: abonnement.toJSON(), prefs });
}

export async function desactiver() {
  const abonnement = await abonnementActuel();
  if (!abonnement) return;
  await appelRelais('DELETE', `/abo/${codePerso()}`, { endpoint: abonnement.endpoint }).catch(() => {});
  await abonnement.unsubscribe();
}

export const lirePrefs = () => appelRelais('GET', `/abo/${codePerso()}`);
export const changerPrefs = (prefs) => appelRelais('PUT', `/prefs/${codePerso()}`, prefs);
export const envoyerTest = () => appelRelais('POST', `/test/${codePerso()}`);
export const historique = () => appelRelais('GET', `/historique/${codePerso()}`);
