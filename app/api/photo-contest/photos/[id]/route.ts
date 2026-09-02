import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { deleteV3LegacyDemoMedia } from "@/lib/platform/v3-media-mutations";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    const result = await deleteV3LegacyDemoMedia(user.id, "contest", id);
    if (result.reason === "locked") {
      return NextResponse.json({ error: "Il contest è già concluso" }, { status: 409 });
    }
    if (!result.deleted || !result.objectKey) {
      const status = result.reason === "not_found" ? 404 : 403;
      return NextResponse.json(
        { error: status === 404 ? "Foto non trovata" : "Operazione non autorizzata" },
        { status },
      );
    }
    await getObjectStorage()
      .delete(result.objectKey)
      .catch((error) => {
        console.error("Oggetto R2 orfano dopo cancellazione metadati contest", { id, error });
      });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Cancellazione foto contest non riuscita", error);
    return NextResponse.json({ error: "Cancellazione non riuscita" }, { status: 503 });
  }
}
