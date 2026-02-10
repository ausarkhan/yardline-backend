-- Provider Stripe Connect accounts
-- Ensures a single Stripe connected account per provider

CREATE TABLE IF NOT EXISTS providers (
  provider_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS providers_stripe_account_id_idx ON providers(stripe_account_id);

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Providers can view their profile" ON providers;
CREATE POLICY "Providers can view their profile"
  ON providers FOR SELECT
  USING (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Providers can insert their profile" ON providers;
CREATE POLICY "Providers can insert their profile"
  ON providers FOR INSERT
  WITH CHECK (auth.uid() = provider_id);

DROP POLICY IF EXISTS "Providers can update their profile" ON providers;
CREATE POLICY "Providers can update their profile"
  ON providers FOR UPDATE
  USING (auth.uid() = provider_id);

DROP TRIGGER IF EXISTS providers_updated_at_trigger ON providers;
CREATE TRIGGER providers_updated_at_trigger
  BEFORE UPDATE ON providers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
