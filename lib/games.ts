import { getSql } from "./db";
import { assertDatabaseTables } from "./platform/schema-readiness";

export async function ensureGameScoresTable() {
  await assertDatabaseTables(["trip_game_scores"]);
}
