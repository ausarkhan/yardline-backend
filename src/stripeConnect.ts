import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as db from './db';

type StripeAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  transfersEnabled: boolean | null;
  disabledReason: string | null;
};

async function findExistingConnectedAccountIdInStripe(params: {
  stripe: Stripe;
  userId: string;
  userEmail?: string | null;
}): Promise<string | null> {
  const { stripe, userId, userEmail } = params;

  let startingAfter: string | undefined;

  while (true) {
    const accounts = await stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });

    const metadataMatch = accounts.data.find(
      account => account.metadata?.user_id === userId
    );

    if (metadataMatch) {
      return metadataMatch.id;
    }

    if (userEmail && userEmail.trim().length > 0) {
      const normalizedEmail = userEmail.trim().toLowerCase();
      const emailMatch = accounts.data.find(
        account => (account.email || '').trim().toLowerCase() === normalizedEmail
      );

      if (emailMatch) {
        return emailMatch.id;
      }
    }

    if (!accounts.has_more || accounts.data.length === 0) {
      break;
    }

    startingAfter = accounts.data[accounts.data.length - 1].id;
  }

  return null;
}

export async function getOrCreateConnectedAccount(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  userId: string;
  userEmail?: string | null;
  displayName?: string | null;
}): Promise<string> {
  const { supabase, stripe, userId } = params;

  const existingDbAccount = await db.getStripeConnectedAccountByUserId(supabase, userId);
  if (existingDbAccount?.stripe_account_id) {
    console.log(
      `[STRIPE_CONNECT] userId=${userId} stripeAccountId=${existingDbAccount.stripe_account_id} reused_from_db`
    );
    return existingDbAccount.stripe_account_id;
  }

  let userEmail = params.userEmail ?? null;
  let displayName = params.displayName ?? null;

  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (!error && data?.user) {
      userEmail = userEmail ?? data.user.email ?? null;
      const metadataName =
        typeof data.user.user_metadata?.full_name === 'string'
          ? data.user.user_metadata.full_name
          : null;
      displayName = displayName ?? metadataName;
    }
  } catch (error) {
    console.warn('[STRIPE_CONNECT] Failed to load user profile for account mapping', {
      userId,
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  const stripeExistingId = await findExistingConnectedAccountIdInStripe({
    stripe,
    userId,
    userEmail
  });

  if (stripeExistingId) {
    const stripeAccount = await stripe.accounts.retrieve(stripeExistingId);

    const existingByStripeId = await db.getStripeConnectedAccountByStripeAccountId(
      supabase,
      stripeExistingId
    );
    if (existingByStripeId && existingByStripeId.user_id !== userId) {
      throw new Error(
        `Stripe account ${stripeExistingId} is already mapped to a different user`
      );
    }

    await db.upsertStripeConnectedAccount(supabase, {
      userId,
      stripeAccountId: stripeExistingId,
      chargesEnabled: !!stripeAccount.charges_enabled,
      payoutsEnabled: !!stripeAccount.payouts_enabled,
      detailsSubmitted: !!stripeAccount.details_submitted
    });

    console.log(
      `[STRIPE_CONNECT] userId=${userId} stripeAccountId=${stripeExistingId} reused_from_stripe`
    );

    return stripeExistingId;
  }

  const account = await stripe.accounts.create({
    type: 'express',
    ...(userEmail && userEmail.trim().length > 0 ? { email: userEmail.trim() } : {}),
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    ...(displayName && displayName.trim().length > 0
      ? { business_profile: { name: displayName.trim() } }
      : {}),
    metadata: {
      user_id: userId
    }
  }, {
    idempotencyKey: `create_connect_${userId}`
  });

  const existingByStripeId = await db.getStripeConnectedAccountByStripeAccountId(
    supabase,
    account.id
  );
  if (existingByStripeId && existingByStripeId.user_id !== userId) {
    throw new Error(
      `Stripe account ${account.id} is already mapped to a different user`
    );
  }

  await db.upsertStripeConnectedAccount(supabase, {
    userId,
    stripeAccountId: account.id,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted
  });

  await db.setProviderStripeAccountId(supabase, userId, account.id);

  console.log(
    `[STRIPE_CONNECT] userId=${userId} stripeAccountId=${account.id} created`
  );

  return account.id;
}

export async function getOrCreateProviderStripeAccountId(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  providerId: string;
  email?: string | null;
  name?: string | null;
}): Promise<string> {
  return getOrCreateConnectedAccount({
    supabase: params.supabase,
    stripe: params.stripe,
    userId: params.providerId,
    userEmail: params.email,
    displayName: params.name
  });
}

export async function getStripeAccountStatus(
  stripe: Stripe,
  stripeAccountId: string
): Promise<StripeAccountStatus> {
  const account = await stripe.accounts.retrieve(stripeAccountId);

  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const detailsSubmitted = !!account.details_submitted;
  const transfersCapability = account.capabilities?.transfers ?? null;
  const transfersEnabled = transfersCapability ? transfersCapability === 'active' : null;
  const disabledReason = account.requirements?.disabled_reason ?? null;

  console.log(
    `[STRIPE_CONNECT_STATUS] stripeAccountId=${stripeAccountId} charges_enabled=${chargesEnabled} payouts_enabled=${payoutsEnabled} disabled_reason=${disabledReason ?? 'none'} transfers=${transfersCapability ?? 'unknown'}`
  );

  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    transfersEnabled,
    disabledReason
  };
}

export function isStripeAccountReady(status: StripeAccountStatus): boolean {
  if (!status.chargesEnabled || !status.payoutsEnabled) return false;
  if (status.transfersEnabled === false) return false;
  return true;
}
