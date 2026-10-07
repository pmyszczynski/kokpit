import { joinClassNames } from "../../joinClassNames";
import "./WidgetBody.css";
import type { HTMLAttributes, ReactNode } from "react";

export interface WidgetBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  notice?: ReactNode;
  reserveNotice?: boolean;
  centered?: boolean;
  noticeClassName?: string;
  /** Opt-in named keyboard-scrollable content; the notice remains outside it. */
  scrollLabel?: string;
  /** Center saved empty content while retaining the fixed notice slot. */
  contentCentered?: boolean;
  contentClassName?: string;
}

/** A shrinkable widget body with an optional, stable notice row. */
export function WidgetBody({
  children,
  notice,
  reserveNotice = false,
  centered = false,
  className,
  noticeClassName,
  scrollLabel,
  contentCentered = false,
  contentClassName,
  ...props
}: WidgetBodyProps) {
  const hasNoticeSlot =
    reserveNotice || (notice !== null && notice !== undefined && typeof notice !== "boolean");

  return (
    <div
      {...props}
      className={joinClassNames(
        "widget-ui",
        "widget-body",
        centered ? "widget-body--centered" : undefined,
        className
      )}
    >
      {scrollLabel !== undefined || contentCentered || contentClassName !== undefined ? <div
        className={joinClassNames("widget-body__content", scrollLabel !== undefined ? "widget-body__content--scroll" : undefined, contentCentered ? "widget-body__content--centered" : undefined, contentClassName)}
        role={scrollLabel !== undefined ? "region" : undefined}
        aria-label={scrollLabel}
        tabIndex={scrollLabel !== undefined ? 0 : undefined}
      >{children}</div> : children}
      {hasNoticeSlot && (
        <div className={joinClassNames("widget-body__notice", noticeClassName)}>
          {notice}
        </div>
      )}
    </div>
  );
}
