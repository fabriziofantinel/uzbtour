type ErrorContext = Record<string, unknown>;

function safeValue(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeValue);
  return "[redacted]";
}

export function reportServerError(error: unknown, context: ErrorContext = {}) {
  const errorId = crypto.randomUUID();
  const record = {
    level: "error",
    event: "application_error",
    errorId,
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
    errorType: error instanceof Error ? error.name : typeof error,
    digest:
      typeof error === "object" && error !== null && "digest" in error ? String(error.digest).slice(0, 200) : undefined,
    context: Object.fromEntries(Object.entries(context).map(([key, value]) => [key, safeValue(value)])),
  };
  console.error(JSON.stringify(record));
  return errorId;
}
