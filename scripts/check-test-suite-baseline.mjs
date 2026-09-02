import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const baseline = JSON.parse(await readFile(resolve(root, "tests/contracts/test-suite-baseline.json"), "utf8"));
const unitFiles = (await readdir(resolve(root, "tests/unit"))).filter((name) => name.endsWith(".test.ts"));
const countCases = async (paths) => {
  let count = 0;
  for (const path of paths) {
    const source = await readFile(resolve(root, path), "utf8");
    count += [...source.matchAll(/\b(?:it|test)\s*\(/g)].length;
  }
  return count;
};
const unitCases = await countCases(unitFiles.map((name) => `tests/unit/${name}`));
const e2eFiles = (await readdir(resolve(root, "tests/e2e")))
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => `tests/e2e/${name}`);
const e2eCases = await countCases(e2eFiles);
const missingAcceptanceScripts = [];
for (const script of baseline.requiredAcceptanceScripts) {
  await readFile(resolve(root, script), "utf8").catch(() => missingAcceptanceScripts.push(script));
}

if (
  unitFiles.length < baseline.unitFiles ||
  unitCases < baseline.unitCases ||
  e2eCases < baseline.e2eCases ||
  missingAcceptanceScripts.length > 0
) {
  throw new Error(
    `Baseline test ridotta: ${JSON.stringify({ unitFiles: unitFiles.length, unitCases, e2eCases, missingAcceptanceScripts, baseline })}`,
  );
}
console.log(JSON.stringify({ status: "passed", unitFiles: unitFiles.length, unitCases, e2eCases }));
