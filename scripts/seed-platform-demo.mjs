import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL non configurata");

const encodedUsers = process.env.TRIP_USERS_B64;
if (!encodedUsers) throw new Error("TRIP_USERS_B64 non configurata");

const users = JSON.parse(Buffer.from(encodedUsers, "base64").toString("utf8"));
if (!Array.isArray(users) || users.length === 0) {
  throw new Error("TRIP_USERS_B64 non contiene utenti validi");
}

const sql = neon(databaseUrl);
const ids = {
  agency: "11111111-1111-4111-8111-111111111111",
  template: "22222222-2222-4222-8222-222222222222",
  version: "33333333-3333-4333-8333-333333333333",
  departure: "44444444-4444-4444-8444-444444444444",
  party: "55555555-5555-4555-8555-555555555555",
};

const days = [
  ["Torino → Istanbul → Tashkent", "Tashkent", 12],
  ["Arrivo a Tashkent e trasferimento a Khiva", "Tashkent / Khiva", 1],
  ["Khiva", "Khiva", 2],
  ["Khiva → Bukhara in treno", "Bukhara", 3],
  ["Bukhara", "Bukhara", 4],
  ["Bukhara → Samarcanda", "Samarcanda", 5],
  ["Samarcanda", "Samarcanda", 6],
  ["Shahrisabz", "Shahrisabz", 7],
  ["Samarcanda → Tashkent", "Tashkent", 8],
  ["Kokand, Rishtan e Fergana", "Valle di Fergana", 9],
  ["Margilan → Tashkent", "Margilan / Tashkent", 10],
  ["Tashkent", "Tashkent", 11],
  ["Tashkent → Istanbul → Torino", "Torino", 13],
];

for (const user of users) {
  if (!user || typeof user.id !== "string" || typeof user.name !== "string") continue;
  await sql`
    INSERT INTO platform_users (id, display_name, initials, auth_provider, status)
    VALUES (${user.id}, ${user.name}, ${String(user.initials ?? "")}, 'legacy', 'active')
    ON CONFLICT (id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      initials = EXCLUDED.initials,
      updated_at = NOW()
  `;
}

const fabrizio = users.find((user) => user?.id === "FF") ?? users[0];

await sql`
  INSERT INTO agencies (
    id, slug, name, status, default_locale, default_timezone, branding, settings,
    reference_name, reference_email, reference_phone
  )
  VALUES (
    ${ids.agency}, 'uzb-tour-demo', 'UZB Tour Demo', 'trial', 'it-IT', 'Europe/Rome',
    ${JSON.stringify({ primaryColor: "#0f766e" })}::jsonb,
    ${JSON.stringify({ demo: true })}::jsonb,
    ${fabrizio.name}, ${String(fabrizio.email ?? "demo@smf-travel.local")},
    ${String(fabrizio.phone ?? "Non disponibile")}
  )
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
`;

await sql`
  UPDATE platform_users SET platform_role = 'superadmin', updated_at = NOW()
  WHERE id = ${fabrizio.id}
`;
await sql`
  INSERT INTO agency_memberships (agency_id, user_id, role)
  VALUES (${ids.agency}, ${fabrizio.id}, 'owner')
  ON CONFLICT (agency_id, user_id) DO UPDATE SET role = EXCLUDED.role
`;

await sql`
  INSERT INTO trip_templates (
    id, agency_id, slug, title, destination_country, description, status,
    default_locale, default_timezone, created_by_user_id
  ) VALUES (
    ${ids.template}, ${ids.agency}, 'uzbekistan-via-della-seta-2026',
    'Via della Seta — Uzbekistan 2026', 'Uzbekistan',
    'Viaggio dimostrativo importato dall’app UZB Tour originale.', 'active',
    'it-IT', 'Asia/Tashkent', ${fabrizio.id}
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
`;

await sql`
  INSERT INTO trip_template_versions (
    id, agency_id, template_id, version_number, status, revision_note,
    published_at, created_by_user_id
  ) VALUES (
    ${ids.version}, ${ids.agency}, ${ids.template}, 1, 'published',
    'Versione iniziale derivata dal viaggio Uzbekistan.', NOW(), ${fabrizio.id}
  )
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
`;

for (let index = 0; index < days.length; index += 1) {
  const [title, city, legacyDay] = days[index];
  const dayNumber = index + 1;
  const dayId = `60000000-0000-4000-8000-${String(dayNumber).padStart(12, "0")}`;
  const sourceDate = `2026-08-${String(dayNumber).padStart(2, "0")}`;
  await sql`
    INSERT INTO trip_days (
      id, agency_id, template_version_id, day_number, day_offset, label, title,
      city, source_date, metadata
    ) VALUES (
      ${dayId}, ${ids.agency}, ${ids.version}, ${dayNumber}, ${index},
      ${`${dayNumber} agosto`}, ${title}, ${city}, ${sourceDate},
      ${JSON.stringify({ legacyDay })}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      title = EXCLUDED.title,
      city = EXCLUDED.city,
      source_date = EXCLUDED.source_date,
      metadata = EXCLUDED.metadata
  `;
}

await sql`
  INSERT INTO departures (
    id, agency_id, template_id, template_version_id, code, title, starts_on,
    ends_on, timezone, status, settings, published_at
  ) VALUES (
    ${ids.departure}, ${ids.agency}, ${ids.template}, ${ids.version}, 'UZB-2026-08',
    'Uzbekistan — agosto 2026', '2026-08-01', '2026-08-13', 'Asia/Tashkent',
    'completed', ${JSON.stringify({ demo: true })}::jsonb, NOW()
  )
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
`;

await sql`
  INSERT INTO travel_parties (id, agency_id, departure_id, code, name, status, settings)
  VALUES (
    ${ids.party}, ${ids.agency}, ${ids.departure}, 'FANTINEL', 'Famiglia Fantinel',
    'completed', ${JSON.stringify({ demo: true })}::jsonb
  )
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
`;

for (let index = 0; index < users.length; index += 1) {
  const user = users[index];
  if (!user || typeof user.id !== "string" || typeof user.name !== "string") continue;
  const travelerId = `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  await sql`
    INSERT INTO traveler_profiles (id, agency_id, user_id, display_name)
    VALUES (${travelerId}, ${ids.agency}, ${user.id}, ${user.name})
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
  `;
  await sql`
    INSERT INTO party_memberships (agency_id, party_id, traveler_id, role, status)
    VALUES (
      ${ids.agency}, ${ids.party}, ${travelerId},
      ${user.id === fabrizio.id ? "organizer" : "member"}, 'active'
    )
    ON CONFLICT (party_id, traveler_id) DO UPDATE SET
      role = EXCLUDED.role,
      status = EXCLUDED.status
  `;
}

console.log(`Demo creata: 1 agenzia, 1 viaggio, ${days.length} giorni, ${users.length} viaggiatori`);
