import "server-only";

import { getSql } from "@/lib/db";
import { PlatformRequestError } from "./errors";

export type PostTripReview = {
  eligible: boolean;
  rating: number | null;
  comment: string;
  referralCode: string;
  publicReviewUrl: string;
  agencyName: string;
  submittedAt: string | null;
};

export async function readOwnPostTripReview(actorId: string, departureId: string, partyId: string) {
  const rows = await getSql()`SELECT * FROM app.read_own_post_trip_review_v3(
    ${actorId}::uuid,${departureId}::uuid,${partyId}::uuid)`;
  if (!rows[0]) throw new PlatformRequestError("Valutazione post-viaggio non disponibile");
  return {
    eligible: Boolean(rows[0].eligible),
    rating: rows[0].rating == null ? null : Number(rows[0].rating),
    comment: String(rows[0].comment || ""),
    referralCode: String(rows[0].referral_code || ""),
    publicReviewUrl: String(rows[0].public_review_url || ""),
    agencyName: String(rows[0].agency_name || ""),
    submittedAt: rows[0].submitted_at == null ? null : String(rows[0].submitted_at),
  } satisfies PostTripReview;
}

export async function saveOwnPostTripReview(input: {
  actorId: string;
  departureId: string;
  partyId: string;
  rating: number;
  comment: string;
  clientOperationId: string;
}) {
  const rows = await getSql()`SELECT review_id::text,referral_code FROM app.save_own_post_trip_review_v3(
    ${input.actorId}::uuid,${input.departureId}::uuid,${input.partyId}::uuid,${input.rating},${input.comment},
    ${input.clientOperationId}::uuid)`;
  if (!rows[0]) throw new PlatformRequestError("Valutazione non salvata");
  return { id: String(rows[0].review_id), referralCode: String(rows[0].referral_code) };
}

export async function readAgencyPostTripSettings(actorId: string, agencyId: string) {
  const rows = await getSql()`SELECT * FROM app.read_agency_post_trip_settings_v3(${actorId}::uuid,${agencyId}::uuid)`;
  return { publicReviewUrl: String(rows[0]?.public_review_url || "") };
}

export async function updateAgencyPostTripSettings(actorId: string, agencyId: string, publicReviewUrl: string) {
  const rows = await getSql()`SELECT app.update_agency_post_trip_settings_v3(
    ${actorId}::uuid,${agencyId}::uuid,${publicReviewUrl}) saved`;
  if (!rows[0]?.saved) throw new PlatformRequestError("Impostazioni non salvate");
}
