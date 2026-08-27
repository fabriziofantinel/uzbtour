-- Final traveler-domain read retirement. These compatibility tables are no
-- longer referenced by the production traveler experience. They remain owner-
-- readable for audit/rollback, while smf_app can only use normalized V3 data.

REVOKE SELECT ON TABLE
  public.party_expenses,
  public.party_day_notes,
  public.party_restaurants,
  public.party_cash_movements,
  public.traveler_programme_feedback,
  public.party_activity_results,
  public.party_photo_contest_entries,
  public.party_memories,
  public.generated_content
FROM smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('051_v3_legacy_traveler_read_retirement') ON CONFLICT(version) DO NOTHING;
