import { getSql } from "./db";

let quizSchemaPromise: Promise<void> | null = null;

export async function ensureQuizTable() {
  const sql = getSql();
  if (!quizSchemaPromise) {
    quizSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_quiz_attempts (
          id BIGSERIAL PRIMARY KEY,
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 11),
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          answers JSONB NOT NULL,
          score SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 15),
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (day, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_quiz_attempts_score_idx
        ON trip_quiz_attempts (day, score DESC, submitted_at)
      `;
    })().catch((error) => {
      quizSchemaPromise = null;
      throw error;
    });
  }
  await quizSchemaPromise;
}

