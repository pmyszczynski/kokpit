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
}

/** A list with one labeled keyboard-scrollable region and fixed surrounding slots. */
export function WidgetList({ label, header, footer, empty, children, className, listClassName, ...props }: WidgetListProps) {
  return (
    <div {...props} className={joinClassNames("widget-ui", "widget-list", className)}>
      {header != null && <div className="widget-list__header">{header}</div>}
      {empty != null ? <div className="widget-list__empty">{empty}</div> : (
        <ul aria-label={label} tabIndex={0} className={joinClassNames("widget-list__scroll", listClassName)}>{children}</ul>
      )}
      {footer != null && <div className="widget-list__footer">{footer}</div>}
    </div>
  );
}
