CREATE TABLE IF NOT EXISTS journey.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  agency_id UUID NOT NULL REFERENCES iam.agencies(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  traveler_id UUID REFERENCES travel.traveler_profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  endpoint_hash CHAR(64) NOT NULL CHECK(endpoint_hash ~ '^[0-9a-f]{64}$'),
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  user_agent TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(agency_id,endpoint_hash)
);
CREATE INDEX IF NOT EXISTS web_push_subscription_tenant_user_idx
  ON journey.web_push_subscriptions(agency_id,user_id,revoked_at,updated_at DESC);
ALTER TABLE journey.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey.web_push_subscriptions FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app.upsert_own_web_push_subscription_v3(
  p_actor_subject TEXT,p_endpoint TEXT,p_p256dh TEXT,p_auth TEXT,p_user_agent TEXT,p_expiration TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey SET row_security=off AS $$
DECLARE v_user UUID;v_agency UUID;v_traveler UUID;v_id UUID;
BEGIN
  v_user:=app.resolve_cognito_authenticated_user(p_actor_subject);
  SELECT profile.agency_id,profile.id INTO v_agency,v_traveler
  FROM travel.traveler_profiles profile
  JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id
  JOIN travel.departures departure ON departure.id=membership.departure_id AND departure.agency_id=membership.agency_id
  WHERE profile.user_id=v_user AND departure.status IN('open','confirmed','in_progress')
  ORDER BY departure.starts_on DESC LIMIT 1;
  IF v_agency IS NULL OR p_endpoint IS NULL OR p_endpoint='' OR p_p256dh='' OR p_auth='' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler push subscription is not authorized';
  END IF;
  INSERT INTO journey.web_push_subscriptions(agency_id,user_id,traveler_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent,expires_at)
  VALUES(v_agency,v_user,v_traveler,p_endpoint,encode(digest(p_endpoint,'sha256'),'hex'),p_p256dh,p_auth,p_user_agent,p_expiration)
  ON CONFLICT(agency_id,endpoint_hash) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth_secret=EXCLUDED.auth_secret,
    user_agent=EXCLUDED.user_agent,expires_at=EXCLUDED.expires_at,revoked_at=NULL,updated_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON TABLE journey.web_push_subscriptions FROM PUBLIC;
REVOKE ALL ON FUNCTION app.upsert_own_web_push_subscription_v3(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.upsert_own_web_push_subscription_v3(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;
CREATE OR REPLACE FUNCTION app.list_departure_web_push_subscriptions_v3(p_departure_id UUID)
RETURNS TABLE(id UUID,endpoint TEXT,p256dh TEXT,auth_secret TEXT) LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,travel,journey SET row_security=off AS $$
  SELECT subscription.id,subscription.endpoint,subscription.p256dh,subscription.auth_secret
  FROM journey.web_push_subscriptions subscription
  JOIN travel.party_memberships membership ON membership.agency_id=subscription.agency_id AND membership.traveler_id=subscription.traveler_id
  WHERE membership.departure_id=p_departure_id AND subscription.revoked_at IS NULL
$$;
CREATE OR REPLACE FUNCTION app.revoke_web_push_subscription_v3(p_id UUID) RETURNS VOID LANGUAGE sql SECURITY DEFINER
SET search_path=pg_catalog,journey SET row_security=off AS $$
  UPDATE journey.web_push_subscriptions SET revoked_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id
$$;
REVOKE ALL ON FUNCTION app.list_departure_web_push_subscriptions_v3(UUID),app.revoke_web_push_subscription_v3(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_departure_web_push_subscriptions_v3(UUID),app.revoke_web_push_subscription_v3(UUID) TO smf_app;
INSERT INTO public.platform_schema_migrations(version) VALUES('093_v3_web_push_subscriptions') ON CONFLICT(version) DO NOTHING;
