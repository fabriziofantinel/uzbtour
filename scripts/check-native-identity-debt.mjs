import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../", import.meta.url);
const registry = JSON.parse(
  await readFile(new URL("../tests/contracts/native-identity-debt.json", import.meta.url), "utf8"),
);
const files = [];
const migrationFiles = [];

async function collect(directory) {
  for (const entry of await readdir(new URL(`${directory}/`, root), { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) await collect(path);
    else if (extname(entry.name) === ".ts") files.push(path);
  }
}

for (const directory of ["lib/platform", "app/api"]) await collect(directory);
for (const entry of await readdir(new URL("database/migrations/", root))) {
  if (entry.endsWith(".sql")) migrationFiles.push(`database/migrations/${entry}`);
}

const actual = new Map();
let occurrences = 0;
const legacyCall = /app\.([a-z0-9_]*legacy[a-z0-9_]*)\s*\(/g;
for (const file of files) {
  const source = await readFile(new URL(file, root), "utf8");
  for (const match of source.matchAll(legacyCall)) {
    occurrences += 1;
    actual.set(match[1], (actual.get(match[1]) ?? 0) + 1);
  }
}

const expected = new Map(Object.entries(registry.functions));
const violations = [];
for (const [name, count] of actual) {
  if (!expected.has(name)) violations.push(`Nuovo bridge legacy non registrato: ${name} (${count})`);
  else if (count > expected.get(name)) violations.push(`Debito ${name} aumentato: ${count} > ${expected.get(name)}`);
}
for (const [name, count] of expected) {
  const found = actual.get(name) ?? 0;
  if (found < count) violations.push(`Ridurre la baseline ${name}: registro ${count}, codice ${found}`);
}
if (occurrences > registry.maximumOccurrences) {
  violations.push(`Debito identità aumentato: ${occurrences} > ${registry.maximumOccurrences}`);
}

// Migrations are immutable, so count only the last definition seen for each
// function. This prevents historical compatibility signatures from hiding a
// newly introduced legacy actor parameter.
const effectiveFunctions = new Map();
for (const file of migrationFiles.sort()) {
  const source = await readFile(new URL(file, root), "utf8");
  const definition = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+([a-z0-9_.]+)\s*\(([\s\S]*?)\)\s*(?:RETURNS|LANGUAGE)/gi;
  for (const match of source.matchAll(definition)) {
    effectiveFunctions.set(match[1].toLowerCase(), match[2]);
  }
}
const sqlLegacyFunctions = [...effectiveFunctions.entries()]
  .filter(([, parameters]) => /p_actor_legacy(?:_user_id)?\s+(?:text|varchar)/i.test(parameters))
  .map(([name]) => name)
  .sort();
if (sqlLegacyFunctions.length > registry.maximumSqlLegacyFunctions) {
  violations.push(`Debito firme SQL aumentato: ${sqlLegacyFunctions.length} > ${registry.maximumSqlLegacyFunctions}`);
}
if (sqlLegacyFunctions.length < registry.maximumSqlLegacyFunctions) {
  violations.push(
    `Ridurre la baseline firme SQL: registro ${registry.maximumSqlLegacyFunctions}, codice ${sqlLegacyFunctions.length}`,
  );
}
if (violations.length) throw new Error(violations.join("\n"));

console.log(
  JSON.stringify({
    status: "passed",
    target: registry.targetParameter,
    legacyBridgeOccurrences: occurrences,
    registeredFunctions: expected.size,
    sqlLegacyFunctions: sqlLegacyFunctions.length,
  }),
);
