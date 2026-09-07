import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import {
  readDepartureInsurance,
  readDepartureInsuranceScoped,
  saveDepartureInsurance,
} from "@/lib/platform/departure-operations";
import { platformApiError } from "@/lib/platform/http";

const guaranteeSchema = z.object({
  label: z.string().trim().min(1).max(160),
  status: z.enum(["included", "excluded", "not_indicated"]),
  notes: z.string().trim().max(1000),
});
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("insurance"),
    providerName: z.string().trim().min(2).max(180),
    productName: z.string().trim().max(180),
    policyNumber: z.string().trim().min(1).max(120),
    assistancePhone: z.string().trim().min(3).max(80),
    validFrom: z.iso.date(),
    validTo: z.iso.date(),
    guarantees: z.array(guaranteeSchema).max(30),
    documentId: z.string().uuid().nullable(),
    audienceScope: z.enum(["trip", "group", "traveler"]),
    partyId: z.string().uuid().nullable(),
    travelerId: z.string().uuid().nullable(),
  }),
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const url = new URL(_request.url);
    const audienceScope = z
      .enum(["trip", "group", "traveler"])
      .catch("trip")
      .parse(url.searchParams.get("audienceScope"));
    const partyId = z.string().uuid().nullable().catch(null).parse(url.searchParams.get("partyId"));
    const travelerId = z.string().uuid().nullable().catch(null).parse(url.searchParams.get("travelerId"));
    const insurance =
      audienceScope === "trip"
        ? await readDepartureInsurance(actor.nativeId, id)
        : await readDepartureInsuranceScoped({
            actorNativeId: actor.nativeId,
            departureId: id,
            audienceScope,
            partyId,
            travelerId,
          });
    return NextResponse.json({ insurance });
  } catch (error) {
    return platformApiError(error, "Configurazione della partenza non disponibile");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
    if (parsed.data.validTo < parsed.data.validFrom)
      return NextResponse.json({ error: "La validità finale precede quella iniziale" }, { status: 400 });
    const partyId = parsed.data.audienceScope === "trip" ? null : parsed.data.partyId;
    const travelerId = parsed.data.audienceScope === "traveler" ? parsed.data.travelerId : null;
    if ((parsed.data.audienceScope !== "trip" && !partyId) || (parsed.data.audienceScope === "traveler" && !travelerId))
      return NextResponse.json({ error: "Seleziona i destinatari della polizza" }, { status: 400 });
    await saveDepartureInsurance({
      actorNativeId: actor.nativeId,
      departureId: id,
      ...parsed.data,
      partyId,
      travelerId,
    });
    return NextResponse.json({
      insurance: await readDepartureInsuranceScoped({
        actorNativeId: actor.nativeId,
        departureId: id,
        audienceScope: parsed.data.audienceScope,
        partyId,
        travelerId,
      }),
    });
  } catch (error) {
    return platformApiError(error, "Salvataggio della configurazione non riuscito");
  }
}
