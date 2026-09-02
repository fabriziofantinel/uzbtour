import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";

export async function GET() {
  const startedAt = Date.now();
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    return NextResponse.json({ user });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Auth profile lookup failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      }),
    );
    return NextResponse.json({ error: "Profilo temporaneamente non disponibile" }, { status: 503 });
  }
}
