import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { platformApiError } from "@/lib/platform/http";
import { recordTravelerAnalytics } from "@/lib/platform/agency-analytics";

const inputSchema = z.object({
  departureId: z.string().uuid(),
  partyId: z.string().uuid(),
  dayId: z.string().uuid().nullable().optional(),
  eventName: z.enum(["traveler_session", "programme_view", "document_list_view", "document_download"]),
  sessionId: z.string().uuid(),
  clientOperationId: z.string().uuid(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const parsed = inputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Evento analytics non valido" }, { status: 400 });
    const id = await recordTravelerAnalytics({ userId: user.id, ...parsed.data });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return platformApiError(error, "Analytics non disponibile");
  }
}
