import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function ensureScheduledQuizGrants(input: {
  agencyId: string; departureId: string; partyId: string; userId: string;
}) {
  const sql = getSql();
  const [, candidates] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
    txn`
      SELECT activity.id::text,departure.template_version_id::text,traveler.id::text AS traveler_id
      FROM travel.traveler_profiles traveler
      JOIN travel.party_memberships membership ON membership.agency_id=traveler.agency_id
        AND membership.traveler_id=traveler.id AND membership.departure_id=${input.departureId}
        AND membership.party_id=${input.partyId} AND membership.status='active'
      JOIN travel.departures departure ON departure.agency_id=membership.agency_id
        AND departure.id=membership.departure_id
      JOIN content.activities activity ON activity.agency_id=departure.agency_id
        AND activity.template_version_id=departure.template_version_id
        AND activity.activity_type='quiz' AND activity.status='approved'
      LEFT JOIN travel.departure_days operational_day ON operational_day.agency_id=activity.agency_id
        AND operational_day.departure_id=departure.id AND operational_day.template_day_id=activity.template_day_id
      WHERE traveler.agency_id=${input.agencyId}
        AND traveler.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
        AND (activity.availability_rule='always' OR (
          activity.availability_rule='relative_day_time' AND operational_day.service_date IS NOT NULL
          AND (((operational_day.service_date+activity.relative_days)+activity.unlock_local_time)
            AT TIME ZONE departure.timezone)<=clock_timestamp()
        ))
        AND NOT app.has_active_activity_access_grant_v3(
          activity.agency_id,departure.id,membership.party_id,traveler.id,activity.id
        )
    `,
  ]);
  for (const candidate of candidates as Row[]) {
    const activityId = String(candidate.id);
    const travelerId = String(candidate.traveler_id);
    const contentHash = sha256(`${activityId}:${String(candidate.template_version_id)}`);
    const accessHash = sha256(`${input.partyId}:${travelerId}:${activityId}:${randomUUID()}`);
    await sql`SELECT app.issue_activity_access_grant(
      ${input.agencyId},${input.departureId},${input.partyId},${travelerId},${activityId},
      ${accessHash}::char(64),${contentHash}::char(64),NULL
    )`;
  }
}

export function v3GamificationCutoverReadEnabled() {
  return process.env.V3_GAMIFICATION_READ_SOURCE !== "legacy";
}

