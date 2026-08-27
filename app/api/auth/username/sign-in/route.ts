import { NextResponse } from "next/server";
import { z } from "zod";
import { isCognitoConfigured, setCognitoCookies, signInWithUsername } from "@/lib/auth/cognito";

const schema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Credenziali non valide" }, { status: 400 });
  if (!isCognitoConfigured()) return NextResponse.json({ error: "Autenticazione in configurazione" }, { status: 503 });
  try {
    const result = await signInWithUsername(parsed.data.username, parsed.data.password);
    const response = NextResponse.json({ ok: true });
    setCognitoCookies(response, result);
    return response;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const status = name === "TooManyRequestsException" ? 429 : 401;
    return NextResponse.json({ error: status === 429 ? "Troppi tentativi" : "Username o password non corretti" }, { status });
  }
}
