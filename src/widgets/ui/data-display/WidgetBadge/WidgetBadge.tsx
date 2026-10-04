import type { HTMLAttributes } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetBadge.css";

export type WidgetBadgeTone = "neutral" | "positive" | "info" | "warning" | "alert";
export interface WidgetBadgeProps extends HTMLAttributes<HTMLSpanElement> { tone?: WidgetBadgeTone; }

/** Named presentation tones; callers supply visible status/category labels. */
export function WidgetBadge({ tone = "neutral", className, ...props }: WidgetBadgeProps) {
  return <span {...props} className={joinClassNames("widget-ui", "widget-badge", `widget-badge--tone-${tone}`, className)} />;
}
