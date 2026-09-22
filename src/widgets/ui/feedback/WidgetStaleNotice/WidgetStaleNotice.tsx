export interface WidgetStaleNoticeProps {
  error: string | null;
  message?: string;
  className?: string;
}

const defaultMessage = "Refresh failed · saved data";

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

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
      className={joinClassNames("widget-ui", "widget-stale-notice", className)}
      role="alert"
      title={error}
      aria-label={accessibleMessage}
    >
      {message}
    </span>
  );
}
