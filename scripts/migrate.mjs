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
  CREATE TABLE IF NOT EXISTS trip_expenses (
    id BIGSERIAL PRIMARY KEY,
    label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payer_id TEXT NOT NULL,
    payer_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
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

console.log("Migrazione Neon completata.");
