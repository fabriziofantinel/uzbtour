import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import {
  closeDepartureCommunication,
  publishDepartureCommunication,
  publishStaffDepartureCommunication,
  readDepartureCommunicationRecipients,
  readDepartureCommunications,
} from "@/lib/platform/departure-operations";
import { platformApiError } from "@/lib/platform/http";
import { sendNoticePush } from "@/lib/platform/web-push";

export const runtime = "nodejs";

const publishSchema = z.object({
  title: z.string().trim().min(2).max(180),
  summary: z.string().trim().min(2).max(5000),
  severity: z.enum(["information", "important", "urgent"]),
  requiresAcknowledgement: z.boolean(),
  acknowledgeBy: z.string().datetime().nullable(),
  audiencePartyIds: z.array(z.string().uuid()).max(100),
  audienceTravelerIds: z.array(z.string().uuid()).max(500),
  audienceStaffRole: z.enum(["accompagnatore", "guida"]).nullable().optional(),
  clientOperationId: z.string().uuid(),
});
const closeSchema = z.object({ noticeId: z.string().uuid(), closureNote: z.string().trim().min(3).max(1000) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const noticeId = new URL(request.url).searchParams.get("noticeId");
    if (noticeId)
      return NextResponse.json({ recipients: await readDepartureCommunicationRecipients(actor.id, noticeId) });
    return NextResponse.json({ communications: await readDepartureCommunications(actor.id, id) });
  } catch (error) {
    return platformApiError(error, "Lettura delle comunicazioni non riuscita");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const parsed = publishSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Comunicazione non valida" }, { status: 400 });
    if (parsed.data.requiresAcknowledgement && !parsed.data.acknowledgeBy)
      return NextResponse.json({ error: "Indica la scadenza della presa visione" }, { status: 400 });
    const noticeId = parsed.data.audienceStaffRole
      ? await publishStaffDepartureCommunication({
          actorId: actor.nativeId,
          departureId: id,
          staffRole: parsed.data.audienceStaffRole,
          title: parsed.data.title,
          summary: parsed.data.summary,
          severity: parsed.data.severity,
          requiresAcknowledgement: parsed.data.requiresAcknowledgement,
          acknowledgeBy: parsed.data.acknowledgeBy,
          clientOperationId: parsed.data.clientOperationId,
        })
      : await publishDepartureCommunication({ actorId: actor.id, departureId: id, ...parsed.data });
    if (!parsed.data.audienceStaffRole)
      after(() =>
        sendNoticePush({
          noticeId,
          departureId: id,
          severity: parsed.data.severity,
          title: parsed.data.title,
        }).catch((error) =>
          console.error("Communication push failed", error instanceof Error ? error.name : "unknown"),
        ),
      );
    return NextResponse.json({ noticeId, communications: await readDepartureCommunications(actor.id, id) });
  } catch (error) {
    return platformApiError(error, "Pubblicazione della comunicazione non riuscita");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const parsed = closeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Nota di chiusura non valida" }, { status: 400 });
    await closeDepartureCommunication(actor.id, parsed.data.noticeId, parsed.data.closureNote);
    return NextResponse.json({ communications: await readDepartureCommunications(actor.id, id) });
  } catch (error) {
    return platformApiError(error, "Chiusura della comunicazione non riuscita");
  }
}
