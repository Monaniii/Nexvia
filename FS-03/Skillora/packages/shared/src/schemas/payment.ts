import { z } from 'zod';
import { objectIdSchema } from './common';

export const checkoutSchema = z
  .object({
    courseId: objectIdSchema,
    couponCode: z.string().trim().max(40).optional(),
  })
  .strict();

export const refundSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    amountMinor: z.number().int().min(1).optional(),
  })
  .strict();

export const payoutRequestSchema = z
  .object({
    amountMinor: z.number().int().min(100).max(100_000_00),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const payoutDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'mark_paid']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const webhookEventSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

export const settingsUpdateSchema = z
  .object({
    commissionBps: z.number().int().min(0).max(10000).optional(),
    platformName: z.string().trim().min(2).max(60).optional(),
    supportEmail: z.string().trim().email().max(200).optional(),
    payoutThresholdMinor: z.number().int().min(0).optional(),
    autoApproveCourses: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
  })
  .strict();

export const moderationSchema = z
  .object({
    action: z.enum(['approve', 'reject', 'unpublish', 'archive']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const userAdminUpdateSchema = z
  .object({
    role: z.enum(['student', 'instructor', 'admin']).optional(),
    isActive: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    instructorApproved: z.boolean().optional(),
  })
  .strict();

export type CheckoutInput = z.infer<typeof checkoutSchema>;