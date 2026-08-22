import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { travelProgrammeDraftSchema } from "@/lib/platform/import-schema";
import {
  getImportAgency,
  getImportForReview,
  saveImportDraft,
} from "@/lib/platform/import-repository";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const agencyId = await getImportAgency(id);
    await requireAgencyAdmin(agencyId);
    return NextResponse.json({ import: await getImportForReview(id, agencyId) });
  } catch (error) {
    return platformApiError(error, "Lettura dell’importazione non riuscita");
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const agencyId = await getImportAgency(id);
    const actor = await requireAgencyAdmin(agencyId);
    const body = await request.json().catch(() => null) as { draft?: unknown } | null;
    const parsed = travelProgrammeDraftSchema.safeParse(body?.draft);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "La bozza contiene campi mancanti o non validi", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    await saveImportDraft({ importId: id, agencyId, actorId: actor.id, draft: parsed.data });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Salvataggio della revisione non riuscito");
  }
}
