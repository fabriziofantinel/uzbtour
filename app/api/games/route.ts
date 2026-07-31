import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { gameDays } from "@/lib/game-data";
import { ensureGameScoresTable } from "@/lib/games";
import { getSql } from "@/lib/db";
import { getTripUsers } from "@/lib/trip-users";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type GameName = "word" | "order" | "puzzle";

function scoreFromRow(row: Record<string, unknown>) {
  const word = Number(row.word_score);
  const order = Number(row.order_score);
  const puzzle = Number(row.puzzle_score);
  return { word, order, puzzle, total: word + order + puzzle };
}

function buildResponse(
  user: { id: string; name: string; initials: string },
  rows: Record<string, unknown>[]
) {
  const ownScores = new Map(
    rows.filter((row) => String(row.user_id) === user.id)
      .map((row) => [Number(row.day), scoreFromRow(row)])
  );
  const users = getTripUsers();

  return {
    currentUser: user,
    isAdmin: user.initials.toUpperCase() === "FF",
    days: gameDays.map((day) => ({
      day: day.day,
      unlocked: true,
      scores: ownScores.get(day.day) ?? { word: 0, order: 0, puzzle: 0, total: 0 },
      ranking: rows
        .filter((row) => Number(row.day) === day.day)
        .map((row) => ({ name: String(row.user_name), ...scoreFromRow(row) }))
        .sort((left, right) => right.total - left.total)
    })),
    totals: users.map((tripUser) => {
      const scores = rows.filter((row) => String(row.user_id) === tripUser.id);
      return {
        name: tripUser.name,
        initials: tripUser.initials,
        score: scores.reduce((sum, row) => sum + scoreFromRow(row).total, 0),
        completed: scores.filter((row) => scoreFromRow(row).total === 100).length
      };
    }).sort((left, right) => right.score - left.score || right.completed - left.completed)
  };
}

async function readRows() {
  return getSql()`
    SELECT day, user_id, user_name, word_score, order_score, puzzle_score, updated_at
    FROM trip_game_scores
    ORDER BY day, (word_score + order_score + puzzle_score) DESC, updated_at
  `;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    await ensureGameScoresTable();
    return NextResponse.json(buildResponse(user, await readRows()));
  } catch (error) {
    console.error("Impossibile leggere i giochi", error);
    return NextResponse.json({ error: "Giochi temporaneamente non disponibili" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    day?: number;
    game?: GameName;
    score?: number;
  } | null;
  const day = gameDays.find((entry) => entry.day === body?.day);
  const maximums: Record<GameName, number> = { word: 30, order: 30, puzzle: 40 };
  const game = body?.game;
  const score = Number(body?.score);

  if (
    !day ||
    !game ||
    !(game in maximums) ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > maximums[game]
  ) {
    return NextResponse.json({ error: "Punteggio non valido" }, { status: 400 });
  }
  const column = game === "word"
    ? "word_score"
    : game === "order" ? "order_score" : "puzzle_score";

  try {
    await ensureGameScoresTable();
    const sql = getSql();
    if (column === "word_score") {
      await sql`
        INSERT INTO trip_game_scores (day, user_id, user_name, word_score)
        VALUES (${day.day}, ${user.id}, ${user.name}, ${score})
        ON CONFLICT (day, user_id) DO UPDATE SET
          word_score = GREATEST(trip_game_scores.word_score, EXCLUDED.word_score),
          user_name = EXCLUDED.user_name,
          updated_at = NOW()
      `;
    } else if (column === "order_score") {
      await sql`
        INSERT INTO trip_game_scores (day, user_id, user_name, order_score)
        VALUES (${day.day}, ${user.id}, ${user.name}, ${score})
        ON CONFLICT (day, user_id) DO UPDATE SET
          order_score = GREATEST(trip_game_scores.order_score, EXCLUDED.order_score),
          user_name = EXCLUDED.user_name,
          updated_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO trip_game_scores (day, user_id, user_name, puzzle_score)
        VALUES (${day.day}, ${user.id}, ${user.name}, ${score})
        ON CONFLICT (day, user_id) DO UPDATE SET
          puzzle_score = GREATEST(trip_game_scores.puzzle_score, EXCLUDED.puzzle_score),
          user_name = EXCLUDED.user_name,
          updated_at = NOW()
      `;
    }
    return NextResponse.json(buildResponse(user, await readRows()));
  } catch (error) {
    console.error("Salvataggio del gioco non riuscito", error);
    return NextResponse.json({ error: "Punteggio non salvato" }, { status: 503 });
  }
}
