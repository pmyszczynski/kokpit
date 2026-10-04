import { joinClassNames } from "../../joinClassNames";
import "./WidgetState.css";
import type { ReactNode } from "react";

export interface WidgetStateProps {
  state: "loading" | "error" | "empty";
  children?: ReactNode;
  className?: string;
  /** Optional hook on the error text, where legacy CSS colors must still apply. */
  labelClassName?: string;
}

/** Presentation for initial loading/error states and widget-supplied empty copy. */
export function WidgetState({ state, children, className, labelClassName }: WidgetStateProps) {
  if (
    (state === "empty" || state === "error") &&
    (children === null || children === undefined)
  ) {
    return null;
  }

  const rootClassName = joinClassNames(
    "widget-ui",
    "widget-state",
    `widget-state--${state}`,
    className
  );

  if (state === "loading") {
    return (
      <div className={rootClassName} role="status" aria-label="Loading widget">
        <span className="widget-state__spinner" aria-hidden="true" />
        {children}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={rootClassName} role="alert">
        <span className={joinClassNames("widget-state__label", labelClassName)}>{children}</span>
      </div>
    );
  }

  return <div className={rootClassName}>{children}</div>;
}
