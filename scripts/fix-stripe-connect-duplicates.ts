import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

type AccountCandidate = {
  id: string;
  userId: string;
  email: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  created: number;
  source: string[];
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY =
  process.env.STRIPE_LIVE_SECRET_KEY ||
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_TEST_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN !== 'false';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_*_SECRET_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia' as any
});

async function listAllConnectedAccounts(): Promise<Stripe.Account[]> {
  const accounts: Stripe.Account[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const page = await stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    accounts.push(...page.data);

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return accounts;
}

function mergeCandidate(
  map: Map<string, AccountCandidate>,
  input: AccountCandidate,
  sourceLabel: string
) {
  const existing = map.get(input.id);
  if (!existing) {
    map.set(input.id, { ...input, source: [sourceLabel] });
    return;
  }

  existing.chargesEnabled = existing.chargesEnabled || input.chargesEnabled;
  existing.payoutsEnabled = existing.payoutsEnabled || input.payoutsEnabled;
  existing.detailsSubmitted = existing.detailsSubmitted || input.detailsSubmitted;
  existing.email = existing.email || input.email;
  existing.created = Math.min(existing.created || input.created, input.created || existing.created);
  if (!existing.source.includes(sourceLabel)) {
    existing.source.push(sourceLabel);
  }
}

function choosePrimary(candidates: AccountCandidate[]): AccountCandidate {
  return [...candidates].sort((a, b) => {
    const score = (candidate: AccountCandidate) => {
      if (candidate.payoutsEnabled && candidate.chargesEnabled) return 3;
      if (candidate.payoutsEnabled || candidate.chargesEnabled) return 2;
      if (candidate.detailsSubmitted) return 1;
      return 0;
    };

    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) return scoreDiff;

    return a.created - b.created;
  })[0];
}

async function main() {
  console.log('=== Stripe Connect Duplicate Fix ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE_WRITE'}`);

  const allStripeAccounts = await listAllConnectedAccounts();
  console.log(`Loaded ${allStripeAccounts.length} connected accounts from Stripe`);

  const { data: mappedRows, error: mappedError } = await supabase
    .from('stripe_connected_accounts')
    .select('user_id, stripe_account_id');

  if (mappedError) throw mappedError;

  const { data: providerRows, error: providerError } = await supabase
    .from('providers')
    .select('provider_id, stripe_account_id')
    .not('stripe_account_id', 'is', null);

  if (providerError) throw providerError;

  const userCandidates = new Map<string, Map<string, AccountCandidate>>();

  const addForUser = (userId: string, candidate: AccountCandidate, sourceLabel: string) => {
    if (!userCandidates.has(userId)) {
      userCandidates.set(userId, new Map());
    }
    mergeCandidate(userCandidates.get(userId)!, candidate, sourceLabel);
  };

  for (const account of allStripeAccounts) {
    const metadataUserId = account.metadata?.user_id;
    if (metadataUserId) {
      addForUser(
        metadataUserId,
        {
          id: account.id,
          userId: metadataUserId,
          email: account.email || null,
          chargesEnabled: !!account.charges_enabled,
          payoutsEnabled: !!account.payouts_enabled,
          detailsSubmitted: !!account.details_submitted,
          created: account.created || 0,
          source: []
        },
        'stripe_metadata'
      );
    }
  }

  const trackedUserIds = new Set<string>();

  for (const row of mappedRows || []) {
    trackedUserIds.add(row.user_id);
    const stripeAccount = allStripeAccounts.find(account => account.id === row.stripe_account_id);
    addForUser(
      row.user_id,
      {
        id: row.stripe_account_id,
        userId: row.user_id,
        email: stripeAccount?.email || null,
        chargesEnabled: !!stripeAccount?.charges_enabled,
        payoutsEnabled: !!stripeAccount?.payouts_enabled,
        detailsSubmitted: !!stripeAccount?.details_submitted,
        created: stripeAccount?.created || 0,
        source: []
      },
      'db_stripe_connected_accounts'
    );
  }

  for (const row of providerRows || []) {
    trackedUserIds.add(row.provider_id);
    const stripeAccount = allStripeAccounts.find(account => account.id === row.stripe_account_id);
    addForUser(
      row.provider_id,
      {
        id: row.stripe_account_id,
        userId: row.provider_id,
        email: stripeAccount?.email || null,
        chargesEnabled: !!stripeAccount?.charges_enabled,
        payoutsEnabled: !!stripeAccount?.payouts_enabled,
        detailsSubmitted: !!stripeAccount?.details_submitted,
        created: stripeAccount?.created || 0,
        source: []
      },
      'db_providers'
    );
  }

  for (const userId of trackedUserIds) {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) continue;

    const normalizedEmail = data.user.email.trim().toLowerCase();
    const emailMatches = allStripeAccounts.filter(
      account => (account.email || '').trim().toLowerCase() === normalizedEmail
    );

    for (const account of emailMatches) {
      addForUser(
        userId,
        {
          id: account.id,
          userId,
          email: account.email || null,
          chargesEnabled: !!account.charges_enabled,
          payoutsEnabled: !!account.payouts_enabled,
          detailsSubmitted: !!account.details_submitted,
          created: account.created || 0,
          source: []
        },
        'stripe_email_fallback'
      );
    }
  }

  let duplicatesFound = 0;
  let mappingsUpdated = 0;

  for (const [userId, candidatesMap] of userCandidates.entries()) {
    const candidates = [...candidatesMap.values()];
    if (candidates.length === 0) continue;

    const primary = choosePrimary(candidates);
    const duplicates = candidates.filter(candidate => candidate.id !== primary.id);

    if (duplicates.length > 0) {
      duplicatesFound += 1;
      console.log(`\nUser ${userId} has ${candidates.length} connected accounts`);
      console.log(
        `Primary: ${primary.id} (charges=${primary.chargesEnabled}, payouts=${primary.payoutsEnabled}, details=${primary.detailsSubmitted}, source=${primary.source.join(',')})`
      );
      for (const duplicate of duplicates) {
        console.log(
          `Duplicate: ${duplicate.id} (charges=${duplicate.chargesEnabled}, payouts=${duplicate.payoutsEnabled}, details=${duplicate.detailsSubmitted}, source=${duplicate.source.join(',')})`
        );
      }
    }

    if (!DRY_RUN) {
      const { error: upsertError } = await supabase
        .from('stripe_connected_accounts')
        .upsert(
          {
            user_id: userId,
            stripe_account_id: primary.id,
            charges_enabled: primary.chargesEnabled,
            payouts_enabled: primary.payoutsEnabled,
            details_submitted: primary.detailsSubmitted,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );

      if (upsertError) throw upsertError;

      const { error: providerUpsertError } = await supabase
        .from('providers')
        .upsert(
          {
            provider_id: userId,
            stripe_account_id: primary.id,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'provider_id' }
        );

      if (providerUpsertError) throw providerUpsertError;
    }

    mappingsUpdated += 1;
  }

  console.log('\n=== Summary ===');
  console.log(`Users evaluated: ${userCandidates.size}`);
  console.log(`Users with duplicates: ${duplicatesFound}`);
  console.log(`Mappings processed: ${mappingsUpdated}`);
  console.log(`Write mode: ${DRY_RUN ? 'dry-run (no writes)' : 'live updates complete'}`);
}

main().catch(error => {
  console.error('Duplicate cleanup failed:', error);
  process.exit(1);
});
