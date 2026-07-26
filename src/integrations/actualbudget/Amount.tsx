import { formatMoney } from "./format";

export interface AmountProps {
  /** Minor units (cents). Negative for outflows. */
  cents: number;
  currency: string;
  locale?: string;
}

/**
 * Renders a minor-unit amount as localized currency text, tagging negative
 * amounts so CSS can colour them.
 *
 * Privacy blurring is intentionally not handled here: it is applied once, at
 * the widget root (`.actualbudget-widget--private` in globals.css), which
 * blurs every descendant `.actualbudget-amount` and clears on hover/focus of
 * the whole tile. That keeps the blur presentational only — the text stays in
 * the accessibility tree for screen readers, and a single hover reveals the
 * entire widget instead of one figure at a time.
 */
export function Amount({ cents, currency, locale }: AmountProps) {
  const className =
    cents < 0
      ? "actualbudget-amount actualbudget-amount--negative"
      : "actualbudget-amount";
  return <span className={className}>{formatMoney(cents, currency, locale)}</span>;
}
