-- Enforce single Stripe Connect account mapping per user
-- Source of truth: stripe_connected_accounts(user_id -> stripe_account_id)

-- 1) Ensure unified mapping table exists (idempotent safety for older environments)
CREATE TABLE IF NOT EXISTS stripe_connected_accounts (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  charges_enabled BOOLEAN DEFAULT FALSE,
  payouts_enabled BOOLEAN DEFAULT FALSE,
  details_submitted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stripe_connected_accounts_stripe_account_id_idx
  ON stripe_connected_accounts(stripe_account_id);

-- 2) Backfill from legacy providers table when present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'providers'
  ) THEN
    EXECUTE $sql$
      INSERT INTO stripe_connected_accounts (user_id, stripe_account_id)
      SELECT provider_id, stripe_account_id
      FROM providers
      WHERE stripe_account_id IS NOT NULL
      ON CONFLICT (user_id) DO NOTHING
    $sql$;
  END IF;
END $$;

-- 3) Backfill from any legacy role-specific account columns if present
DO $$
DECLARE
  legacy_source RECORD;
BEGIN
  FOR legacy_source IN
    SELECT
      c.table_schema,
      c.table_name,
      c.column_name,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM information_schema.columns c2
          WHERE c2.table_schema = c.table_schema
            AND c2.table_name = c.table_name
            AND c2.column_name = 'user_id'
        ) THEN 'user_id'
        WHEN EXISTS (
          SELECT 1
          FROM information_schema.columns c2
          WHERE c2.table_schema = c.table_schema
            AND c2.table_name = c.table_name
            AND c2.column_name = 'provider_id'
        ) THEN 'provider_id'
        ELSE NULL
      END AS id_column
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('event_stripe_account_id', 'service_stripe_account_id')
  LOOP
    IF legacy_source.id_column IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'INSERT INTO stripe_connected_accounts (user_id, stripe_account_id) '
      || 'SELECT %I, %I FROM %I.%I '
      || 'WHERE %I IS NOT NULL AND %I IS NOT NULL '
      || 'ON CONFLICT (user_id) DO NOTHING',
      legacy_source.id_column,
      legacy_source.column_name,
      legacy_source.table_schema,
      legacy_source.table_name,
      legacy_source.id_column,
      legacy_source.column_name
    );
  END LOOP;
END $$;

-- 4) Mirror any legacy readiness/onboarded flags to unified readiness where columns still exist
--    Unified rule: isReadyForPayouts = charges_enabled AND payouts_enabled
DO $$
DECLARE
  target_table RECORD;
  id_column TEXT;
BEGIN
  FOR target_table IN
    SELECT DISTINCT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name IN (
        'event_provider_onboarded',
        'service_provider_onboarded',
        'is_event_provider_ready',
        'is_service_provider_ready'
      )
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'user_id'
    ) THEN
      id_column := 'user_id';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'provider_id'
    ) THEN
      id_column := 'provider_id';
    ELSE
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'event_provider_onboarded'
    ) THEN
      EXECUTE format(
        'UPDATE %I.%I t '
        || 'SET event_provider_onboarded = COALESCE(sca.charges_enabled AND sca.payouts_enabled, FALSE) '
        || 'FROM stripe_connected_accounts sca '
        || 'WHERE t.%I = sca.user_id',
        target_table.table_schema,
        target_table.table_name,
        id_column
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'service_provider_onboarded'
    ) THEN
      EXECUTE format(
        'UPDATE %I.%I t '
        || 'SET service_provider_onboarded = COALESCE(sca.charges_enabled AND sca.payouts_enabled, FALSE) '
        || 'FROM stripe_connected_accounts sca '
        || 'WHERE t.%I = sca.user_id',
        target_table.table_schema,
        target_table.table_name,
        id_column
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'is_event_provider_ready'
    ) THEN
      EXECUTE format(
        'UPDATE %I.%I t '
        || 'SET is_event_provider_ready = COALESCE(sca.charges_enabled AND sca.payouts_enabled, FALSE) '
        || 'FROM stripe_connected_accounts sca '
        || 'WHERE t.%I = sca.user_id',
        target_table.table_schema,
        target_table.table_name,
        id_column
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target_table.table_schema
        AND c.table_name = target_table.table_name
        AND c.column_name = 'is_service_provider_ready'
    ) THEN
      EXECUTE format(
        'UPDATE %I.%I t '
        || 'SET is_service_provider_ready = COALESCE(sca.charges_enabled AND sca.payouts_enabled, FALSE) '
        || 'FROM stripe_connected_accounts sca '
        || 'WHERE t.%I = sca.user_id',
        target_table.table_schema,
        target_table.table_name,
        id_column
      );
    END IF;
  END LOOP;
END $$;
