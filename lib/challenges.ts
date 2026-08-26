import { getSql } from "./db";
import { safeOriginalName } from "./photos";
import { assertDatabaseTables } from "./platform/schema-readiness";

export type ChallengeEvidenceType = "mission" | "bingo";

export async function ensureChallengeTables() {
  await assertDatabaseTables(["trip_mission_completions", "trip_bingo_completions"]);
}

export function validChallengeEvidencePath(
  pathname: unknown,
  type: ChallengeEvidenceType,
  day: number
) {
  if (typeof pathname !== "string") return false;
  const folder = type === "mission" ? "missione" : "bingo";
  return new RegExp(
    `^uzbekistan-2026/prove/${folder}/giorno-${day}/[0-9a-f-]{36}\\.(?:jpe?g|png|webp|heic|heif)$`,
    "i"
  ).test(pathname);
}

export async function saveChallengeEvidence(input: {
  type: ChallengeEvidenceType;
  day: number;
  challengeId: string;
  pathname: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number | null;
  note?: string;
  user: { id: string; name: string };
}) {
  await ensureChallengeTables();
  const sql = getSql();
  const originalName = safeOriginalName(input.originalName);
  const note = (input.note ?? "").trim().slice(0, 240);
  if (input.type === "mission") {
    const rows = await sql`
      INSERT INTO trip_mission_completions (
        day, mission_id, user_id, user_name, note, pathname, original_name,
        content_type, size_bytes, status, completed_at
      )
      VALUES (
        ${input.day}, ${input.challengeId}, ${input.user.id}, ${input.user.name},
        ${note}, ${input.pathname}, ${originalName}, ${input.contentType},
        ${input.sizeBytes ?? null}, 'pending', NOW()
      )
      ON CONFLICT (day, mission_id, user_id) DO UPDATE SET
        user_name = EXCLUDED.user_name,
        note = EXCLUDED.note,
        pathname = EXCLUDED.pathname,
        original_name = EXCLUDED.original_name,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        status = 'pending',
        reviewed_by_id = NULL,
        reviewed_by_name = NULL,
        reviewed_at = NULL,
        review_note = '',
        completed_at = NOW()
      RETURNING id
    `;
    return rows[0];
  }
  const rows = await sql`
    INSERT INTO trip_bingo_completions (
      item_id, user_id, user_name, note, day, pathname, original_name,
      content_type, size_bytes, status, completed_at
    )
    VALUES (
      ${input.challengeId}, ${input.user.id}, ${input.user.name}, ${note},
      ${input.day}, ${input.pathname}, ${originalName}, ${input.contentType},
      ${input.sizeBytes ?? null}, 'pending', NOW()
    )
    ON CONFLICT (item_id, user_id) DO UPDATE SET
      user_name = EXCLUDED.user_name,
      note = EXCLUDED.note,
      day = EXCLUDED.day,
      pathname = EXCLUDED.pathname,
      original_name = EXCLUDED.original_name,
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      status = 'pending',
      reviewed_by_id = NULL,
      reviewed_by_name = NULL,
      reviewed_at = NULL,
      review_note = '',
      completed_at = NOW()
    RETURNING id
  `;
  return rows[0];
}
