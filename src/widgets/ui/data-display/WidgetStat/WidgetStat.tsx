import type { ReactNode } from "react";

export type WidgetStatTone = "neutral" | "positive" | "info" | "positive-soft" | "info-soft";

export interface WidgetStatProps {
  label: ReactNode;
  value: ReactNode;
  tone?: WidgetStatTone;
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

/** A formatted value and its label, presented as a compact stat card. */
export function WidgetStat({
  label,
  value,
  tone = "neutral",
  className,
  valueClassName,
  labelClassName,
}: WidgetStatProps) {
  return (
    <dl
      className={joinClassNames(
        "widget-ui",
        "widget-stat",
        `widget-stat--tone-${tone}`,
        className
      )}
    >
      <dt className={joinClassNames("widget-stat__label", labelClassName)}>{label}</dt>
      <dd className={joinClassNames("widget-stat__value", valueClassName)}>{value}</dd>
    </dl>
  );
}
