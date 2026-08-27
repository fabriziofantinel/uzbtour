import "server-only";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3GamificationCutoverReadEnabled() {
  return process.env.V3_GAMIFICATION_READ_SOURCE === "v3";
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
  const sql = getSql();
  const [, challenges, photos, results, contests] = await sql.transaction((txn) => [
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
            'contestCategory',activity.contest_category)
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
      WHERE activity.agency_id=${input.agencyId}
        AND activity.template_version_id=${input.templateVersionId}
        AND activity.status='approved'
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
      ORDER BY entry.submitted_at DESC
    `,
  ], { readOnly: true });

  return {
    challenges: challenges as Row[],
    photos: photos as Row[],
    results: results as Row[],
    contests: contests as Row[],
  };
}
