import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  ensurePhotoContestsTable,
  GEMINI_PHOTO_MODEL,
  judgePhotos,
  MAX_CONTEST_PHOTOS,
  MAX_PHOTOS_PER_PARTICIPANT,
  photoContestDay,
  photoContestDays,
  photoContestDefinition,
  type PhotoScore,
  type PhotoContestType,
  validPhotoContestType
} from "@/lib/photo-contest";
import { isPhotoAdmin } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";
export const maxDuration = 300;

function contestFromRow(row: Record<string, unknown>) {
  const winnerId = row.winner_photo_id == null ? null : String(row.winner_photo_id);
  return {
    day: Number(row.day),
    contestType: String(row.contest_type),
    status: String(row.status),
    winnerPhotoId: winnerId,
    winnerScore: row.winner_score == null ? null : Number(row.winner_score),
    winnerReason: row.winner_reason == null ? null : String(row.winner_reason),
    winnerContentUrl: winnerId ? `/api/photo-contest/photos/${winnerId}/content` : null,
    rankings: Array.isArray(row.rankings) ? row.rankings : [],
    judgedBy: String(row.judged_by_name),
    model: String(row.model),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message == null ? null : String(row.error_message)
  };
}

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

async function buildResponse(user: { id: string; initials: string }) {
  const sql = getSql();
  const [contestRows, photoRows] = await Promise.all([
    sql`
      SELECT day, contest_type, status, winner_photo_id, winner_score, winner_reason,
             rankings, judged_by_name, model, error_message, started_at, completed_at
      FROM trip_daily_photo_contests
      ORDER BY day, contest_type
    `,
    sql`
      SELECT id, day, contest_type, participant_slot, original_name,
             uploaded_by_id, uploaded_by_name, created_at
      FROM trip_contest_photos
      ORDER BY day, contest_type, uploaded_by_name, participant_slot
    `
  ]);

  const contests = new Map(
    contestRows.map((row) => [
      `${Number(row.day)}:${String(row.contest_type)}`,
      contestFromRow(row)
    ])
  );
  const photos = new Map<string, ReturnType<typeof photoFromRow>[]>();
  for (const row of photoRows) {
    const key = `${Number(row.day)}:${String(row.contest_type)}`;
    photos.set(key, [...(photos.get(key) ?? []), photoFromRow(row, user)]);
  }

  return {
    isAdmin: isPhotoAdmin(user),
    maxPhotosPerParticipant: MAX_PHOTOS_PER_PARTICIPANT,
    days: photoContestDays.map((day) => {
      const buildKind = (contestType: PhotoContestType) => {
        const key = `${day.day}:${contestType}`;
        const definition = photoContestDefinition(day.day, contestType)!;
        const entries = photos.get(key) ?? [];
        return {
          ...definition,
          photoCount: entries.length,
          myPhotoCount: entries.filter((photo) => photo.isMine).length,
          photos: entries,
          contest: contests.get(key) ?? null
        };
      };

      return {
        day: day.day,
        label: day.label,
        date: day.date,
        city: day.city,
        contests: {
          free: buildKind("free"),
          theme: buildKind("theme")
        }
      };
    })
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
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

  const body = await request.json().catch(() => null) as {
    day?: number;
    contestType?: PhotoContestType;
  } | null;
  const tripDay = photoContestDay(body?.day);
  if (!tripDay || !validPhotoContestType(body?.contestType)) {
    return NextResponse.json({ error: "Contest non valido" }, { status: 400 });
  }
  const contestType = body.contestType;
  const definition = photoContestDefinition(tripDay.day, contestType)!;
  const sql = getSql();

  try {
    await ensurePhotoContestsTable();
    const resumed = await sql`
      UPDATE trip_daily_photo_contests
      SET status = 'processing',
          judged_by_id = ${user.id},
          judged_by_name = ${user.name},
          error_message = NULL,
          started_at = NOW(),
          completed_at = NULL
      WHERE day = ${tripDay.day}
        AND contest_type = ${contestType}
        AND (
          status = 'failed'
          OR (status = 'processing' AND started_at < NOW() - INTERVAL '15 minutes')
        )
      RETURNING day, started_at, rankings, model
    `;

    const inserted = resumed.length > 0 ? resumed : await sql`
      INSERT INTO trip_daily_photo_contests (
        day, contest_type, status, judged_by_id, judged_by_name, model, started_at
      )
      VALUES (
        ${tripDay.day}, ${contestType}, 'processing',
        ${user.id}, ${user.name}, ${GEMINI_PHOTO_MODEL}, NOW()
      )
      ON CONFLICT (day, contest_type) DO NOTHING
      RETURNING day, started_at, rankings, model
    `;
    if (inserted.length === 0) {
      const existing = await sql`
        SELECT status
        FROM trip_daily_photo_contests
        WHERE day = ${tripDay.day} AND contest_type = ${contestType}
        LIMIT 1
      `;
      const status = String(existing[0]?.status ?? "");
      return NextResponse.json(
        {
          error: status === "completed"
            ? "La foto vincitrice di questo contest è già stata scelta"
            : "La giuria di questo contest è già in corso"
        },
        { status: 409 }
      );
    }

    const startedAt = inserted[0].started_at;
    const photos = await sql`
      SELECT id, pathname, original_name, uploaded_by_name
      FROM trip_contest_photos
      WHERE day = ${tripDay.day}
        AND contest_type = ${contestType}
        AND created_at <= ${startedAt}
      ORDER BY id
    `;
    if (photos.length === 0) throw new Error("Nessuna foto caricata in questo contest");
    if (photos.length > MAX_CONTEST_PHOTOS) {
      throw new Error(`Il contest può valutare al massimo ${MAX_CONTEST_PHOTOS} foto`);
    }

    const previousRankings = Array.isArray(inserted[0].rankings)
      ? inserted[0].rankings as PhotoScore[]
      : [];
    const previousModel = String(inserted[0].model ?? GEMINI_PHOTO_MODEL);
    const judgment = await judgePhotos(photos.map((photo) => ({
      id: String(photo.id),
      pathname: String(photo.pathname),
      originalName: String(photo.original_name),
      addedBy: String(photo.uploaded_by_name),
      day: tripDay.day,
      city: tripDay.city,
      highlights: tripDay.highlights,
      themeTitle: definition.title,
      themeDescription: definition.description
    })), {
      existingRankings: previousRankings,
      onProgress: async (rankings, model) => {
        const models = [previousModel, model].filter(Boolean).join(" + ");
        await sql`
          UPDATE trip_daily_photo_contests
          SET rankings = CAST(${JSON.stringify(rankings)} AS JSONB),
              model = ${models}
          WHERE day = ${tripDay.day}
            AND contest_type = ${contestType}
            AND status = 'processing'
        `;
      }
    });
    const winner = judgment.rankings[0];
    const completedModels = [previousModel, judgment.model]
      .filter((model, index, models) => model && models.indexOf(model) === index)
      .join(" + ");

    await sql`
      UPDATE trip_daily_photo_contests
      SET status = 'completed',
          winner_photo_id = ${winner.photoId},
          winner_score = ${winner.total},
          winner_reason = ${winner.rationale},
          rankings = CAST(${JSON.stringify(judgment.rankings)} AS JSONB),
          model = ${completedModels},
          error_message = NULL,
          completed_at = NOW()
      WHERE day = ${tripDay.day} AND contest_type = ${contestType}
    `;

    return NextResponse.json(await buildResponse(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Valutazione non riuscita";
    console.error("Giuria fotografica non riuscita", error);
    await sql`
      UPDATE trip_daily_photo_contests
      SET status = 'failed', error_message = ${message.slice(0, 300)}
      WHERE day = ${tripDay.day}
        AND contest_type = ${contestType}
        AND status = 'processing'
    `.catch(() => null);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
