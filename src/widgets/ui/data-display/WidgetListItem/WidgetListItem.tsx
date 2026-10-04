import type { HTMLAttributes, ReactNode } from "react";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetListItem.css";

export interface WidgetListItemProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  title: ReactNode;
  secondary?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  contentClassName?: string;
  titleClassName?: string;
  secondaryClassName?: string;
}

/** Collection row; integration content owns formatting and domain semantics. */
export function WidgetListItem({ title, secondary, leading, trailing, className, contentClassName, titleClassName, secondaryClassName, ...props }: WidgetListItemProps) {
  return (
    <li {...props} className={joinClassNames("widget-ui", "widget-list-item", className)}>
      {leading != null && <div className="widget-list-item__leading">{leading}</div>}
      <div className={joinClassNames("widget-list-item__content", contentClassName)}>
        <span className={joinClassNames("widget-list-item__title", titleClassName)} title={typeof title === "string" ? title : undefined}>{title}</span>
        {secondary != null && <span className={joinClassNames("widget-list-item__secondary", secondaryClassName)} title={typeof secondary === "string" ? secondary : undefined}>{secondary}</span>}
      </div>
      {trailing != null && <div className="widget-list-item__trailing">{trailing}</div>}
    </li>
  );
}
