import { del, head } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  ensurePhotoContestsTable,
  MAX_PHOTOS_PER_PARTICIPANT,
  photoContestDay,
  saveContestPhotoMetadata,
  type PhotoContestType,
  validContestPhotoPath,
  validPhotoContestType
} from "@/lib/photo-contest";
import {
  MAX_PHOTO_SIZE_BYTES,
  PHOTO_CONTENT_TYPES,
  safeOriginalName
} from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type UploadPayload = {
  day?: number;
  contestType?: PhotoContestType;
  originalName?: string;
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
  const body = await request.json().catch(() => null) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  const user = body.type === "blob.generate-client-token"
    ? await getCurrentUser()
    : null;
  if (body.type === "blob.generate-client-token" && !user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  try {
    const response = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!user) throw new Error("Non autenticato");
        const payload = JSON.parse(clientPayload ?? "{}") as UploadPayload;
        if (
          !photoContestDay(payload.day) ||
          !validPhotoContestType(payload.contestType) ||
          !validContestPhotoPath(pathname, Number(payload.day), payload.contestType)
        ) {
          throw new Error("Percorso della foto non valido");
        }
        await assertContestOpen(Number(payload.day), payload.contestType, user.id);

        return {
          allowedContentTypes: [...PHOTO_CONTENT_TYPES],
          maximumSizeInBytes: MAX_PHOTO_SIZE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({
            day: payload.day,
            contestType: payload.contestType,
            originalName: safeOriginalName(payload.originalName),
            user: { id: user.id, name: user.name }
          })
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload ?? "{}") as UploadPayload & {
          user?: { id?: string; name?: string };
        };
        if (
          !photoContestDay(payload.day) ||
          !validPhotoContestType(payload.contestType) ||
          !validContestPhotoPath(blob.pathname, Number(payload.day), payload.contestType) ||
          !payload.user?.id ||
          !payload.user.name
        ) {
          await del(blob.pathname).catch(() => null);
          throw new Error("Metadati della foto non validi");
        }

        try {
          await assertContestOpen(Number(payload.day), payload.contestType, payload.user.id);
          const metadata = await head(blob.pathname).catch(() => null);
          await saveContestPhotoMetadata({
            day: Number(payload.day),
            contestType: payload.contestType,
            pathname: blob.pathname,
            originalName: safeOriginalName(payload.originalName),
            contentType: blob.contentType,
            sizeBytes: metadata?.size ?? null,
            user: { id: payload.user.id, name: payload.user.name }
          });
        } catch (error) {
          await del(blob.pathname).catch(() => null);
          throw error;
        }
      }
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Foto non caricata";
    console.error("Caricamento foto contest non riuscito", error);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
