import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KokpitLogo from "@/components/KokpitLogo";

describe("KokpitLogo", () => {
  it("renders the navbar mark image with the expected source and dimensions", () => {
    render(<KokpitLogo />);
    const img = screen.getByRole("img", { hidden: true });
    expect(img).toHaveAttribute(
      "src",
      expect.stringContaining("kokpit-mark-navbar-64.png"),
    );
    expect(img).toHaveAttribute("width", "28");
    expect(img).toHaveAttribute("height", "28");
  });

  it("marks the mark image as decorative (empty alt, aria-hidden)", () => {
    render(<KokpitLogo />);
    const img = screen.getByRole("img", { hidden: true });
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the wordmark text alongside the mark", () => {
    render(<KokpitLogo />);
    expect(screen.getByText("kokpit")).toBeInTheDocument();
  });

  it("wraps the mark and wordmark in a single kokpit-logo container", () => {
    const { container } = render(<KokpitLogo />);
    const wrapper = container.querySelector(".kokpit-logo");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("img")).not.toBeNull();
    expect(wrapper?.querySelector(".kokpit-logo__wordmark")).toHaveTextContent("kokpit");
  });
});