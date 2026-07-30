import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL non configurata");

const sql = neon(databaseUrl);

await sql`
  CREATE TABLE IF NOT EXISTS trip_notes (
    day SMALLINT PRIMARY KEY CHECK (day BETWEEN 1 AND 11),
    text TEXT NOT NULL,
    updated_by_id TEXT NOT NULL,
    updated_by_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  ALTER TABLE trip_notes
  DROP CONSTRAINT IF EXISTS trip_notes_day_check
`;

await sql`
  ALTER TABLE trip_notes
  ADD CONSTRAINT trip_notes_day_check CHECK (day BETWEEN 1 AND 13)
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_restaurants (
    id BIGSERIAL PRIMARY KEY,
    day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 11),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    added_by_id TEXT NOT NULL,
    added_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS trip_restaurants_day_created_idx
  ON trip_restaurants (day, created_at)
`;

await sql`
  ALTER TABLE trip_restaurants
  DROP CONSTRAINT IF EXISTS trip_restaurants_day_check
`;

await sql`
  ALTER TABLE trip_restaurants
  ADD CONSTRAINT trip_restaurants_day_check CHECK (day BETWEEN 1 AND 13)
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_expenses (
    id BIGSERIAL PRIMARY KEY,
    day SMALLINT CHECK (day BETWEEN 1 AND 13),
    label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payer_id TEXT NOT NULL,
    payer_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  ALTER TABLE trip_expenses
  ADD COLUMN IF NOT EXISTS day SMALLINT
`;

await sql`
  ALTER TABLE trip_expenses
  DROP CONSTRAINT IF EXISTS trip_expenses_day_check
`;

await sql`
  ALTER TABLE trip_expenses
  ADD CONSTRAINT trip_expenses_day_check CHECK (day IS NULL OR day BETWEEN 1 AND 13)
`;

await sql`
  CREATE INDEX IF NOT EXISTS trip_expenses_day_created_idx
  ON trip_expenses (day, created_at)
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_photos (
    id BIGSERIAL PRIMARY KEY,
    day SMALLINT NOT NULL CHECK (day BETWEEN 1 AND 13),
    pathname TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL CHECK (char_length(original_name) BETWEEN 1 AND 255),
    content_type TEXT NOT NULL,
    size_bytes BIGINT,
    uploaded_by_id TEXT NOT NULL,
    uploaded_by_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS trip_photos_day_created_idx
  ON trip_photos (day, created_at DESC)
`;

await sql`
  CREATE TABLE IF NOT EXISTS trip_photo_contests (
    day SMALLINT PRIMARY KEY CHECK (day BETWEEN 1 AND 13),
    status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    winner_photo_id BIGINT REFERENCES trip_photos(id) ON DELETE SET NULL,
    winner_score SMALLINT CHECK (winner_score BETWEEN 0 AND 100),
    winner_reason TEXT,
    rankings JSONB NOT NULL DEFAULT '[]'::JSONB,
    judged_by_id TEXT NOT NULL,
    judged_by_name TEXT NOT NULL,
    model TEXT NOT NULL,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  )
`;

await sql`
  ALTER TABLE trip_photo_contests
  DROP CONSTRAINT IF EXISTS trip_photo_contests_day_check
`;

await sql`
  ALTER TABLE trip_photo_contests
  ADD CONSTRAINT trip_photo_contests_day_check CHECK (day BETWEEN 1 AND 13)
`;

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

console.log("Migrazione Neon completata.");
