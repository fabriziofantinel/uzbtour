CREATE OR REPLACE FUNCTION app.upsert_own_web_push_subscription_v3(
  p_actor_subject TEXT,p_endpoint TEXT,p_p256dh TEXT,p_auth TEXT,p_user_agent TEXT,p_expiration TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,app,iam,travel,journey SET row_security=off AS $$
DECLARE v_user UUID;v_id UUID;v_first UUID;candidate RECORD;
BEGIN
  SELECT users.id INTO v_user
  FROM iam.user_identities identity
  JOIN iam.users users ON users.id=identity.user_id AND users.status='active'
  WHERE identity.provider='cognito' AND identity.subject=p_actor_subject;
  IF v_user IS NULL OR COALESCE(p_endpoint,'')='' OR COALESCE(p_p256dh,'')='' OR COALESCE(p_auth,'')='' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler push subscription is not authorized';
  END IF;
  FOR candidate IN
    SELECT DISTINCT ON(profile.agency_id) profile.agency_id,profile.id AS traveler_id
    FROM travel.traveler_profiles profile
    JOIN travel.party_memberships membership ON membership.agency_id=profile.agency_id AND membership.traveler_id=profile.id AND membership.status='active'
    JOIN travel.departures departure ON departure.id=membership.departure_id AND departure.agency_id=membership.agency_id
    JOIN iam.agencies agency ON agency.id=profile.agency_id AND agency.status IN('trial','active')
    WHERE profile.user_id=v_user AND departure.status IN('open','confirmed','in_progress')
    ORDER BY profile.agency_id,departure.starts_on DESC
  LOOP
    INSERT INTO journey.web_push_subscriptions(agency_id,user_id,traveler_id,endpoint,endpoint_hash,p256dh,auth_secret,user_agent,expires_at)
    VALUES(candidate.agency_id,v_user,candidate.traveler_id,p_endpoint,encode(app.digest(p_endpoint,'sha256'),'hex'),p_p256dh,p_auth,p_user_agent,p_expiration)
    ON CONFLICT(agency_id,endpoint_hash) DO UPDATE SET user_id=EXCLUDED.user_id,traveler_id=EXCLUDED.traveler_id,
      p256dh=EXCLUDED.p256dh,auth_secret=EXCLUDED.auth_secret,user_agent=EXCLUDED.user_agent,
      expires_at=EXCLUDED.expires_at,revoked_at=NULL,updated_at=clock_timestamp()
    RETURNING id INTO v_id;
    v_first:=COALESCE(v_first,v_id);
  END LOOP;
  IF v_first IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='traveler push subscription is not authorized';
  END IF;
  RETURN v_first;
END $$;

REVOKE ALL ON FUNCTION app.upsert_own_web_push_subscription_v3(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.upsert_own_web_push_subscription_v3(TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ) TO smf_app;

INSERT INTO public.platform_schema_migrations(version)
VALUES('113_v3_web_push_identity_contract') ON CONFLICT(version) DO NOTHING;
