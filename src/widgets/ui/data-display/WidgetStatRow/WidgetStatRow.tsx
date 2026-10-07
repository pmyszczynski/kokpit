import type { HTMLAttributes, ReactNode } from "react";
import type { WidgetStatTone } from "../WidgetStat";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetStatRow.css";

export interface WidgetStatRowValue {
  content: ReactNode;
  tone?: WidgetStatTone;
  title?: string;
  className?: string;
}
export interface WidgetStatRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  value?: ReactNode;
  subValue?: ReactNode;
  /** Paired or grouped measurements, such as transfer directions or load periods. */
  values?: readonly WidgetStatRowValue[];
  tone?: WidgetStatTone;
  bar?: ReactNode;
  detail?: ReactNode;
  headerClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  subValueClassName?: string;
  valuesClassName?: string;
}

/** A labeled measurement; callers retain units, formatting, bars and domain meaning. */
export function WidgetStatRow({ label, value, subValue, values, tone = "neutral", bar, detail, className, headerClassName, labelClassName, valueClassName, subValueClassName, valuesClassName, ...props }: WidgetStatRowProps) {
  return <div {...props} className={joinClassNames("widget-ui", "widget-stat-row", className)}>
    <div className={joinClassNames("widget-stat-row__header", headerClassName)}>
      <span className={joinClassNames("widget-stat-row__label", labelClassName)}>{label}</span>
      {value != null && <span className={joinClassNames("widget-stat-row__value", `widget-stat-row__value--tone-${tone}`, valueClassName)}>
        {value}{subValue != null && <span className={joinClassNames("widget-stat-row__subvalue", subValueClassName)}> {subValue}</span>}
      </span>}
      {values != null && <div className={joinClassNames("widget-stat-row__values", valuesClassName)}>
        {values.map((item, index) => <span key={index} title={item.title} className={joinClassNames("widget-stat-row__value", `widget-stat-row__value--tone-${item.tone ?? tone}`, item.className)}>{item.content}</span>)}
      </div>}
    </div>
    {bar}
    {detail != null && <div className="widget-stat-row__detail">{detail}</div>}
  </div>;
}
