import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { ensureChallengeTables } from "@/lib/challenges";
import { getSql } from "@/lib/db";
import { getObjectStorage } from "@/lib/platform/object-storage";

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
    await ensureChallengeTables();
    const sql = getSql();
    const rows = type === "m"
      ? await sql`SELECT pathname, original_name, content_type FROM trip_mission_completions WHERE id = ${numericId} LIMIT 1`
      : await sql`SELECT pathname, original_name, content_type FROM trip_bingo_completions WHERE id = ${numericId} LIMIT 1`;
    const evidence = rows[0];
    if (!evidence?.pathname) {
      return NextResponse.json({ error: "Foto-prova non trovata" }, { status: 404 });
    }
    const filename = encodeURIComponent(String(evidence.original_name ?? "prova"));
    const url = await getObjectStorage().createDownloadUrl(String(evidence.pathname), 5 * 60, {
      contentDisposition: `inline; filename*=UTF-8''${filename}`,
      contentType: String(evidence.content_type ?? "image/jpeg")
    });
    return NextResponse.redirect(url, 307);
  } catch (error) {
    console.error("Lettura della foto-prova non riuscita", error);
    return NextResponse.json({ error: "Foto-prova temporaneamente non disponibile" }, { status: 503 });
  }
}
