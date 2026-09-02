import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export type ApiRateLimitPolicy = { scope: string; limit: number; windowSeconds: number };

function requestIdentity(request: Request, principal?: string) {
  if (principal) return `principal:${principal}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `network:${address}`;
}

export async function enforceApiRateLimit(request: Request, policy: ApiRateLimitPolicy, principal?: string) {
  const keyHash = createHash("sha256").update(requestIdentity(request, principal)).digest("hex");
  const rows = await getSql()`SELECT allowed,remaining,retry_after_seconds
    FROM app.consume_api_rate_limit_v3(${policy.scope},${keyHash},${policy.limit},${policy.windowSeconds})`;
  const result = rows[0];
  if (result?.allowed === true) return null;
  const retryAfter = Math.max(1, Number(result?.retry_after_seconds) || policy.windowSeconds);
  return NextResponse.json(
    { code: "RATE_LIMITED", error: "Troppe richieste. Riprova più tardi." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    },
  );
}
