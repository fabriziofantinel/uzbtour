import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { addJourneyTraveler, getJourneyManagement } from "@/lib/platform/journey-repository";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";

const schema = z.object({
  agencyId: z.string().uuid(), partyId: z.string().uuid(), name: z.string().trim().min(2).max(160),
  username: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
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
    let invitationEmailSent = false;
    if (invitation.activationToken) {
      const activationUrl = new URL(`/attiva-account#token=${encodeURIComponent(invitation.activationToken)}`, request.url).toString();
      invitationEmailSent = await sendTravelerInvitation({
        email: input.email,
        name: input.name,
        username: input.username,
        activationUrl,
      }).catch((error) => {
        console.error("Traveler invitation email failed", error instanceof Error ? error.name : "unknown");
        return false;
      });
    }
    return NextResponse.json({ data: await getJourneyManagement(id, actor.id), activationToken: invitation.activationToken, invitationEmailSent }, { status: 201 });
  } catch (error) { return platformApiError(error, "Inserimento del viaggiatore non riuscito"); }
}
