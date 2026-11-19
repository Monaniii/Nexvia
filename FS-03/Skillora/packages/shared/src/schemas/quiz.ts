import { z } from 'zod';
import { QUESTION_TYPES } from '../constants';
import { objectIdSchema } from './common';

const optionSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(600),
  })
  .strict();

export const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(2).max(2000),
    points: z.number().int().min(1).max(1000).default(1),
    options: z.array(optionSchema).min(2).max(8),
    correctOptionIds: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
    explanation: z.string().trim().max(1000).optional(),
  })
  .superRefine((q, ctx) => {
    const ids = new Set(q.options.map((o) => o.id));
    if (ids.size !== q.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Option ids must be unique', path: ['options'] });
    }
    for (const cid of q.correctOptionIds) {
      if (!ids.has(cid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'correctOptionIds must reference existing options',
          path: ['correctOptionIds'],
        });
      }
    }
    if (q.type === 'true_false' && q.options.length !== 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'true/false needs exactly 2 options', path: ['options'] });
    }
    if (q.type !== 'multi_choice' && q.correctOptionIds.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This question type must have exactly one correct option',
        path: ['correctOptionIds'],
      });
    }
  });

export const quizUpsertSchema = z
  .object({
    title: z.string().trim().min(2).max(140),
    description: z.string().trim().max(2000).nullable().optional(),
    lessonId: objectIdSchema.nullable().optional(),
    passScorePercent: z.number().int().min(0).max(100).default(60),
    timeLimitSeconds: z.number().int().min(30).max(7200).nullable().default(null),
    maxAttempts: z.number().int().min(1).max(10).default(1),
    randomizeQuestions: z.boolean().default(false),
    randomizeOptions: z.boolean().default(false),
    questions: z.array(questionSchema).min(1).max(50),
  })
  .strict();

export const quizSubmissionSchema = z
  .object({
    answers: z
      .array(
        z.object({
          questionId: z.string().trim().min(1).max(40),
          optionIds: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const quizUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(140).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    passScorePercent: z.number().int().min(0).max(100).optional(),
    timeLimitSeconds: z.number().int().min(30).max(7200).nullable().optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    randomizeQuestions: z.boolean().optional(),
    randomizeOptions: z.boolean().optional(),
    questions: z.array(questionSchema).min(1).max(50).optional(),
  })
  .strict();

export type QuizUpsertInput = z.infer<typeof quizUpsertSchema>;
export type QuizSubmissionInput = z.infer<typeof quizSubmissionSchema>;
export type QuestionInput = z.infer<typeof questionSchema>;