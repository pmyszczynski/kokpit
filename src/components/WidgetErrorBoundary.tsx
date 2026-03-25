"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  widgetType?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "Widget crashed",
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="widget-error" role="alert">
          <span className="widget-error__label">
            {this.props.widgetType ? `[${this.props.widgetType}] ` : ""}
            {this.state.message}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
