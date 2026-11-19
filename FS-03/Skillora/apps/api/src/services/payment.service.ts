import { Types } from 'mongoose';
import type { EarningsBreakdown } from '@skillora/shared';
import { computeEarnings } from '@skillora/shared';
import { env, integrationStatus } from '../config/env';
import {
  InstructorLedgerEntry,
  Order,
  Payment,
  PayoutRequest,
  Refund,
  WebhookEvent,
  getPlatformSettings,
} from '../models/financial';
import { Course, Enrollment } from '../models/course';
import { createNotification, writeAudit } from '../models/identity';
import { errors } from '../lib/errors';
import { reference } from '../lib/slug';
import { logger } from '../lib/logger';
import { enrollFree } from './enrollment.service';

function oid(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

export type PaymentProvider = 'stripe' | 'local_test_gateway';

export interface CheckoutResult {
  orderReference: string;
  provider: PaymentProvider;
  /** Stripe hosted URL, or the local test-gateway page route. */
  url: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
  testMode: boolean;
}

/* ------------------------------------------------------------------ *
 * Checkout
 * ------------------------------------------------------------------ */
export async function createCheckout(
  userId: string,
  courseId: string,
  opts: { couponCode?: string } = {},
): Promise<CheckoutResult> {
  const course = await Course.findById(courseId).lean();
  if (!course) throw errors.notFound('Course not found');
  if (course.status !== 'published') throw errors.forbidden('This course is not available for purchase');

  const alreadyEnrolled = await Enrollment.exists({ user: oid(userId), course: course._id });
  if (alreadyEnrolled) throw errors.conflict('You are already enrolled in this course');

  const existingPaid = await Order.findOne({
    buyer: oid(userId),
    course: course._id,
    status: { $in: ['paid', 'partially_refunded'] },
  }).lean();
  if (existingPaid) throw errors.conflict('You already own this course');

  // Price ALWAYS comes from the database — never from the client.
  const grossMinor = course.priceMinor ?? 0;
  if (grossMinor <= 0) throw errors.precondition('This course is free — enroll directly');

  const settings = await getPlatformSettings();
  void settings;

  const provider: PaymentProvider = env.PAYMENT_PROVIDER === 'stripe' && integrationStatus.stripe
    ? 'stripe'
    : 'local_test_gateway';

  const order = await Order.create({
    reference: reference('ORD'),
    buyer: oid(userId),
    course: course._id,
    courseTitleSnapshot: course.title,
    grossMinor,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: grossMinor,
    currency: course.currency ?? 'USD',
    status: 'pending',
    paymentProvider: provider,
    couponCode: opts.couponCode ?? null,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });

  const payment = await Payment.create({
    order: order._id,
    amountMinor: grossMinor,
    currency: order.currency,
    status: 'requires_payment',
    provider,
  });

  if (provider === 'stripe') {
    const url = await createStripeSession(order, payment);
    return {
      orderReference: order.reference,
      provider,
      url,
      expiresAt: order.expiresAt!.toISOString(),
      amountMinor: grossMinor,
      currency: order.currency,
      testMode: true,
    };
  }

  // Local test gateway: a first-class simulated checkout with the same server
  // pipeline (session -> confirmation -> signed event -> fulfillment).
  const url = `${env.WEB_ORIGIN.replace(/\/$/, '')}/checkout/${order.reference}`;
  payment.providerSessionId = `tg_${order.reference}`;
  await payment.save();
  return {
    orderReference: order.reference,
    provider,
    url,
    expiresAt: order.expiresAt!.toISOString(),
    amountMinor: grossMinor,
    currency: order.currency,
    testMode: true,
  };
}

async function createStripeSession(order: any, payment: any): Promise<string> {
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: String(order._id),
    success_url: `${env.WEB_ORIGIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.WEB_ORIGIN}/payment/cancelled?ref=${order.reference}`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: order.totalMinor,
          product_data: { name: order.courseTitleSnapshot },
        },
      },
    ],
    metadata: { orderReference: order.reference, orderId: String(order._id) },
  });
  payment.providerSessionId = session.id;
  await payment.save();
  return session.url ?? `${env.WEB_ORIGIN}/checkout/${order.reference}`;
}

