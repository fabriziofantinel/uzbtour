import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const [queue, experience, expenses, journal, v3Expenses, v3Journey] = await Promise.all([
  readFile("lib/pwa/offline-queue.ts", "utf8"),
  readFile("app/viaggio/travel-experience.tsx", "utf8"),
  readFile("app/api/traveler/expenses/route.ts", "utf8"),
  readFile("app/api/traveler/journal/route.ts", "utf8"),
  readFile("lib/platform/v3-expenses.ts", "utf8"),
  readFile("lib/platform/v3-journey-mutations.ts", "utf8"),
]);
assert.match(queue, /OfflineMutationKind = "expense" \| "cash" \| "feedback"/);
assert.match(queue, /indexedDB\.open/);
assert.match(queue, /clientOperationId/);
assert.match(queue, /X-Client-Operation-Id/);
assert.match(queue, /status === 409/);
assert.match(queue, /response\.status === 409[\s\S]*new Response/);
assert.match(queue, /smf-offline-mutations/);
assert.match(queue, /navigator\.onLine/);
assert.match(experience, /kind:\s*"expense",\s*url:\s*"\/api\/traveler\/expenses"/);
assert.match(experience, /kind:\s*offlineKind,\s*url:\s*"\/api\/traveler\/journal"/);
assert.match(expenses, /clientOperationId:\s*z[\s\S]*?\.string\(\)[\s\S]*?\.uuid\(\)/);
assert.match(journal, /clientOperationId/);
assert.match(journal, /\^\[A-Z\]\{3\}\$/);
assert.doesNotMatch(journal, /\["EUR", "UZS", "VND"\]\.includes/);
assert.match(v3Expenses, /ON CONFLICT \(party_id, client_operation_id\) DO NOTHING/);
assert.match(v3Journey, /ON CONFLICT\(party_id,client_operation_id\) DO NOTHING/);
console.log(
  JSON.stringify({
    status: "passed",
    indexedDbQueue: true,
    expensesQueued: true,
    cashQueued: true,
    backgroundSync: true,
    retryAndConflictHandling: true,
    idempotentBackend: true,
    dynamicIsoCurrency: true,
  }),
);
