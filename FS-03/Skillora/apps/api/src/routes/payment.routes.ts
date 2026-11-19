import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import {
  checkoutSchema,
  payoutDecisionSchema,
  payoutRequestSchema,
  refundSchema,
} from '@skillora/shared';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/asyncHandler';
import { created, ok, paginate } from '../lib/http';
import { authenticate, authorize } from '../middleware/auth';
import { checkoutLimiter } from '../middleware/rateLimit';
import { errors } from '../lib/errors';
import { env } from '../config/env';
import * as paymentService from '../services/payment.service';
import { getPlatformSettings } from '../models/financial';
import { logger } from '../lib/logger';

const router = Router();

/** Stripe needs the exact raw bytes for signature verification. */
function rawBodyForWebhook() {
  return express.raw({ type: 'application/json', limit: '2mb' });
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */
router.post(
  '/checkout',
  authenticate,
  checkoutLimiter,
  validate(checkoutSchema),
  asyncHandler(async (req, res) => {
    const result = await paymentService.createCheckout(req.auth!.id, req.body.courseId, {
      couponCode: req.body.couponCode,
    });
    created(res, result);
  }),
);

router.get(
  '/payments/status/:reference',
  authenticate,
  asyncHandler(async (req, res) => {
    const { Order, Payment } = await import('../models/financial');
    const order = await Order.findOne({ reference: String(req.params.reference) }).lean();
    if (!order) throw errors.notFound('Order not found');
    if (String(order.buyer) !== req.auth!.id && req.auth!.role !== 'admin') {
      throw errors.forbidden('This order belongs to another account');
    }
    const payment = await Payment.findOne({ order: order._id }).sort({ createdAt: -1 }).lean();
    ok(res, {
      reference: order.reference,
      status: order.status,
      totalMinor: order.totalMinor,
      currency: order.currency,
      courseTitle: order.courseTitleSnapshot,
      provider: order.paymentProvider,
      paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
      failureReason: payment?.failureReason ?? null,
    });
  }),
);

/* ------------------------------------------------------------------ *
 * Local test gateway (SIMULATED — never presented as a real processor)
 * ------------------------------------------------------------------ */
router.get(
  '/payments/test-gateway/cards',
  asyncHandler(async (_req, res) => {
    ok(res, {
      simulated: true,
      note: 'Skillora local test gateway. Configure PAYMENT_PROVIDER=stripe with real test keys for Stripe test mode.',
      cards: Object.entries(paymentService.TEST_CARDS).map(([number, meta]) => ({
        number,
        label: meta.label,
        result: meta.result,
      })),
    });
  }),
);

const cardSchema = z.object({
  number: z.string().min(12).max(25),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/),
  name: z.string().trim().min(2).max(80),
});

router.post(
  '/payments/test-gateway/:reference/confirm',
  authenticate,
  checkoutLimiter,
  validate(cardSchema),
  asyncHandler(async (req, res) => {
    const order = await (await import('../models/financial')).Order.findOne({
      reference: String(req.params.reference),
    }).lean();
    if (!order) throw errors.notFound('Order not found');
    if (String(order.buyer) !== req.auth!.id) throw errors.forbidden('Not your order');

    const result = await paymentService.confirmLocalPayment(String(req.params.reference), req.body);
    ok(res, result);
  }),
);

/**
 * Stripe webhook. Signature-verified with raw body; duplicates are dropped by
 * the unique event id recorded in webhookEvents.
 */
router.post(
  '/webhooks/stripe',
  rawBodyForWebhook(),
  asyncHandler(async (req, res) => {
    if (env.PAYMENT_PROVIDER !== 'stripe') {
      res.status(200).json({ received: true, ignored: 'payments.provider is not stripe' });
      return;
    }
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') throw errors.validation('Missing stripe-signature header');
    if (!env.STRIPE_WEBHOOK_SECRET) throw errors.unavailable('STRIPE_WEBHOOK_SECRET is not configured');

    const stripe = new (await import('stripe')).default(env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-12-18.acacia' as never,
    });

    let event: import('stripe').Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn({ err }, 'Stripe signature verification failed');
      throw errors.validation('Webhook signature verification failed');
    }

    const result = await paymentService.processPaymentEvent({
      eventId: event.id,
      provider: 'stripe',
      type: event.type,
      payload: extractStripePayload(event),
    });
    res.status(200).json({ received: true, ...result });
  }),
);

