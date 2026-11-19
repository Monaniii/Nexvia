import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ORDER_STATUSES, PAYMENT_STATUSES, PAYOUT_STATUSES } from '@skillora/shared';
import { toJSONOptions } from './identity';

/* ------------------------------------------------------------------ *
 * Order — server-priced, immutable snapshot of what was bought
 * ------------------------------------------------------------------ */
const orderSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    buyer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    courseTitleSnapshot: { type: String, required: true },
    grossMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    taxMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', index: true },
    paymentProvider: { type: String, enum: ['stripe', 'local_test_gateway'], required: true },
    couponCode: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refundedMinor: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);
orderSchema.index({ buyer: 1, course: 1 }, { unique: true, partialFilterExpression: { status: 'paid' } });
orderSchema.index({ status: 1, createdAt: -1 });

export type OrderDoc = HydratedDocument<InferSchemaType<typeof orderSchema>>;
export const Order = model('Order', orderSchema);

/* ------------------------------------------------------------------ *
 * Payment (one or more attempts may exist per order)
 * ------------------------------------------------------------------ */
const paymentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    amountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'requires_payment', index: true },
    provider: { type: String, enum: ['stripe', 'local_test_gateway'], required: true },
    providerSessionId: { type: String, default: null, index: true },
    providerPaymentId: { type: String, default: null, index: true },
    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const Payment = model('Payment', paymentSchema);

/* ------------------------------------------------------------------ *
 * Refund
 * ------------------------------------------------------------------ */
const refundSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    reason: { type: String, default: null },
    providerRefundId: { type: String, default: null, index: true },
    status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const Refund = model('Refund', refundSchema);

/* ------------------------------------------------------------------ *
 * Instructor ledger — append-only financial entries derived from events
 * ------------------------------------------------------------------ */
const ledgerEntrySchema = new Schema(
  {
    instructor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    course: { type: Schema.Types.ObjectId, ref: 'Course', default: null, index: true },
    type: {
      type: String,
      enum: ['sale', 'commission', 'refund', 'fee', 'adjustment', 'payout'],
      required: true,
    },
    amountMinor: { type: Number, required: true },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    description: { type: String, default: '', maxlength: 300 },
    /** Guards against duplicate webhook deliveries creating duplicate entries. */
    dedupeKey: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);
ledgerEntrySchema.index({ instructor: 1, createdAt: -1 });

export const InstructorLedgerEntry = model('InstructorLedgerEntry', ledgerEntrySchema);

/* ------------------------------------------------------------------ *
 * Payout requests
 * ------------------------------------------------------------------ */
const payoutRequestSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    instructor: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: { type: String, enum: PAYOUT_STATUSES, default: 'pending', index: true },
    note: { type: String, default: null, maxlength: 500 },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    /** Simulated payout marker — never claim a real transfer occurred. */
    simulated: { type: Boolean, default: true },
    externalTransferRef: { type: String, default: null },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const PayoutRequest = model('PayoutRequest', payoutRequestSchema);

/* ------------------------------------------------------------------ *
 * Webhook events — unique provider event id guarantees idempotency
 * ------------------------------------------------------------------ */
const webhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    provider: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ['received', 'processed', 'failed', 'ignored'], default: 'received' },
    payload: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions },
);

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);

/* ------------------------------------------------------------------ *
 * Platform settings (singleton document with id "platform")
 * ------------------------------------------------------------------ */
const platformSettingsSchema = new Schema(
  {
    _id: { type: String, default: 'platform' },
    platformName: { type: String, default: 'Skillora' },
    commissionBps: { type: Number, default: 1500, min: 0, max: 10000 },
    supportEmail: { type: String, default: 'support@skillora.local' },
    payoutThresholdMinor: { type: Number, default: 5000, min: 0 },
    autoApproveCourses: { type: Boolean, default: false },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: toJSONOptions },
);

export const PlatformSettings = model('PlatformSettings', platformSettingsSchema);

export async function getPlatformSettings() {
  const existing = await PlatformSettings.findById('platform').lean();
  if (existing) return existing;
  const created = await PlatformSettings.create({ _id: 'platform' });
  return created.toObject();
}
