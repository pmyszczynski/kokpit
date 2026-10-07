"use client";

import { joinClassNames } from "../../joinClassNames";
import "./WidgetStat.css";
import { useId, useRef, type ReactNode, type SyntheticEvent } from "react";

export type WidgetStatTone = "neutral" | "positive" | "info" | "positive-soft" | "info-soft" | "alert" | "warning";

export interface WidgetStatProps {
  label: ReactNode;
  value: ReactNode;
  tone?: WidgetStatTone;
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
  /** Full supporting measurement exposed by the value tooltip and accessible description. */
  valueTooltip?: string;
}

/** A formatted value and its label, presented as a compact stat card. */
export function WidgetStat({
  label,
  value,
  tone = "neutral",
  className,
  valueClassName,
  labelClassName,
  valueTooltip,
}: WidgetStatProps) {
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const showTooltip = (event: SyntheticEvent<HTMLElement>) => {
    const tooltip = tooltipRef.current;
    if (!tooltip?.showPopover) return;
    if (!tooltip.matches(":popover-open")) tooltip.showPopover();
    const anchor = event.currentTarget.getBoundingClientRect();
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
    tooltip.style.top = `${anchor.bottom + bounds.height + 6 <= window.innerHeight - 8
      ? anchor.bottom + 6 : Math.max(8, anchor.top - bounds.height - 6)}px`;
  };
  const hideTooltip = () => {
    const tooltip = tooltipRef.current;
    if (tooltip?.hidePopover && tooltip.matches(":popover-open")) tooltip.hidePopover();
  };

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
      <dd className={joinClassNames("widget-stat__value", valueClassName)}
        tabIndex={valueTooltip ? 0 : undefined} aria-describedby={valueTooltip ? tooltipId : undefined}
        onFocus={valueTooltip ? showTooltip : undefined} onBlur={hideTooltip}
        onMouseEnter={valueTooltip ? showTooltip : undefined}
        onMouseLeave={event => { if (event.currentTarget !== document.activeElement) hideTooltip(); }}
        onKeyDown={event => { if (event.key === "Escape") hideTooltip(); }}>
        {value}
        {valueTooltip && <span ref={tooltipRef} id={tooltipId} role="tooltip" popover="manual" className="widget-ui widget-stat__tooltip">{valueTooltip}</span>}
      </dd>
    </dl>
  );
}
