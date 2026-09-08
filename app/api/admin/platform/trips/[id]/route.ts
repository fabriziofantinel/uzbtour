import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { deleteTripRecords, getTripDeletionTarget } from "@/lib/platform/repository";
import { isObjectRetentionLockedError } from "@/lib/platform/storage-errors";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Viaggio non valido" }, { status: 400 });
    }
    const actor = await requirePlatformAdmin();
    const target = await getTripDeletionTarget(id, actor.nativeId);
    const storage = getObjectStorage();
    for (const asset of target.assets) {
      if (asset.provider !== storage.provider || asset.bucket !== storage.bucket) {
        return NextResponse.json({ error: "Storage del viaggio non coerente" }, { status: 409 });
      }
    }
    let retainedFiles = 0;
    for (const asset of target.assets) {
      try {
        await storage.delete(asset.objectKey);
      } catch (error) {
        if (!isObjectRetentionLockedError(error)) throw error;
        retainedFiles += 1;
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "trip_asset_retained_by_bucket_policy",
            tripId: target.id,
            assetId: asset.id,
          }),
        );
      }
    }
    await deleteTripRecords({
      templateId: target.id,
      agencyId: target.agencyId,
      actorId: actor.nativeId,
      title: target.title,
      mediaAssetIds: target.assets.map((asset) => asset.id),
    });
    return NextResponse.json({
      ok: true,
      deletedFiles: target.assets.length - retainedFiles,
      retainedFiles,
    });
  } catch (error) {
    return platformApiError(error, "Eliminazione del viaggio non riuscita");
  }
}