function extractStripePayload(event: import('stripe').Stripe.Event): Record<string, any> {
  const obj = event.data?.object as any;
  return {
    orderReference: obj?.metadata?.orderReference ?? obj?.metadata?.orderId ?? null,
    paymentIntent: typeof obj?.payment_intent === 'string' ? obj.payment_intent : (obj?.payment_intent?.id ?? null),
    providerPaymentId: typeof obj?.payment_intent === 'string' ? obj.payment_intent : (obj?.id ?? null),
    amountMinor: obj?.amount_total ?? obj?.amount ?? null,
    reason: obj?.failure_code ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Orders / purchase history
 * ------------------------------------------------------------------ */
router.get(
  '/orders',
  authenticate,
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const { items, total } = await paymentService.listOrders(req.auth!.id, page, limit);
    ok(res, paginate(items, total, page, limit));
  }),
);

/* ------------------------------------------------------------------ *
 * Instructor finance
 * ------------------------------------------------------------------ */
router.get(
  '/instructor/earnings',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const months = Number(req.query.months ?? 6);
    ok(res, await paymentService.getInstructorEarnings(req.auth!.id, months));
  }),
);

router.get(
  '/instructor/ledger',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const { items, total } = await paymentService.listLedger(req.auth!.id, page, limit);
    ok(res, paginate(items, total, page, limit));
  }),
);

router.post(
  '/instructor/payouts',
  authenticate,
  authorize('instructor', 'admin'),
  validate(payoutRequestSchema),
  asyncHandler(async (req, res) => {
    const payout = await paymentService.requestPayout(req.auth!.id, req.body);
    created(res, { id: String(payout._id), reference: payout.reference, status: payout.status });
  }),
);

router.get(
  '/instructor/payouts',
  authenticate,
  authorize('instructor', 'admin'),
  asyncHandler(async (req, res) => {
    const { items, total } = await paymentService.listPayouts(
      req.auth!.id,
      Number(req.query.page ?? 1),
      Number(req.query.limit ?? 20),
    );
    ok(res, paginate(items, total, Number(req.query.page ?? 1), Number(req.query.limit ?? 20)));
  }),
);

/* ------------------------------------------------------------------ *
 * Admin: refunds, payouts, orders
 * ------------------------------------------------------------------ */
router.post(
  '/admin/orders/:reference/refund',
  authenticate,
  authorize('admin'),
  validate(refundSchema),
  asyncHandler(async (req, res) => {
    const refund = await paymentService.refundOrder(String(req.params.reference), {
      amountMinor: req.body.amountMinor,
      reason: req.body.reason,
      adminId: req.auth!.id,
    });
    ok(res, { id: String(refund._id), status: refund.status, amountMinor: refund.amountMinor });
  }),
);

router.get(
  '/admin/orders',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { Order } = await import('../models/financial');
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const filter = status ? { status } : {};
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('buyer', 'name email')
        .populate('course', 'title')
        .lean(),
      Order.countDocuments(filter),
    ]);
    ok(
      res,
      paginate(
        rows.map((o: any) => ({
          id: String(o._id),
          reference: o.reference,
          buyerName: o.buyer?.name ?? '—',
          buyerEmail: o.buyer?.email ?? '—',
          courseTitle: o.course?.title ?? o.courseTitleSnapshot,
          totalMinor: o.totalMinor,
          currency: o.currency,
          status: o.status,
          provider: o.paymentProvider,
          createdAt: new Date(o.createdAt).toISOString(),
          paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null,
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.get(
  '/admin/payouts',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const { items, total } = await paymentService.listPayouts(undefined, page, limit);
    ok(res, paginate(items, total, page, limit));
  }),
);

router.post(
  '/admin/payouts/:id/decision',
  authenticate,
  authorize('admin'),
  validate(payoutDecisionSchema),
  asyncHandler(async (req, res) => {
    const payout = await paymentService.decidePayout(
      String(req.params.id),
      req.body.decision,
      req.auth!.id,
      req.body.note,
    );
    ok(res, { id: String(payout._id), status: payout.status, simulated: payout.simulated });
  }),
);

router.get(
  '/admin/webhook-events',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { WebhookEvent } = await import('../models/financial');
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const [rows, total] = await Promise.all([
      WebhookEvent.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WebhookEvent.countDocuments({}),
    ]);
    ok(
      res,
      paginate(
        rows.map((e: any) => ({
          id: String(e._id),
          eventId: e.eventId,
          provider: e.provider,
          type: e.type,
          status: e.status,
          error: e.error ?? null,
          receivedAt: new Date(e.createdAt).toISOString(),
        })),
        total,
        page,
        limit,
      ),
    );
  }),
);

router.get(
  '/payments/config',
  authenticate,
  asyncHandler(async (_req, res) => {
    const settings = await getPlatformSettings();
    ok(res, {
      provider: env.PAYMENT_PROVIDER,
      stripeConfigured: paymentService.isStripeConfigured(),
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
      commissionBps: settings.commissionBps,
      testMode: true,
    });
  }),
);

export default router;