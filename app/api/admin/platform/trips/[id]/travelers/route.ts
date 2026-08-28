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
  birthDate: z.union([z.literal(""), z.iso.date()]).default(""),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireAgencyAdmin(input.agencyId);
    const current = await getJourneyManagement(id, actor.id);
    const group = current.families.find((family) => family.id === input.partyId);
    if (current.journey.agencyId !== input.agencyId || !group) {
      return NextResponse.json({ error: "Gruppo non valido" }, { status: 403 });
    }
    const firstTraveler = group.travelers.length === 0;
    if (firstTraveler && input.birthDate) {
      const eighteenthBirthday = new Date(`${input.birthDate}T12:00:00Z`);
      eighteenthBirthday.setUTCFullYear(eighteenthBirthday.getUTCFullYear() + 18);
      if (eighteenthBirthday > new Date(`${current.journey.startsOn}T12:00:00Z`)) {
        return NextResponse.json({ error: "Il primo viaggiatore deve essere adulto perché diventerà capogruppo" }, { status: 400 });
      }
    }
    const invitation = await addJourneyTraveler({ ...input, role: firstTraveler ? "organizer" : "member", actorId: actor.id });
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
    return NextResponse.json({ data: await getJourneyManagement(id, actor.id), travelerId: invitation.travelerId, activationToken: invitation.activationToken, invitationEmailSent }, { status: 201 });
  } catch (error) { return platformApiError(error, "Inserimento del viaggiatore non riuscito"); }
}
