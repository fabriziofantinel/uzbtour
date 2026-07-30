import { getSql } from "./db";

let gameSchemaPromise: Promise<void> | null = null;

export async function ensureGameScoresTable() {
  const sql = getSql();
  if (!gameSchemaPromise) {
    gameSchemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS trip_game_scores (
          id BIGSERIAL PRIMARY KEY,
          day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
          user_id TEXT NOT NULL,
          user_name TEXT NOT NULL,
          word_score SMALLINT NOT NULL DEFAULT 0 CHECK (word_score BETWEEN 0 AND 30),
          order_score SMALLINT NOT NULL DEFAULT 0 CHECK (order_score BETWEEN 0 AND 30),
          puzzle_score SMALLINT NOT NULL DEFAULT 0 CHECK (puzzle_score BETWEEN 0 AND 40),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (day, user_id)
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS trip_game_scores_ranking_idx
        ON trip_game_scores (day, (word_score + order_score + puzzle_score) DESC, updated_at)
      `;
    })().catch((error) => {
      gameSchemaPromise = null;
      throw error;
    });
  }
  await gameSchemaPromise;
}
