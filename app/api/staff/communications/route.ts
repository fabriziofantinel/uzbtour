import { NextResponse } from "next/server";
import { z } from "zod";
import { acknowledgeStaffCommunication, readDepartureCommunications } from "@/lib/platform/departure-operations";
import { requireDepartureOperator } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";

const payloadSchema = z.object({
  departureId: z.string().uuid(),
  noticeId: z.string().uuid(),
  clientOperationId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Comunicazione non valida" }, { status: 400 });
    const actor = await requireDepartureOperator(parsed.data.departureId);
    const notices = await readDepartureCommunications(actor.id, parsed.data.departureId, actor.nativeId);
    if (
      !notices.some(
        (notice) => notice.id === parsed.data.noticeId && notice.audienceKind === "staff" && notice.isRecipient,
      )
    )
      return NextResponse.json({ error: "Comunicazione non disponibile" }, { status: 404 });
    const acknowledged = await acknowledgeStaffCommunication(
      actor.nativeId,
      parsed.data.noticeId,
      parsed.data.clientOperationId,
    );
    return NextResponse.json({ acknowledged });
  } catch (error) {
    return platformApiError(error, "Presa visione non riuscita");
  }
}
