import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  ensurePhotoContestsTable,
  photoContestDay,
  saveContestPhotoMetadata,
  type PhotoContestType,
  validContestPhotoPath,
  validPhotoContestType
} from "@/lib/photo-contest";
import { isPhotoAdmin, safeOriginalName } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

function photoFromRow(
  row: Record<string, unknown>,
  user: { id: string; initials: string }
) {
  const id = String(row.id);
  return {
    id,
    slot: Number(row.participant_slot),
    originalName: String(row.original_name),
    addedBy: String(row.uploaded_by_name),
    isMine: String(row.uploaded_by_id) === user.id,
    canDelete: String(row.uploaded_by_id) === user.id || isPhotoAdmin(user),
    contentUrl: `/api/photo-contest/photos/${id}/content`,
    createdAt: row.created_at
  };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    day?: number;
    contestType?: PhotoContestType;
    pathname?: string;
    originalName?: string;
  } | null;
  if (
    !body ||
    !photoContestDay(body.day) ||
    !validPhotoContestType(body.contestType) ||
    !validContestPhotoPath(body.pathname, Number(body.day), body.contestType)
  ) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    await ensurePhotoContestsTable();
    const sql = getSql();
    const closed = await sql`
      SELECT status
      FROM trip_daily_photo_contests
      WHERE day = ${Number(body.day)}
        AND contest_type = ${body.contestType}
        AND status IN ('processing', 'completed')
      LIMIT 1
    `;
    if (closed.length > 0) {
      return NextResponse.json(
        {
          error: String(closed[0].status) === "processing"
            ? "La giuria del contest è già in corso"
            : "Il contest è già concluso"
        },
        { status: 409 }
      );
    }

    const metadata = await head(String(body.pathname));
    const row = await saveContestPhotoMetadata({
      day: Number(body.day),
      contestType: body.contestType,
      pathname: String(body.pathname),
      originalName: safeOriginalName(body.originalName),
      contentType: metadata.contentType,
      sizeBytes: metadata.size,
      user
    });
    return NextResponse.json({ photo: photoFromRow(row, user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Foto non registrata";
    console.error("Conferma foto contest non riuscita", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
