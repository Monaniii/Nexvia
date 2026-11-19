import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, roleSchema } from './common';

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(['student', 'instructor']).default('student'),
  headline: z.string().trim().max(160).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(10).max(200),
    password: passwordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .strict();

export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    avatarUrl: z.string().trim().url().max(500).nullable().optional(),
    headline: z.string().trim().max(160).nullable().optional(),
    bio: z.string().trim().max(4000).nullable().optional(),
    website: z.string().trim().url().max(300).nullable().optional(),
    expertise: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
    socialLinks: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(40),
          url: z.string().trim().url().max(300),
        }),
      )
      .max(8)
      .optional(),
  })
  .strict();

export const changeRoleSchema = z.object({ role: roleSchema });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;