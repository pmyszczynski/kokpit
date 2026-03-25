"use client";

import { getWidget } from "@/widgets";
import type { WidgetDefinition } from "@/widgets";
import { useWidget } from "@/widgets/useWidget";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";

interface WidgetRendererProps {
  type: string;
  serviceName: string;
  refreshInterval?: number;
}

// Separated so useWidget is only mounted when the widget type is known.
// React rules prohibit conditional hook calls, so the guard lives in the parent.
function KnownWidgetContent({
  widget,
  type,
  serviceName,
  refreshInterval,
}: {
  widget: WidgetDefinition;
  type: string;
  serviceName: string;
  refreshInterval?: number;
}) {
  const { data, loading, error, refresh } = useWidget(
    type,
    serviceName,
    refreshInterval ?? widget.refreshInterval
  );

  if (loading && data === null) {
    return (
      <div className="widget-loading" aria-label="Loading widget">
        <span className="widget-loading__spinner" aria-hidden="true" />
      </div>
    );
  }

  if (error && data === null) {
    return (
      <div className="widget-error" role="alert">
        <span className="widget-error__label">{error}</span>
      </div>
    );
  }

  const Component = widget.component;
  return <Component data={data} loading={loading} error={error} refresh={refresh} />;
}

function WidgetContent({ type, serviceName, refreshInterval }: WidgetRendererProps) {
  const widget = getWidget(type);

  if (!widget) {
    return (
      <div className="widget-error" role="alert">
        <span className="widget-error__label">Unknown widget type: &quot;{type}&quot;</span>
      </div>
    );
  }

  return (
    <KnownWidgetContent
      widget={widget}
      type={type}
      serviceName={serviceName}
      refreshInterval={refreshInterval}
    />
  );
}

export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary widgetType={props.type}>
      <WidgetContent {...props} />
    </WidgetErrorBoundary>
  );
}
