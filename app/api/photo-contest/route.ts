import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  ensurePhotoContestsTable,
  GEMINI_PHOTO_MODEL,
  isPhotoContestUnlocked,
  judgePhotos,
  MAX_CONTEST_PHOTOS,
  photoContestDay,
  photoContestDays
} from "@/lib/photo-contest";
import { ensurePhotosTable, isPhotoAdmin } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 300;

function contestFromRow(row: Record<string, unknown>) {
  const winnerId = row.winner_photo_id == null ? null : String(row.winner_photo_id);
  return {
    day: Number(row.day),
    status: String(row.status),
    winnerPhotoId: winnerId,
    winnerScore: row.winner_score == null ? null : Number(row.winner_score),
    winnerReason: row.winner_reason == null ? null : String(row.winner_reason),
    winnerContentUrl: winnerId ? `/api/photos/${winnerId}/content` : null,
    rankings: Array.isArray(row.rankings) ? row.rankings : [],
    judgedBy: String(row.judged_by_name),
    model: String(row.model),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message == null ? null : String(row.error_message)
  };
}

async function buildResponse(user: { initials: string }) {
  const sql = getSql();
  const [contestRows, photoRows] = await Promise.all([
    sql`
      SELECT day, status, winner_photo_id, winner_score, winner_reason, rankings,
             judged_by_name, model, error_message, started_at, completed_at
      FROM trip_photo_contests
      ORDER BY day
    `,
    sql`
      SELECT day, COUNT(*)::INTEGER AS photo_count
      FROM trip_photos
      WHERE day BETWEEN 1 AND 13
      GROUP BY day
    `
  ]);
  const counts = new Map(photoRows.map((row) => [Number(row.day), Number(row.photo_count)]));
  const contests = new Map(contestRows.map((row) => [Number(row.day), contestFromRow(row)]));

  return {
    isAdmin: isPhotoAdmin(user),
    days: photoContestDays.map((day) => ({
      day: day.day,
      label: day.label,
      date: day.date,
      city: day.city,
      unlockAt: day.unlockAt,
      unlocked: isPhotoAdmin(user) || isPhotoContestUnlocked(day.day),
      photoCount: counts.get(day.day) ?? 0,
      contest: contests.get(day.day) ?? null
    }))
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    await ensurePhotosTable();
    await ensurePhotoContestsTable();
    return NextResponse.json(await buildResponse(user));
  } catch (error) {
    console.error("Impossibile leggere i concorsi fotografici", error);
    return NextResponse.json(
      { error: "Concorsi fotografici temporaneamente non disponibili" },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  if (!isPhotoAdmin(user)) {
    return NextResponse.json({ error: "Solo Fabrizio può avviare la giuria" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as { day?: number } | null;
  const tripDay = photoContestDay(body?.day);
  if (!tripDay) return NextResponse.json({ error: "Giornata non valida" }, { status: 400 });
  const sql = getSql();
  try {
    await ensurePhotosTable();
    await ensurePhotoContestsTable();

    await sql`
      DELETE FROM trip_photo_contests
      WHERE day = ${tripDay.day}
        AND (
          status = 'failed'
          OR (status = 'processing' AND started_at < NOW() - INTERVAL '15 minutes')
        )
    `;

    const inserted = await sql`
      INSERT INTO trip_photo_contests (
        day, status, judged_by_id, judged_by_name, model, started_at
      )
      VALUES (
        ${tripDay.day}, 'processing', ${user.id}, ${user.name}, ${GEMINI_PHOTO_MODEL}, NOW()
      )
      ON CONFLICT (day) DO NOTHING
      RETURNING day, started_at
    `;
    if (inserted.length === 0) {
      const existing = await sql`
        SELECT status FROM trip_photo_contests WHERE day = ${tripDay.day} LIMIT 1
      `;
      const status = String(existing[0]?.status ?? "");
      return NextResponse.json(
        {
          error: status === "completed"
            ? "La foto del giorno è già stata scelta"
            : "La giuria per questa giornata è già in corso"
        },
        { status: 409 }
      );
    }

    const startedAt = inserted[0].started_at;
    const photos = await sql`
      SELECT id, pathname, original_name, uploaded_by_name
      FROM trip_photos
      WHERE day = ${tripDay.day} AND created_at <= ${startedAt}
      ORDER BY id
    `;
    if (photos.length === 0) throw new Error("Nessuna foto caricata per questa giornata");
    if (photos.length > MAX_CONTEST_PHOTOS) {
      throw new Error(`Il concorso può valutare al massimo ${MAX_CONTEST_PHOTOS} foto`);
    }

    const rankings = await judgePhotos(photos.map((photo) => ({
      id: String(photo.id),
      pathname: String(photo.pathname),
      originalName: String(photo.original_name),
      addedBy: String(photo.uploaded_by_name),
      day: tripDay.day,
      city: tripDay.city,
      highlights: tripDay.highlights
    })));
    const winner = rankings[0];
    const serializedRankings = JSON.stringify(rankings);

    await sql`
      UPDATE trip_photo_contests
      SET status = 'completed',
          winner_photo_id = ${winner.photoId},
          winner_score = ${winner.total},
          winner_reason = ${winner.rationale},
          rankings = CAST(${serializedRankings} AS JSONB),
          error_message = NULL,
          completed_at = NOW()
      WHERE day = ${tripDay.day}
    `;

    return NextResponse.json(await buildResponse(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Valutazione non riuscita";
    console.error("Giuria fotografica non riuscita", error);
    await sql`
      UPDATE trip_photo_contests
      SET status = 'failed', error_message = ${message.slice(0, 300)}
      WHERE day = ${tripDay.day} AND status = 'processing'
    `.catch(() => null);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
