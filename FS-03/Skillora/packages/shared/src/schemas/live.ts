import { z } from 'zod';
import { objectIdSchema } from './common';

export const liveClassCreateSchema = z
  .object({
    courseId: objectIdSchema,
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().max(3000).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    maxParticipants: z.number().int().min(2).max(500).default(100),
    allowStudentRecording: z.boolean().default(false),
  })
  .strict()
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine((v) => new Date(v.startsAt).getTime() > Date.now() - 60_000, {
    message: 'startsAt must be in the future',
    path: ['startsAt'],
  });

export const liveClassUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
    maxParticipants: z.number().int().min(2).max(500).optional(),
  })
  .strict();

export const chatMessageSchema = z
  .object({ message: z.string().trim().min(1).max(1000) })
  .strict();

export type LiveClassCreateInput = z.infer<typeof liveClassCreateSchema>;