import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth/cognito";

const schema = z.object({ username: z.string().trim().min(3).max(80) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success) await requestPasswordReset(parsed.data.username).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
