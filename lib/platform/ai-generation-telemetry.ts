import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { TokenUsage } from "@aws-sdk/client-bedrock-runtime";
import { getSql } from "@/lib/db";

type Entry = {
  model: string;
  operation: string;
  region: string;
  promptHash: string;
  inputTokens: number;
  outputTokens: number;
};

type Context = { agencyId: string; platformJobId: string; entries: Entry[] };
const storage = new AsyncLocalStorage<Context>();

function hashable(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { bytes: value.byteLength, sha256: createHash("sha256").update(value).digest("hex") };
  }
  if (Array.isArray(value)) return value.map(hashable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, hashable(item)]),
    );
  }
  return value;
}

export function captureBedrockGeneration(input: {
  model: string;
  operation: string;
  region: string;
  prompt: unknown;
  usage?: TokenUsage;
}) {
  const context = storage.getStore();
  if (!context) return;
  context.entries.push({
    model: input.model,
    operation: input.operation,
    region: input.region,
    promptHash: createHash("sha256")
      .update(JSON.stringify(hashable(input.prompt)))
      .digest("hex"),
    inputTokens: input.usage?.inputTokens ?? 0,
    outputTokens: input.usage?.outputTokens ?? 0,
  });
}

async function persist(context: Context, status: "completed" | "failed", errorMessage: string | null = null) {
  if (context.entries.length === 0) return;
  const grouped = new Map<string, Entry & { invocationCount: number }>();
  for (const entry of context.entries) {
    const key = `${entry.model}\0${entry.operation}\0${entry.region}\0${entry.promptHash}`;
    const current = grouped.get(key);
    if (current) {
      current.inputTokens += entry.inputTokens;
      current.outputTokens += entry.outputTokens;
      current.invocationCount += 1;
    } else grouped.set(key, { ...entry, invocationCount: 1 });
  }
  const sql = getSql();
  await sql.transaction((txn) =>
    [...grouped.values()].map(
      (entry) => txn`SELECT app.record_ai_generation_v3(${context.agencyId},${context.platformJobId},
        'amazon-bedrock',${entry.model},${entry.operation},${entry.region},${entry.promptHash},${status},
        ${entry.inputTokens},${entry.outputTokens},${entry.invocationCount},${errorMessage})`,
    ),
  );
}

export async function withAiGenerationTelemetry<T>(context: Omit<Context, "entries">, action: () => Promise<T>) {
  const active = { ...context, entries: [] as Entry[] };
  return storage.run(active, async () => {
    try {
      const result = await action();
      await persist(active, "completed");
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      try {
        await persist(active, "failed", errorMessage);
      } catch (persistenceError) {
        console.error("AI failure telemetry persistence failed", {
          platformJobId: context.platformJobId,
          error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
        });
      }
      throw error;
    }
  });
}
