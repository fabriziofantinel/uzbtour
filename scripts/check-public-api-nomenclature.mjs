import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiRoot = resolve(root, "app/api");
const clientRoots = [resolve(root, "app"), resolve(root, "components"), resolve(root, "lib")];
const failures = [];

async function visit(directory, inspectSource) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === "families" && absolute.startsWith(apiRoot)) {
        failures.push(`${relative(root, absolute)}: usare il segmento pubblico groups`);
      }
      await visit(absolute, inspectSource);
      continue;
    }
    if (!inspectSource || !/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const source = await readFile(absolute, "utf8");
    if (/\/api\/[^\s"'`]*\/families(?:[\s/"'`]|$)/.test(source)) {
      failures.push(`${relative(root, absolute)}: consumer della route pubblica families`);
    }
    if (/\bfamilies\s*:|\.families\b/.test(source)) {
      failures.push(`${relative(root, absolute)}: chiave pubblica families, usare groups`);
    }
  }
}

await visit(apiRoot, false);
for (const directory of clientRoots) await visit(directory, true);

if (failures.length) throw new Error(failures.join("\n"));
console.log(JSON.stringify({ status: "passed", preferredTerm: "groups", retiredTerm: "families" }));
