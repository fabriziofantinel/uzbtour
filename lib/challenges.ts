import { getSql } from "./db";
import { safeOriginalName } from "./photos";

export type ChallengeEvidenceType = "mission" | "bingo";

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
          pathname TEXT,
          original_name TEXT,
          content_type TEXT,
          size_bytes BIGINT,
          status TEXT NOT NULL DEFAULT 'approved'
            CHECK (status IN ('pending', 'approved', 'rejected')),
          reviewed_by_id TEXT,
          reviewed_by_name TEXT,
          reviewed_at TIMESTAMPTZ,
          review_note TEXT NOT NULL DEFAULT '',
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (day, mission_id, user_id)
        )
      `;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS pathname TEXT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS original_name TEXT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS content_type TEXT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS size_bytes BIGINT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS reviewed_by_id TEXT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE trip_mission_completions ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''`;
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
          day SMALLINT CHECK (day BETWEEN 1 AND 13),
          pathname TEXT,
          original_name TEXT,
          content_type TEXT,
          size_bytes BIGINT,
          status TEXT NOT NULL DEFAULT 'approved'
            CHECK (status IN ('pending', 'approved', 'rejected')),
          reviewed_by_id TEXT,
          reviewed_by_name TEXT,
          reviewed_at TIMESTAMPTZ,
          review_note TEXT NOT NULL DEFAULT '',
          completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (item_id, user_id)
        )
      `;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS day SMALLINT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS pathname TEXT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS original_name TEXT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS content_type TEXT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS size_bytes BIGINT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS reviewed_by_id TEXT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE trip_bingo_completions ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT ''`;
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
