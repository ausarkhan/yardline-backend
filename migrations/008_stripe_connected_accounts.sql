-- Unified Stripe Connect account mapping
-- Single source of truth: one connected account per app user

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

DROP TRIGGER IF EXISTS stripe_connected_accounts_updated_at_trigger ON stripe_connected_accounts;
CREATE TRIGGER stripe_connected_accounts_updated_at_trigger
  BEFORE UPDATE ON stripe_connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Backfill from legacy providers table when available
INSERT INTO stripe_connected_accounts (user_id, stripe_account_id)
SELECT provider_id, stripe_account_id
FROM providers
WHERE stripe_account_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET stripe_account_id = EXCLUDED.stripe_account_id,
    updated_at = NOW();
