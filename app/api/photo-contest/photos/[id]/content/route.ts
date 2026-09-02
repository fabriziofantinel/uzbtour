import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { resolveV3LegacyMediaDownload } from "@/lib/platform/v3-media-download";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    const photo = await resolveV3LegacyMediaDownload(user.id, "contest", id);
    if (!photo) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });

    const filename = encodeURIComponent(photo.originalName);
    const url = await getObjectStorage().createDownloadUrl(photo.objectKey, 5 * 60, {
      contentDisposition: `inline; filename*=UTF-8''${filename}`,
      contentType: photo.contentType,
    });
    return NextResponse.redirect(url, 307);
  } catch (error) {
    console.error("Lettura foto contest non riuscita", error);
    return NextResponse.json({ error: "Foto temporaneamente non disponibile" }, { status: 503 });
  }
}
