CREATE TABLE IF NOT EXISTS ops.tenant_storage_limits (
  agency_id UUID REFERENCES iam.agencies(id) ON DELETE CASCADE,
  total_bytes BIGINT NOT NULL CHECK (total_bytes > 0),
  photo_bytes BIGINT NOT NULL CHECK (photo_bytes > 0 AND photo_bytes <= total_bytes),
  document_bytes BIGINT NOT NULL CHECK (document_bytes > 0 AND document_bytes <= total_bytes),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_by UUID REFERENCES iam.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_storage_limits_platform_uq
  ON ops.tenant_storage_limits ((agency_id IS NULL))
  WHERE agency_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_storage_limits_agency_uq
  ON ops.tenant_storage_limits (agency_id)
  WHERE agency_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS media_assets_agency_live_purpose_size_idx
  ON ops.media_assets (agency_id, purpose)
  INCLUDE (size_bytes)
  WHERE status <> 'deleted' AND deleted_at IS NULL;

REVOKE ALL ON TABLE ops.tenant_storage_limits FROM PUBLIC, smf_app;

INSERT INTO ops.tenant_storage_limits(agency_id, total_bytes, photo_bytes, document_bytes)
VALUES (NULL, 10737418240, 7516192768, 5368709120)
ON CONFLICT ((agency_id IS NULL)) WHERE agency_id IS NULL DO UPDATE
SET total_bytes = EXCLUDED.total_bytes,
    photo_bytes = EXCLUDED.photo_bytes,
    document_bytes = EXCLUDED.document_bytes,
    updated_at = clock_timestamp();

CREATE OR REPLACE FUNCTION app.assert_tenant_storage_capacity_v3(
  p_agency_id UUID,
  p_size_bytes BIGINT,
  p_category TEXT,
  p_excluded_media_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, iam, ops
SET row_security = off
AS $$
DECLARE
  v_total_limit BIGINT;
  v_category_limit BIGINT;
  v_total_used BIGINT;
  v_category_used BIGINT;
BEGIN
  IF p_agency_id IS NULL OR p_size_bytes <= 0 OR p_category NOT IN ('photo', 'document') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid storage quota request';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('storage:' || p_agency_id::text, 0));

  SELECT limits.total_bytes,
    CASE p_category WHEN 'photo' THEN limits.photo_bytes ELSE limits.document_bytes END
  INTO v_total_limit, v_category_limit
  FROM ops.tenant_storage_limits limits
  WHERE limits.agency_id = p_agency_id OR limits.agency_id IS NULL
  ORDER BY (limits.agency_id = p_agency_id) DESC
  LIMIT 1;

  IF v_total_limit IS NULL OR v_category_limit IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'tenant storage limits are not configured';
  END IF;

  SELECT
    COALESCE(sum(COALESCE(asset.size_bytes, 0)), 0),
    COALESCE(sum(COALESCE(asset.size_bytes, 0)) FILTER (
      WHERE CASE p_category
        WHEN 'photo' THEN asset.purpose IN ('memory', 'challenge_evidence', 'contest_entry')
        ELSE asset.purpose NOT IN ('memory', 'challenge_evidence', 'contest_entry')
      END
    ), 0)
  INTO v_total_used, v_category_used
  FROM ops.media_assets asset
  WHERE asset.agency_id = p_agency_id
    AND asset.status <> 'deleted'
    AND asset.deleted_at IS NULL
    AND (p_excluded_media_id IS NULL OR asset.id <> p_excluded_media_id);

  IF v_total_used + p_size_bytes > v_total_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '53100',
      MESSAGE = 'tenant storage quota exceeded',
      DETAIL = format('category=total used=%s requested=%s limit=%s', v_total_used, p_size_bytes, v_total_limit);
  END IF;
  IF v_category_used + p_size_bytes > v_category_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '53100',
      MESSAGE = 'tenant storage quota exceeded',
      DETAIL = format(
        'category=%s used=%s requested=%s limit=%s',
        p_category,
        v_category_used,
        p_size_bytes,
        v_category_limit
      );
  END IF;
END
$$;

REVOKE ALL ON FUNCTION app.assert_tenant_storage_capacity_v3(UUID, BIGINT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.assert_tenant_storage_capacity_v3(UUID, BIGINT, TEXT, UUID) TO smf_app;

CREATE OR REPLACE FUNCTION ops.enforce_media_asset_storage_quota_v3()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, ops
SET row_security = off
AS $$
BEGIN
  IF NEW.status <> 'deleted' AND NEW.deleted_at IS NULL AND COALESCE(NEW.size_bytes, 0) > 0 THEN
    PERFORM app.assert_tenant_storage_capacity_v3(
      NEW.agency_id,
      NEW.size_bytes,
      CASE
        WHEN NEW.purpose IN ('memory', 'challenge_evidence', 'contest_entry') THEN 'photo'
        ELSE 'document'
      END,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END
    );
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION ops.enforce_media_asset_storage_quota_v3() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_media_asset_storage_quota_v3 ON ops.media_assets;
CREATE TRIGGER enforce_media_asset_storage_quota_v3
BEFORE INSERT OR UPDATE OF agency_id, size_bytes, purpose, status, deleted_at
ON ops.media_assets
FOR EACH ROW EXECUTE FUNCTION ops.enforce_media_asset_storage_quota_v3();

INSERT INTO public.platform_schema_migrations(version)
VALUES ('137_v3_tenant_storage_quotas')
ON CONFLICT (version) DO NOTHING;
