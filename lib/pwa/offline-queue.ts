"use client";

export type OfflineMutationKind = "expense" | "cash" | "feedback";
export type OfflineMutation = {
  id: string;
  kind: OfflineMutationKind;
  url: string;
  method: "POST";
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
};

const DB_NAME = "smf-travel-offline";
const STORE = "mutations";

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  return database().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  }));
}

export function uuidV7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index -= 1) { bytes[index] = timestamp % 256; timestamp = Math.floor(timestamp / 256); }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function queueMutation(input: Omit<OfflineMutation, "id" | "createdAt" | "attempts">) {
  const clientOperationId = String(input.body.clientOperationId || uuidV7());
  const mutation: OfflineMutation = {
    ...input,
    id: clientOperationId,
    body: { ...input.body, clientOperationId },
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await transact("readwrite", (store) => store.put(mutation));
  await registerBackgroundSync();
  window.dispatchEvent(new CustomEvent("smf:sync-state", { detail: { state: "pending" } }));
  return mutation;
}

export async function pendingMutations() {
  return transact<OfflineMutation[]>("readonly", (store) => store.getAll());
}

async function removeMutation(id: string) {
  await transact("readwrite", (store) => store.delete(id));
}

async function updateMutation(mutation: OfflineMutation) {
  await transact("readwrite", (store) => store.put(mutation));
}

export async function flushOfflineQueue() {
  if (!navigator.onLine) return { completed: 0, pending: (await pendingMutations()).length };
  const mutations = (await pendingMutations()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let completed = 0;
  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: { "Content-Type": "application/json", "X-Client-Operation-Id": mutation.id },
        body: JSON.stringify(mutation.body),
      });
      if (response.ok || response.status === 409) {
        await removeMutation(mutation.id);
        completed += 1;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        await removeMutation(mutation.id);
        window.dispatchEvent(new CustomEvent("smf:sync-state", { detail: { state: "failed" } }));
      } else {
        await updateMutation({ ...mutation, attempts: mutation.attempts + 1 });
      }
    } catch {
      await updateMutation({ ...mutation, attempts: mutation.attempts + 1 });
      break;
    }
  }
  const pending = (await pendingMutations()).length;
  window.dispatchEvent(new CustomEvent("smf:sync-state", { detail: { state: pending ? "pending" : completed > 0 ? "complete" : "idle", completed } }));
  return { completed, pending };
}

async function registerBackgroundSync() {
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (!registration || !("sync" in registration)) return;
  await (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register("smf-offline-mutations").catch(() => undefined);
}

export async function resilientMutation(input: Omit<OfflineMutation, "id" | "createdAt" | "attempts">) {
  const body = { ...input.body, clientOperationId: input.body.clientOperationId || uuidV7() };
  if (!navigator.onLine) return { queued: true, mutation: await queueMutation({ ...input, body }) };
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: { "Content-Type": "application/json", "X-Client-Operation-Id": String(body.clientOperationId) },
      body: JSON.stringify(body),
    });
    if (response.ok) return { queued: false, response };
    if (response.status >= 500 || response.status === 408 || response.status === 429) {
      return { queued: true, mutation: await queueMutation({ ...input, body }) };
    }
    return { queued: false, response };
  } catch {
    return { queued: true, mutation: await queueMutation({ ...input, body }) };
  }
}
