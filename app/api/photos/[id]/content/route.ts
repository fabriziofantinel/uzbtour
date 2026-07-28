import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { ensurePhotosTable } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function contentDisposition(filename: string, download: boolean) {
  const encoded = encodeURIComponent(filename.replace(/[\r\n]/g, "") || "foto");
  return `${download ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    await ensurePhotosTable();
    const sql = getSql();
    const rows = await sql`
      SELECT pathname, original_name
      FROM trip_photos
      WHERE id = ${id}
      LIMIT 1
    `;
    const photo = rows[0];
    if (!photo) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });

    const result = await get(String(photo.pathname), { access: "private" });
    if (!result || result.statusCode !== 200) {
      return NextResponse.json({ error: "File non trovato" }, { status: 404 });
    }

    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(result.stream, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": contentDisposition(String(photo.original_name), download),
        "Content-Length": String(result.blob.size),
        "Content-Type": result.blob.contentType,
        ETag: result.blob.etag
      }
    });
  } catch (error) {
    console.error("Lettura della foto non riuscita", error);
    return NextResponse.json({ error: "Foto temporaneamente non disponibile" }, { status: 503 });
  }
}

