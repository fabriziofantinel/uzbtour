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
import {
  isPhotoAdmin,
  MAX_PHOTO_SIZE_BYTES,
  PHOTO_CONTENT_TYPES,
  safeOriginalName
} from "@/lib/photos";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";

function photoFromRow(
  row: Record<string, unknown>,
  user: { id: string; isAgencyAdmin: boolean }
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
    objectKey?: string;
    originalName?: string;
  } | null;
  if (
    !body ||
    !photoContestDay(body.day) ||
    !validPhotoContestType(body.contestType) ||
    !validContestPhotoPath(body.objectKey, Number(body.day), body.contestType)
  ) {
    return NextResponse.json({ error: "Foto non valida" }, { status: 400 });
  }

  try {
    await ensurePhotoContestsTable();
    const storage = getObjectStorage();
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
      await storage.delete(String(body.objectKey)).catch(() => undefined);
      return NextResponse.json(
        {
          error: String(closed[0].status) === "processing"
            ? "La giuria del contest è già in corso"
            : "Il contest è già concluso"
        },
        { status: 409 }
      );
    }

    const metadata = await storage.head(String(body.objectKey));
    if (!PHOTO_CONTENT_TYPES.includes(metadata.contentType as typeof PHOTO_CONTENT_TYPES[number])
      || metadata.sizeBytes <= 0 || metadata.sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      await storage.delete(String(body.objectKey)).catch(() => undefined);
      return NextResponse.json({ error: "Il file caricato non è una foto valida" }, { status: 400 });
    }
    const row = await saveContestPhotoMetadata({
      day: Number(body.day),
      contestType: body.contestType,
      pathname: String(body.objectKey),
      originalName: safeOriginalName(body.originalName),
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      user
    });
    return NextResponse.json({ photo: photoFromRow(row, user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Foto non registrata";
    console.error("Conferma foto contest non riuscita", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
