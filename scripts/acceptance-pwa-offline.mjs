import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class MemoryCache {
  constructor(fetcher) { this.entries = new Map(); this.fetcher = fetcher; }
  key(request) { return typeof request === "string" ? new URL(request, "https://smf.test").href : request.url; }
  async match(request) { return this.entries.get(this.key(request))?.clone(); }
  async put(request, response) { this.entries.set(this.key(request), response.clone()); }
  async delete(request) { return this.entries.delete(this.key(request)); }
  async keys() { return [...this.entries.keys()].map((url) => new Request(url)); }
  async addAll(urls) { for (const url of urls) { const request = new Request(new URL(url, "https://smf.test")); await this.put(request, await this.fetcher(request)); } }
}

const listeners = new Map();
let online = true;
const responses = new Map([
  ["/offline.html", new Response("OFFLINE", { headers: { "Content-Type": "text/html" } })],
  ["/manifest.webmanifest", new Response("{}")],
  ["/icons/icon-192.png", new Response("192")],
  ["/icons/icon-512.png", new Response("512")],
  ["/viaggio?partenza=departure-alpha", new Response("PROGRAMMA ALPHA", { headers: { "Content-Type": "text/html" } })],
  ["/api/traveler/trip-data?partenza=departure-alpha", new Response(JSON.stringify({ partyId: "party-alpha", days: [1, 2] }), { headers: { "Content-Type": "application/json" } })],
  ["/api/traveler/documents/doc-alpha/content", new Response("VOUCHER ALPHA", { headers: { "Content-Type": "application/pdf" } })],
]);
const fetcher = async (request) => {
  if (!online) throw new TypeError("offline");
  const url = new URL(typeof request === "string" ? request : request.url, "https://smf.test");
  const response = responses.get(`${url.pathname}${url.search}`) ?? responses.get(url.pathname);
  if (!response) return new Response("missing", { status: 404 });
  return response.clone();
};
const stores = new Map();
const caches = {
  async open(name) { if (!stores.has(name)) stores.set(name, new MemoryCache(fetcher)); return stores.get(name); },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); },
  async match(request) { for (const cache of stores.values()) { const found = await cache.match(request); if (found) return found; } },
};
const self = {
  location: { origin: "https://smf.test" },
  clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
  registration: { showNotification: async () => {} },
  addEventListener(type, handler) { listeners.set(type, handler); },
  skipWaiting: async () => {},
};
const context = vm.createContext({ self, caches, fetch: fetcher, Request, Response, Headers, URL, Date, Promise, Map, Set, console });
vm.runInContext(await readFile("public/sw.js", "utf8"), context, { filename: "public/sw.js" });

async function dispatchWait(type, data = {}) {
  let pending = Promise.resolve();
  listeners.get(type)({ ...data, waitUntil(value) { pending = Promise.resolve(value); } });
  await pending;
}
await dispatchWait("install");
assert.ok(await (await caches.open("smf-pwa-v6-shell")).match("https://smf.test/offline.html"));

const messages = [];
await dispatchWait("message", {
  data: { type: "CACHE_TRIP", urls: [
    "/viaggio?partenza=departure-alpha",
    "/api/traveler/trip-data?partenza=departure-alpha",
    "/api/traveler/documents/doc-alpha/content",
  ] },
  ports: [{ postMessage(message) { messages.push(message); } }],
});
assert.equal(messages.at(-1)?.type, "OFFLINE_READY");
assert.equal(messages.filter((message) => message.type === "OFFLINE_PROGRESS").length, 3);

async function offlineFetch(path, mode = "cors") {
  online = false;
  let responsePromise;
  const request = mode === "navigate"
    ? { url: `https://smf.test${path}`, method: "GET", mode: "navigate" }
    : new Request(`https://smf.test${path}`, { mode });
  listeners.get("fetch")({ request, respondWith(value) { responsePromise = Promise.resolve(value); } });
  assert.ok(responsePromise, `Nessuna strategia offline per ${path}`);
  return responsePromise;
}
assert.equal(await (await offlineFetch("/api/traveler/trip-data?partenza=departure-alpha")).json().then((value) => value.partyId), "party-alpha");
assert.equal(await (await offlineFetch("/api/traveler/documents/doc-alpha/content")).text(), "VOUCHER ALPHA");
assert.equal(await (await offlineFetch("/viaggio?partenza=departure-alpha", "navigate")).text(), "PROGRAMMA ALPHA");

let privateNavigationResponse;
listeners.get("fetch")({
  request: { url: "https://smf.test/agenzia", method: "GET", mode: "navigate" },
  respondWith(value) { privateNavigationResponse = Promise.resolve(value); },
});
assert.equal(privateNavigationResponse, undefined, "Il back-office autenticato non deve essere servito dalla cache PWA");

await dispatchWait("message", { data: { type: "CLEAR_PRIVATE_CACHES" } });
assert.equal(await (await caches.open("smf-pwa-v6-data")).keys().then((keys) => keys.length), 0);
assert.equal(await (await caches.open("smf-pwa-v6-media")).keys().then((keys) => keys.length), 0);
console.log(JSON.stringify({ status: "passed", cachedResources: 3, offlineProgramme: true, offlineTripData: true, offlineDocument: true, privateBackOfficeExcluded: true, privateCacheCleared: true }));
