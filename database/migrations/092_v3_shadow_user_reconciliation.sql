INSERT INTO ops.legacy_id_map(source_system,entity_type,legacy_id)
SELECT 'public-v2','user',legacy.id
  FROM public.platform_users legacy
ON CONFLICT(source_system,entity_type,legacy_id) DO NOTHING;

INSERT INTO iam.users(
  id,username,display_name,email,phone,platform_role,status,created_at,updated_at
)
SELECT map.target_id,legacy.username,legacy.display_name,legacy.email,legacy.phone,
       legacy.platform_role,legacy.status,legacy.created_at,legacy.updated_at
  FROM public.platform_users legacy
  JOIN ops.legacy_id_map map
    ON map.source_system='public-v2'
   AND map.entity_type='user'
   AND map.legacy_id=legacy.id
ON CONFLICT(id) DO UPDATE SET
  username=EXCLUDED.username,
  display_name=EXCLUDED.display_name,
  email=EXCLUDED.email,
  phone=EXCLUDED.phone,
  platform_role=EXCLUDED.platform_role,
  status=EXCLUDED.status,
  updated_at=EXCLUDED.updated_at;

INSERT INTO public.platform_schema_migrations(version)
VALUES('092_v3_shadow_user_reconciliation')
ON CONFLICT(version) DO NOTHING;
