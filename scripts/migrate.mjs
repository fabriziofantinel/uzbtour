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

console.log("Migrazione Neon completata.");
