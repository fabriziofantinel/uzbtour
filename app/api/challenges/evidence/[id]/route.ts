import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getObjectStorage } from "@/lib/platform/object-storage";
import { resolveV3LegacyMediaDownload } from "@/lib/platform/v3-media-download";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await context.params;
  const [type, numericId] = id.split("-");
  if (!["m", "b"].includes(type) || !/^\d+$/.test(numericId ?? "")) {
    return NextResponse.json({ error: "Prova non valida" }, { status: 400 });
  }

  try {
    const evidence = await resolveV3LegacyMediaDownload(
      user.id,
      type === "m" ? "mission" : "bingo",
      numericId,
    );
    if (!evidence) {
      return NextResponse.json({ error: "Foto-prova non trovata" }, { status: 404 });
    }
    const filename = encodeURIComponent(evidence.originalName);
    const url = await getObjectStorage().createDownloadUrl(evidence.objectKey, 5 * 60, {
      contentDisposition: `inline; filename*=UTF-8''${filename}`,
      contentType: evidence.contentType,
    });
    return NextResponse.redirect(url, 307);
  } catch (error) {
    console.error("Lettura della foto-prova non riuscita", error);
    return NextResponse.json({ error: "Foto-prova temporaneamente non disponibile" }, { status: 503 });
  }
}
