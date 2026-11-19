import { z } from 'zod';
import { DIFFICULTY_LEVELS, LESSON_TYPES } from '../constants';
import { minorUnitsSchema, objectIdSchema, paginationSchema, slugSchema } from './common';

export const courseCreateSchema = z
  .object({
    title: z.string().trim().min(4).max(140),
    headline: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().min(40).max(20_000).optional(),
    categoryId: objectIdSchema.optional(),
    level: z.enum(DIFFICULTY_LEVELS).default('beginner'),
    language: z.string().trim().min(2).max(40).default('English'),
    priceMinor: minorUnitsSchema.default(0),
    currency: z.string().trim().length(3).toUpperCase().default('USD'),
    objectives: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
    prerequisites: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
    thumbnailUrl: z.string().trim().max(600).nullable().optional(),
    welcomeMessage: z.string().trim().max(1000).nullable().optional(),
    congratulationsMessage: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const courseUpdateSchema = courseCreateSchema.partial().extend({
  status: z.enum(['draft', 'archived']).optional(),
});

export const sectionCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    order: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

export const sectionUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(140).optional(),
    order: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

export const lessonCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    type: z.enum(LESSON_TYPES).default('video'),
    content: z.string().trim().max(50_000).nullable().optional(),
    durationSeconds: z.number().int().min(0).max(86_400).default(0),
    isPreview: z.boolean().default(false),
    isPublished: z.boolean().default(false),
    order: z.number().int().min(0).max(9999).optional(),
    resources: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          fileName: z.string().trim().min(1).max(200),
          url: z.string().trim().max(600),
          sizeBytes: z.number().int().min(0),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict();

export const lessonUpdateSchema = lessonCreateSchema.partial();

export const courseSearchSchema = paginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  category: slugSchema.optional(),
  level: z.enum(DIFFICULTY_LEVELS).optional(),
  price: z.enum(['free', 'paid']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  instructor: z.string().trim().max(120).optional(),
  duration: z.enum(['short', 'medium', 'long']).optional(),
  sort: z
    .enum(['newest', 'oldest', 'rating', 'popular', 'price_asc', 'price_desc', 'title'])
    .default('popular'),
});

export const reviewCreateSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

export const publishSchema = z
  .object({
    action: z.enum(['submit', 'approve', 'reject', 'unpublish', 'archive']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    slug: slugSchema,
    icon: z.string().trim().max(60).optional(),
  })
  .strict();

export type CourseCreateInput = z.infer<typeof courseCreateSchema>;
export type CourseSearchInput = z.infer<typeof courseSearchSchema>;
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;