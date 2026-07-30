import { getSql } from "./db";

let challengeSchemaPromise: Promise<void> | null = null;

export async function ensureChallengeTables() {
  const sql = getSql();
  if (!challengeSchemaPromise) {
    challengeSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_mission_completions (
          id BIGSERIAL PRIMARY KEY,
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
          mission_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (day, mission_id, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_mission_user_day_idx
        ON trip_mission_completions (user_id, day, completed_at)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS trip_bingo_completions (
          id BIGSERIAL PRIMARY KEY,
          item_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (item_id, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_bingo_user_idx
        ON trip_bingo_completions (user_id, completed_at)
      `;
    })().catch((error) => {
      challengeSchemaPromise = null;
      throw error;
    });
  }
  await challengeSchemaPromise;
}
