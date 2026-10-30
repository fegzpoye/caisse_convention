// Caisse du stand : page et bibliothèques gardées par le navigateur pour rouvrir la caisse sans
// réseau (Safari compris). Seules la page de la caisse et ses bibliothèques publiques sont gardées ;
// les échanges avec SHAYA MANAGER, Firebase et toute autre adresse ne passent jamais par ce cache.
// Les autres pages publiées dans le même dossier (roue, écran du stand, carte…) ne sont jamais
// interceptées : elles ne peuvent ni remplacer la copie de la caisse, ni être servies à sa place.
"use strict";

const VERSION = "caisse-2026-10-30-production";
const BIBLIOTHEQUES = ["https://cdnjs.cloudflare.com/", "https://fonts.googleapis.com/", "https://fonts.gstatic.com/", "https://www.gstatic.com/firebasejs/"];
// Adresses de la caisse elle-même : le dossier du service worker et son index.html.
const DOSSIER = new URL("./", self.location.href).pathname;
const PAGES_CAISSE = [DOSSIER, `${DOSSIER}index.html`];

self.addEventListener("install", (event) => {
  // Page de la caisse mise de côté dès l'installation (une erreur réseau n'empêche pas l'installation).
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(new Request("./", { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

// Bibliothèques déjà gardées par une version précédente de la caisse : reprises dans la nouvelle copie
// avant la suppression des anciennes, pour que la caisse se rouvre hors ligne dès la mise à jour (adresses
// versionnées : même adresse, même contenu). La page n'est pas reprise : elle vient de la nouvelle version.
async function reprendreBibliotheques(anciennes) {
  const cache = await caches.open(VERSION);
  for (const nom of anciennes) {
    const ancien = await caches.open(nom);
    for (const requete of await ancien.keys()) {
      if (!BIBLIOTHEQUES.some((debut) => requete.url.startsWith(debut)) || (await cache.match(requete))) continue;
      const reponse = await ancien.match(requete);
      if (reponse) await cache.put(requete, reponse);
    }
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (cles) => {
        const anciennes = cles.filter((c) => c !== VERSION && c.startsWith("caisse-"));
        await reprendreBibliotheques(anciennes).catch(() => undefined);
        await Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c)));
      })
      .then(() => self.clients.claim()),
  );
});

// Page : réseau d'abord (version à jour), copie gardée si le réseau ne répond pas.
async function page(request) {
  const cache = await caches.open(VERSION);
  try {
    const controle = new AbortController();
    const minuteur = setTimeout(() => controle.abort(), 5000);
    const reponse = await fetch(request, { signal: controle.signal });
    clearTimeout(minuteur);
    if (reponse.ok) await cache.put("./", reponse.clone());
    return reponse;
  } catch {
    return (await cache.match("./")) || (await cache.match(request)) || new Response("Caisse hors ligne : ouvrez-la une première fois avec du réseau.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

// Bibliothèque publique versionnée : copie gardée d'abord, mise à jour en arrière-plan.
async function bibliotheque(request) {
  const cache = await caches.open(VERSION);
  const gardee = await cache.match(request);
  const reseau = fetch(request)
    .then((reponse) => {
      if (reponse.ok || reponse.type === "opaque") cache.put(request, reponse.clone());
      return reponse;
    })
    .catch(() => undefined);
  return gardee || (await reseau) || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && url.origin === self.location.origin && PAGES_CAISSE.includes(url.pathname)) {
    event.respondWith(page(request));
    return;
  }
  if (BIBLIOTHEQUES.some((debut) => request.url.startsWith(debut))) event.respondWith(bibliotheque(request));
  // Tout le reste (autres pages du dossier, API de SHAYA MANAGER, Firebase, Discord…) : jamais intercepté.
});
