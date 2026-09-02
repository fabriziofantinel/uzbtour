/* SMF Travel service worker: bounded offline cache, sync bridge and Web Push. */
const VERSION = "smf-pwa-v11";
const SHELL = `${VERSION}-shell`, DATA = `${VERSION}-data`, MAPS = `${VERSION}-maps`, MEDIA = `${VERSION}-media`;
const OFFLINE_URL = "/offline.html";
const SHELL_FILES = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => ![SHELL, DATA, MAPS, MEDIA].includes(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
  if (event.data?.type === "CACHE_TRIP") {
    const port=event.ports?.[0],urls=Array.isArray(event.data.urls)?event.data.urls:[];
    event.waitUntil((async()=>{let done=0,skipped=0;for(let index=0;index<urls.length;index+=1){const url=urls[index];try{const absoluteUrl=new URL(url,self.location.origin);const headers=new Headers();if(index>=2)headers.set("X-SMF-Offline-Package","1");const request=new Request(absoluteUrl,{credentials:"include",headers});const response=await fetch(request);if(!response.ok)throw new Error(`Risorsa non disponibile: ${absoluteUrl.pathname}`);const privateMedia=absoluteUrl.pathname.includes("/content")||absoluteUrl.pathname.includes("/photos/")||absoluteUrl.pathname.startsWith("/api/agency-logo/");const cache=await caches.open(privateMedia?MEDIA:DATA);await cache.put(request,await stamped(response));}catch(error){if(index<2){port?.postMessage({type:"OFFLINE_FAILED",message:error instanceof Error?error.message:"Download non riuscito"});return;}skipped+=1;}finally{done+=1;port?.postMessage({type:"OFFLINE_PROGRESS",done,total:urls.length});}}port?.postMessage({type:"OFFLINE_READY",skipped});})());
  }
  if (event.data?.type === "CLEAR_PRIVATE_CACHES") event.waitUntil(Promise.all([caches.delete(DATA),caches.delete(MEDIA),caches.delete(MAPS)]));
});
async function trimCache(name, limit, maxAgeMs) {
  const cache = await caches.open(name), keys = await cache.keys(), now = Date.now();
  const dated = await Promise.all(keys.map(async (request) => ({ request, stored: Number((await cache.match(request))?.headers.get("sw-stored-at") || 0) })));
  const expired = dated.filter((entry) => entry.stored && now - entry.stored > maxAgeMs);
  const excess = dated.sort((a, b) => a.stored - b.stored).slice(0, Math.max(0, dated.length - limit));
  await Promise.all([...new Map([...expired, ...excess].map((entry) => [entry.request.url, entry.request])).values()].map((request) => cache.delete(request)));
}
async function stamped(response) {
  const headers = new Headers(response.headers); headers.set("sw-stored-at", String(Date.now()));
  return new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers });
}
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL), cached = await cache.match(request);
  const network = fetch(request).then(async (response) => { if (response.ok) await cache.put(request, await stamped(response)); return response; }).catch(() => null);
  return cached || network || caches.match(OFFLINE_URL);
}
async function networkFirst(request) {
  const cache = await caches.open(DATA);
  try { const response = await fetch(request); if (response.ok) await cache.put(request, await stamped(response)); return response; }
  catch { return (await cache.match(request)) || (request.mode === "navigate" ? caches.match(OFFLINE_URL) : new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } })); }
}
async function cacheFirst(request, name, limit, maxAgeMs) {
  const cache = await caches.open(name), cached = await cache.match(request); if (cached) return cached;
  const response = await fetch(request); if (response.ok) { await cache.put(request, await stamped(response)); void trimCache(name, limit, maxAgeMs); } return response;
}
self.addEventListener("fetch", (event) => {
  const request = event.request; if (request.method !== "GET") return; const url = new URL(request.url);
  const isTile = /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname) || url.hostname.includes("openstreetmap");
  const isMedia = url.pathname.includes("/content") || url.pathname.includes("/photos/") || url.pathname.startsWith("/api/agency-logo/") || url.hostname.includes("r2.cloudflarestorage.com");
  const isTripData = url.pathname.startsWith("/api/traveler/");
  // Le pagine HTML autenticate non sono app-shell: inserirle nella cache
  // condivisa del browser potrebbe mostrare dati del tenant precedente dopo
  // un cambio identita o un'impersonazione. La shell contiene solo asset
  // pubblici e immutabili; /viaggio usa la cache privata DATA separata.
  const isShell = url.origin === self.location.origin && request.mode !== "navigate" &&
    (url.pathname.startsWith("/_next/static/") || /\.(?:css|js|woff2?)$/.test(url.pathname));
  if (isTile) event.respondWith(cacheFirst(request, MAPS, 180, 14 * 86400000));
  else if (isMedia) event.respondWith(cacheFirst(request, MEDIA, 80, 30 * 86400000));
  else if (isTripData || (request.mode === "navigate" && url.pathname.startsWith("/viaggio"))) event.respondWith(networkFirst(request));
  else if (isShell) event.respondWith(staleWhileRevalidate(request));
});
self.addEventListener("sync", (event) => { if (event.tag === "smf-offline-mutations") event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => Promise.all(clients.map((client) => client.postMessage({ type: "FLUSH_OFFLINE_QUEUE" }))))); });
self.addEventListener("push", (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(data.title || "SMF Travel", { body: data.body || "Hai un nuovo aggiornamento sul tuo viaggio.", icon: data.icon || "/icons/icon-192.png", tag: data.tag || "smf-travel-update", data: { url: data.url || "/viaggio" }, actions: [{ action: "open", title: "Apri il viaggio" }] }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close(); const target = new URL(event.notification.data?.url || "/viaggio", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => { const existing = clients.find((client) => client.url.startsWith(self.location.origin)); if (existing) { existing.navigate(target); return existing.focus(); } return self.clients.openWindow(target); }));
});
