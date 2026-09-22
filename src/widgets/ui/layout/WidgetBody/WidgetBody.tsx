import type { HTMLAttributes, ReactNode } from "react";

export interface WidgetBodyProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  notice?: ReactNode;
  reserveNotice?: boolean;
  centered?: boolean;
  noticeClassName?: string;
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

/** A shrinkable widget body with an optional, stable notice row. */
export function WidgetBody({
  children,
  notice,
  reserveNotice = false,
  centered = false,
  className,
  noticeClassName,
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
      {children}
      {hasNoticeSlot && (
        <div className={joinClassNames("widget-body__notice", noticeClassName)}>
          {notice}
        </div>
      )}
    </div>
  );
}
