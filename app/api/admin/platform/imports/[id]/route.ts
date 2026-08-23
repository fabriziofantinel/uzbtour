import { NextResponse } from "next/server";
import { requireAgencyAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { travelProgrammeDraftSchema } from "@/lib/platform/import-schema";
import {
  deleteImportDraftRecords,
  getImportAgency,
  getImportDeletionTarget,
  getImportForReview,
  saveImportDraft,
} from "@/lib/platform/import-repository";
import { getObjectStorage } from "@/lib/platform/object-storage";

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
    const draft = {
      ...parsed.data,
      days: parsed.data.days.map((day) => ({
        ...day,
        activities: day.activities.map((activity) => ({
          ...activity,
          title: activity.type === "visit" ? activity.placeName : activity.title,
          startsAt: "",
          endsAt: "",
        })),
      })),
    };
    await saveImportDraft({ importId: id, agencyId, actorId: actor.id, draft });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Salvataggio della revisione non riuscito");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const agencyId = await getImportAgency(id);
    await requireAgencyAdmin(agencyId);
    const target = await getImportDeletionTarget(id, agencyId);
    const storage = getObjectStorage(target.provider);
    if (storage.bucket !== target.bucket) {
      return NextResponse.json({ error: "Bucket del documento non valido" }, { status: 409 });
    }
    await storage.delete(target.objectKey);
    await deleteImportDraftRecords({
      importId: id,
      agencyId,
      documentId: target.documentId,
      mediaAssetId: target.mediaAssetId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return platformApiError(error, "Eliminazione della bozza non riuscita");
  }
}
