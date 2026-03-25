"use client";

import { getWidget } from "@/widgets";
import { useWidget } from "@/widgets/useWidget";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";

interface WidgetRendererProps {
  type: string;
  config: Record<string, unknown>;
  refreshInterval?: number;
}

function WidgetContent({ type, config, refreshInterval }: WidgetRendererProps) {
  const widget = getWidget(type);

  const { data, loading, error, refresh } = useWidget(
    type,
    config,
    refreshInterval ?? widget?.refreshInterval
  );

  if (!widget) {
    return (
      <div className="widget-error" role="alert">
        <span className="widget-error__label">Unknown widget type: &quot;{type}&quot;</span>
      </div>
    );
  }

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

export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary widgetType={props.type}>
      <WidgetContent {...props} />
    </WidgetErrorBoundary>
  );
}
