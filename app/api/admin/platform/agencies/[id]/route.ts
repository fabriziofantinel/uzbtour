import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/authorization";
import { platformApiError } from "@/lib/platform/http";
import { getObjectStorage } from "@/lib/platform/object-storage";
import {
  deleteAgencyRecords,
  getAgencyDeletionTarget,
  getAgencyRegistry,
} from "@/lib/platform/superadmin-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Agenzia non valida" }, { status: 400 });
    }

    const target = await getAgencyDeletionTarget(id);
    if (target.assets.length > 0) {
      const storage = getObjectStorage();
      for (const asset of target.assets) {
        if (asset.provider !== storage.provider || asset.bucket !== storage.bucket) {
          return NextResponse.json(
            { error: "Lo storage dell’agenzia non è coerente con la configurazione attiva" },
            { status: 409 }
          );
        }
      }
      for (const asset of target.assets) await storage.delete(asset.objectKey);
    }

    const deleted = await deleteAgencyRecords({
      agencyId: target.id,
      candidateUserIds: target.candidateUserIds,
    });
    return NextResponse.json({
      ok: true,
      deletedAgency: target.name,
      deletedFiles: target.assets.length,
      deletedUsers: deleted.deletedUsers,
      agencies: await getAgencyRegistry(),
    });
  } catch (error) {
    return platformApiError(error, "Eliminazione agenzia non riuscita");
  }
}
