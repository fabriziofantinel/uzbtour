import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  ensurePhotoContestsTable,
  MAX_PHOTOS_PER_PARTICIPANT,
  photoContestDay,
  type PhotoContestType,
  validPhotoContestType
} from "@/lib/photo-contest";
import {
  MAX_PHOTO_SIZE_BYTES,
  photoExtensionForUpload,
  safeOriginalName
} from "@/lib/photos";
import { getObjectStorage } from "@/lib/platform/object-storage";

export const runtime = "nodejs";

type UploadPayload = {
  day?: number;
  contestType?: PhotoContestType;
  originalName?: string;
  contentType?: string;
  sizeBytes?: number;
};

async function assertContestOpen(
  day: number,
  contestType: PhotoContestType,
  userId: string
) {
  await ensurePhotoContestsTable();
  const sql = getSql();
  const [closed, countRows] = await Promise.all([
    sql`
      SELECT status
      FROM trip_daily_photo_contests
      WHERE day = ${day}
        AND contest_type = ${contestType}
        AND status IN ('processing', 'completed')
      LIMIT 1
    `,
    sql`
      SELECT COUNT(*)::INTEGER AS count
      FROM trip_contest_photos
      WHERE day = ${day}
        AND contest_type = ${contestType}
        AND uploaded_by_id = ${userId}
    `
  ]);
  if (closed.length > 0) {
    throw new Error(
      String(closed[0].status) === "processing"
        ? "La giuria del contest è già in corso"
        : "Il contest è già concluso"
    );
  }
  if (Number(countRows[0]?.count ?? 0) >= MAX_PHOTOS_PER_PARTICIPANT) {
    throw new Error(`Puoi caricare al massimo ${MAX_PHOTOS_PER_PARTICIPANT} foto per contest`);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as UploadPayload | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    const originalName = safeOriginalName(body.originalName);
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const extension = photoExtensionForUpload(originalName, contentType);
    const sizeBytes = Number(body.sizeBytes);
    if (!photoContestDay(body.day) || !validPhotoContestType(body.contestType)
      || !extension || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
      || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
      return NextResponse.json({ error: "Foto del contest non valida o superiore a 25 MB" }, { status: 400 });
    }
    await assertContestOpen(Number(body.day), body.contestType, user.id);
    const key = `uzbekistan-2026/contest/giorno-${body.day}/${body.contestType}/${crypto.randomUUID()}.${extension}`;
    return NextResponse.json(await getObjectStorage().createUploadAuthorization(
      key,
      contentType,
      10 * 60
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Foto non caricata";
    console.error("Caricamento foto contest non riuscito", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
