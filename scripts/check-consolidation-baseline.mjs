import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const immutableMigrationMax = 59;
const expected = {
  database: { count: 45, digest: "8e3010cd3035f2fe7ab8d71db5d4524eb4650d9288cf35f2f279098e3439f69b" },
  layout: { count: 69, digest: "eecf2cb19e596cfccb3180ad19def21268be6144d74ef61cfac05a5a1f0a34f8" },
};

async function filesBelow(directory, predicate) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (predicate(absolute)) result.push(absolute);
    }
  }
  await visit(directory);
  return result;
}

async function fingerprint(files) {
  const entries = [];
  for (const absolute of files.sort()) {
    const path = relative(root, absolute).replaceAll("\\", "/");
    const normalized = (await readFile(absolute, "utf8")).replaceAll("\r\n", "\n");
    const hash = createHash("sha256").update(normalized).digest("hex");
    entries.push({ path, hash });
  }
  const digest = createHash("sha256")
    .update(entries.map((entry) => `${entry.path}\0${entry.hash}\n`).join(""))
    .digest("hex");
  return { count: entries.length, digest, files: entries.map((entry) => entry.path) };
}

const migrations = await filesBelow(resolve(root, "database/migrations"), (absolute) => {
  const match = absolute.replaceAll("\\", "/").match(/\/(\d{3})_[^/]+\.sql$/);
  return Boolean(match && Number(match[1]) <= immutableMigrationMax);
});
const appFiles = await filesBelow(resolve(root, "app"), (absolute) => {
  const path = relative(root, absolute).replaceAll("\\", "/");
  return !path.startsWith("app/api/") && (path.endsWith(".tsx") || path.endsWith(".css"));
});
const database = await fingerprint(migrations);
const layout = await fingerprint([resolve(root, "DESIGN.md"), resolve(root, "PRODUCT.md"), ...appFiles]);
const report = { immutableMigrationMax, database, layout };

if (process.argv.includes("--report")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const failures = [];
for (const area of ["database", "layout"]) {
  if (report[area].count !== expected[area].count || report[area].digest !== expected[area].digest) {
    failures.push(
      `${area}: baseline modificata (atteso ${expected[area].count}/${expected[area].digest}, rilevato ${report[area].count}/${report[area].digest})`,
    );
  }
}
if (failures.length)
  throw new Error(
    `${failures.join("\n")}\nEseguire npm run quality:baseline:report e aggiornare la baseline solo dopo approvazione esplicita.`,
  );
console.log(JSON.stringify({ status: "passed", database: expected.database, layout: expected.layout }));
