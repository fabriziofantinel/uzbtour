import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { addJourneyTraveler, getJourneyManagement } from "@/lib/platform/journey-repository";

const schema = z.object({
  agencyId: z.string().uuid(), partyId: z.string().uuid(), name: z.string().trim().min(2).max(160),
  email: z.email(), phone: z.string().trim().max(60).default(""),
  birthDate: z.union([z.literal(""), z.iso.date()]).default(""), role: z.enum(["organizer", "member"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireAgencyAdmin(input.agencyId);
    const current = await getJourneyManagement(id, actor.id);
    if (current.journey.agencyId !== input.agencyId || !current.families.some((family) => family.id === input.partyId)) {
      return NextResponse.json({ error: "Famiglia non valida" }, { status: 403 });
    }
    const invitation = await addJourneyTraveler({ ...input, actorId: actor.id });
    return NextResponse.json({ data: await getJourneyManagement(id, actor.id), activationToken: invitation.activationToken }, { status: 201 });
  } catch (error) { return platformApiError(error, "Inserimento del viaggiatore non riuscito"); }
}
