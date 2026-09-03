import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type AiTestMode = "live" | "record" | "replay";

type ReplayEnvelope<T> = {
  version: 1;
  scenario: string;
  recordedAt: string;
  value: T;
};

function mode(): AiTestMode {
  // Fail closed: an omitted mode must never trigger a paid model invocation.
  const value = (process.env.AI_TEST_MODE || "replay").trim().toLowerCase();
  if (value === "live" || value === "record" || value === "replay") return value;
  throw new Error(`AI_TEST_MODE non valido: ${value}`);
}

function fixturePath(scenario: string) {
  if (!/^[a-z0-9][a-z0-9-]+$/.test(scenario)) throw new Error(`Scenario replay non valido: ${scenario}`);
  const root = process.env.AI_TEST_FIXTURE_DIR?.trim() || path.resolve("tests/fixtures/ai-replay");
  return path.join(root, `${scenario}.json`);
}

export async function withAiTestReplay<T>(scenario: string, live: () => Promise<T>): Promise<T> {
  const selectedMode = mode();
  const target = fixturePath(scenario);
  if (selectedMode === "replay") {
    const envelope = JSON.parse(await readFile(target, "utf8")) as ReplayEnvelope<T>;
    if (envelope.version !== 1 || envelope.scenario !== scenario || envelope.value == null) {
      throw new Error(`Fixture AI non valida: ${target}`);
    }
    return envelope.value;
  }

  const value = await live();
  if (selectedMode === "record") {
    if (process.env.AI_TEST_RECORD_CONFIRM !== "1") {
      throw new Error("La registrazione delle fixture AI richiede AI_TEST_RECORD_CONFIRM=1");
    }
    const envelope: ReplayEnvelope<T> = { version: 1, scenario, recordedAt: new Date().toISOString(), value };
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }
  return value;
}
