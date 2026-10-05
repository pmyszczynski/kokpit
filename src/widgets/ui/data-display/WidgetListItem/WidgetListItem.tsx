import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetListItem.css";
import type { WidgetStatTone } from "../WidgetStat";

export interface WidgetListItemColumn {
  content: ReactNode;
  tone?: WidgetStatTone;
  className?: string;
}
interface WidgetListItemBaseProps extends Omit<HTMLAttributes<HTMLLIElement>, "title" | "children"> {
  title: ReactNode;
  /** Full text for a rich title that may be truncated. Strings default to themselves. */
  titleTooltip?: string;
  /** Full text for rich secondary content that may be truncated. */
  secondaryTooltip?: string;
  secondary?: ReactNode;
  contentClassName?: string;
  titleClassName?: string;
  secondaryClassName?: string;
}
export type WidgetListItemProps = WidgetListItemBaseProps & (
  | { columns?: undefined; leading?: ReactNode; trailing?: ReactNode }
  | { columns: readonly [WidgetListItemColumn, WidgetListItemColumn, WidgetListItemColumn]; leading?: never; trailing?: never }
);

/** Collection row; integration content owns formatting and domain semantics. */
export function WidgetListItem({ title, titleTooltip, secondary, secondaryTooltip, leading, trailing, columns, className, contentClassName, titleClassName, secondaryClassName, ...props }: WidgetListItemProps) {
  return (
    <li {...props} className={joinClassNames("widget-ui", "widget-list-item", columns ? "widget-list-item--columns" : undefined, className)}>
      {leading != null && <div className="widget-list-item__leading">{leading}</div>}
      <div className={joinClassNames("widget-list-item__content", contentClassName)}>
        <span className={joinClassNames("widget-list-item__title", titleClassName)} title={titleTooltip ?? (typeof title === "string" ? title : undefined)}>{title}</span>
        {secondary != null && <span className={joinClassNames("widget-list-item__secondary", secondaryClassName)} title={secondaryTooltip ?? (typeof secondary === "string" ? secondary : undefined)}>{secondary}</span>}
      </div>
      {trailing != null && <div className="widget-list-item__trailing">{trailing}</div>}
      {columns?.map((column, index) => <div key={index} className={joinClassNames("widget-list-item__column", `widget-list-item__column--tone-${column.tone ?? "neutral"}`, column.className)}>{column.content}</div>)}
    </li>
  );
}
