import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import {
  deleteJourneyGroup,
  getJourneyManagement,
  removeJourneyTraveler,
  setJourneyGroupLeader,
  setMinorImageConsent,
  updateJourneyGroupCompetition,
} from "@/lib/platform/journey-repository";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("competition"),
    agencyId: z.string().uuid(),
    travelerId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal("leader"), agencyId: z.string().uuid(), travelerId: z.string().uuid() }),
  z.object({
    action: z.literal("minorConsent"),
    agencyId: z.string().uuid(),
    travelerId: z.string().uuid(),
    decision: z.enum(["granted", "denied", "withdrawn"]),
  }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  try {
    const { id, partyId } = await params;
    const input = schema.parse(await request.json());
    const actor = await requireAgencyAdmin(input.agencyId);
    const current = await getJourneyManagement(id, actor.id);
    const group = current.families.find((family) => family.id === partyId);
    if (current.journey.agencyId !== input.agencyId || !group) {
      return NextResponse.json({ error: "Gruppo non valido" }, { status: 403 });
    }
    if (input.action === "minorConsent") {
      const traveler = group.travelers.find((item) => item.id === input.travelerId);
      if (!traveler || traveler.memberType !== "dependent_minor")
        return NextResponse.json({ error: "Il consenso è previsto solo per un minore del gruppo" }, { status: 400 });
      await setMinorImageConsent({
        actorId: actor.id,
        agencyId: input.agencyId,
        departureId: id,
        partyId,
        travelerId: input.travelerId,
        decision: input.decision,
      });
    } else if (input.action === "leader") {
      if (!group.travelers.some((traveler) => traveler.id === input.travelerId)) {
        return NextResponse.json({ error: "Il capogruppo deve appartenere al gruppo" }, { status: 400 });
      }
      await setJourneyGroupLeader({
        actorId: actor.id,
        agencyId: input.agencyId,
        departureId: id,
        partyId,
        travelerId: input.travelerId,
      });
    } else {
      if (!group.travelers.some((traveler) => traveler.id === input.travelerId)) {
        return NextResponse.json({ error: "Il viaggiatore deve appartenere al gruppo" }, { status: 400 });
      }
      await updateJourneyGroupCompetition({
        actorId: actor.id,
        agencyId: input.agencyId,
        departureId: id,
        partyId,
        travelerId: input.travelerId,
        enabled: input.enabled,
      });
    }
    return NextResponse.json({ data: await getJourneyManagement(id, actor.id) });
  } catch (error) {
    return platformApiError(error, "Aggiornamento del gruppo non riuscito");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; partyId: string }> }) {
  try {
    const { id, partyId } = await params;
    const input = z
      .object({ agencyId: z.string().uuid(), travelerId: z.string().uuid().optional() })
      .parse(await request.json());
    const actor = await requireAgencyAdmin(input.agencyId);
    const current = await getJourneyManagement(id, actor.id);
    const group = current.families.find((item) => item.id === partyId);
    if (current.journey.agencyId !== input.agencyId || !group)
      return NextResponse.json({ error: "Gruppo non valido" }, { status: 403 });
    if (input.travelerId) {
      if (!group.travelers.some((item) => item.id === input.travelerId))
        return NextResponse.json({ error: "Viaggiatore non valido" }, { status: 404 });
      await removeJourneyTraveler({
        actorId: actor.id,
        agencyId: input.agencyId,
        departureId: id,
        partyId,
        travelerId: input.travelerId,
      });
    } else await deleteJourneyGroup({ actorId: actor.id, agencyId: input.agencyId, departureId: id, partyId });
    return NextResponse.json({ data: await getJourneyManagement(id, actor.id) });
  } catch (error) {
    return platformApiError(error, "Eliminazione non riuscita");
  }
}
