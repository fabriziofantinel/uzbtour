REVOKE ALL ON FUNCTION app.issue_activity_access_grant(UUID,UUID,UUID,UUID,UUID,CHAR,CHAR,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_activity_access_grant(UUID,UUID,UUID,UUID,UUID,CHAR,CHAR,UUID) TO smf_app;
REVOKE SELECT ON TABLE journey.activity_access_grants FROM smf_app;
INSERT INTO public.platform_schema_migrations(version)
VALUES('107_v3_activity_access_issue_grant') ON CONFLICT(version) DO NOTHING;
