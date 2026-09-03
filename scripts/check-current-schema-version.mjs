import { readdir, readFile } from "node:fs/promises";

const migrationFiles = (await readdir(new URL("../database/migrations/", import.meta.url)))
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const latestFile = migrationFiles.at(-1);
if (!latestFile) throw new Error("Nessuna migrazione numerata trovata");

const expected = latestFile.replace(/\.sql$/, "");
const readiness = await readFile(new URL("../lib/platform/schema-readiness.ts", import.meta.url), "utf8");
const declared = readiness.match(/CURRENT_SCHEMA_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!declared) throw new Error("CURRENT_SCHEMA_VERSION non trovata");
if (declared !== expected) {
  throw new Error(`CURRENT_SCHEMA_VERSION non allineata: dichiarata ${declared}, ultima migrazione ${expected}`);
}

const latestMigration = await readFile(new URL(`../database/migrations/${latestFile}`, import.meta.url), "utf8");
if (!latestMigration.includes(`'${expected}'`)) {
  throw new Error(`${latestFile}: marker platform_schema_migrations non coerente con il nome del file`);
}

console.log(JSON.stringify({ status: "passed", currentSchemaVersion: declared }));
