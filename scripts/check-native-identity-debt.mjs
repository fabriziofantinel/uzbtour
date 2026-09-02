import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../", import.meta.url);
const registry = JSON.parse(
  await readFile(new URL("../tests/contracts/native-identity-debt.json", import.meta.url), "utf8"),
);
const files = [];

async function collect(directory) {
  for (const entry of await readdir(new URL(`${directory}/`, root), { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) await collect(path);
    else if (extname(entry.name) === ".ts") files.push(path);
  }
}

for (const directory of ["lib/platform", "app/api"]) await collect(directory);

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
if (violations.length) throw new Error(violations.join("\n"));

console.log(
  JSON.stringify({
    status: "passed",
    target: registry.targetParameter,
    legacyBridgeOccurrences: occurrences,
    registeredFunctions: expected.size,
  }),
);
