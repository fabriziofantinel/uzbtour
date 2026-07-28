import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getSql } from "@/lib/db";
import { getQuizQuestions, isQuizUnlocked, quizDays } from "@/lib/quiz-data";
import { ensureQuizTable } from "@/lib/quiz";
import { getTripUsers } from "@/lib/trip-users";

export const runtime = "nodejs";
export const preferredRegion = "fra1";

type AnswerMap = Record<string, string>;

function publicQuestions(day: number) {
  return getQuizQuestions(day).map(({ correctAnswer: _correctAnswer, ...item }) => item);
}

function buildQuizResponse(
  user: { id: string; name: string; initials: string },
  rows: Record<string, unknown>[]
) {
  const attempts = rows.map((row) => ({
    day: Number(row.day),
    userId: String(row.user_id),
    userName: String(row.user_name),
    score: Number(row.score),
    answers: row.answers as AnswerMap,
    submittedAt: row.submitted_at
  }));
  const ownAttempts = new Map(
    attempts.filter((attempt) => attempt.userId === user.id).map((attempt) => [attempt.day, attempt])
  );
  const users = getTripUsers().map((tripUser) => ({
    id: tripUser.id,
    name: tripUser.name,
    initials: tripUser.initials
  }));

  const dailyRankings = quizDays.map((day) => ({
    day: day.day,
    entries: attempts
      .filter((attempt) => attempt.day === day.day)
      .sort((left, right) => right.score - left.score || String(left.submittedAt).localeCompare(String(right.submittedAt)))
      .map(({ userId: _userId, answers: _answers, ...attempt }) => attempt)
  }));

  const totals = users.map((tripUser) => {
    const userAttempts = attempts.filter((attempt) => attempt.userId === tripUser.id);
    return {
      name: tripUser.name,
      initials: tripUser.initials,
      score: userAttempts.reduce((sum, attempt) => sum + attempt.score, 0),
      completed: userAttempts.length
    };
  }).sort((left, right) => right.score - left.score || right.completed - left.completed);

  return {
    currentUser: user,
    isAdmin: user.initials.toUpperCase() === "FF",
    days: quizDays.map((day) => {
      const unlocked = isQuizUnlocked(day, user);
      const attempt = ownAttempts.get(day.day);
      const questions = unlocked ? publicQuestions(day.day) : [];
      const result = attempt ? getQuizQuestions(day.day).map((question) => ({
        id: question.id,
        selectedAnswer: attempt.answers[question.id] ?? "",
        correctAnswer: question.correctAnswer,
        correct: attempt.answers[question.id] === question.correctAnswer
      })) : null;

      return {
        day: day.day,
        date: day.date,
        city: day.city,
        unlockAt: day.unlockAt,
        unlocked,
        questions,
        attempt: attempt ? {
          score: attempt.score,
          answers: attempt.answers,
          submittedAt: attempt.submittedAt,
          result
        } : null
      };
    }),
    dailyRankings,
    totals
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  try {
    await ensureQuizTable();
    const rows = await getSql()`
      SELECT day, user_id, user_name, answers, score, submitted_at
      FROM trip_quiz_attempts
      ORDER BY day, score DESC, submitted_at
    `;
    return NextResponse.json(buildQuizResponse(user, rows));
  } catch (error) {
    console.error("Impossibile leggere i quiz", error);
    return NextResponse.json({ error: "Quiz temporaneamente non disponibile" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    day?: number;
    answers?: AnswerMap;
  } | null;
  const day = quizDays.find((entry) => entry.day === body?.day);
  if (!day || !body?.answers || typeof body.answers !== "object") {
    return NextResponse.json({ error: "Risposte non valide" }, { status: 400 });
  }
  if (!isQuizUnlocked(day, user)) {
    return NextResponse.json({ error: "Il quiz non è ancora sbloccato" }, { status: 403 });
  }

  const questions = getQuizQuestions(day.day);
  const answers = body.answers;
  const complete = questions.every((question) =>
    typeof answers[question.id] === "string" && question.options.includes(answers[question.id])
  );
  if (!complete || Object.keys(answers).length !== questions.length) {
    return NextResponse.json({ error: "Rispondi a tutte le 15 domande" }, { status: 400 });
  }

  try {
    await ensureQuizTable();
    const sql = getSql();
    const existing = await sql`
      SELECT id FROM trip_quiz_attempts
      WHERE day = ${day.day} AND user_id = ${user.id}
      LIMIT 1
    `;
    const isAdmin = user.initials.toUpperCase() === "FF";
    if (existing.length > 0 && !isAdmin) {
      return NextResponse.json({ error: "Hai già confermato questo quiz" }, { status: 409 });
    }

    const score = questions.reduce(
      (total, question) => total + (answers[question.id] === question.correctAnswer ? 1 : 0),
      0
    );
    const serializedAnswers = JSON.stringify(answers);

    if (isAdmin) {
      await sql`
        INSERT INTO trip_quiz_attempts (day, user_id, user_name, answers, score, submitted_at)
        VALUES (
          ${day.day}, ${user.id}, ${user.name}, CAST(${serializedAnswers} AS JSONB), ${score}, NOW()
        )
        ON CONFLICT (day, user_id) DO UPDATE SET
          answers = EXCLUDED.answers,
          score = EXCLUDED.score,
          user_name = EXCLUDED.user_name,
          submitted_at = NOW()
      `;
    } else {
      await sql`
        INSERT INTO trip_quiz_attempts (day, user_id, user_name, answers, score)
        VALUES (
          ${day.day}, ${user.id}, ${user.name}, CAST(${serializedAnswers} AS JSONB), ${score}
        )
      `;
    }

    const rows = await sql`
      SELECT day, user_id, user_name, answers, score, submitted_at
      FROM trip_quiz_attempts
      ORDER BY day, score DESC, submitted_at
    `;
    return NextResponse.json(buildQuizResponse(user, rows));
  } catch (error) {
    console.error("Salvataggio del quiz non riuscito", error);
    return NextResponse.json({ error: "Punteggio non salvato" }, { status: 503 });
  }
}

