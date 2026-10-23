// =========================================================
// Service worker de Radar : un petit script que le navigateur garde en arrière-plan.
// Il reçoit les notifications envoyées par le relais et les affiche,
// même quand aucune page du site n'est ouverte.
// =========================================================

// Nouvelle version : on remplace l'ancienne tout de suite
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (evenement) => evenement.waitUntil(self.clients.claim()));

// Réception d'une notification (le contenu a été chiffré par le relais, déchiffré par le navigateur)
self.addEventListener('push', (evenement) => {
  let donnees = { titre: 'Radar', corps: 'Du nouveau sur ta liste !' };
  try {
    donnees = { ...donnees, ...evenement.data.json() };
  } catch { /* message vide ou illisible : texte par défaut */ }

  evenement.waitUntil(self.registration.showNotification(donnees.titre, {
    body: donnees.corps,
    icon: donnees.image || 'icones/icone-192.png',
    badge: 'icones/badge-96.png', // petite icône monochrome dans la barre d'état Android
    data: { url: donnees.url || './' },
  }));
});

// Clic sur la notification : on ouvre la bonne page (ou on réutilise un onglet déjà ouvert)
self.addEventListener('notificationclick', (evenement) => {
  evenement.notification.close();
  const url = new URL(evenement.notification.data?.url || './', self.registration.scope).href;
  evenement.waitUntil((async () => {
    const onglets = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existant = onglets.find((o) => o.url === url);
    if (existant) return existant.focus();
    return self.clients.openWindow(url);
  })());
});
