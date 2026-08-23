import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL non configurata");

const sql = neon(databaseUrl);
const [summary] = await sql`
  SELECT
    (SELECT COUNT(*)::INTEGER FROM agencies) AS agencies,
    (SELECT COUNT(*)::INTEGER FROM trip_templates) AS trips,
    (SELECT COUNT(*)::INTEGER FROM traveler_profiles) AS travelers,
    (SELECT COUNT(*)::INTEGER FROM platform_users WHERE platform_role = 'superadmin') AS superadmins
`;
const requiredColumns = await sql`
  SELECT COUNT(*)::INTEGER AS count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (
      (table_name = 'platform_users' AND column_name IN ('platform_role', 'phone'))
      OR (table_name = 'agencies' AND column_name IN (
        'legal_name', 'vat_number', 'tax_code', 'registered_address', 'registered_city',
        'registered_postal_code', 'registered_province', 'registered_country', 'pec',
        'sdi_code', 'phone', 'email', 'website', 'reference_name', 'reference_email',
        'reference_phone'
      ))
    )
`;

if (Number(requiredColumns[0]?.count ?? 0) !== 18) {
  throw new Error("Schema superadmin incompleto");
}
if (Number(summary.superadmins) < 1) throw new Error("Nessun superadmin configurato");
console.log(JSON.stringify(summary, null, 2));
