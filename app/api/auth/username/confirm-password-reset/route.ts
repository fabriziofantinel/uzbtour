import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthProvider } from "@/lib/auth/auth-provider";

const schema = z.object({
  username: z.string().trim().min(3).max(80),
  code: z.string().trim().min(4).max(12),
  password: z.string().min(10).max(256).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  try {
    await getAuthProvider().confirmPasswordReset(parsed.data.username, parsed.data.code, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Codice non valido o scaduto" }, { status: 400 });
  }
}
