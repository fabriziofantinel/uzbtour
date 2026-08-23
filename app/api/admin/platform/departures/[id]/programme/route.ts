import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { cleanText, platformApiError } from "@/lib/platform/http";
import { updateAgencyProgrammeDay } from "@/lib/platform/programme-repository";

export const runtime = "nodejs";

const uuid = /^[0-9a-f-]{36}$/i;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const dayId = cleanText(body?.dayId, 64);
    if (!uuid.test(id) || !uuid.test(dayId)) {
      return NextResponse.json({ error: "Partenza o giornata non valida" }, { status: 400 });
    }
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    const rawHotels = Array.isArray(body?.hotels) ? body.hotels : [];
    const items = rawItems.map((entry, index) => {
      const item = entry as Record<string, unknown>;
      return {
        id: cleanText(item.id, 64), title: cleanText(item.title, 240),
        description: cleanText(item.description, 4000), startsAt: cleanText(item.startsAt, 5),
        endsAt: cleanText(item.endsAt, 5), sortOrder: index,
      };
    });
    const hotels = rawHotels.map((entry, index) => {
      const hotel = entry as Record<string, unknown>;
      return {
        id: cleanText(hotel.id, 64), name: cleanText(hotel.name, 240),
        notes: cleanText(hotel.notes, 2000), sortOrder: index,
      };
    });
    if (items.some((item) => !uuid.test(item.id) || item.title.length < 1) ||
        hotels.some((hotel) => !uuid.test(hotel.id) || hotel.name.length < 1)) {
      return NextResponse.json({ error: "Titoli e alberghi non possono essere vuoti" }, { status: 400 });
    }
    await updateAgencyProgrammeDay({
      departureId: id, dayId, actorId: actor.id,
      label: cleanText(body?.label, 240), title: cleanText(body?.title, 240),
      city: cleanText(body?.city, 160), description: cleanText(body?.description, 5000),
      items, hotels,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Aggiornamento della giornata non riuscito");
  }
}
