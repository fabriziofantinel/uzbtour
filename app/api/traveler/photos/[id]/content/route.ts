import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { resolveV3MemoryDownload } from "@/lib/platform/v3-media-download";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }
  const asset = await resolveV3MemoryDownload(user.nativeId, id);
  if (!asset) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });
  const storage = getObjectStorage();
  if (asset.provider !== storage.provider || asset.bucket !== storage.bucket) {
    return NextResponse.json({ error: "Storage non coerente" }, { status: 409 });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";
  const url = await storage.createDownloadUrl(asset.objectKey, 5 * 60, {
    contentType: asset.contentType,
    contentDisposition: download ? `attachment; filename="${asset.originalName.replace(/["\r\n]/g, "")}"` : "inline",
  });
  return NextResponse.redirect(url);
}
