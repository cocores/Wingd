import express from 'express';
import db from '../firestore.js';
import { requireAuth } from '../middleware/auth.js';
import { stripe, billingConfigured, webhookConfigured, STRIPE_WEBHOOK_SECRET, STRIPE_PREMIUM_PRICE_ID } from '../lib/stripe.js';

const router = express.Router();
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

async function getOrCreateStripeCustomer(userId) {
  const userRef = db.collection('users').doc(userId);
  const user = (await userRef.get()).data();
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { userId } });
  await userRef.update({ stripeCustomerId: customer.id });
  return customer.id;
}

router.get('/status', requireAuth, async (req, res) => {
  const user = (await db.collection('users').doc(req.userId).get()).data();
  res.json({
    configured: billingConfigured(),
    premiumStatus: user.premiumStatus || 'none',
    premiumCurrentPeriodEnd: user.premiumCurrentPeriodEnd || null,
  });
});

router.post('/checkout', requireAuth, async (req, res) => {
  if (!billingConfigured()) return res.status(501).json({ error: 'Billing is not configured on this server' });

  const customerId = await getOrCreateStripeCustomer(req.userId);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    // Set on the session so the webhook (which only sees Stripe object ids,
    // never our JWT) can map the resulting subscription back to a user.
    client_reference_id: req.userId,
    line_items: [{ price: STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
    success_url: `${clientOrigin}/premium?checkout=success`,
    cancel_url: `${clientOrigin}/premium?checkout=cancelled`,
  });
  res.json({ url: session.url });
});

router.post('/portal', requireAuth, async (req, res) => {
  if (!billingConfigured()) return res.status(501).json({ error: 'Billing is not configured on this server' });
  const customerId = (await db.collection('users').doc(req.userId).get()).data()?.stripeCustomerId;
  if (!customerId) return res.status(400).json({ error: 'No billing account yet — subscribe first' });

  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${clientOrigin}/premium` });
  res.json({ url: session.url });
});

// Mounted separately in index.js with express.raw() — Stripe's signature
// verification needs the exact raw request body, not the parsed JSON, so
// this route must NOT go through the app's normal express.json() middleware.
export async function handleWebhook(req, res) {
  if (!webhookConfigured()) return res.status(501).send('Webhook not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  const usersRef = db.collection('users');

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.client_reference_id && session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await usersRef.doc(session.client_reference_id).update({
        stripeSubscriptionId: subscription.id,
        premiumStatus: subscription.status,
        premiumCurrentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      });
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const snap = await usersRef.where('stripeCustomerId', '==', subscription.customer).limit(1).get();
    if (!snap.empty) {
      await snap.docs[0].ref.update({
        stripeSubscriptionId: subscription.id,
        premiumStatus: event.type === 'customer.subscription.deleted' ? 'canceled' : subscription.status,
        premiumCurrentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      });
    }
  }

  res.json({ received: true });
}

export default router;
