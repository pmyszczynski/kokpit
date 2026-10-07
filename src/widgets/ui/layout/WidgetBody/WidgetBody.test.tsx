import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetBody } from "./WidgetBody";

describe("WidgetBody", () => {
  it("keeps an opt-in named keyboard scroll region separate from the fixed notice", () => {
    const { rerender } = render(<WidgetBody scrollLabel="Host measurements" contentClassName="host-scroll" reserveNotice>CPU</WidgetBody>);
    const region = screen.getByRole("region", { name: "Host measurements" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("widget-body__content--scroll", "host-scroll");
    expect(region).toHaveTextContent("CPU");
    expect(region.nextElementSibling).toHaveClass("widget-body__notice");
    rerender(<WidgetBody scrollLabel="Host measurements" reserveNotice notice={<span>Refresh failed</span>}>CPU</WidgetBody>);
    expect(region).not.toHaveTextContent("Refresh failed");
    expect(region.nextElementSibling).toHaveTextContent("Refresh failed");
  });
  it("centers saved empty content without an empty keyboard target", () => {
    const { container } = render(<WidgetBody contentCentered reserveNotice>No stats to show</WidgetBody>);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(container.querySelector(".widget-body__content--centered")).toHaveTextContent("No stats to show");
    expect(container.querySelector("[tabindex]")).not.toBeInTheDocument();
  });
  it("keeps caller content, classes, and div accessibility attributes", () => {
    render(
      <WidgetBody centered className="immich-stats-widget" aria-label="Immich stats">
        <span>Storage</span>
      </WidgetBody>
    );

    const body = screen.getByLabelText("Immich stats");

    expect(body).toHaveClass(
      "widget-ui",
      "widget-body",
      "widget-body--centered",
      "immich-stats-widget"
    );
    expect(body).toHaveTextContent("Storage");
  });

  it("adds a permanent empty notice slot when notice space is reserved", () => {
    const { container } = render(
      <WidgetBody reserveNotice>
        <span>Storage</span>
      </WidgetBody>
    );

    const notice = container.querySelector(".widget-body__notice");

    expect(notice).toBeEmptyDOMElement();
    expect(notice?.previousElementSibling).toHaveTextContent("Storage");
  });

  it("omits an optional notice slot when no notice was provided", () => {
    const { container } = render(<WidgetBody>Storage</WidgetBody>);

    expect(container.querySelector(".widget-body__notice")).not.toBeInTheDocument();
  });

  it("does not reserve an optional slot for conditional boolean notices", () => {
    const { container } = render(<WidgetBody notice={false}>Storage</WidgetBody>);

    expect(container.querySelector(".widget-body__notice")).not.toBeInTheDocument();
  });

  it("keeps zero as notice content", () => {
    const { container } = render(<WidgetBody notice={0}>Storage</WidgetBody>);

    expect(container.querySelector(".widget-body__notice")).toHaveTextContent("0");
  });

  it("renders an optional notice and preserves its caller class hook", () => {
    render(
      <WidgetBody notice={<span>Refresh failed</span>} noticeClassName="immich-notice">
        Storage
      </WidgetBody>
    );

    expect(screen.getByText("Refresh failed").parentElement).toHaveClass(
      "widget-body__notice",
      "immich-notice"
    );
  });
});
