import { BPS_DENOMINATOR } from './constants';

/**
 * All monetary values are integer minor units (cents). Never use floats for money.
 */
export function formatMinor(amountMinor: number, currency = 'USD'): string {
  if (!Number.isFinite(amountMinor)) throw new Error('amountMinor must be a finite integer');
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amountMinor));
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const grouped = major.toLocaleString('en-US');
  const symbol = currency === 'USD' ? '$' : '';
  const suffix = currency === 'USD' ? '' : ` ${currency}`;
  return `${sign}${symbol}${grouped}.${String(minor).padStart(2, '0')}${suffix}`;
}

export function parseMajorToMinor(value: string | number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid monetary value: ${value}`);
  return Math.round(n * 100);
}

/** Apply a basis-point rate (1500 = 15%) and round half-up to the nearest minor unit. */
export function applyBps(amountMinor: number, bps: number): number {
  assertInt(amountMinor, 'amountMinor');
  assertInt(bps, 'bps');
  const product = amountMinor * bps;
  const quotient = Math.floor(product / BPS_DENOMINATOR);
  const remainder = product % BPS_DENOMINATOR;
  const rounded = remainder * 2 >= BPS_DENOMINATOR ? quotient + 1 : quotient;
  return rounded;
}

function assertInt(v: number, name: string): void {
  if (!Number.isInteger(v)) throw new Error(`${name} must be an integer minor unit value`);
}

export interface EarningsBreakdown {
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  commissionBps: number;
  commissionMinor: number;
  processingFeeMinor: number;
  refundedMinor: number;
  netMinor: number;
  currency: string;
}

/**
 * Ledger math for one order line. Totals are derived from integers only so that
 * repeated evaluation always produces the same numbers.
 */
export function computeEarnings(input: {
  grossMinor: number;
  discountMinor?: number;
  taxMinor?: number;
  commissionBps: number;
  processingFeeMinor?: number;
  refundedMinor?: number;
  currency: string;
}): EarningsBreakdown {
  const gross = Math.trunc(input.grossMinor);
  const discount = Math.trunc(input.discountMinor ?? 0);
  const tax = Math.trunc(input.taxMinor ?? 0);
  const fee = Math.trunc(input.processingFeeMinor ?? 0);
  const refunded = Math.trunc(input.refundedMinor ?? 0);

  if (gross < 0 || discount < 0 || tax < 0 || fee < 0 || refunded < 0) {
    throw new Error('Monetary inputs must be non-negative');
  }
  if (discount > gross) throw new Error('discount cannot exceed gross amount');

  const taxable = gross - discount;
  const commission = applyBps(taxable, input.commissionBps);
  const net = Math.max(0, taxable - commission - fee - refunded);

  return {
    grossMinor: gross,
    discountMinor: discount,
    taxMinor: tax,
    commissionBps: input.commissionBps,
    commissionMinor: commission,
    processingFeeMinor: fee,
    refundedMinor: refunded,
    netMinor: net,
    currency: input.currency,
  };
}