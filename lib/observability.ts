import { getSql } from "./db";

type ErrorContext = Record<string, unknown>;

export type ServerErrorReport = {
  errorId: string;
  record: Record<string, unknown>;
  persistence: {
    environment: string;
    deploymentId?: string;
    errorType: string;
    fingerprint: string;
    digest?: string;
    traceId?: string;
    layer?: string;
    routePath?: string;
    method?: string;
    context: Record<string, unknown>;
  };
};

function safeValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeValue);
  return "[redacted]";
}

function fingerprintText(value: string) {
  return Array.from({ length: 8 }, (_, seed) => {
    let hash = (0x811c9dc5 ^ seed) >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }).join("");
}

export function createServerErrorReport(error: unknown, context: ErrorContext = {}): ServerErrorReport {
  const errorId = crypto.randomUUID();
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  const errorType = error instanceof Error ? error.name : typeof error;
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String(error.digest).slice(0, 200) : undefined;
  const safeContext = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, safeValue(value)]));
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown";
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined;
  const record = {
    level: "error",
    event: "application_error",
    errorId,
    timestamp: new Date().toISOString(),
    environment,
    deploymentId,
    message,
    errorType,
    digest,
    context: safeContext,
  };
  console.error(JSON.stringify(record));
  return {
    errorId,
    record,
    persistence: {
      environment,
      deploymentId,
      errorType,
      fingerprint: fingerprintText(`${errorType}\n${digest ?? ""}\n${message}`),
      digest,
      traceId: typeof context.traceId === "string" ? context.traceId : undefined,
      layer: typeof context.layer === "string" ? context.layer : undefined,
      routePath: typeof context.routePath === "string" ? context.routePath : undefined,
      method: typeof context.method === "string" ? context.method : undefined,
      context: safeContext,
    },
  };
}

export async function persistServerError(report: ServerErrorReport) {
  const item = report.persistence;
  await getSql()`SELECT app.record_application_error_v3(
    ${report.errorId}::uuid,${item.environment},${item.deploymentId || null},${item.errorType},
    ${item.fingerprint},${item.digest || null},${item.traceId || null}::uuid,${item.layer || null},
    ${item.routePath || null},${item.method || null},${JSON.stringify(item.context)}::jsonb
  )`;
}

export function reportServerError(error: unknown, context: ErrorContext = {}) {
  return createServerErrorReport(error, context).errorId;
}
