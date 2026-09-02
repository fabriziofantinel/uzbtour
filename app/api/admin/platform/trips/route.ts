import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { createTripTemplate } from "@/lib/platform/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const agencyId = cleanText(body?.agencyId, 64);
    const title = cleanText(body?.title, 240);
    const destinationCountry = cleanText(body?.destinationCountry, 120);
    const timezone = cleanText(body?.timezone, 80) || "UTC";

    if (!agencyId || title.length < 3) {
      return NextResponse.json({ error: "Agenzia e titolo del viaggio sono obbligatori" }, { status: 400 });
    }
    try {
      new Intl.DateTimeFormat("it-IT", { timeZone: timezone }).format(new Date());
    } catch {
      return NextResponse.json({ error: "Fuso orario non valido" }, { status: 400 });
    }

    const actor = await requireAgencyAdmin(agencyId);
    const trip = await createTripTemplate({
      agencyId,
      title,
      destinationCountry,
      timezone,
      actorId: actor.id,
    });
    return NextResponse.json({ trip }, { status: 201 });
  } catch (error) {
    return platformApiError(error, "Creazione del viaggio non riuscita");
  }
}
