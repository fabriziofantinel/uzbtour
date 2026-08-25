import { getSql } from "@/lib/db";

let schemaPromise: Promise<void> | null = null;

export async function ensureProgrammeFeedbackSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS itinerary_item_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agency_id UUID NOT NULL,
          departure_id UUID NOT NULL, itinerary_item_id UUID NOT NULL, media_asset_id UUID NOT NULL,
          document_type TEXT NOT NULL DEFAULT 'ticket' CHECK (document_type IN ('ticket', 'voucher', 'other')),
          title TEXT NOT NULL, created_by_user_id TEXT REFERENCES platform_users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, media_asset_id) REFERENCES media_assets(agency_id, id) ON DELETE CASCADE,
          UNIQUE (agency_id, media_asset_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS itinerary_item_documents_scope_idx ON itinerary_item_documents (departure_id, itinerary_item_id, created_at)`;
      await sql`
        CREATE TABLE IF NOT EXISTS traveler_programme_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agency_id UUID NOT NULL,
          departure_id UUID NOT NULL, party_id UUID NOT NULL, traveler_id UUID NOT NULL,
          trip_day_id UUID NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ('itinerary_item', 'hotel')),
          itinerary_item_id UUID, hotel_id UUID, rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          FOREIGN KEY (agency_id, departure_id) REFERENCES departures(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, party_id) REFERENCES travel_parties(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, traveler_id) REFERENCES traveler_profiles(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, trip_day_id) REFERENCES trip_days(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (agency_id, itinerary_item_id) REFERENCES itinerary_items(agency_id, id) ON DELETE CASCADE,
          FOREIGN KEY (hotel_id) REFERENCES hotels(id) ON DELETE CASCADE,
          CHECK (
            (target_type = 'itinerary_item' AND itinerary_item_id IS NOT NULL AND hotel_id IS NULL)
            OR (target_type = 'hotel' AND hotel_id IS NOT NULL AND itinerary_item_id IS NULL)
          )
        )
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS traveler_programme_item_feedback_uidx
        ON traveler_programme_feedback (departure_id, party_id, traveler_id, itinerary_item_id)
        WHERE itinerary_item_id IS NOT NULL
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS traveler_programme_hotel_feedback_uidx
        ON traveler_programme_feedback (departure_id, party_id, traveler_id, trip_day_id, hotel_id)
        WHERE hotel_id IS NOT NULL
      `;
      await sql`CREATE INDEX IF NOT EXISTS traveler_programme_feedback_analysis_idx ON traveler_programme_feedback (agency_id, target_type, rating, updated_at DESC)`;
      await sql`
        INSERT INTO platform_schema_migrations (version) VALUES ('010_programme_tickets_feedback')
        ON CONFLICT (version) DO NOTHING
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}