export async function readV3ChallengeAnswerSpecs(input: {
  agencyId: string;
  templateVersionId: string;
  dayId: string;
  itemIds: string[];
}) {
  if (input.itemIds.length === 0) return [] as Row[];
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      SELECT item.id::text, activity.activity_type, item.answer_spec
      FROM content.activity_items item
      JOIN content.activities activity
        ON activity.id=item.activity_id AND activity.agency_id=item.agency_id
       AND activity.template_version_id=item.template_version_id
      WHERE item.agency_id=${input.agencyId}
        AND item.template_version_id=${input.templateVersionId}
        AND activity.template_day_id=${input.dayId}
        AND activity.status='approved'
        AND item.id=ANY(${input.itemIds}::uuid[])
    `,
  ], { readOnly: true });
  return rows as Row[];
}

export async function readV3Gamification(input: {
  agencyId: string;
  departureId: string;
  templateVersionId: string;
  partyId: string;
  userId: string;
}) {
  await ensureScheduledQuizGrants(input);
  const sql = getSql();
  const [, challenges, photos, results, contests, competitionGroups, competitionResults, competitionContests] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
    txn`
      SELECT item.id::text, activity.template_day_id::text AS trip_day_id,
        day.day_number,
        CASE activity.activity_type
          WHEN 'quiz' THEN 'quiz_question'
          WHEN 'bingo' THEN 'bingo_item'
          WHEN 'puzzle' THEN 'word_game'
          ELSE activity.activity_type
        END AS content_type,
        CASE WHEN activity.activity_type IN ('quiz','photo_contest')
          THEN activity.title ELSE COALESCE(NULLIF(item.prompt,''),activity.title) END AS title,
        CASE activity.activity_type
          WHEN 'quiz' THEN jsonb_build_object(
            'question',item.prompt,
            'options',COALESCE(item.payload->'options','[]'::jsonb),
            'explanation',COALESCE(item.payload->>'explanation',''))
          WHEN 'mission' THEN jsonb_build_object(
            'description',COALESCE(item.payload->>'description',activity.instructions))
          WHEN 'bingo' THEN jsonb_build_object(
            'description',COALESCE(item.payload->>'description',activity.instructions))
          WHEN 'photo_contest' THEN jsonb_build_object(
            'description',COALESCE(item.payload->>'description',activity.instructions),
            'contestCategory',activity.contest_category,
            'closesAt',(((operational_day.service_date+1)+time '06:00') AT TIME ZONE current_departure.timezone),
            'closed',clock_timestamp()>=(((operational_day.service_date+1)+time '06:00') AT TIME ZONE current_departure.timezone))
          ELSE jsonb_build_object(
            'type',COALESCE(item.payload->>'type',''),
            'instructions',COALESCE(item.payload->>'instructions',activity.instructions))
        END AS content
      FROM content.activities activity
      JOIN content.activity_items item
        ON item.activity_id=activity.id AND item.agency_id=activity.agency_id
       AND item.template_version_id=activity.template_version_id
      LEFT JOIN travel.template_days day
        ON day.id=activity.template_day_id AND day.agency_id=activity.agency_id
       AND day.template_version_id=activity.template_version_id
      LEFT JOIN travel.departure_days operational_day ON operational_day.agency_id=activity.agency_id
        AND operational_day.departure_id=${input.departureId} AND operational_day.template_day_id=activity.template_day_id
      LEFT JOIN travel.departures current_departure ON current_departure.agency_id=activity.agency_id
        AND current_departure.id=${input.departureId}
      WHERE activity.agency_id=${input.agencyId}
        AND activity.template_version_id=${input.templateVersionId}
        AND activity.status='approved'
        AND (
          activity.activity_type<>'quiz'
          OR app.has_active_activity_access_grant_v3(
            activity.agency_id,${input.departureId}::uuid,${input.partyId}::uuid,
            (SELECT profile.id FROM travel.traveler_profiles profile
             WHERE profile.agency_id=${input.agencyId}
               AND profile.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
             LIMIT 1),activity.id
          )
        )
      ORDER BY COALESCE(day.day_number,0),activity.sort_order,item.ordinal
    `,
    txn`
      SELECT memory.id::text, day.template_day_id::text AS trip_day_id,
        template_day.day_number, asset.id::text AS media_id, asset.original_name,
        asset.content_type, asset.size_bytes,
        CASE WHEN asset.uploaded_by_user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
          THEN ${input.userId} ELSE COALESCE(asset.uploaded_by_user_id::text,'') END AS uploaded_by_user_id,
        creator.display_name AS added_by, memory.created_at::text
      FROM journey.memories memory
      JOIN ops.media_assets asset
        ON asset.id=memory.media_asset_id AND asset.agency_id=memory.agency_id
      JOIN travel.departure_days day
        ON day.id=memory.departure_day_id AND day.agency_id=memory.agency_id
       AND day.departure_id=memory.departure_id
      JOIN travel.template_days template_day
        ON template_day.id=day.template_day_id AND template_day.agency_id=day.agency_id
      JOIN travel.traveler_profiles creator
        ON creator.id=memory.created_by_traveler_id AND creator.agency_id=memory.agency_id
      WHERE memory.agency_id=${input.agencyId} AND memory.departure_id=${input.departureId}
        AND memory.party_id=${input.partyId} AND asset.status='ready'
      ORDER BY memory.created_at DESC
    `,
    txn`
      SELECT answer.value->>'__resultId' AS id, attempt.traveler_id::text,
        profile.display_name, day.template_day_id::text AS trip_day_id,
        answer.key AS generated_content_id,
        CASE activity.activity_type
          WHEN 'quiz' THEN 'quiz' WHEN 'mission' THEN 'mission'
          WHEN 'bingo' THEN 'bingo' ELSE 'game'
        END AS activity_type,
        COALESCE((answer.value->>'__score')::integer,0) AS score,
        (answer.value->>'__maxScore')::integer AS max_score,
        COALESCE(answer.value->>'__status',attempt.status) AS status,
        answer.value - '__resultId' - '__score' - '__maxScore' - '__status'
          - '__submittedAt' - '__updatedAt' - 'correctIndex' AS result,
        COALESCE(answer.value->>'__submittedAt',attempt.submitted_at::text) AS submitted_at,
        evidence.memory_id::text AS evidence_memory_id
      FROM journey.activity_attempts attempt
      JOIN content.activities activity
        ON activity.id=attempt.activity_id AND activity.agency_id=attempt.agency_id
      JOIN travel.traveler_profiles profile
        ON profile.id=attempt.traveler_id AND profile.agency_id=attempt.agency_id
      LEFT JOIN travel.departure_days day
        ON day.id=attempt.departure_day_id AND day.agency_id=attempt.agency_id
       AND day.departure_id=attempt.departure_id
      CROSS JOIN LATERAL jsonb_each(attempt.answers) answer
      LEFT JOIN LATERAL (
        SELECT memory.id AS memory_id
        FROM journey.activity_evidence proof
        JOIN journey.memories memory
          ON memory.media_asset_id=proof.media_asset_id
         AND memory.agency_id=proof.agency_id AND memory.party_id=proof.party_id
        WHERE proof.attempt_id=attempt.id AND proof.activity_item_id=answer.key::uuid
        ORDER BY proof.created_at DESC LIMIT 1
      ) evidence ON true
      WHERE attempt.agency_id=${input.agencyId} AND attempt.departure_id=${input.departureId}
        AND attempt.party_id=${input.partyId}
      ORDER BY COALESCE(answer.value->>'__submittedAt',attempt.submitted_at::text) DESC
    `,
    txn`
      SELECT entry.id::text, entry.traveler_id::text, profile.display_name,
        item.id::text AS generated_content_id, entry.media_asset_id::text,
        entry.participant_slot,
        CASE WHEN entry.status='ranked' THEN 'completed' ELSE entry.status END AS status,
        judgement.score, COALESCE(judgement.reason,'') AS reason, entry.is_winner,
        entry.submitted_at::text, memory.id::text AS memory_id
      FROM journey.photo_contest_entries entry
      JOIN content.activity_items item
        ON item.activity_id=entry.activity_id AND item.agency_id=entry.agency_id
       AND item.item_kind='contest_rule'
      JOIN travel.traveler_profiles profile
        ON profile.id=entry.traveler_id AND profile.agency_id=entry.agency_id
      LEFT JOIN LATERAL (
        SELECT judged.score,judged.reason
        FROM journey.photo_contest_judgements judged
        WHERE judged.agency_id=entry.agency_id AND judged.party_id=entry.party_id
          AND judged.activity_id=entry.activity_id AND judged.entry_id=entry.id
        ORDER BY judged.judged_at DESC,judged.id DESC LIMIT 1
      ) judgement ON true
      LEFT JOIN journey.memories memory
        ON memory.media_asset_id=entry.media_asset_id
       AND memory.agency_id=entry.agency_id AND memory.party_id=entry.party_id
      WHERE entry.agency_id=${input.agencyId} AND entry.departure_id=${input.departureId}
        AND entry.party_id=${input.partyId}
        AND (entry.status IN('selected','ranked') OR (entry.traveler_id=(SELECT profile.id FROM travel.traveler_profiles profile
          WHERE profile.agency_id=${input.agencyId} AND profile.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId}) LIMIT 1)
          AND entry.status IN('draft','evaluating')))
      ORDER BY entry.submitted_at DESC
    `,
    txn`
      SELECT party.id::text,party.name,
        party.id=${input.partyId}::uuid AS is_current
      FROM travel.travel_parties party
      WHERE party.agency_id=${input.agencyId} AND party.departure_id=${input.departureId}
        AND EXISTS(SELECT 1 FROM travel.party_memberships participant
          WHERE participant.agency_id=party.agency_id AND participant.departure_id=party.departure_id
            AND participant.party_id=party.id AND participant.status<>'removed'
            AND participant.participates_in_trip_games)
        AND EXISTS(SELECT 1 FROM travel.party_memberships current_participant
          JOIN travel.traveler_profiles current_profile
            ON current_profile.id=current_participant.traveler_id
           AND current_profile.agency_id=current_participant.agency_id
          WHERE current_participant.agency_id=party.agency_id
            AND current_participant.departure_id=party.departure_id
            AND current_participant.party_id=${input.partyId}::uuid
            AND current_profile.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
            AND current_participant.status<>'removed' AND current_participant.participates_in_trip_games)
      ORDER BY party.name
    `,
    txn`
      SELECT answer.value->>'__resultId' AS id,attempt.party_id::text,party.name AS party_name,
        attempt.traveler_id::text,profile.display_name,
        answer.key AS generated_content_id,
        CASE activity.activity_type
          WHEN 'quiz' THEN 'quiz' WHEN 'mission' THEN 'mission'
          WHEN 'bingo' THEN 'bingo' ELSE 'game'
        END AS activity_type,
        COALESCE((answer.value->>'__score')::integer,0) AS score,
        COALESCE(answer.value->>'__status',attempt.status) AS status
      FROM journey.activity_attempts attempt
      JOIN travel.travel_parties party ON party.id=attempt.party_id
        AND party.agency_id=attempt.agency_id AND party.departure_id=attempt.departure_id
      JOIN travel.party_memberships participant ON participant.agency_id=attempt.agency_id
        AND participant.departure_id=attempt.departure_id AND participant.party_id=attempt.party_id
        AND participant.traveler_id=attempt.traveler_id AND participant.status<>'removed'
        AND participant.participates_in_trip_games
      JOIN content.activities activity ON activity.id=attempt.activity_id AND activity.agency_id=attempt.agency_id
      JOIN travel.traveler_profiles profile ON profile.id=attempt.traveler_id AND profile.agency_id=attempt.agency_id
      CROSS JOIN LATERAL jsonb_each(attempt.answers) answer
      WHERE attempt.agency_id=${input.agencyId} AND attempt.departure_id=${input.departureId}
        AND EXISTS(SELECT 1 FROM travel.party_memberships current_participant
          JOIN travel.traveler_profiles current_profile
            ON current_profile.id=current_participant.traveler_id
           AND current_profile.agency_id=current_participant.agency_id
          WHERE current_participant.agency_id=attempt.agency_id
            AND current_participant.departure_id=attempt.departure_id
            AND current_participant.party_id=${input.partyId}::uuid
            AND current_profile.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
            AND current_participant.status<>'removed' AND current_participant.participates_in_trip_games)
    `,
    txn`
      SELECT entry.id::text,entry.party_id::text,party.name AS party_name,
        entry.traveler_id::text,profile.display_name,item.id::text AS generated_content_id,
        judgement.score,entry.is_winner
      FROM journey.photo_contest_entries entry
      JOIN travel.travel_parties party ON party.id=entry.party_id
        AND party.agency_id=entry.agency_id AND party.departure_id=entry.departure_id
      JOIN travel.party_memberships participant ON participant.agency_id=entry.agency_id
        AND participant.departure_id=entry.departure_id AND participant.party_id=entry.party_id
        AND participant.traveler_id=entry.traveler_id AND participant.status<>'removed'
        AND participant.participates_in_trip_games
      JOIN content.activity_items item ON item.activity_id=entry.activity_id
        AND item.agency_id=entry.agency_id AND item.item_kind='contest_rule'
      JOIN travel.traveler_profiles profile ON profile.id=entry.traveler_id AND profile.agency_id=entry.agency_id
      LEFT JOIN LATERAL (
        SELECT judged.score FROM journey.photo_contest_judgements judged
        WHERE judged.agency_id=entry.agency_id AND judged.party_id=entry.party_id
          AND judged.activity_id=entry.activity_id AND judged.entry_id=entry.id
        ORDER BY judged.judged_at DESC,judged.id DESC LIMIT 1
      ) judgement ON true
      WHERE entry.agency_id=${input.agencyId} AND entry.departure_id=${input.departureId}
        AND entry.status='ranked'
        AND EXISTS(SELECT 1 FROM travel.party_memberships current_participant
          JOIN travel.traveler_profiles current_profile
            ON current_profile.id=current_participant.traveler_id
           AND current_profile.agency_id=current_participant.agency_id
          WHERE current_participant.agency_id=entry.agency_id
            AND current_participant.departure_id=entry.departure_id
            AND current_participant.party_id=${input.partyId}::uuid
            AND current_profile.user_id=app.resolve_legacy_user_id(${input.userId},${input.agencyId})
            AND current_participant.status<>'removed' AND current_participant.participates_in_trip_games)
    `,
  ], { readOnly: true });

  const quizCountByDay = new Map<string, number>();
  const boundedChallenges = (challenges as Row[]).filter((challenge) => {
    if (String(challenge.content_type) !== "quiz_question") return true;
    const dayId = String(challenge.trip_day_id || "");
    const count = quizCountByDay.get(dayId) ?? 0;
    if (count >= 10) return false;
    quizCountByDay.set(dayId, count + 1);
    return true;
  });

  return {
    challenges: boundedChallenges,
    photos: photos as Row[],
    results: results as Row[],
    contests: contests as Row[],
    competitionGroups: competitionGroups as Row[],
    competitionResults: competitionResults as Row[],
    competitionContests: competitionContests as Row[],
  };
}
