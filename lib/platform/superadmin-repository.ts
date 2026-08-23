import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./http";

export type SuperadminSummary = {
  agencies: number;
  trips: number;
  travelers: number;
};

export type AgencyAgent = {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: string;
};

export type AgencyRegistryItem = {
  id: string;
  slug: string;
  name: string;
  status: string;
  legalName: string;
  vatNumber: string;
  taxCode: string;
  registeredAddress: string;
  registeredCity: string;
  registeredPostalCode: string;
  registeredProvince: string;
  registeredCountry: string;
  pec: string;
  sdiCode: string;
  phone: string;
  email: string;
  website: string;
  referenceName: string;
  referenceEmail: string;
  referencePhone: string;
  tripCount: number;
  travelerCount: number;
  agents: AgencyAgent[];
};

export type ImpersonationUser = {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  status: string;
  platformRole: "superadmin" | "user";
  agencyNames: string[];
  agencyRoles: string[];
  isTraveler: boolean;
};

function textValue(value: unknown) {
  return value == null ? "" : String(value);
}

function agencySlug(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "agenzia";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function getSuperadminSummary(): Promise<SuperadminSummary> {
  const sql = getSql();
  const [agencies, trips, travelers] = await Promise.all([
    sql`SELECT COUNT(*)::INTEGER AS count FROM agencies`,
    sql`SELECT COUNT(*)::INTEGER AS count FROM trip_templates`,
    sql`SELECT COUNT(*)::INTEGER AS count FROM traveler_profiles`,
  ]);
  return {
    agencies: Number(agencies[0]?.count ?? 0),
    trips: Number(trips[0]?.count ?? 0),
    travelers: Number(travelers[0]?.count ?? 0),
  };
}

export async function getAgencyRegistry(): Promise<AgencyRegistryItem[]> {
  const sql = getSql();
  const [agencyRows, agentRows] = await Promise.all([
    sql`
      SELECT a.*,
        COUNT(DISTINCT tt.id)::INTEGER AS trip_count,
        COUNT(DISTINCT tp.id)::INTEGER AS traveler_count
      FROM agencies a
      LEFT JOIN trip_templates tt ON tt.agency_id = a.id
      LEFT JOIN traveler_profiles tp ON tp.agency_id = a.id
      GROUP BY a.id
      ORDER BY a.name
    `,
    sql`
      SELECT am.agency_id::text, pu.id, pu.display_name, pu.initials,
             pu.email, pu.phone, pu.status, am.role
      FROM agency_memberships am
      JOIN platform_users pu ON pu.id = am.user_id
      ORDER BY pu.display_name
    `,
  ]);

  return agencyRows.map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    status: String(row.status),
    legalName: textValue(row.legal_name),
    vatNumber: textValue(row.vat_number),
    taxCode: textValue(row.tax_code),
    registeredAddress: textValue(row.registered_address),
    registeredCity: textValue(row.registered_city),
    registeredPostalCode: textValue(row.registered_postal_code),
    registeredProvince: textValue(row.registered_province),
    registeredCountry: textValue(row.registered_country),
    pec: textValue(row.pec),
    sdiCode: textValue(row.sdi_code),
    phone: textValue(row.phone),
    email: textValue(row.email),
    website: textValue(row.website),
    referenceName: textValue(row.reference_name),
    referenceEmail: textValue(row.reference_email),
    referencePhone: textValue(row.reference_phone),
    tripCount: Number(row.trip_count ?? 0),
    travelerCount: Number(row.traveler_count ?? 0),
    agents: agentRows
      .filter((agent) => String(agent.agency_id) === String(row.id))
      .map((agent) => ({
        id: String(agent.id),
        name: String(agent.display_name),
        initials: String(agent.initials),
        email: textValue(agent.email),
        phone: textValue(agent.phone),
        role: String(agent.role) as AgencyAgent["role"],
        status: String(agent.status),
      })),
  }));
}

export async function getImpersonationUsers(actorId: string): Promise<ImpersonationUser[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT users.id, users.display_name, users.initials, users.email, users.phone,
           users.status, users.platform_role,
           COALESCE(
             ARRAY_AGG(DISTINCT agencies.name) FILTER (WHERE agencies.id IS NOT NULL),
             ARRAY[]::TEXT[]
           ) AS agency_names,
           COALESCE(
             ARRAY_AGG(DISTINCT memberships.role) FILTER (WHERE memberships.role IS NOT NULL),
             ARRAY[]::TEXT[]
           ) AS agency_roles,
           EXISTS (SELECT 1 FROM traveler_profiles WHERE user_id = users.id) AS is_traveler
    FROM platform_users users
    LEFT JOIN agency_memberships memberships ON memberships.user_id = users.id
    LEFT JOIN agencies ON agencies.id = memberships.agency_id
    WHERE users.id <> ${actorId}
      AND users.status <> 'disabled'
    GROUP BY users.id
    ORDER BY users.display_name, users.email
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    initials: String(row.initials || ""),
    email: textValue(row.email),
    phone: textValue(row.phone),
    status: String(row.status),
    platformRole: String(row.platform_role) as ImpersonationUser["platformRole"],
    agencyNames: Array.isArray(row.agency_names) ? row.agency_names.map(String) : [],
    agencyRoles: Array.isArray(row.agency_roles) ? row.agency_roles.map(String) : [],
    isTraveler: Boolean(row.is_traveler),
  }));
}

