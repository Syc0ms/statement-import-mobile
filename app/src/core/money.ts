import type { RecurringCharge } from './types';

/** ISO 4217 minor-unit exponents for the currencies this fragment may see. Default 2. */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
};

/**
 * Formats integer minor units without floating point: 15199 AUD -> "151.99 AUD".
 * Thousands are grouped with a narrow no-break space.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const exponent = MINOR_UNIT_EXPONENT[currency] ?? 2;
  const negative = amountMinor < 0;
  const absolute = Math.abs(Math.trunc(amountMinor));
  const divisor = 10 ** exponent;
  const whole = Math.floor(absolute / divisor);
  const fraction = absolute % divisor;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const amount = exponent > 0 ? `${grouped}.${String(fraction).padStart(exponent, '0')}` : grouped;
  return `${negative ? '−' : ''}${amount} ${currency}`;
}

/** Sum of monthly-equivalent charges, in minor units. Unknown cadences are excluded. */
export function monthlyTotalMinor(items: readonly RecurringCharge[]): number {
  return items.reduce((sum, item) => {
    const perMonth = monthlyEquivalent(item);
    return perMonth === null ? sum : sum + perMonth;
  }, 0);
}

function monthlyEquivalent(item: RecurringCharge): number | null {
  switch (item.cadence) {
    case 'monthly':
      return item.amountMinor;
    case 'yearly':
    case 'annual':
      return Math.round(item.amountMinor / 12);
    case 'weekly':
      return Math.round((item.amountMinor * 52) / 12);
    default:
      return null;
  }
}

const MONTHS_RU = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

/** "2026-10-01" -> "1 окт. 2026". Parsed by hand so the device time zone cannot shift the day. */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return iso;
  return `${day} ${MONTHS_RU[month - 1]} ${match[1]}`;
}

/** Exact byte count with thin-space grouping: 10485771 -> "10 485 771". */
export function formatByteCount(bytes: number): string {
  return String(Math.trunc(bytes)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
}

/** Human-readable byte size: 112 Б, 33.1 КБ, 10.0 МБ (binary units). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} КБ`;
  return `${(kib / 1024).toFixed(1)} МБ`;
}
