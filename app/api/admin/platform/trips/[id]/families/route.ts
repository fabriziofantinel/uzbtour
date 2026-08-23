import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { createJourneyFamily, getJourneyManagement } from "@/lib/platform/journey-repository";

const schema = z.object({ agencyId: z.string().uuid(), name: z.string().trim().min(2).max(160) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireAgencyAdmin(input.agencyId);
    const current = await getJourneyManagement(id, actor.id);
    if (current.journey.agencyId !== input.agencyId) return NextResponse.json({ error: "Agenzia non valida" }, { status: 403 });
    const familyId = await createJourneyFamily({ departureId: id, agencyId: input.agencyId, name: input.name, actorId: actor.id });
    return NextResponse.json({ familyId, data: await getJourneyManagement(id, actor.id) }, { status: 201 });
  } catch (error) { return platformApiError(error, "Creazione della famiglia non riuscita"); }
}
