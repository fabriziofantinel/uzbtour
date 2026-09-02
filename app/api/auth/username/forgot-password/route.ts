import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthProvider } from "@/lib/auth/auth-provider";
import { enforceApiRateLimit } from "@/lib/platform/api-rate-limit";

const schema = z.object({ username: z.string().trim().min(3).max(80) });

export async function POST(request: Request) {
  const limited = await enforceApiRateLimit(request, { scope: "auth.password-reset", limit: 5, windowSeconds: 3600 });
  if (limited) return limited;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success)
    await getAuthProvider()
      .requestPasswordReset(parsed.data.username)
      .catch(() => undefined);
  return NextResponse.json({ ok: true });
}
