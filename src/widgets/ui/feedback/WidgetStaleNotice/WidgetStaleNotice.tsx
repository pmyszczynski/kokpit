import { joinClassNames } from "../../joinClassNames";
import "./WidgetStaleNotice.css";

export interface WidgetStaleNoticeProps {
  error: string | null;
  message?: string;
  className?: string;
}

const defaultMessage = "Refresh failed · saved data";

/** Announces that the widget is showing saved data after a refresh failure. */
export function WidgetStaleNotice({
  error,
  message = defaultMessage,
  className,
}: WidgetStaleNoticeProps) {
  if (error === null) {
    return null;
  }

  const accessibleMessage =
    message === defaultMessage
      ? `Refresh failed; saved data is shown. ${error}`
      : `${message}. ${error}`;

  return (
    <span
      key={error}
      className={joinClassNames("widget-ui", "widget-stale-notice", className)}
      role="alert"
      title={error}
      aria-label={accessibleMessage}
      aria-atomic="true"
    >
      {message}
    </span>
  );
}
