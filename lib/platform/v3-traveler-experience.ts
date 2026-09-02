import { createHash } from "node:crypto";

import { getSql } from "@/lib/db";

type Row = Record<string, unknown>;

export function v3TravelerExperienceShadowReadEnabled() {
  return process.env.V3_TRAVELER_EXPERIENCE_SHADOW_READ === "true";
}

function digest(rows: unknown[]) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function ordered(rows: Row[], keys: string[]) {
  return rows
    .map((row) =>
      Object.fromEntries(
        keys.map((key) => [
          key,
          row[key] == null ? null : typeof row[key] === "number" ? Number(row[key]) : String(row[key]),
        ]),
      ),
    )
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function report(domain: string, scope: Record<string, string>, legacy: unknown[], target: unknown[]) {
  const legacyDigest = digest(legacy);
  const targetDigest = digest(target);
  if (legacyDigest !== targetDigest) {
    console.error(`[v3-shadow] ${domain} mismatch`, {
      ...scope,
      legacyCount: legacy.length,
      targetCount: target.length,
      legacyDigest,
      targetDigest,
    });
  }
}

export async function compareV3TravelerExperienceShadow(input: {
  agencyId: string;
  departureId: string;
  partyId: string;
  legacyPhotos: Row[];
  legacyResults: Row[];
  legacyContestEntries: Row[];
}) {
  if (!v3TravelerExperienceShadowReadEnabled()) return;
  const sql = getSql();
  try {
    const [, photos, results, contests] = await sql.transaction(
      (txn) => [
        txn`SELECT set_config('app.agency_id', ${input.agencyId}, true)`,
        txn`
        SELECT memory.id::text, day.template_day_id::text AS trip_day_id,
          memory.media_asset_id::text AS media_id
        FROM journey.memories memory
        JOIN travel.departure_days day ON day.id=memory.departure_day_id
          AND day.agency_id=memory.agency_id AND day.departure_id=memory.departure_id
        WHERE memory.agency_id=${input.agencyId} AND memory.departure_id=${input.departureId}
          AND memory.party_id=${input.partyId}
        ORDER BY memory.id
      `,
        txn`
        SELECT answer.key AS generated_content_id, attempt.traveler_id::text,
          day.template_day_id::text AS trip_day_id, activity.activity_type
        FROM journey.activity_attempts attempt
        JOIN content.activities activity ON activity.id=attempt.activity_id
          AND activity.agency_id=attempt.agency_id
        LEFT JOIN travel.departure_days day ON day.id=attempt.departure_day_id
          AND day.agency_id=attempt.agency_id
        CROSS JOIN LATERAL jsonb_each(attempt.answers) answer
        LEFT JOIN content.activity_items item ON item.id=answer.key::uuid
          AND item.activity_id=attempt.activity_id AND item.agency_id=attempt.agency_id
        WHERE attempt.agency_id=${input.agencyId} AND attempt.departure_id=${input.departureId}
          AND attempt.party_id=${input.partyId}
        ORDER BY answer.key
      `,
        txn`
        SELECT entry.id::text, entry.traveler_id::text, item.id::text AS generated_content_id,
          entry.media_asset_id::text, entry.participant_slot, entry.status, entry.is_winner
        FROM journey.photo_contest_entries entry
        JOIN content.activity_items item ON item.activity_id=entry.activity_id
          AND item.agency_id=entry.agency_id AND item.item_kind='contest_rule'
        WHERE entry.agency_id=${input.agencyId} AND entry.departure_id=${input.departureId}
          AND entry.party_id=${input.partyId}
        ORDER BY entry.id
      `,
      ],
      { readOnly: true },
    );

    const scope = { agencyId: input.agencyId, departureId: input.departureId, partyId: input.partyId };
    report(
      "media memories",
      scope,
      ordered(input.legacyPhotos, ["id", "trip_day_id", "media_id"]),
      ordered(photos as Row[], ["id", "trip_day_id", "media_id"]),
    );
    report(
      "gamification",
      scope,
      ordered(input.legacyResults, ["generated_content_id", "traveler_id", "trip_day_id", "activity_type"]),
      ordered(results as Row[], ["generated_content_id", "traveler_id", "trip_day_id", "activity_type"]),
    );
    report(
      "photo contests",
      scope,
      ordered(input.legacyContestEntries, [
        "id",
        "traveler_id",
        "generated_content_id",
        "media_asset_id",
        "participant_slot",
        "status",
        "is_winner",
      ]),
      ordered(contests as Row[], [
        "id",
        "traveler_id",
        "generated_content_id",
        "media_asset_id",
        "participant_slot",
        "status",
        "is_winner",
      ]),
    );
  } catch (error) {
    console.error("[v3-shadow] traveler experience comparison failed", {
      agencyId: input.agencyId,
      departureId: input.departureId,
      partyId: input.partyId,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
