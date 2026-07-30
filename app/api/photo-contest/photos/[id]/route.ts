import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { ensurePhotoContestsTable } from "@/lib/photo-contest";
import { isPhotoAdmin } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    await ensurePhotoContestsTable();
    const sql = getSql();
    const rows = await sql`
      SELECT photo.id, photo.pathname, photo.uploaded_by_id,
             EXISTS (
               SELECT 1
               FROM trip_daily_photo_contests contest
               WHERE contest.day = photo.day
                 AND contest.contest_type = photo.contest_type
                 AND contest.status = 'completed'
             ) AS contest_completed
      FROM trip_contest_photos photo
      WHERE photo.id = ${id}
      LIMIT 1
    `;
    const photo = rows[0];
    if (!photo) return NextResponse.json({ error: "Foto non trovata" }, { status: 404 });
    if (String(photo.uploaded_by_id) !== user.id && !isPhotoAdmin(user)) {
      return NextResponse.json({ error: "Puoi cancellare soltanto le tue foto" }, { status: 403 });
    }
    if (photo.contest_completed) {
      return NextResponse.json({ error: "Il contest è già concluso" }, { status: 409 });
    }

    await del(String(photo.pathname));
    await sql`DELETE FROM trip_contest_photos WHERE id = ${id}`;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Cancellazione foto contest non riuscita", error);
    return NextResponse.json({ error: "Cancellazione non riuscita" }, { status: 503 });
  }
}
