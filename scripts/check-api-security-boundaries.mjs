import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiRoot = resolve(root, "app/api");
const publicRoutes = new Set([
  "auth/invitation",
  "auth/username/sign-in",
  "auth/username/sign-out",
  "auth/username/forgot-password",
  "auth/username/confirm-password-reset",
  "exchange-rate",
  "pwa/manifest",
  "pwa/icon",
]);
const internalRoutes = new Set(["internal/push/send"]);
const authSignal =
  /(?:getCurrentUser|getAuthenticatedActor|require(?:SuperAdmin|PlatformAdmin|AgencyAdmin|AgencyAdminActor|SuperAdminActor))\s*\(/;
const internalSignal = /(?:timingSafeEqual|authorized)\s*\(/;
const failures = [];
let checked = 0;

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) await visit(absolute);
    else if (entry.name === "route.ts") {
      checked++;
      const route = relative(apiRoot, absolute)
        .replaceAll("\\", "/")
        .replace(/\/route\.ts$/, "");
      const source = await readFile(absolute, "utf8");
      const methods = [...source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (match) => match[1],
      );
      if (methods.length === 0) failures.push(`${route}: nessun handler HTTP esportato`);
      if (publicRoutes.has(route)) continue;
      if (internalRoutes.has(route)) {
        if (!internalSignal.test(source)) failures.push(`${route}: autenticazione interna assente`);
        continue;
      }
      if (!authSignal.test(source)) failures.push(`${route}: controllo autenticazione/ruolo assente`);
    }
  }
}
await visit(apiRoot);
for (const route of [...publicRoutes, ...internalRoutes]) {
  try {
    await readFile(resolve(apiRoot, ...route.split("/"), "route.ts"), "utf8");
  } catch {
    failures.push(`${route}: policy riferita a route inesistente`);
  }
}
if (failures.length) throw new Error(failures.join("\n"));
console.log(
  JSON.stringify({
    status: "passed",
    checked,
    public: publicRoutes.size,
    internal: internalRoutes.size,
    protected: checked - publicRoutes.size - internalRoutes.size,
  }),
);
