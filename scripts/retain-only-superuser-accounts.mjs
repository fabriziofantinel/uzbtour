import { Client } from "@neondatabase/serverless";

const apply = process.argv.includes("--apply");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon owner non configurata");

const client = new Client(url);
let transactionOpen = false;
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if (!role || role.runtime) throw new Error("Ruolo owner richiesto");
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='90s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:retain-only-superuser',0))");

  const superusers = (
    await client.query(`
    SELECT users.id,users.username,users.display_name,users.email,map.legacy_id
    FROM iam.users users
    JOIN ops.legacy_id_map map ON map.target_id=users.id
      AND map.source_system='public-v2' AND map.entity_type='user'
    WHERE users.platform_role='superadmin' AND users.status='active'
    ORDER BY users.created_at
  `)
  ).rows;
  if (superusers.length !== 1) throw new Error(`Atteso un solo superuser attivo, trovati ${superusers.length}`);
  const superuser = superusers[0];
  const candidates = (
    await client.query(
      `
    SELECT id,username,display_name,email,status
    FROM iam.users
    WHERE id<>$1 AND status<>'anonymized'
    ORDER BY created_at
  `,
      [superuser.id],
    )
  ).rows;

  if (apply && candidates.length > 0) {
    await client.query(
      `
      DELETE FROM iam.impersonation_sessions
      WHERE actor_user_id<>$1 OR target_user_id<>$1
    `,
      [superuser.id],
    );
    await client.query(
      `
      UPDATE travel.traveler_profiles SET user_id=NULL,updated_at=clock_timestamp()
      WHERE user_id<>$1
    `,
      [superuser.id],
    );
    await client.query(`DELETE FROM iam.agency_memberships WHERE user_id<>$1`, [superuser.id]);
    await client.query(`DELETE FROM iam.invitations WHERE invited_user_id<>$1`, [superuser.id]);
    await client.query(`DELETE FROM iam.user_identities WHERE user_id<>$1`, [superuser.id]);
    await client.query(
      `
      DELETE FROM public.platform_users legacy
      USING ops.legacy_id_map map
      WHERE map.source_system='public-v2' AND map.entity_type='user'
        AND map.legacy_id=legacy.id AND map.target_id<>$1
    `,
      [superuser.id],
    );
    await client.query(
      `
      UPDATE iam.users
      SET username='deleted_'||substr(replace(id::text,'-',''),1,24),
          display_name='Utente rimosso',
          email='deleted+'||replace(id::text,'-','')||'@invalid.local',
          phone=NULL,status='anonymized',updated_at=clock_timestamp()
      WHERE id<>$1 AND status<>'anonymized'
    `,
      [superuser.id],
    );
  }

  const gate = (
    await client.query(`SELECT
    count(*) FILTER(WHERE platform_role='superadmin' AND status='active')::int active_superusers,
    count(*) FILTER(WHERE platform_role<>'superadmin' AND status IN('active','invited'))::int accessible_other_users
    FROM iam.users`)
  ).rows[0];
  if (apply && (gate.active_superusers !== 1 || gate.accessible_other_users !== 0)) {
    throw new Error("Gate account non superato");
  }

  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");
  transactionOpen = false;
  console.log(
    JSON.stringify(
      {
        status: apply ? "applied" : "dry_run",
        retained: { username: superuser.username, displayName: superuser.display_name, email: superuser.email },
        removedAccessCount: candidates.length,
        gates: apply ? gate : { active_superusers: 1, accessible_other_users: 0 },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