let stripeClient: import('stripe').default | null = null;
async function getStripe(): Promise<import('stripe').default> {
  if (!env.STRIPE_SECRET_KEY) throw errors.unavailable('Stripe is not configured (missing STRIPE_SECRET_KEY)');
  if (!stripeClient) {
    const Stripe = (await import('stripe')).default;
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as never });
  }
  return stripeClient;
}

/* ------------------------------------------------------------------ *
 * Local test gateway (explicitly simulated — clearly labeled everywhere)
 * ------------------------------------------------------------------ */
export const TEST_CARDS: Record<string, { result: 'success' | 'decline'; label: string }> = {
  '4242424242424242': { result: 'success', label: 'Visa — always succeeds' },
  '4000000000000002': { result: 'decline', label: 'Visa — always declines' },
  '4000000000009995': { result: 'decline', label: 'Visa — insufficient funds' },
  '4000000000009994': { result: 'success', label: 'Amex — succeeds after 3DS-like delay' },
};

function luhnValid(card: string): boolean {
  if (!/^\d{12,19}$/.test(card)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = card.length - 1; i >= 0; i -= 1) {
    let d = Number(card[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Confirms a local test-gateway order. The confirmation then travels through
 * the SAME event pipeline as a Stripe webhook, so fulfillment code is shared
 * and idempotent for both providers.
 */
export async function confirmLocalPayment(
  orderReference: string,
  card: { number: string; expMonth: number; expYear: number; cvc: string; name: string },
): Promise<{ orderReference: string; status: string; result: 'success' | 'decline' }> {
  const order = await Order.findOne({ reference: orderReference });
  if (!order) throw errors.notFound('Order not found');
  if (order.status === 'paid') return { orderReference, status: 'paid', result: 'success' };
  if (order.status !== 'pending') throw errors.precondition(`Order is ${order.status}`);

  const number = card.number.replace(/[\s-]/g, '');
  const known = TEST_CARDS[number];
  const expOk =
    Number.isInteger(card.expMonth) &&
    Number.isInteger(card.expYear) &&
    card.expMonth >= 1 &&
    card.expMonth <= 12 &&
    card.expYear >= new Date().getFullYear();

  const accepted = Boolean(known && known.result === 'success' && luhnValid(number) && expOk && /^\d{3,4}$/.test(card.cvc));

  const eventId = `evt_local_${order.reference}_${accepted ? 'ok' : 'fail'}`;

  if (accepted) {
    await processPaymentEvent({
      eventId,
      provider: 'local_test_gateway',
      type: 'payment_intent.succeeded',
      payload: { orderReference: order.reference, cardLast4: number.slice(-4), simulated: true },
    });
    return { orderReference, status: 'paid', result: 'success' };
  }

  await processPaymentEvent({
    eventId,
    provider: 'local_test_gateway',
    type: 'payment_intent.failed',
    payload: {
      orderReference: order.reference,
      reason: known ? 'card_declined' : !luhnValid(number) ? 'invalid_card' : 'invalid_expiry_or_cvc',
      simulated: true,
    },
  });
  return {
    orderReference,
    status: 'failed',
    result: 'decline',
  };
}

/* ------------------------------------------------------------------ *
 * Event pipeline (shared by Stripe webhooks and the local gateway)
 * ------------------------------------------------------------------ */
export interface PaymentEventInput {
  eventId: string;
  provider: string;
  type: string;
  payload: Record<string, any>;
}

/**
 * Processes a payment event exactly once. Duplicate webhook deliveries are
 * detected via the unique webhookEvents.eventId index and ignored.
 */
export async function processPaymentEvent(input: PaymentEventInput): Promise<{ processed: boolean; duplicate: boolean }> {
  try {
    await WebhookEvent.create({
      eventId: input.eventId,
      provider: input.provider,
      type: input.type,
      status: 'received',
      payload: { orderReference: input.payload?.orderReference ?? null },
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      logger.info({ eventId: input.eventId }, 'Duplicate webhook delivery ignored');
      return { processed: false, duplicate: true };
    }
    throw err;
  }

  try {
    if (input.type === 'payment_intent.succeeded') {
      await fulfillOrder(input.payload.orderReference, {
        providerPaymentId: input.payload.providerPaymentId ?? input.payload.paymentIntent ?? null,
        provider: input.provider,
        eventId: input.eventId,
      });
    } else if (input.type === 'payment_intent.failed') {
      await failOrder(input.payload.orderReference, input.payload.reason ?? 'payment_failed');
    } else if (input.type === 'charge.refunded') {
      await applyRefundFromEvent(input.payload);
    } else {
      await WebhookEvent.updateOne(
        { eventId: input.eventId },
        { $set: { status: 'ignored', processedAt: new Date() } },
      );
      return { processed: false, duplicate: false };
    }

    await WebhookEvent.updateOne(
      { eventId: input.eventId },
      { $set: { status: 'processed', processedAt: new Date() } },
    );
    return { processed: true, duplicate: false };
  } catch (err) {
    await WebhookEvent.updateOne(
      { eventId: input.eventId },
      {
        $set: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          processedAt: new Date(),
        },
      },
    );
    throw err;
  }
}

/**
 * Marks the order paid, activates enrollment and writes the ledger entries.
 * Re-entry is a no-op: the order state machine and dedupeKey index make it
 * safe under duplicate or concurrent deliveries.
 */
async function fulfillOrder(
  orderReference: string,
  opts: { providerPaymentId?: string | null; provider: string; eventId: string },
): Promise<void> {
  const order = await Order.findOne({ reference: orderReference });
  if (!order) throw errors.notFound(`Unknown order reference: ${orderReference}`);
  if (order.status === 'paid' || order.status === 'refunded') return; // idempotent
  if (order.status !== 'pending' && order.status !== 'failed') {
    throw errors.precondition(`Order ${order.reference} is ${order.status}`);
  }

  order.status = 'paid';
  order.paidAt = new Date();
  await order.save();

  await Payment.updateMany(
    { order: order._id, status: { $in: ['requires_payment', 'failed'] } },
    {
      $set: {
        status: 'succeeded',
        paidAt: new Date(),
        ...(opts.providerPaymentId ? { providerPaymentId: opts.providerPaymentId } : {}),
      },
    },
  );

  // Enrollment activates ONLY here, after a verified server-side event.
  await enrollForPurchase(String(order.buyer), String(order.course), String(order._id));

  await writeLedgerEntries(order);

  await createNotification({
    user: String(order.buyer),
    type: 'payment_receipt',
    title: 'Payment confirmed',
    body: `Your payment for "${order.courseTitleSnapshot}" was confirmed. The course is now in your learning.`,
    link: '/learning',
  });
  await createNotification({
    user: String((await Course.findById(order.course).select('instructor').lean())?.instructor),
    type: 'new_enrollment',
    title: 'Course sale',
    body: `"${order.courseTitleSnapshot}" was purchased (order ${order.reference}).`,
    link: '/instructor/revenue',
  });
  await writeAudit({
    actor: String(order.buyer),
    action: 'payment.succeeded',
    entityType: 'order',
    entityId: String(order._id),
    metadata: { reference: order.reference, totalMinor: order.totalMinor, provider: opts.provider },
  });
}

async function enrollForPurchase(userId: string, courseId: string, orderId: string): Promise<void> {
  try {
    await enrollFree(userId, courseId, 'purchase');
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
  }
  void orderId;
}

async function failOrder(orderReference: string, reason: string): Promise<void> {
  const order = await Order.findOne({ reference: orderReference });
  if (!order || order.status === 'paid') return;
  order.status = 'failed';
  await order.save();
  await Payment.updateMany(
    { order: order._id, status: 'requires_payment' },
    { $set: { status: 'failed', failureReason: reason } },
  );
  logger.info({ orderReference, reason }, 'Order marked failed');
}

/**
 * Ledger entries for a paid order: an instructor credit and a platform
 * commission debit, each guarded by a dedupeKey so replaying the event cannot
 * double the instructor's earnings.
 */
async function writeLedgerEntries(order: any): Promise<void> {
  const settings = await getPlatformSettings();
  const course = await Course.findById(order.course).select('instructor currency').lean();
  if (!course) return;

  const breakdown = computeEarnings({
    grossMinor: order.grossMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    commissionBps: settings.commissionBps,
    processingFeeMinor: 0,
    refundedMinor: 0,
    currency: order.currency,
  });

  const instructorId = String(course.instructor);
  const entries = [
    {
      dedupeKey: `sale:${order._id}`,
      type: 'sale' as const,
      amountMinor: breakdown.grossMinor - breakdown.discountMinor,
      description: `Sale — ${order.courseTitleSnapshot} (${order.reference})`,
    },
    {
      dedupeKey: `commission:${order._id}`,
      type: 'commission' as const,
      amountMinor: -breakdown.commissionMinor,
      description: `Platform commission ${settings.commissionBps / 100}% (${order.reference})`,
    },
  ];

  for (const entry of entries) {
    try {
      await InstructorLedgerEntry.create({
        instructor: oid(instructorId),
        order: order._id,
        course: order.course,
        type: entry.type,
        amountMinor: entry.amountMinor,
        currency: order.currency,
        description: entry.description,
        dedupeKey: entry.dedupeKey,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // duplicate = already recorded
    }
  }
}

async function applyRefundFromEvent(payload: Record<string, any>): Promise<void> {
  const order = payload.orderReference
    ? await Order.findOne({ reference: payload.orderReference })
    : null;
  if (!order) throw errors.notFound('Order not found for refund event');
  await recordRefund(order, payload.amountMinor ?? order.totalMinor - order.refundedMinor, payload.reason ?? null, null, payload.eventId);
}

/* ------------------------------------------------------------------ *
 * Refunds (admin)
 * ------------------------------------------------------------------ */
export async function refundOrder(
  orderReference: string,
  opts: { amountMinor?: number; reason?: string; adminId: string },
): Promise<any> {
  const order = await Order.findOne({ reference: orderReference });
  if (!order) throw errors.notFound('Order not found');
  if (order.status !== 'paid' && order.status !== 'partially_refunded') {
    throw errors.precondition(`Order is ${order.status} and cannot be refunded`);
  }
  const amount = opts.amountMinor ?? order.totalMinor - order.refundedMinor;
  if (amount <= 0 || amount > order.totalMinor - order.refundedMinor) {
    throw errors.validation('Refund amount exceeds the refundable balance');
  }

  let providerRefundId: string | null = null;
  if (order.paymentProvider === 'stripe' && integrationStatus.stripe) {
    try {
      const stripe = await getStripe();
      const payment = await Payment.findOne({ order: order._id, status: 'succeeded' })
        .sort({ createdAt: -1 })
        .lean();
      const refund = await stripe.refunds.create({
        payment_intent: payment?.providerPaymentId as string,
        amount,
      });
      providerRefundId = refund.id;
    } catch (err) {
      logger.error({ err, orderReference }, 'Stripe refund failed');
      throw errors.payment('Stripe refund could not be processed');
    }
  } else {
    providerRefundId = `tg_ref_${order.reference}_${Date.now()}`;
  }

  return recordRefund(order, amount, opts.reason ?? null, opts.adminId, `refund:${order.reference}:${order.refundedMinor + amount}`, providerRefundId);
}

async function recordRefund(
  order: any,
  amountMinor: number,
  reason: string | null,
  adminId: string | null,
  eventIdOrDedupe: string,
  providerRefundId?: string | null,
): Promise<any> {
  const settings = await getPlatformSettings();

  const refund = await Refund.create({
    order: order._id,
    amountMinor,
    currency: order.currency,
    reason,
    providerRefundId: providerRefundId ?? null,
    status: 'succeeded',
    createdBy: adminId ? oid(adminId) : null,
    processedAt: new Date(),
  });

  order.refundedMinor = (order.refundedMinor ?? 0) + amountMinor;
  order.status = order.refundedMinor >= order.totalMinor ? 'refunded' : 'partially_refunded';
  await order.save();

  // Reverse instructor earnings proportionally (commission stays with platform
  // only on the retained amount).
  const course = await Course.findById(order.course).select('instructor').lean();
  if (course) {
    const grossNet = order.grossMinor - order.discountMinor;
    const commission = Math.round((grossNet * settings.commissionBps) / 10_000);
    const instructorShare = grossNet - commission;
    const refundedShare =
      grossNet > 0 ? Math.round((amountMinor * instructorShare) / grossNet) : 0;

    try {
      await InstructorLedgerEntry.create({
        instructor: course.instructor,
        order: order._id,
        course: order.course,
        type: 'refund',
        amountMinor: -refundedShare,
        currency: order.currency,
        description: `Refund adjustment — order ${order.reference}`,
        dedupeKey: `refund:${order.reference}:${order.refundedMinor}`,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }

  // Full refund revokes course access (documented policy).
  if (order.refundedMinor >= order.totalMinor) {
    await Enrollment.deleteOne({ user: order.buyer, course: order.course });
  }

  await createNotification({
    user: String(order.buyer),
    type: 'payment_receipt',
    title: 'Refund processed',
    body: `A refund of ${(amountMinor / 100).toFixed(2)} ${order.currency} was issued for "${order.courseTitleSnapshot}".`,
    link: '/purchases',
  });
  await writeAudit({
    actor: adminId,
    actorRole: 'admin',
    action: 'payment.refunded',
    entityType: 'order',
    entityId: String(order._id),
    metadata: { amountMinor, reason, eventId: eventIdOrDedupe },
  });

  return refund;
}

/* ------------------------------------------------------------------ *
 * Instructor earnings & payouts
 * ------------------------------------------------------------------ */
export async function getInstructorEarnings(instructorId: string, months = 6) {
  const settings = await getPlatformSettings();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const entries = await InstructorLedgerEntry.find({
    instructor: oid(instructorId),
    createdAt: { $gte: since },
  }).lean();

  const totals = entries.reduce(
    (acc, e) => {
      if (e.type === 'sale') acc.gross += e.amountMinor;
      if (e.type === 'commission') acc.commission += e.amountMinor; // negative
      if (e.type === 'refund') acc.refund += e.amountMinor; // negative
      if (e.type === 'payout') acc.paidOut += e.amountMinor; // negative
      if (e.type === 'fee') acc.fees += e.amountMinor;
      return acc;
    },
    { gross: 0, commission: 0, refund: 0, paidOut: 0, fees: 0 },
  );

  const series: { label: string; grossMinor: number; netMinor: number }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const inMonth = entries.filter((e) => new Date(e.createdAt).toISOString().startsWith(key));
    const gross = inMonth.filter((e) => e.type === 'sale').reduce((s, e) => s + e.amountMinor, 0);
    const net = inMonth.reduce((s, e) => (e.type === 'payout' ? s : s + e.amountMinor), 0);
    series.push({ label, grossMinor: gross, netMinor: net });
  }

  const net = totals.gross + totals.commission + totals.refund + totals.fees;
  const pendingPayouts = await PayoutRequest.aggregate([
    { $match: { instructor: oid(instructorId), status: 'pending' } },
    { $group: { _id: null, total: { $sum: '$amountMinor' } } },
  ]);
  const pendingMinor = pendingPayouts[0]?.total ?? 0;

  const enrollmentCount = await countInstructorEnrollments(instructorId);

  return {
    grossMinor: totals.gross,
    commissionMinor: Math.abs(totals.commission),
    refundMinor: Math.abs(totals.refund),
    netMinor: net,
    payableMinor: Math.max(0, net - Math.abs(totals.paidOut) - pendingMinor),
    paidOutMinor: Math.abs(totals.paidOut),
    pendingPayoutMinor: pendingMinor,
    currency: 'USD',
    enrollmentCount,
    series,
    commissionBps: settings.commissionBps,
  };
}

async function countInstructorEnrollments(instructorId: string): Promise<number> {
  const courses = await Course.find({ instructor: oid(instructorId) }).select('_id').lean();
  if (courses.length === 0) return 0;
  const { Enrollment } = await import('../models/course');
  return Enrollment.countDocuments({ course: { $in: courses.map((c) => c._id) } });
}

export async function requestPayout(
  instructorId: string,
  input: { amountMinor: number; note?: string },
) {
  const earnings = await getInstructorEarnings(instructorId, 12);
  const settings = await getPlatformSettings();

  if (earnings.payableMinor < input.amountMinor) {
    throw errors.precondition(
      `Requested amount exceeds the payable balance of ${earnings.payableMinor} minor units`,
    );
  }
  if (input.amountMinor < settings.payoutThresholdMinor) {
    throw errors.precondition(
      `Minimum payout is ${settings.payoutThresholdMinor} minor units`,
    );
  }
  const existingPending = await PayoutRequest.findOne({
    instructor: oid(instructorId),
    status: 'pending',
  }).lean();
  if (existingPending) throw errors.conflict('A payout request is already pending');

  const payout = await PayoutRequest.create({
    reference: reference('PO'),
    instructor: oid(instructorId),
    amountMinor: input.amountMinor,
    currency: 'USD',
    status: 'pending',
    note: input.note ?? null,
    simulated: true,
  });
  return payout;
}

export async function decidePayout(
  payoutId: string,
  decision: 'approve' | 'reject' | 'mark_paid',
  adminId: string,
  note?: string,
) {
  const payout = await PayoutRequest.findById(payoutId);
  if (!payout) throw errors.notFound('Payout request not found');

  if (decision === 'approve' && payout.status === 'pending') payout.status = 'approved';
  else if (decision === 'reject' && (payout.status === 'pending' || payout.status === 'approved')) {
    payout.status = 'rejected';
  } else if (decision === 'mark_paid' && (payout.status === 'approved' || payout.status === 'pending')) {
    payout.status = 'paid';
    payout.externalTransferRef = `sim_${payout.reference}`;
    // Ledger debit so the payout reduces the payable balance.
    try {
      await InstructorLedgerEntry.create({
        instructor: payout.instructor,
        type: 'payout',
        amountMinor: -payout.amountMinor,
        currency: payout.currency,
        description: `Payout ${payout.reference} (simulated transfer)`,
        dedupeKey: `payout:${payout._id}`,
      });
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  } else {
    throw errors.precondition(`Cannot ${decision} a payout in status ${payout.status}`);
  }

  payout.processedBy = oid(adminId);
  payout.processedAt = new Date();
  if (note) payout.note = note;
  await payout.save();

  await createNotification({
    user: String(payout.instructor),
    type: 'payout_update',
    title: `Payout ${payout.status}`,
    body: `Payout ${payout.reference} for ${(payout.amountMinor / 100).toFixed(2)} ${payout.currency} is now ${payout.status}.`,
    link: '/instructor/payouts',
  });
  await writeAudit({
    actor: adminId,
    actorRole: 'admin',
    action: `payout.${decision}`,
    entityType: 'payout',
    entityId: String(payout._id),
    metadata: { reference: payout.reference, amountMinor: payout.amountMinor, simulated: true },
  });
  return payout;
}

export async function listLedger(instructorId: string, page: number, limit: number) {
  const filter = { instructor: oid(instructorId) };
  const [rows, total] = await Promise.all([
    InstructorLedgerEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('order', 'reference')
      .populate('course', 'title')
      .lean(),
    InstructorLedgerEntry.countDocuments(filter),
  ]);
  return {
    items: rows.map((e: any) => ({
      id: String(e._id),
      orderId: e.order ? String(e.order._id) : null,
      orderReference: e.order?.reference ?? null,
      courseTitle: e.course?.title ?? null,
      type: e.type,
      amountMinor: e.amountMinor,
      currency: e.currency,
      description: e.description,
      createdAt: new Date(e.createdAt).toISOString(),
    })),
    total,
  };
}

export async function listPayouts(instructorId?: string, page = 1, limit = 20) {
  const filter = instructorId ? { instructor: oid(instructorId) } : {};
  const [rows, total] = await Promise.all([
    PayoutRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('instructor', 'name email')
      .lean(),
    PayoutRequest.countDocuments(filter),
  ]);
  return {
    items: rows.map((p: any) => ({
      id: String(p._id),
      reference: p.reference,
      instructorName: p.instructor?.name ?? 'Instructor',
      instructorEmail: p.instructor?.email ?? null,
      amountMinor: p.amountMinor,
      currency: p.currency,
      status: p.status,
      requestedAt: new Date(p.createdAt).toISOString(),
      processedAt: p.processedAt ? new Date(p.processedAt).toISOString() : null,
      note: p.note ?? null,
      simulated: p.simulated !== false,
    })),
    total,
  };
}

export async function listOrders(userId: string, page: number, limit: number) {
  const filter = { buyer: oid(userId) };
  const [rows, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('course', 'title slug thumbnailUrl')
      .lean(),
    Order.countDocuments(filter),
  ]);
  return {
    items: rows.map((o: any) => ({
      id: String(o._id),
      reference: o.reference,
      courseId: String(o.course?._id ?? o.course),
      courseTitle: o.course?.title ?? o.courseTitleSnapshot,
      amountMinor: o.grossMinor,
      discountMinor: o.discountMinor,
      taxMinor: o.taxMinor,
      totalMinor: o.totalMinor,
      currency: o.currency,
      status: o.status,
      paymentProvider: o.paymentProvider,
      createdAt: new Date(o.createdAt).toISOString(),
      paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null,
    })),
    total,
  };
}

export function isStripeConfigured(): boolean {
  return integrationStatus.stripe;
}

export type { EarningsBreakdown };
