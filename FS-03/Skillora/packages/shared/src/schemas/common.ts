import { z } from 'zod';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT, ROLES } from '../constants';

export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid identifier');

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});

export const sortSchema = z.string().trim().max(64).optional();

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const nameSchema = z.string().trim().min(2).max(80);

export const roleSchema = z.enum(ROLES);

export const currencySchema = z.string().trim().toUpperCase().length(3).default('USD');

/** Money is always an integer number of minor units. */
export const minorUnitsSchema = z.number().int().min(0).max(100_000_00);

export const mongoIdObject = objectIdSchema;

export function errorMessageFor(path: string, message: string) {
  return { path, message };
}