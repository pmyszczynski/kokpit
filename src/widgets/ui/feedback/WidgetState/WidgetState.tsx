import { joinClassNames } from "../../joinClassNames";
import "./WidgetState.css";
import type { ReactNode } from "react";

export interface WidgetStateProps {
  state: "loading" | "error" | "empty";
  children?: ReactNode;
  className?: string;
}

/** Presentation for initial loading/error states and widget-supplied empty copy. */
export function WidgetState({ state, children, className }: WidgetStateProps) {
  if (state === "empty" && children === undefined) {
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
        <span className="widget-state__label">{children}</span>
      </div>
    );
  }

  return <div className={rootClassName}>{children}</div>;
}
