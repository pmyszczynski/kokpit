import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetList.css";

export type WidgetListSummaryTone = "neutral" | "positive" | "info";
export interface WidgetListSummary {
  primary: ReactNode;
  secondary?: ReactNode;
  primaryTone?: WidgetListSummaryTone;
  secondaryTone?: WidgetListSummaryTone;
  className?: string;
  primaryClassName?: string;
  secondaryClassName?: string;
}

export interface WidgetListProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  header?: ReactNode;
  /** Two caller-owned measurements displayed outside the scrolling list. */
  summary?: WidgetListSummary;
  footer?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
  listClassName?: string;
  /** Fixed labels for the shared four-column item variant. */
  columnLabels?: readonly [string, string, string, string];
  columnsClassName?: string;
  /** Align leading and trailing accessories across three-slot list rows. */
  alignAccessories?: boolean;
}

/** A list with one labeled keyboard-scrollable region and fixed surrounding slots. */
export function WidgetList({ label, header, summary, footer, empty, children, className, listClassName, columnLabels, columnsClassName, alignAccessories = false, ...props }: WidgetListProps) {
  return (
    <div {...props} className={joinClassNames("widget-ui", "widget-list", className)}>
      {header != null && <div className="widget-list__header">{header}</div>}
      {summary && <div className={joinClassNames("widget-list__summary", summary.className)}>
        <span className={joinClassNames("widget-list__summary-primary", `widget-list__summary-tone-${summary.primaryTone ?? "neutral"}`, summary.primaryClassName)}>{summary.primary}</span>
        {summary.secondary != null && <span className={joinClassNames("widget-list__summary-secondary", `widget-list__summary-tone-${summary.secondaryTone ?? "neutral"}`, summary.secondaryClassName)}>{summary.secondary}</span>}
      </div>}
      {columnLabels && empty == null && <div className={joinClassNames("widget-list__columns", columnsClassName)}>{columnLabels.map((text, index) => <span key={index}>{text}</span>)}</div>}
      {empty != null ? <div className="widget-list__empty">{empty}</div> : (
        <ul aria-label={label} tabIndex={0} className={joinClassNames("widget-list__scroll", alignAccessories ? "widget-list__scroll--aligned" : undefined, listClassName)}>{children}</ul>
      )}
      {footer != null && <div className="widget-list__footer">{footer}</div>}
    </div>
  );
}
