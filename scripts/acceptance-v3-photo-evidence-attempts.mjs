import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Connessione diretta Neon owner non configurata");
const client = new Client(url);
let open = false;
try {
  await client.connect();
  await client.query("BEGIN");
  open = true;
  const fixtures = (
    await client.query(`SELECT DISTINCT ON(activity.activity_type)
 membership.agency_id,membership.departure_id,membership.party_id,profile.user_id,mapping.legacy_id actor_legacy_id,
 day.template_day_id,item.id activity_item_id,activity.activity_type
 FROM travel.party_memberships membership
 JOIN travel.traveler_profiles profile ON profile.agency_id=membership.agency_id AND profile.id=membership.traveler_id
 JOIN ops.legacy_id_map mapping ON mapping.source_system='public-v2' AND mapping.entity_type='user' AND mapping.target_id=profile.user_id
 JOIN travel.departures departure ON departure.agency_id=membership.agency_id AND departure.id=membership.departure_id
 JOIN travel.departure_days day ON day.agency_id=departure.agency_id AND day.departure_id=departure.id
 JOIN content.activities activity ON activity.agency_id=departure.agency_id AND activity.template_version_id=departure.template_version_id
   AND (activity.template_day_id=day.template_day_id OR (activity.activity_type='bingo' AND activity.template_day_id IS NULL))
   AND activity.activity_type IN('mission','bingo') AND activity.status='approved'
 JOIN content.activity_items item ON item.agency_id=activity.agency_id AND item.activity_id=activity.id
   AND item.item_kind=CASE activity.activity_type WHEN 'mission' THEN 'mission' ELSE 'bingo_cell' END
 WHERE membership.status='active' ORDER BY activity.activity_type,day.service_date,item.ordinal`)
  ).rows;
  if (
    !fixtures.some((row) => row.activity_type === "mission") ||
    !fixtures.some((row) => row.activity_type === "bingo")
  )
    throw new Error("Fixture missione/bingo non disponibile");
  for (const fixture of fixtures) {
    fixture.media = [];
    for (let i = 1; i <= 3; i++) {
      const id = randomUUID();
      fixture.media.push(id);
      await client.query(
        `INSERT INTO ops.media_assets(id,agency_id,departure_id,party_id,uploaded_by_user_id,provider,bucket,object_key,original_name,content_type,size_bytes,purpose,visibility,status)
 VALUES($1,$2,$3,$4,$5,'r2','acceptance',$6,$7,'image/jpeg',128,'challenge_evidence','party','ready')`,
        [
          id,
          fixture.agency_id,
          fixture.departure_id,
          fixture.party_id,
          fixture.user_id,
          `acceptance/${id}.jpg`,
          `${fixture.activity_type}-${i}.jpg`,
        ],
      );
    }
  }
  await client.query("GRANT smf_app TO current_user");
  await client.query("SET LOCAL ROLE smf_app");
  const summary = {};
  for (const fixture of fixtures) {
    await client.query("SELECT set_config('app.agency_id',$1,true)", [fixture.agency_id]);
    const submit = async (index) => {
      const resultId = randomUUID();
      const row = (
        await client.query(`SELECT * FROM app.submit_photo_evidence_v3($1,$2,$3,$4,$5,$6,$7,$8)`, [
          fixture.actor_legacy_id,
          fixture.agency_id,
          fixture.departure_id,
          fixture.party_id,
          fixture.template_day_id,
          fixture.activity_item_id,
          resultId,
          fixture.media[index],
        ])
      ).rows[0];
      return { row, resultId };
    };
    const settle = async (attempt, approved, index) =>
      client.query(`SELECT * FROM app.save_activity_item_result_v3($1,$2,$3,$4,$5,$6,$7,$8,10,$9,$10::jsonb,$11)`, [
        fixture.actor_legacy_id,
        fixture.agency_id,
        fixture.departure_id,
        fixture.party_id,
        fixture.template_day_id,
        fixture.activity_item_id,
        attempt.resultId,
        approved ? 10 : 0,
        approved ? "approved" : "rejected",
        JSON.stringify({
          mediaId: fixture.media[index],
          aiValidation: {
            status: approved ? "approved" : "rejected",
            attemptCount: index + 1,
            attemptsRemaining: approved ? 0 : Math.max(0, 1 - index),
          },
        }),
        fixture.media[index],
      ]);
    if (fixture.activity_type === "mission") {
      const first = await submit(0);
      if (Number(first.row.attempt_number) !== 1) throw new Error("Primo tentativo missione non valido");
      await settle(first, true, 0);
      await client.query("SAVEPOINT mission_after_approval");
      let denied = false;
      try {
        await submit(1);
      } catch (error) {
        denied = error?.code === "55000";
        await client.query("ROLLBACK TO SAVEPOINT mission_after_approval");
      }
      if (!denied) throw new Error("Missione approvata accetta un altro tentativo");
      summary.mission = { approvedFirstAttempt: true, furtherAttemptDenied: true };
    } else {
      const first = await submit(0);
      await settle(first, false, 0);
      const second = await submit(1);
      if (Number(second.row.attempt_number) !== 2 || Number(second.row.attempts_remaining) !== 0)
        throw new Error("Secondo tentativo bingo non valido");
      await settle(second, false, 1);
      await client.query("SAVEPOINT bingo_third");
      let denied = false;
      try {
        await submit(2);
      } catch (error) {
        denied = error?.code === "23514";
        await client.query("ROLLBACK TO SAVEPOINT bingo_third");
      }
      if (!denied) throw new Error("Terzo tentativo bingo non rifiutato");
      summary.bingo = { twoRejectedAttempts: true, thirdAttemptDenied: true };
    }
  }
  await client.query("ROLLBACK");
  open = false;
  console.log(JSON.stringify({ status: "passed_with_rollback", ...summary }, null, 2));
} catch (error) {
  if (open) await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
