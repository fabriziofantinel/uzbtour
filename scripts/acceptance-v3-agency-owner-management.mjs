import { randomBytes } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const actor = (
    await client.query(`SELECT users.id FROM iam.users users
    WHERE users.platform_role='superadmin' AND users.status='active' LIMIT 1`)
  ).rows[0];
  if (!actor) throw new Error("Superadmin di collaudo non trovato");
  const suffix = randomBytes(5).toString("hex"),
    oldUsername = `audit.old.${suffix}`,
    newUsername = `audit.new.${suffix}`;
  const payload = {
    slug: `audit-owner-${suffix}`,
    name: `Audit owner ${suffix}`,
    referenceName: "Responsabile precedente",
    referenceInitials: "RP",
    referenceUsername: oldUsername,
    referenceEmail: `old.${suffix}@example.invalid`,
    referencePhone: "3330000000",
    branding: {},
  };
  const created = (
    await client.query(
      `SELECT * FROM app.create_platform_agency_with_owner($1,$2::jsonb,$3,clock_timestamp()+interval '1 day')`,
      [actor.id, JSON.stringify(payload), "a".repeat(64)],
    )
  ).rows[0];
  const oldIdentity = (
    await client.query(
      `SELECT target_id,legacy_id FROM ops.legacy_id_map WHERE source_system='public-v2' AND entity_type='user' AND legacy_id=$1`,
      [created.legacy_user_id],
    )
  ).rows[0];
  await client.query(`SELECT app.update_platform_agency_owner_contact($1,$2,$3,$4)`, [
    actor.id,
    created.agency_id,
    `updated.${suffix}@example.invalid`,
    "3331111111",
  ]);
  const availableBefore = (await client.query(`SELECT app.is_username_available($1,$2) value`, [actor.id, newUsername]))
    .rows[0].value;
  const replaced = (
    await client.query(
      `SELECT * FROM app.replace_platform_agency_owner($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval '1 day')`,
      [
        actor.id,
        created.agency_id,
        "Nuovo Responsabile",
        "NR",
        newUsername,
        `new.${suffix}@example.invalid`,
        "3332222222",
        "b".repeat(64),
      ],
    )
  ).rows[0];
  const check = (
    await client.query(
      `SELECT
    EXISTS(SELECT 1 FROM iam.users WHERE id=$1) old_iam_exists,
    EXISTS(SELECT 1 FROM public.platform_users WHERE id=$2) old_legacy_exists,
    (SELECT reference_email FROM iam.agencies WHERE id=$3) reference_email,
    app.is_username_available($4,$5) new_username_available`,
      [oldIdentity.target_id, oldIdentity.legacy_id, created.agency_id, actor.id, newUsername],
    )
  ).rows[0];
  if (
    !availableBefore ||
    check.old_iam_exists ||
    check.old_legacy_exists ||
    check.new_username_available ||
    !replaced.activation_required
  ) {
    throw new Error(`Collaudo owner fallito: ${JSON.stringify({ availableBefore, check, replaced })}`);
  }
  await client.query("ROLLBACK");
  open = false;
  console.log(
    JSON.stringify(
      { status: "passed", contactUpdate: true, oldOwnerDeleted: true, newOwnerInvited: true, usernameUniqueness: true },
      null,
      2,
    ),
  );
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
