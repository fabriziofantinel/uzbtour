import { NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import {
  type ChallengeEvidenceType,
  ensureChallengeTables,
  saveChallengeEvidence,
  validChallengeEvidencePath
} from "@/lib/challenges";
import {
  BINGO_MAX_POINTS,
  MISSION_POINTS,
  bingoItems,
  bingoScore,
  missionDays
} from "@/lib/challenge-data";
import { isGameUnlocked } from "@/lib/game-data";
import { getTripUsers } from "@/lib/trip-users";
import { isPhotoAdmin, safeOriginalName, validPhotoDay } from "@/lib/photos";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type CompletionRow = Record<string, unknown>;

function badgesFor(input: {
  missions: number;
  bingo: number;
  quiz: number;
  games: number;
  photoWins: number;
  languageMissions: number;
}) {
  return [
    { id: "explorer", name: "Esploratore", icon: "compass", description: "10 missioni completate", unlocked: input.missions >= 10 },
    { id: "bingo", name: "Occhio di falco", icon: "grid", description: "8 caselle del Bingo trovate", unlocked: input.bingo >= 8 },
    { id: "photographer", name: "Fotografo della Via della Seta", icon: "camera", description: "Una foto del giorno", unlocked: input.photoWins >= 1 },
    { id: "quiz", name: "Mente brillante", icon: "brain", description: "30 punti nei quiz", unlocked: input.quiz >= 30 },
    { id: "games", name: "Campione di viaggio", icon: "trophy", description: "300 punti nei giochi", unlocked: input.games >= 300 },
    { id: "polyglot", name: "Poliglotta", icon: "languages", description: "3 missioni linguistiche", unlocked: input.languageMissions >= 3 },
    {
      id: "legend",
      name: "Leggenda dell’Uzbekistan",
      icon: "crown",
      description: "Sblocca tutti gli altri badge",
      unlocked: input.missions >= 10 && input.bingo >= 8 && input.photoWins >= 1
        && input.quiz >= 30 && input.games >= 300 && input.languageMissions >= 3
    }
  ];
}

async function readChallengeRows() {
  const sql = getSql();
  const [missions, bingo, quizzes, games, photoContests] = await Promise.all([
    sql`
      SELECT id, day, mission_id, user_id, user_name, note, pathname, original_name,
             status, review_note, reviewed_by_name, reviewed_at, completed_at
      FROM trip_mission_completions
      ORDER BY completed_at
    `,
    sql`
      SELECT id, day, item_id, user_id, user_name, note, pathname, original_name,
             status, review_note, reviewed_by_name, reviewed_at, completed_at
      FROM trip_bingo_completions
      ORDER BY completed_at
    `,
    sql`
      SELECT user_id, COALESCE(SUM(score), 0)::INTEGER AS score
      FROM trip_quiz_attempts
      GROUP BY user_id
    `,
    sql`
      SELECT user_id,
             COALESCE(SUM(word_score + order_score + puzzle_score), 0)::INTEGER AS score
      FROM trip_game_scores
      GROUP BY user_id
    `,
    sql`
      SELECT rankings
      FROM trip_photo_contests
      WHERE status = 'completed'
    `
  ]);
  return { missions, bingo, quizzes, games, photoContests };
}

function photoWinsByName(rows: CompletionRow[]) {
  const wins = new Map<string, number>();
  for (const row of rows) {
    const rankings = Array.isArray(row.rankings) ? row.rankings : [];
    const winner = rankings[0] as Record<string, unknown> | undefined;
    const name = typeof winner?.addedBy === "string" ? winner.addedBy : "";
    if (name) wins.set(name, (wins.get(name) ?? 0) + 1);
  }
  return wins;
}

async function buildResponse(user: { id: string; name: string; initials: string }) {
  const rows = await readChallengeRows();
  const photoWins = photoWinsByName(rows.photoContests);
  const quizScores = new Map(rows.quizzes.map((row) => [String(row.user_id), Number(row.score)]));
  const gameScores = new Map(rows.games.map((row) => [String(row.user_id), Number(row.score)]));
  const ownMissions = rows.missions.filter((row) => String(row.user_id) === user.id);
  const ownBingo = rows.bingo.filter((row) => String(row.user_id) === user.id);

  const totals = getTripUsers().map((tripUser) => {
    const missions = rows.missions.filter((row) =>
      String(row.user_id) === tripUser.id && String(row.status) === "approved"
    );
    const bingo = rows.bingo.filter((row) =>
      String(row.user_id) === tripUser.id && String(row.status) === "approved"
    );
    const quiz = quizScores.get(tripUser.id) ?? 0;
    const games = gameScores.get(tripUser.id) ?? 0;
    const wins = photoWins.get(tripUser.name) ?? 0;
    const languageMissions = missions.filter((row) => {
      const missionDay = missionDays.find((day) => day.day === Number(row.day));
      return missionDay?.missions.find((mission) => mission.id === String(row.mission_id))?.kind === "language";
    }).length;
    const missionPoints = missions.length * MISSION_POINTS;
    const bingoPoints = bingoScore(bingo.length);
    const photoPoints = wins * 50;
    const badges = badgesFor({
      missions: missions.length,
      bingo: bingo.length,
      quiz,
      games,
      photoWins: wins,
      languageMissions
    });
    return {
      id: tripUser.id,
      name: tripUser.name,
      initials: tripUser.initials,
      score: quiz + games + missionPoints + bingoPoints + photoPoints,
      breakdown: { quiz, games, missions: missionPoints, bingo: bingoPoints, photos: photoPoints },
      badges
    };
  }).sort((left, right) => right.score - left.score);

  return {
    currentUser: user,
    isAdmin: isPhotoAdmin(user),
    missionDays: missionDays.map((day) => ({
      day: day.day,
      label: day.label,
      date: day.date,
      city: day.city,
      unlocked: isGameUnlocked(day, user),
      submissions: ownMissions
        .filter((row) => Number(row.day) === day.day)
        .map((row) => ({
          id: Number(row.id),
          missionId: String(row.mission_id),
          note: String(row.note ?? ""),
          status: String(row.status),
          evidenceUrl: row.pathname ? `/api/challenges/evidence/m-${row.id}` : null,
          originalName: row.original_name == null ? null : String(row.original_name),
          reviewNote: String(row.review_note ?? ""),
          reviewedBy: row.reviewed_by_name == null ? null : String(row.reviewed_by_name),
          submittedAt: row.completed_at
        }))
    })),
    bingo: {
      submissions: ownBingo.map((row) => ({
        id: Number(row.id),
        itemId: String(row.item_id),
        day: row.day == null ? null : Number(row.day),
        note: String(row.note ?? ""),
        status: String(row.status),
        evidenceUrl: row.pathname ? `/api/challenges/evidence/b-${row.id}` : null,
        originalName: row.original_name == null ? null : String(row.original_name),
        reviewNote: String(row.review_note ?? ""),
        reviewedBy: row.reviewed_by_name == null ? null : String(row.reviewed_by_name),
        submittedAt: row.completed_at
      })),
      score: bingoScore(ownBingo.filter((row) => String(row.status) === "approved").length),
      maximum: BINGO_MAX_POINTS
    },
    pendingReviews: isPhotoAdmin(user) ? [
      ...rows.missions
        .filter((row) => String(row.status) === "pending")
        .map((row) => {
          const day = missionDays.find((entry) => entry.day === Number(row.day));
          const mission = day?.missions.find((entry) => entry.id === String(row.mission_id));
          return {
            id: Number(row.id),
            type: "mission" as const,
            challengeId: String(row.mission_id),
            title: mission?.title ?? "Missione",
            description: mission?.description ?? "",
            day: Number(row.day),
            dayLabel: `${day?.label ?? "GIORNO"} · ${day?.date ?? ""}`,
            userName: String(row.user_name),
            note: String(row.note ?? ""),
            evidenceUrl: `/api/challenges/evidence/m-${row.id}`,
            submittedAt: row.completed_at
          };
        }),
      ...rows.bingo
        .filter((row) => String(row.status) === "pending")
        .map((row) => {
          const item = bingoItems.find((entry) => entry.id === String(row.item_id));
          return {
            id: Number(row.id),
            type: "bingo" as const,
            challengeId: String(row.item_id),
            title: item?.title ?? "Bingo",
            description: item?.description ?? "",
            day: row.day == null ? 12 : Number(row.day),
            dayLabel: "BINGO UZBEKISTAN",
            userName: String(row.user_name),
            note: String(row.note ?? ""),
            evidenceUrl: `/api/challenges/evidence/b-${row.id}`,
            submittedAt: row.completed_at
          };
        })
    ].sort((left, right) =>
      new Date(String(left.submittedAt)).getTime() - new Date(String(right.submittedAt)).getTime()
    ) : [],
    totals
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  try {
    await ensureChallengeTables();
    return NextResponse.json(await buildResponse(user));
  } catch (error) {
    console.error("Impossibile leggere le sfide", error);
    return NextResponse.json({ error: "Sfide temporaneamente non disponibili" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    action?: "submit" | "review";
    type?: ChallengeEvidenceType;
    day?: number;
    id?: string;
    pathname?: string;
    originalName?: string;
    note?: string;
    evidenceId?: number;
    decision?: "approved" | "rejected";
    reviewNote?: string;
  } | null;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 240) : "";
  const sql = getSql();

  try {
    await ensureChallengeTables();
    if (body?.action === "review") {
      if (!isPhotoAdmin(user)) {
        return NextResponse.json({ error: "Solo Fabrizio può validare le prove" }, { status: 403 });
      }
      const evidenceId = Number(body.evidenceId);
      if (
        !body.type ||
        !["mission", "bingo"].includes(body.type) ||
        !Number.isInteger(evidenceId) ||
        evidenceId <= 0 ||
        !body.decision ||
        !["approved", "rejected"].includes(body.decision)
      ) {
        return NextResponse.json({ error: "Valutazione non valida" }, { status: 400 });
      }
      const reviewNote = typeof body.reviewNote === "string"
        ? body.reviewNote.trim().slice(0, 240)
        : "";
      if (body.type === "mission") {
        await sql`
          UPDATE trip_mission_completions
          SET status = ${body.decision}, review_note = ${reviewNote},
              reviewed_by_id = ${user.id}, reviewed_by_name = ${user.name}, reviewed_at = NOW()
          WHERE id = ${evidenceId} AND status = 'pending'
        `;
      } else {
        await sql`
          UPDATE trip_bingo_completions
          SET status = ${body.decision}, review_note = ${reviewNote},
              reviewed_by_id = ${user.id}, reviewed_by_name = ${user.name}, reviewed_at = NOW()
          WHERE id = ${evidenceId} AND status = 'pending'
        `;
      }
    } else if (body?.action === "submit" && body.type === "mission") {
      const day = missionDays.find((entry) => entry.day === body.day);
      const mission = day?.missions.find((entry) => entry.id === body.id);
      if (!day || !mission) {
        return NextResponse.json({ error: "Missione non valida" }, { status: 400 });
      }
      if (!isGameUnlocked(day, user)) {
        return NextResponse.json({ error: "Le missioni non sono ancora sbloccate" }, { status: 403 });
      }
      if (!body.pathname || !validChallengeEvidencePath(body.pathname, "mission", day.day)) {
        return NextResponse.json({ error: "Foto-prova obbligatoria" }, { status: 400 });
      }
      const metadata = await head(body.pathname);
      await saveChallengeEvidence({
        type: "mission",
        day: day.day,
        challengeId: mission.id,
        pathname: body.pathname,
        originalName: safeOriginalName(body.originalName),
        contentType: metadata.contentType,
        sizeBytes: metadata.size,
        note,
        user
      });
    } else if (body?.action === "submit" && body.type === "bingo") {
      const item = bingoItems.find((entry) => entry.id === body.id);
      if (!item) return NextResponse.json({ error: "Casella Bingo non valida" }, { status: 400 });
      if (
        !validPhotoDay(body.day) ||
        !body.pathname ||
        !validChallengeEvidencePath(body.pathname, "bingo", body.day)
      ) {
        return NextResponse.json({ error: "Foto-prova obbligatoria" }, { status: 400 });
      }
      const metadata = await head(body.pathname);
      await saveChallengeEvidence({
        type: "bingo",
        day: body.day,
        challengeId: item.id,
        pathname: body.pathname,
        originalName: safeOriginalName(body.originalName),
        contentType: metadata.contentType,
        sizeBytes: metadata.size,
        note,
        user
      });
    } else {
      return NextResponse.json({ error: "Operazione non valida" }, { status: 400 });
    }
    return NextResponse.json(await buildResponse(user));
  } catch (error) {
    console.error("Salvataggio della sfida non riuscito", error);
    return NextResponse.json({ error: "Sfida non salvata" }, { status: 503 });
  }
}
