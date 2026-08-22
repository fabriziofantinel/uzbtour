import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
const platformUserId = process.env.PLATFORM_USER_ID?.trim();
const authEmail = process.env.AUTH_USER_EMAIL?.trim().toLowerCase();
const authSubject = process.env.AUTH_USER_SUBJECT?.trim();

if (!databaseUrl) throw new Error("DATABASE_URL non configurata");
if (!platformUserId) throw new Error("PLATFORM_USER_ID non configurato");
if (!authEmail) throw new Error("AUTH_USER_EMAIL non configurata");
if (!authSubject) throw new Error("AUTH_USER_SUBJECT non configurato");

const sql = neon(databaseUrl);
const updated = await sql`
  UPDATE platform_users
  SET email = ${authEmail},
      auth_provider = 'neon',
      auth_subject = ${authSubject},
      status = 'active',
      updated_at = NOW()
  WHERE id = ${platformUserId}
  RETURNING id, display_name, email, auth_provider, auth_subject
`;

if (updated.length !== 1) {
  throw new Error(`Utente piattaforma non trovato: ${platformUserId}`);
}

console.log(JSON.stringify(updated[0], null, 2));
