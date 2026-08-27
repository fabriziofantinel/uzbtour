import "server-only";

import { randomUUID } from "node:crypto";

import { getSql } from "@/lib/db";

type ActivityResultStatus = "submitted" | "approved" | "rejected";

export async function saveV3ActivityItemResult(input: {
  userId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  dayId: string;
  itemId: string;
  score: number;
  maxScore: number;
  status: ActivityResultStatus;
  result: Record<string, unknown>;
  mediaId?: string | null;
  resultId?: string;
}) {
  const sql = getSql();
  const resultId = input.resultId ?? randomUUID();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
    txn`SELECT * FROM app.save_activity_item_result_v3(
      ${input.userId},${input.agencyId},${input.departureId},${input.partyId},${input.dayId},
      ${input.itemId},${resultId},${input.score},${input.maxScore},${input.status},
      ${JSON.stringify(input.result)}::jsonb,${input.mediaId ?? null}::uuid)`,
  ]);
  return rows[0] as Record<string, unknown>;
}

export async function addV3PhotoContestEntry(input: {
  userId: string;
  agencyId: string;
  departureId: string;
  partyId: string;
  dayId: string;
  itemId: string;
  mediaId: string;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
    txn`SELECT * FROM app.add_photo_contest_entry_v3(
      ${input.userId},${input.agencyId},${input.departureId},${input.partyId},${input.dayId},
      ${input.itemId},${input.mediaId},${randomUUID()})`,
  ]);
  return rows[0] as Record<string, unknown>;
}

export async function reviewV3ActivityEvidence(input: {
  userId: string;
  agencyId: string;
  partyId: string;
  resultId: string;
  approved: boolean;
}) {
  const sql = getSql();
  const [, rows] = await sql.transaction((txn) => [
    txn`SELECT set_config('app.agency_id',${input.agencyId},true)`,
    txn`SELECT * FROM app.review_activity_evidence_v3(
      ${input.userId},${input.agencyId},${input.partyId},${input.resultId},${input.approved})`,
  ]);
  return rows[0] as Record<string, unknown>;
}
