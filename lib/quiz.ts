import { getSql } from "./db";
import { assertDatabaseTables } from "./platform/schema-readiness";

export async function ensureQuizTable() {
  await assertDatabaseTables(["trip_quiz_attempts"]);
}
