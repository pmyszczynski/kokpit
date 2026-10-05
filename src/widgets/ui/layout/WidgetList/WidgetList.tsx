import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetList.css";

export interface WidgetListProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  header?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
  listClassName?: string;
  /** Fixed labels for the shared four-column item variant. */
  columnLabels?: readonly [string, string, string, string];
  headerClassName?: string;
  /** Align leading and trailing accessories across three-slot list rows. */
  alignAccessories?: boolean;
}

/** A list with one labeled keyboard-scrollable region and fixed surrounding slots. */
export function WidgetList({ label, header, footer, empty, children, className, listClassName, columnLabels, headerClassName, alignAccessories = false, ...props }: WidgetListProps) {
  return (
    <div {...props} className={joinClassNames("widget-ui", "widget-list", className)}>
      {header != null && <div className="widget-list__header">{header}</div>}
      {columnLabels && empty == null && <div className={joinClassNames("widget-list__columns", headerClassName)}>{columnLabels.map((text, index) => <span key={index}>{text}</span>)}</div>}
      {empty != null ? <div className="widget-list__empty">{empty}</div> : (
        <ul aria-label={label} tabIndex={0} className={joinClassNames("widget-list__scroll", alignAccessories ? "widget-list__scroll--aligned" : undefined, listClassName)}>{children}</ul>
      )}
      {footer != null && <div className="widget-list__footer">{footer}</div>}
    </div>
  );
}
