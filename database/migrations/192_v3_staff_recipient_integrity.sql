CREATE INDEX IF NOT EXISTS staff_communication_recipients_tenant_idx
  ON ops.staff_departure_communication_recipients(agency_id,departure_id,communication_id,user_id);

ALTER TABLE ops.travel_documents VALIDATE CONSTRAINT travel_documents_day_audience_ck;
ALTER TABLE travel.departure_insurance_policies VALIDATE CONSTRAINT departure_insurance_audience_ck;

INSERT INTO public.platform_schema_migrations(version)
VALUES('192_v3_staff_recipient_integrity') ON CONFLICT(version) DO NOTHING;
