import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { WidgetStatTone } from "../WidgetStat";
import { joinClassNames } from "../../joinClassNames";
import "./WidgetBar.css";

interface WidgetBarBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  min?: number;
  max?: number;
  tone?: WidgetStatTone;
  trackClassName?: string;
  fillClassName?: string;
  labelClassName?: string;
}
export type WidgetBarProps = WidgetBarBaseProps & (
  | { kind?: "progress"; value: number | null }
  | { kind: "usage"; value: number }
) & (
  | { valueLabel?: string | null; valueText?: string }
  /** Rich domain labels must supply their equivalent accessible value text. */
  | { valueLabel?: ReactNode; valueText: string }
);

/** A named progress or usage measurement; integrations retain domain formatting. */
export function WidgetBar({ label, value, min = 0, max = 100, kind = "progress", tone = "info", valueLabel, valueText, trackClassName, fillClassName, labelClassName, className, style, ...props }: WidgetBarProps) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) throw new RangeError("WidgetBar requires a finite increasing range");
  const known = value !== null && Number.isFinite(value);
  if (kind === "usage" && !known) throw new RangeError("WidgetBar usage requires a finite value");
  const bounded = known ? Math.min(max, Math.max(min, value!)) : undefined;
  const percent = bounded === undefined ? 0 : (bounded - min) / (max - min) * 100;
  const text = valueText ?? (typeof valueLabel === "string" ? valueLabel : known ? String(value) : "Unknown progress");
  const barStyle: CSSProperties & { "--widget-bar-value": string } = { "--widget-bar-value": `${percent}%`, ...style };
  return <div {...props} style={barStyle} className={joinClassNames("widget-ui", "widget-bar", `widget-bar--tone-${tone}`, !known ? "widget-bar--indeterminate" : undefined, className)}>
    <div className={joinClassNames("widget-bar__track", trackClassName)} role={kind === "usage" ? "meter" : "progressbar"}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={bounded} aria-valuetext={text}>
      <div className={joinClassNames("widget-bar__fill", fillClassName)} />
    </div>
    {valueLabel != null && <span className={joinClassNames("widget-bar__label", labelClassName)}>{valueLabel}</span>}
  </div>;
}
