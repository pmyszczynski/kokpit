import { joinClassNames } from "../../joinClassNames";
import "./WidgetStatGrid.css";
import type { HTMLAttributes, ReactNode } from "react";

export interface WidgetStatGridProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  columns?: 1 | 2 | 3 | 4;
}

/** A shrinkable grid that arranges widget statistics into caller-selected columns. */
export function WidgetStatGrid({
  children,
  columns = 2,
  className,
  ...props
}: WidgetStatGridProps) {
  return (
    <div
      {...props}
      className={joinClassNames("widget-ui", "widget-stat-grid", className)}
      data-columns={columns}
    >
      {children}
    </div>
  );
}
