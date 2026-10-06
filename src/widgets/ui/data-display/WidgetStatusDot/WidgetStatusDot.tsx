import type { HTMLAttributes } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetStatusDot.css";

export type WidgetStatusDotTone = "neutral" | "positive" | "warning";
export interface WidgetStatusDotProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "role" | "aria-label"> {
  label: string;
  tone?: WidgetStatusDotTone;
}

/** A static, named state indicator; callers own the domain-to-tone mapping. */
export function WidgetStatusDot({ label, tone = "neutral", className, ...props }: WidgetStatusDotProps) {
  return <span title={label} {...props} role="img" aria-label={label}
    className={joinClassNames("widget-ui", "widget-status-dot", `widget-status-dot--tone-${tone}`, className)} />;
}
