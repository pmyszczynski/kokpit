/**
 * Actual Budget carries every amount as an integer in the minor currency unit
 * (cents): $120.30 arrives as 12030. Outflows are negative.
 */
export function centsToUnits(cents: number): number {
  return cents / 100;
}

/**
 * Renders a minor-unit amount as currency. The API carries no currency
 * information at all, so both `currency` and `locale` come from user config
 * and can be nonsense — Intl throws RangeError on an unknown currency code or
 * a malformed language tag, which would otherwise blank the whole widget.
 */
export function formatMoney(
  cents: number,
  currency: string,
  locale?: string
): string {
  const value = centsToUnits(cents);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}

/**
 * Whole days from today to a `YYYY-MM-DD` date, in local time. Negative when
 * the date is in the past.
 *
 * The date is split by hand rather than passed to `new Date(string)`, which
 * parses a bare `YYYY-MM-DD` as UTC midnight and lands on the previous day for
 * anyone west of UTC. Rounding (not truncating) the difference absorbs the 23-
 * and 25-hour days either side of a DST transition. Returns 0 for anything
 * that isn't a parseable date, so callers never see NaN.
 */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return 0;

  const target = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
