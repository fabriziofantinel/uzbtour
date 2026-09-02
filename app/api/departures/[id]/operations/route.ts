import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { platformApiError } from "@/lib/platform/http";
import {
  assignTourLeader,
  readDepartureOperationalControl,
  recordAttendance,
  saveOperationalAlert,
} from "@/lib/platform/departure-operational-control";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assignTourLeader"), userId: z.string().min(1).max(200) }),
  z.object({
    action: z.literal("attendance"),
    dayId: z.string().uuid(),
    travelerId: z.string().uuid(),
    status: z.enum(["present", "absent", "excused"]),
    note: z.string().max(500).default(""),
  }),
  z.object({
    action: z.literal("operationalAlert"),
    travelerId: z.string().uuid(),
    summary: z.string().trim().min(3).max(500),
    instructions: z.string().max(1000).default(""),
    explicitConsent: z.literal(true),
  }),
]);

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const { id } = await context.params;
    return NextResponse.json(await readDepartureOperationalControl(user.id, id));
  } catch (error) {
    return platformApiError(error, "Operatività non disponibile");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    const { id } = await context.params,
      parsed = action.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dati operativi non validi" }, { status: 400 });
    if (parsed.data.action === "assignTourLeader") await assignTourLeader(user.id, id, parsed.data.userId);
    else if (parsed.data.action === "attendance") await recordAttendance({ actorId: user.id, ...parsed.data });
    else
      await saveOperationalAlert({
        actorId: user.id,
        departureId: id,
        travelerId: parsed.data.travelerId,
        summary: parsed.data.summary,
        instructions: parsed.data.instructions,
        consent: parsed.data.explicitConsent,
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Operazione non riuscita");
  }
}
