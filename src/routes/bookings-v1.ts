// YardLine Safe V1 Two-Step Payment System (Deprecated)
// Deposit + final payment flow has been removed.

import { Router, Request, Response } from 'express';
import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export function createBookingV1Routes(
  supabase: SupabaseClient,
  stripe: Stripe,
  calcPlatformFeeCents: (priceCents: number) => number
) {
  const router = Router();

  const respondGone = (_req: Request, res: Response) => {
    return res.status(410).json({
      error: 'Deposit-based booking payments have been removed. Please use booking checkout after provider acceptance.',
      code: 'deposit_flow_removed'
    });
  };

  router.post('/request', respondGone);
  router.post('/confirm-deposit', respondGone);
  router.post('/:id/accept', respondGone);
  router.post('/:id/pay-remaining', respondGone);

  return router;
}
