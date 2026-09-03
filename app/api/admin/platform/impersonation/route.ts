import { NextResponse } from "next/server";
import { z } from "zod";
import { IMPERSONATION_COOKIE } from "@/lib/current-user";
import { PlatformAuthorizationError, requireSuperAdminActor } from "@/lib/platform/authorization";
import { IMPERSONATION_DURATION_SECONDS, startImpersonation } from "@/lib/platform/impersonation";

const payloadSchema = z.object({ targetUserId: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return NextResponse.json({ error: "Origine della richiesta non valida" }, { status: 403 });
    }
    const actor = await requireSuperAdminActor();
    const payload = payloadSchema.parse(await request.json());
    const session = await startImpersonation({
      actorId: actor.nativeId,
      targetId: payload.targetUserId,
      userAgent: request.headers.get("user-agent") || undefined,
    });
    const response = NextResponse.json({ redirectUrl: session.redirectUrl });
    response.cookies.set(IMPERSONATION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: IMPERSONATION_DURATION_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Utente non valido" }, { status: 400 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Impossibile avviare la sessione",
      },
      { status: 400 },
    );
  }
}
