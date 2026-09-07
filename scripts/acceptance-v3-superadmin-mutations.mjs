import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_URL ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione Neon non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const actor = (
    await client.query(
      "SELECT id FROM iam.users WHERE platform_role='superadmin' AND status='active' ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  if (!actor) throw new Error("Superadmin attivo non disponibile");
  const suffix = randomUUID(),
    slug = `acceptance-${suffix}`,
    email = `agent-${suffix}@invalid.example`;
  const ownerUsername = `owner_${suffix.replaceAll("-", "").slice(0, 20)}`;
  const agencyPayload = {
    slug,
    name: "Agenzia collaudo",
    referenceName: "Responsabile collaudo",
    referenceInitials: "RC",
    referenceUsername: ownerUsername,
    referenceEmail: `owner-${suffix}@invalid.example`,
    referencePhone: "+39000000001",
    registeredCountry: "IT",
    branding: { primaryColor: "#247A6B", logoUrl: "" },
  };
  const agencyId = (
    await client.query(
      `SELECT agency_id::text id FROM app.create_platform_agency_with_owner(
        $1,$2::jsonb,$3,clock_timestamp()+interval '1 hour')`,
      [actor.id, JSON.stringify(agencyPayload), randomBytes(32).toString("hex")],
    )
  ).rows[0]?.id;
  const branding = (
    await client.query("SELECT app.update_platform_agency_branding($1,$2,$3,$4) updated", [
      actor.id,
      agencyId,
      "#135E59",
      "https://example.invalid/logo.svg",
    ])
  ).rows[0]?.updated;
  const username = `agent_${suffix.replaceAll("-", "").slice(0, 20)}`;
  const tokenHash = randomBytes(32).toString("hex");
  const agentId = (
    await client.query(
      "SELECT legacy_user_id id FROM app.provision_platform_agency_agent($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        actor.id,
        agencyId,
        "Agente collaudo",
        "AC",
        username,
        email,
        "+39000000000",
        "admin",
        tokenHash,
        new Date(Date.now() + 3600000).toISOString(),
      ],
    )
  ).rows[0]?.id;
  const registry = await client.query("SELECT * FROM app.read_superadmin_agency_registry($1) WHERE agency_id=$2", [
    actor.id,
    agencyId,
  ]);
  const row = registry.rows.find((item) => item.agent_id === agentId);
  if (
    !agencyId ||
    branding !== true ||
    !agentId ||
    !row ||
    row.branding?.primaryColor !== "#135E59" ||
    row.agent_status !== "invited"
  )
    throw new Error(`Collaudo mutazioni incompleto: ${JSON.stringify({ agencyId, branding, agentId, row })}`);
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: "passed", rolledBack: true, agencyCreated: true, brandingUpdated: true, agentProvisioned: true },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
