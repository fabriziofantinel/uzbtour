import { spawnSync } from "node:child_process";
import path from "node:path";

const mode = process.argv[2] || "replay";
if (!new Set(["live", "record", "replay"]).has(mode)) throw new Error(`Modalità AI non valida: ${mode}`);
if (mode === "record" && process.env.AI_TEST_RECORD_CONFIRM !== "1") {
  throw new Error("Usare AI_TEST_RECORD_CONFIRM=1 per aggiornare intenzionalmente le fixture AI");
}

const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
const scenarios = [
  "scripts/acceptance-bedrock-travel-import.ts",
  "scripts/acceptance-bedrock-travel-import-matrix.ts",
  "scripts/acceptance-bedrock-reference-content.ts",
  "scripts/acceptance-photo-ai-synthetic-dataset.ts",
  "scripts/acceptance-travel-import-quality.ts",
];

for (const scenario of scenarios) {
  const result = spawnSync(process.execPath, [tsxCli, scenario], {
    cwd: process.cwd(),
    env: { ...process.env, AI_TEST_MODE: mode },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Scenario AI fallito: ${scenario}`);
}

console.log(JSON.stringify({ status: "passed", mode, scenarios: scenarios.length }));
