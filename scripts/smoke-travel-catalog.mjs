import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non configurata");
const sql = neon(process.env.DATABASE_URL);
const expectedTables = [
  "countries", "cities", "visit_sites", "hotels", "trip_countries",
  "trip_day_cities", "trip_day_sites", "trip_day_hotels", "reference_contents", "user_invitations",
];
const rows = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY(${expectedTables})
`;
const found = new Set(rows.map((row) => String(row.table_name)));
const missing = expectedTables.filter((table) => !found.has(table));
if (missing.length) throw new Error(`Tabelle mancanti: ${missing.join(", ")}`);
const columns = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'trip_templates' AND column_name IN ('starts_on', 'ends_on', 'primary_country_id')
`;
if (columns.length !== 3) throw new Error("Testata viaggio incompleta");
console.log(JSON.stringify({ catalogTables: found.size, tripHeaderColumns: columns.length }));
