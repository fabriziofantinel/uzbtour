import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { platformApiError } from "@/lib/platform/http";
import {
  assignTourLeader,
  assignDepartureStaffDays,
  clearDeparturePresence,
  inviteTourLeader,
  readDepartureOperationalControl,
  recordAttendance,
  revokeTourLeader,
  saveOperationalAlert,
  setDeparturePresence,
} from "@/lib/platform/departure-operational-control";
import { sendTravelerInvitation } from "@/lib/auth/invitation-email";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setPresence"), travelerId: z.string().uuid(), isPresent: z.boolean() }),
  z.object({ action: z.literal("clearPresence") }),
  z.object({
    action: z.literal("assignStaffDays"),
    userId: z.string().uuid(),
    role: z.enum(["agent", "accompagnatore", "guida"]),
    dayIds: z.array(z.string().uuid()).min(1).max(120),
  }),
  z.object({
    action: z.literal("assignTourLeader"),
    userId: z.string().min(1).max(200),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  }),
  z.object({
    action: z.literal("inviteTourLeader"),
    name: z.string().trim().min(2).max(160),
    username: z
      .string()
      .trim()
      .min(3)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
    email: z.email(),
    phone: z.string().trim().min(5).max(40),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime(),
  }),
  z.object({
    action: z.literal("revokeTourLeader"),
    assignmentId: z.string().uuid(),
    reason: z.string().trim().min(3).max(300),
  }),
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
    return NextResponse.json(await readDepartureOperationalControl(user.nativeId, id));
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
    let invitationEmailSent: boolean | undefined;
    if (parsed.data.action === "setPresence")
      await setDeparturePresence(user.nativeId, id, parsed.data.travelerId, parsed.data.isPresent);
    else if (parsed.data.action === "clearPresence") await clearDeparturePresence(user.nativeId, id);
    else if (parsed.data.action === "assignStaffDays")
      await assignDepartureStaffDays({ actorUserId: user.nativeId, departureId: id, ...parsed.data });
    else if (parsed.data.action === "assignTourLeader")
      await assignTourLeader(user.nativeId, id, parsed.data.userId, parsed.data.validFrom, parsed.data.validUntil);
    else if (parsed.data.action === "inviteTourLeader") {
      const invited = await inviteTourLeader({ actorUserId: user.nativeId, departureId: id, ...parsed.data });
      invitationEmailSent = false;
      if (invited.activationToken) {
        const activationUrl = new URL(
          `/attiva-account#token=${encodeURIComponent(invited.activationToken)}`,
          request.url,
        ).toString();
        invitationEmailSent = await sendTravelerInvitation({
          email: parsed.data.email,
          name: parsed.data.name,
          username: parsed.data.username,
          activationUrl,
        }).catch(() => false);
      }
    } else if (parsed.data.action === "revokeTourLeader")
      await revokeTourLeader(user.nativeId, id, parsed.data.assignmentId, parsed.data.reason);
    else if (parsed.data.action === "attendance")
      await recordAttendance({ actorUserId: user.nativeId, ...parsed.data });
    else
      await saveOperationalAlert({
        actorId: user.id,
        departureId: id,
        travelerId: parsed.data.travelerId,
        summary: parsed.data.summary,
        instructions: parsed.data.instructions,
        consent: parsed.data.explicitConsent,
      });
    return NextResponse.json({ ok: true, invitationEmailSent });
  } catch (error) {
    return platformApiError(error, "Operazione non riuscita");
  }
}
