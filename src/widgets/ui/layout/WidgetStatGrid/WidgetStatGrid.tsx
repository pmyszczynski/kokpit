import type { HTMLAttributes, ReactNode } from "react";

export interface WidgetStatGridProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  columns?: 1 | 2 | 3 | 4;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
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
