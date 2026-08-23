import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { createDepartureFromProgramme } from "@/lib/platform/programme-repository";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const startsOn = cleanText(body?.startsOn, 10);
    const endsOn = cleanText(body?.endsOn, 10);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn < startsOn) {
      return NextResponse.json({ error: "Inserisci date di partenza e rientro valide" }, { status: 400 });
    }
    const departureId = await createDepartureFromProgramme({
      templateId: id, actorId: actor.id, startsOn, endsOn,
      title: cleanText(body?.title, 240),
    });
    return NextResponse.json({ departureId }, { status: 201 });
  } catch (error) {
    return platformApiError(error, "Creazione della partenza non riuscita");
  }
}
