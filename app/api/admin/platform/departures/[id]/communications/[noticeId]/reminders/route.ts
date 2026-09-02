import { NextResponse } from "next/server";
import { z } from "zod";
import { sendCommunicationReminder } from "@/lib/auth/invitation-email";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import {
  readDepartureCommunicationRecipients,
  readDepartureCommunications,
  recordCommunicationReminder,
} from "@/lib/platform/departure-operations";
import { platformApiError } from "@/lib/platform/http";
import { sendNoticePush } from "@/lib/platform/web-push";

export const runtime = "nodejs";
const schema = z.object({ travelerId: z.string().uuid(), channel: z.enum(["push", "email"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string; noticeId: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id: departureId, noticeId } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Sollecito non valido" }, { status: 400 });
    const recipients = await readDepartureCommunicationRecipients(actor.id, noticeId);
    const recipient = recipients.find((item) => item.travelerId === parsed.data.travelerId && !item.readAt);
    if (!recipient) return NextResponse.json({ error: "Destinatario già letto o non disponibile" }, { status: 409 });
    const notice = (await readDepartureCommunications(actor.id, departureId)).find((item) => item.id === noticeId);
    if (!notice) return NextResponse.json({ error: "Comunicazione non disponibile" }, { status: 404 });
    let sent = false;
    if (parsed.data.channel === "push") {
      const result = await sendNoticePush({
        noticeId,
        departureId,
        travelerId: recipient.travelerId,
        severity: notice.severity,
        title: notice.title,
      });
      sent = result.sent > 0;
    } else {
      sent = await sendCommunicationReminder({
        email: recipient.email,
        name: recipient.name,
        communicationTitle: notice.title,
        appUrl: `${new URL(request.url).origin}/viaggio?tab=programma`,
      });
    }
    await recordCommunicationReminder({
      actorId: actor.id,
      noticeId,
      travelerId: recipient.travelerId,
      channel: parsed.data.channel,
      outcome: sent ? "sent" : "unreachable",
    });
    return NextResponse.json({ ok: sent });
  } catch (error) {
    return platformApiError(error, "Invio del sollecito non riuscito");
  }
}
