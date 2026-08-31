CREATE OR REPLACE FUNCTION app.list_departure_branded_web_push_subscriptions_v3(p_departure_id UUID)
RETURNS TABLE(id UUID,endpoint TEXT,p256dh TEXT,auth_secret TEXT,agency_logo_url TEXT)
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,journey SET row_security=off AS $$
  SELECT subscription.id,subscription.endpoint,subscription.p256dh,subscription.auth_secret,
    COALESCE(agency.branding->>'logoUrl','')
  FROM journey.web_push_subscriptions subscription
  JOIN travel.party_memberships membership
    ON membership.agency_id=subscription.agency_id AND membership.traveler_id=subscription.traveler_id
  JOIN iam.agencies agency ON agency.id=subscription.agency_id
  WHERE membership.departure_id=p_departure_id
    AND membership.status='active'
    AND subscription.revoked_at IS NULL
$$;

CREATE OR REPLACE FUNCTION app.list_party_branded_web_push_subscriptions_v3(p_departure UUID,p_party UUID)
RETURNS TABLE(id UUID,endpoint TEXT,p256dh TEXT,auth_secret TEXT,agency_logo_url TEXT)
LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,iam,travel,journey SET row_security=off AS $$
  SELECT subscription.id,subscription.endpoint,subscription.p256dh,subscription.auth_secret,
    COALESCE(agency.branding->>'logoUrl','')
  FROM journey.web_push_subscriptions subscription
  JOIN travel.party_memberships membership
    ON membership.agency_id=subscription.agency_id AND membership.traveler_id=subscription.traveler_id
  JOIN iam.agencies agency ON agency.id=subscription.agency_id
  WHERE membership.departure_id=p_departure
    AND membership.party_id=p_party
    AND membership.status='active'
    AND subscription.revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION app.list_departure_branded_web_push_subscriptions_v3(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_party_branded_web_push_subscriptions_v3(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_departure_branded_web_push_subscriptions_v3(UUID) TO smf_app;
GRANT EXECUTE ON FUNCTION app.list_party_branded_web_push_subscriptions_v3(UUID,UUID) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('120_v3_branded_web_push_subscriptions') ON CONFLICT(version) DO NOTHING;