export async function createAgency(input: {
  name: string;
  legalName?: string;
  vatNumber?: string;
  taxCode?: string;
  registeredAddress?: string;
  registeredCity?: string;
  registeredPostalCode?: string;
  registeredProvince?: string;
  registeredCountry?: string;
  pec?: string;
  sdiCode?: string;
  phone?: string;
  email?: string;
  website?: string;
  referenceName: string;
  referenceEmail: string;
  referencePhone: string;
}) {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO agencies (
      slug, name, status, legal_name, vat_number, tax_code,
      registered_address, registered_city, registered_postal_code,
      registered_province, registered_country, pec, sdi_code,
      phone, email, website, reference_name, reference_email, reference_phone
    ) VALUES (
      ${agencySlug(input.name)}, ${input.name}, 'trial', ${input.legalName || null},
      ${input.vatNumber || null}, ${input.taxCode || null}, ${input.registeredAddress || null},
      ${input.registeredCity || null}, ${input.registeredPostalCode || null},
      ${input.registeredProvince || null}, ${input.registeredCountry || null},
      ${input.pec || null}, ${input.sdiCode || null}, ${input.phone || null},
      ${input.email || null}, ${input.website || null}, ${input.referenceName},
      ${input.referenceEmail}, ${input.referencePhone}
    )
    RETURNING id::text
  `;
  return String(rows[0].id);
}

export async function getAgencyDeletionTarget(agencyId: string) {
  const sql = getSql();
  const agencies = await sql`
    SELECT id::text, name
    FROM agencies
    WHERE id = ${agencyId}
    LIMIT 1
  `;
  if (!agencies[0]) throw new PlatformRequestError("Agenzia non trovata");

  const [assets, users] = await Promise.all([
    sql`
      SELECT id::text, provider, bucket, object_key
      FROM media_assets
      WHERE agency_id = ${agencyId}
      ORDER BY created_at
    `,
    sql`
      SELECT DISTINCT user_id
      FROM (
        SELECT user_id FROM agency_memberships WHERE agency_id = ${agencyId}
        UNION
        SELECT user_id FROM traveler_profiles
        WHERE agency_id = ${agencyId} AND user_id IS NOT NULL
      ) candidates
    `,
  ]);

  return {
    id: String(agencies[0].id),
    name: String(agencies[0].name),
    assets: assets.map((row) => ({
      id: String(row.id),
      provider: String(row.provider),
      bucket: String(row.bucket),
      objectKey: String(row.object_key),
    })),
    candidateUserIds: users.map((row) => String(row.user_id)),
  };
}

export async function deleteAgencyRecords(input: {
  agencyId: string;
  candidateUserIds: string[];
}) {
  const sql = getSql();
  const candidateUserIds = input.candidateUserIds.length > 0
    ? input.candidateUserIds
    : [`deleted-agency:${crypto.randomUUID()}`];
  const results = await sql.transaction((transaction) => [
    transaction`DELETE FROM departures WHERE agency_id = ${input.agencyId}`,
    transaction`
      DELETE FROM agencies
      WHERE id = ${input.agencyId}
      RETURNING id
    `,
    transaction`
      DELETE FROM platform_users users
      WHERE users.id = ANY(${candidateUserIds}::text[])
        AND users.platform_role <> 'superadmin'
        AND NOT EXISTS (
          SELECT 1 FROM agency_memberships memberships WHERE memberships.user_id = users.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM traveler_profiles travelers WHERE travelers.user_id = users.id
        )
      RETURNING id
    `,
  ]);
  if (results[1].length !== 1) throw new PlatformRequestError("Eliminazione dell’agenzia non riuscita");
  return { deletedUsers: results[2].length };
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("it") ?? "").join("");
}

export async function createAgencyAgent(input: {
  agencyId: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "editor" | "viewer";
}) {
  const sql = getSql();
  const agencies = await sql`SELECT 1 FROM agencies WHERE id = ${input.agencyId} LIMIT 1`;
  if (agencies.length === 0) throw new Error("Agenzia non trovata");

  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
  let users = await sql`
    SELECT id FROM platform_users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1
  `;
  if (users.length === 0) {
    users = await sql`
      INSERT INTO platform_users (
        id, display_name, initials, email, phone, auth_provider, status
      ) VALUES (
        ${`agent:${crypto.randomUUID()}`}, ${input.name}, ${initialsFor(input.name)},
        ${normalizedEmail}, ${input.phone}, 'neon', 'invited'
      )
      RETURNING id
    `;
  } else {
    await sql`
      UPDATE platform_users
      SET display_name = ${input.name}, phone = ${input.phone}, updated_at = NOW()
      WHERE id = ${String(users[0].id)}
    `;
  }

  const userId = String(users[0].id);
  await sql`
    INSERT INTO agency_memberships (agency_id, user_id, role)
    VALUES (${input.agencyId}, ${userId}, ${input.role})
    ON CONFLICT (agency_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
  return userId;
}
