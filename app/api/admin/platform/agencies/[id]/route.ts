import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import {
  getAgencyRegistry,
  requestAgencyDeletion,
  updateAgencyBranding,
} from "@/lib/platform/superadmin-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brandingSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: z.union([z.literal(""), z.url()]),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    }
    const parsed = brandingSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Colore o indirizzo del logo non validi" }, { status: 400 });
    }
    await updateAgencyBranding({ agencyId: id, ...parsed.data, actorId: actor.id });
    return NextResponse.json({ agencies: await getAgencyRegistry(actor.id) });
  } catch (error) {
    return platformApiError(error, "Branding dell’agenzia non aggiornato");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireSuperAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    }

    const deletion = await requestAgencyDeletion({
      actorId:actor.id,agencyId:id,reason:"Cancellazione richiesta dal superadmin tramite pannello piattaforma",
    });
    return NextResponse.json({
      ok: true,
      queued: true,
      deletionJobId: deletion.deletionJobId,
      deletedAgency: deletion.agencyName,
      agencies: await getAgencyRegistry(actor.id),
    },{ status: 202 });
  } catch (error) {
    return platformApiError(error, "Eliminazione agenzia non riuscita");
  }
}
