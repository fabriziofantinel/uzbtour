import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon owner non configurata");

const client = new Client(url);
try {
  await client.connect();
  const result = (
    await client.query(`
    SELECT
      count(*) FILTER (WHERE users.status = 'active')::int AS active_users,
      count(*) FILTER (WHERE users.status IN ('active', 'invited') AND users.platform_role <> 'superadmin')::int AS accessible_other_users,
      count(*) FILTER (WHERE users.platform_role = 'superadmin' AND users.status = 'active')::int AS active_superusers,
      count(*) FILTER (WHERE identity.provider = 'cognito' AND identity.subject IS NOT NULL)::int AS cognito_identities,
      count(*) FILTER (WHERE legacy.auth_provider = 'cognito' AND legacy.status = 'active')::int AS cognito_legacy_accounts,
      count(*) FILTER (WHERE invitation.used_at IS NULL AND invitation.expires_at > clock_timestamp())::int AS pending_invitations
    FROM iam.users users
    LEFT JOIN iam.user_identities identity ON identity.user_id = users.id
    LEFT JOIN ops.legacy_id_map map ON map.target_id = users.id
      AND map.source_system = 'public-v2' AND map.entity_type = 'user'
    LEFT JOIN public.platform_users legacy ON legacy.id = map.legacy_id
    LEFT JOIN iam.invitations invitation ON invitation.invited_user_id = users.id
  `)
  ).rows[0];

  const passed =
    result.active_users === 1 &&
    result.accessible_other_users === 0 &&
    result.active_superusers === 1 &&
    result.cognito_identities === 1 &&
    result.cognito_legacy_accounts === 1 &&
    result.pending_invitations === 0;
  if (!passed) throw new Error(`Cutover Cognito non consolidato: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ status: "passed", gates: result }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
