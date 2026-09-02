import { createHash, randomBytes } from "node:crypto";
import { Client } from "@neondatabase/serverless";

if (!process.argv.includes("--apply")) throw new Error("Usare --apply per emettere un invito monouso");
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Connessione Neon owner non configurata");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const client = new Client(url);
let transactionOpen = false;
try {
  await client.connect();
  const role = (await client.query("SELECT current_user role_name,current_user='smf_app' runtime")).rows[0];
  if (!role || role.runtime) throw new Error("Ruolo owner richiesto");
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('smf-travel:invite-superuser',0))");
  const users = (
    await client.query(`
    SELECT users.id,users.username,users.display_name,users.email,map.legacy_id
    FROM iam.users users
    JOIN ops.legacy_id_map map ON map.target_id=users.id
      AND map.source_system='public-v2' AND map.entity_type='user'
    WHERE users.platform_role='superadmin' AND users.status='active'
  `)
  ).rows;
  if (users.length !== 1) throw new Error(`Atteso un solo superuser attivo, trovati ${users.length}`);
  const user = users[0];
  if (!user.username || !user.email) throw new Error("Username o email del superuser mancanti");
  const linked = await client.query(`SELECT 1 FROM iam.user_identities WHERE user_id=$1 AND provider='cognito'`, [
    user.id,
  ]);
  if (linked.rowCount) throw new Error("Il superuser e' gia' collegato a Cognito");
  await client.query(
    `UPDATE iam.invitations SET used_at=clock_timestamp() WHERE invited_user_id=$1 AND used_at IS NULL`,
    [user.id],
  );
  await client.query(
    `UPDATE public.user_invitations SET used_at=clock_timestamp() WHERE user_id=$1 AND used_at IS NULL`,
    [user.legacy_id],
  );
  const invitation = (
    await client.query(
      `
    INSERT INTO iam.invitations(invited_user_id,created_by_user_id,token_hash,expires_at)
    VALUES($1,$1,$2,clock_timestamp()+interval '24 hours') RETURNING id,expires_at
  `,
      [user.id, tokenHash],
    )
  ).rows[0];
  await client.query(
    `
    INSERT INTO public.user_invitations(id,user_id,created_by_user_id,token_hash,expires_at)
    VALUES($1,$2,$2,$3,$4)
  `,
    [invitation.id, user.legacy_id, tokenHash, invitation.expires_at],
  );
  await client.query("COMMIT");
  transactionOpen = false;
  console.log(
    JSON.stringify(
      {
        status: "issued",
        username: user.username,
        expiresAt: invitation.expires_at,
        activationPath: `/attiva-account#token=${encodeURIComponent(token)}`,
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
