import { readFile } from "node:fs/promises";

const runtimeFiles = [
  new URL("../lib/platform/v3-expenses.ts", import.meta.url),
  new URL("../lib/platform/v3-journey-journal.ts", import.meta.url),
  new URL("../lib/platform/v3-programme-feedback.ts", import.meta.url),
  new URL("../lib/platform/v3-traveler-experience.ts", import.meta.url),
  new URL("../lib/platform/v3-travel-catalog.ts", import.meta.url),
  new URL("../lib/platform/v3-traveler-scope.ts", import.meta.url),
  new URL("../lib/platform/v3-media-download.ts", import.meta.url),
  new URL("../lib/platform/v3-media-mutations.ts", import.meta.url),
];

const forbiddenPatterns = [
  /\b(?:FROM|JOIN)\s+ops\.legacy_id_map\b/i,
  /\bSELECT\b[\s\S]*?\bops\.legacy_id_map\b/i,
];

const violations = [];

for (const file of runtimeFiles) {
  const source = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      violations.push(`${file.pathname}: accesso diretto a ops.legacy_id_map`);
      break;
    }
  }
}

if (violations.length > 0) {
  throw new Error(violations.join("\n"));
}

console.log(JSON.stringify({ status: "passed", checkedFiles: runtimeFiles.length }));
