import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { resolveV3LegacyMediaDownload } from "@/lib/platform/v3-media-download";

export const runtime = "nodejs";

function contentDisposition(filename: string, download: boolean) {
  const encoded = encodeURIComponent(filename.replace(/[\r\n]/g, "") || "foto");
  return `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    const photo = await resolveV3LegacyMediaDownload(user.id, "photo", id);
    if (!photo) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });

    const download = new URL(request.url).searchParams.get("download") === "1";
    const url = await getObjectStorage().createDownloadUrl(photo.objectKey, 5 * 60, {
      contentDisposition: contentDisposition(photo.originalName, download),
      contentType: photo.contentType,
    });
    return NextResponse.redirect(url, 307);
  } catch (error) {
    console.error("Lettura della foto non riuscita", error);
    return NextResponse.json({ error: "Foto temporaneamente non disponibile" }, { status: 503 });
  }
}
