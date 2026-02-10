import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as db from './db';

type StripeAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  transfersEnabled: boolean | null;
  disabledReason: string | null;
};

const formatProviderName = (rawName?: string | null, providerId?: string): string => {
  if (rawName && rawName.trim().length > 0) return rawName.trim();
  return providerId ? `Provider ${providerId}` : 'Provider';
};

const formatProviderEmail = (rawEmail?: string | null, providerId?: string): string => {
  if (rawEmail && rawEmail.trim().length > 0) return rawEmail.trim();
  return providerId ? `provider-${providerId}@yardline.app` : 'provider@yardline.app';
};

export async function getOrCreateProviderStripeAccountId(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  providerId: string;
  email?: string | null;
  name?: string | null;
}): Promise<string> {
  const { supabase, stripe, providerId } = params;

  const existingAccountId = await db.getProviderStripeAccountId(supabase, providerId);
  if (existingAccountId) {
    console.log(
      `[STRIPE_CONNECT] providerId=${providerId} stripeAccountId=${existingAccountId} reused`
    );
    return existingAccountId;
  }

  let providerEmail = params.email ?? null;
  let providerName = params.name ?? null;

  try {
    const { data, error } = await supabase.auth.admin.getUserById(providerId);
    if (!error && data?.user) {
      providerEmail = providerEmail ?? data.user.email ?? null;
      const metadataName =
        typeof data.user.user_metadata?.full_name === 'string'
          ? data.user.user_metadata.full_name
          : null;
      providerName = providerName ?? metadataName;
    }
  } catch (error) {
    console.warn('[STRIPE_CONNECT] Failed to load provider profile for account creation', {
      providerId,
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }

  const account = await stripe.accounts.create({
    type: 'express',
    email: formatProviderEmail(providerEmail, providerId),
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    business_profile: { name: formatProviderName(providerName, providerId) }
  });

  await db.setProviderStripeAccountId(supabase, providerId, account.id);

  console.log(
    `[STRIPE_CONNECT] providerId=${providerId} stripeAccountId=${account.id} created`
  );

  return account.id;
}

export async function getStripeAccountStatus(
  stripe: Stripe,
  stripeAccountId: string
): Promise<StripeAccountStatus> {
  const account = await stripe.accounts.retrieve(stripeAccountId);

  const chargesEnabled = !!account.charges_enabled;
  const payoutsEnabled = !!account.payouts_enabled;
  const transfersCapability = account.capabilities?.transfers ?? null;
  const transfersEnabled = transfersCapability ? transfersCapability === 'active' : null;
  const disabledReason = account.requirements?.disabled_reason ?? null;

  console.log(
    `[STRIPE_CONNECT_STATUS] stripeAccountId=${stripeAccountId} charges_enabled=${chargesEnabled} payouts_enabled=${payoutsEnabled} disabled_reason=${disabledReason ?? 'none'} transfers=${transfersCapability ?? 'unknown'}`
  );

  return {
    chargesEnabled,
    payoutsEnabled,
    transfersEnabled,
    disabledReason
  };
}

export function isStripeAccountReady(status: StripeAccountStatus): boolean {
  if (!status.chargesEnabled || !status.payoutsEnabled) return false;
  if (status.transfersEnabled === false) return false;
  return true;
}
