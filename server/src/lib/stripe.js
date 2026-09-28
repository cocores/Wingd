import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || '';

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export function billingConfigured() {
  return !!(STRIPE_SECRET_KEY && STRIPE_PREMIUM_PRICE_ID);
}

export function webhookConfigured() {
  return !!STRIPE_WEBHOOK_SECRET;
}

export { STRIPE_WEBHOOK_SECRET, STRIPE_PREMIUM_PRICE_ID };
