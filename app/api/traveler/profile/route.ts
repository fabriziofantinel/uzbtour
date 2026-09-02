import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { transferOwnGroupLeadership, updateOwnTripCompetition } from "@/lib/platform/v3-traveler-profile-mutations";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("competition"),
    departureId: z.string().uuid(),
    partyId: z.string().uuid(),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("leader"),
    departureId: z.string().uuid(),
    partyId: z.string().uuid(),
    travelerId: z.string().uuid(),
  }),
]);

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    if (input.action === "competition")
      await updateOwnTripCompetition({
        userId: user.id,
        departureId: input.departureId,
        partyId: input.partyId,
        enabled: input.enabled,
      });
    else
      await transferOwnGroupLeadership({
        userId: user.id,
        departureId: input.departureId,
        partyId: input.partyId,
        travelerId: input.travelerId,
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Aggiornamento non riuscito";
    if (/only the current group leader/i.test(message))
      return NextResponse.json({ error: "Solo il capogruppo può cedere il ruolo" }, { status: 403 });
    if (/adult group member/i.test(message))
      return NextResponse.json({ error: "Il nuovo capogruppo deve essere un adulto del gruppo" }, { status: 400 });
    return NextResponse.json({ error: "Aggiornamento del profilo non riuscito" }, { status: 400 });
  }
}
