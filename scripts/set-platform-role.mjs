import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
const userEmail = process.env.PLATFORM_USER_EMAIL?.trim().toLowerCase();
const platformRole = process.env.PLATFORM_ROLE?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL non configurata");
if (!userEmail) throw new Error("PLATFORM_USER_EMAIL non configurata");
if (!new Set(["superadmin", "user"]).has(platformRole)) {
  throw new Error("PLATFORM_ROLE non valido");
}

const sql = neon(databaseUrl);
const rows = await sql`
  UPDATE platform_users
  SET platform_role = ${platformRole}, updated_at = NOW()
  WHERE LOWER(email) = ${userEmail}
  RETURNING id, display_name, email, platform_role
`;

if (rows.length !== 1) throw new Error("Utente piattaforma non trovato o non univoco");
console.log(JSON.stringify(rows[0], null, 2));
