import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";

const explicitRuntimeUrl = process.env.DATABASE_RUNTIME_URL ?? process.env.DATABASE_URL;
const runtimeUrl = explicitRuntimeUrl ?? process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!runtimeUrl) throw new Error("Connessione runtime non configurata");
const client = new Client(runtimeUrl);
try {
  await client.connect();
  if (!explicitRuntimeUrl) {
    await client.query("GRANT smf_app TO current_user");
    await client.query("SET ROLE smf_app");
  }
  const role = (await client.query("SELECT current_user role_name")).rows[0]?.role_name;
  const gates = (
    await client.query(`SELECT
    has_function_privilege(current_user,'app.resolve_legacy_demo_media_download(text,text,bigint)','EXECUTE') resolver,
    NOT has_function_privilege(current_user,'app.legacy_users_share_media_scope(text,text)','EXECUTE') helper_private,
    NOT has_table_privilege(current_user,'ops.legacy_id_map','SELECT') identity_map_private`)
  ).rows[0];
  if (!gates || Object.values(gates).some((value) => value !== true))
    throw new Error(`Gate runtime incompleti: ${JSON.stringify(gates)}`);
  const candidate = (
    await client.query(`SELECT 'photo' kind,id,uploaded_by_id owner_id FROM public.trip_photos
    UNION ALL SELECT 'contest',id,uploaded_by_id FROM public.trip_contest_photos
    UNION ALL SELECT 'mission',id,user_id FROM public.trip_mission_completions WHERE pathname IS NOT NULL
    UNION ALL SELECT 'bingo',id,user_id FROM public.trip_bingo_completions WHERE pathname IS NOT NULL
    LIMIT 1`)
  ).rows[0];
  const ownerAuthorized = candidate
    ? (
        await client.query("SELECT 1 FROM app.resolve_legacy_demo_media_download($1,$2,$3)", [
          candidate.owner_id,
          candidate.kind,
          candidate.id,
        ])
      ).rowCount === 1
    : null;
  if (ownerAuthorized === false) throw new Error("Il proprietario non puo leggere il proprio media");
  const foreignDenied =
    (
      await client.query("SELECT 1 FROM app.resolve_legacy_demo_media_download($1,$2,$3)", [
        randomUUID(),
        candidate?.kind ?? "photo",
        candidate?.id ?? 0,
      ])
    ).rowCount === 0;
  if (!foreignDenied) throw new Error("Un utente estraneo ha ottenuto un media legacy");
  console.log(JSON.stringify({ status: "passed", role, gates, ownerAuthorized, foreignDenied }, null, 2));
} finally {
  await client.end().catch(() => undefined);
}
