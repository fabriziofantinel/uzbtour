import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { resolveTravelerContext } from "@/lib/platform/traveler-experience";
import { assertArchitectureHardeningSchema, assertProgrammeFeedbackSchema } from "@/lib/platform/schema-readiness";
import { saveTravelerProgrammeFeedbackV3 } from "@/lib/platform/v3-feedback-mutations";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    await assertProgrammeFeedbackSchema();
    await assertArchitectureHardeningSchema();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const departureId = String(body?.departureId || "");
    const partyId = String(body?.partyId || "");
    const dayId = String(body?.dayId || "");
    const targetId = String(body?.targetId || "");
    const targetType = String(body?.targetType || "");
    const rating = Number(body?.rating);
    const clientOperationId = body?.clientOperationId == null
      ? crypto.randomUUID()
      : String(body.clientOperationId);
    if (!/^[0-9a-f-]{36}$/i.test(clientOperationId) || !['itinerary_item', 'hotel'].includes(targetType) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Valutazione non valida" }, { status: 400 });
    }
    const context = await resolveTravelerContext({ userId: user.id, departureId, partyId, dayId });
    if (!context) return NextResponse.json({ error: "Viaggiatore non disponibile" }, { status: 403 });
    const agencyId = context.agencyId;
    const feedback = await saveTravelerProgrammeFeedbackV3({
        agencyId,
        userId: user.id,
        departureId,
        partyId,
        dayId,
        targetId,
        targetType: targetType as "itinerary_item" | "hotel",
        rating,
        clientOperationId,
      });
    return NextResponse.json({ feedback });
  } catch (error) {
    console.error("Salvataggio valutazione programma non riuscito", error);
    return NextResponse.json({ error: "Valutazione non salvata" }, { status: 503 });
  }
}
