"use client";

// Register all integration widgets into the client-side registry so that
// getWidget() resolves on any page that renders a WidgetRenderer.
import "@/integrations";
import { getWidget } from "@/widgets";
import type { WidgetDefinition } from "@/widgets";
import { useWidget } from "@/widgets/useWidget";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { dimensionsForFootprint, type TileFootprint } from "@/layout/grid";

interface WidgetRendererProps {
  type: string;
  tileId: string;
  refreshInterval?: number;
  footprint?: TileFootprint;
  mobile?: boolean;
}

// Separated so useWidget is only mounted when the widget type is known.
// React rules prohibit conditional hook calls, so the guard lives in the parent.
function KnownWidgetContent({
  widget,
  type,
  tileId,
  refreshInterval,
  footprint,
  mobile,
}: {
  widget: WidgetDefinition;
  type: string;
  tileId: string;
  refreshInterval?: number;
  footprint: TileFootprint;
  mobile?: boolean;
}) {
  const { data, loading, error, refresh } = useWidget(
    tileId,
    refreshInterval ?? widget.refreshInterval,
    type
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

  const Component = mobile ? widget.mobile?.component : widget.component;
  if (!Component) return null;
  return <Component data={data} loading={loading} error={error} refresh={refresh}
    footprint={footprint} dimensions={dimensionsForFootprint(footprint)} />;
}

function WidgetContent({ type, tileId, refreshInterval, footprint, mobile }: WidgetRendererProps) {
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
      key={type}
      widget={widget}
      type={type}
      tileId={tileId}
      refreshInterval={refreshInterval}
      footprint={footprint ?? { columnSpan: 3, rowSpan: 2 }}
      mobile={mobile}
    />
  );
}

export function WidgetRenderer(props: WidgetRendererProps) {
  return (
    <WidgetErrorBoundary key={props.type} widgetType={props.type}>
      <WidgetContent {...props} />
    </WidgetErrorBoundary>
  );
}
