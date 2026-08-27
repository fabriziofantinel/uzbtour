import { NextResponse } from "next/server";
import { requireAgencyAdmin, requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { deleteTripRecords, getTripDeletionTarget } from "@/lib/platform/repository";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Viaggio non valido" }, { status: 400 });
    }
    await requirePlatformAdmin();
    const preliminary = await getTripDeletionTarget(id);
    const actor = await requireAgencyAdmin(preliminary.agencyId);
    const target = await getTripDeletionTarget(id, actor.id);
    const storage = getObjectStorage();
    for (const asset of target.assets) {
      if (asset.provider !== storage.provider || asset.bucket !== storage.bucket) {
        return NextResponse.json({ error: "Storage del viaggio non coerente" }, { status: 409 });
      }
    }
    for (const asset of target.assets) await storage.delete(asset.objectKey);
    await deleteTripRecords({
      templateId: target.id,
      agencyId: target.agencyId,
      actorId: actor.id,
      title: target.title,
      mediaAssetIds: target.assets.map((asset) => asset.id),
    });
    return NextResponse.json({ ok: true, deletedFiles: target.assets.length });
  } catch (error) {
    return platformApiError(error, "Eliminazione del viaggio non riuscita");
  }
}
