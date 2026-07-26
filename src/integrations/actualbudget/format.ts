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
 * Formats `date` as `YYYY-MM-DD` (or `YYYY-MM`, depending on `options`) inside
 * `timeZone`, using `en-CA` for its ISO-ordered parts. Returns null when
 * `timeZone` is not a valid IANA zone name — the constructor throws
 * `RangeError` for that, which must not take down a widget over a typo'd
 * config field. Callers fall back to local time on a null result.
 */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone }).format(
      date
    );
  } catch {
    return null;
  }
}

/**
 * Whole days from today to a `YYYY-MM-DD` date. Negative when the date is in
 * the past.
 *
 * The date is split by hand rather than passed to `new Date(string)`, which
 * parses a bare `YYYY-MM-DD` as UTC midnight and lands on the previous day for
 * anyone west of UTC. Rounding (not truncating) the difference absorbs the 23-
 * and 25-hour days either side of a DST transition. Returns 0 for anything
 * that isn't a parseable date, so callers never see NaN.
 *
 * "Today" is resolved in `timeZone` when given (falling back to local time if
 * the zone string is invalid), and in local time otherwise. Without this, a
 * container that runs UTC (the default — no Dockerfile or compose file in
 * this repo sets `TZ`) reports the wrong day for anyone outside UTC, which
 * shows up as "1d" for a schedule that is actually due today.
 */
export function daysUntil(
  isoDate: string,
  now: Date = new Date(),
  timeZone?: string
): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return 0;

  const target = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );

  const formatted = timeZone
    ? formatInTimeZone(now, timeZone, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : null;

  let today: Date;
  if (formatted) {
    const [y, m, d] = formatted.split("-").map(Number);
    today = new Date(y, m - 1, d);
  } else {
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
