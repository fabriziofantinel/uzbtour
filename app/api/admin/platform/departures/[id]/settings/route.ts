import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import {
  readDepartureExperienceProfile,
  readDepartureInsurance,
  saveDepartureInsurance,
  setDepartureExperienceProfile,
} from "@/lib/platform/departure-operations";
import { platformApiError } from "@/lib/platform/http";
import { getJobQueue } from "@/lib/platform/job-queue";
import { getDepartureEnrichmentQueueRecord } from "@/lib/platform/repository";

const guaranteeSchema = z.object({
  label: z.string().trim().min(1).max(160),
  status: z.enum(["included", "excluded", "not_indicated"]),
  notes: z.string().trim().max(1000),
});
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), profile: z.enum(["essential", "standard", "complete"]) }),
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
  }),
]);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requirePlatformAdmin();
    const { id } = await context.params;
    const [profile, insurance] = await Promise.all([
      readDepartureExperienceProfile(actor.id, id),
      readDepartureInsurance(actor.id, id),
    ]);
    return NextResponse.json({ profile, insurance });
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
    let enrichmentJob = null;
    if (parsed.data.action === "profile") {
      const previousProfile = await readDepartureExperienceProfile(actor.id, id);
      await setDepartureExperienceProfile(actor.id, id, parsed.data.profile);
      const rank = { essential: 0, standard: 1, complete: 2 } as const;
      if (rank[parsed.data.profile] > rank[previousProfile]) {
        const queued = await getDepartureEnrichmentQueueRecord(id, actor.id);
        enrichmentJob = await getJobQueue().enqueue({
          actorId: actor.id,
          agencyId: queued.agencyId,
          type: "travel-reference.enrich",
          payload: { ...queued.payload, experienceProfile: parsed.data.profile },
          idempotencyKey: `${queued.idempotencyKey}:profile:${parsed.data.profile}:${crypto.randomUUID()}`,
        });
      }
    } else {
      if (parsed.data.validTo < parsed.data.validFrom)
        return NextResponse.json({ error: "La validità finale precede quella iniziale" }, { status: 400 });
      await saveDepartureInsurance({ actorId: actor.id, departureId: id, ...parsed.data });
    }
    return NextResponse.json({
      profile: await readDepartureExperienceProfile(actor.id, id),
      insurance: await readDepartureInsurance(actor.id, id),
      enrichmentJob,
    });
  } catch (error) {
    return platformApiError(error, "Salvataggio della configurazione non riuscito");
  }
}
