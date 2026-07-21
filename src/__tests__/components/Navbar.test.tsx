import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the client component to avoid useRouter in jsdom
vi.mock("@/components/LogoutButton", () => ({
  default: () => <button>Sign out</button>,
}));

import Navbar from "@/components/Navbar";

describe("Navbar", () => {
  it("renders the site brand link", () => {
    render(Navbar({ showLogout: false }));
    expect(screen.getByRole("link", { name: "kokpit" })).toBeInTheDocument();
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute(
      "src",
      expect.stringContaining("kokpit-mark-navbar-64.png"),
    );
  });

  it("nests the Kokpit mark and wordmark inside the brand link", () => {
    render(Navbar({ showLogout: false }));
    const brandLink = screen.getByRole("link", { name: "kokpit" });
    expect(brandLink.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("kokpit-mark-navbar-64.png"),
    );
  });

  it("renders the brand mark as decorative for assistive technology", () => {
    render(Navbar({ showLogout: false }));
    const img = screen.getByRole("img", { hidden: true });
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  it("hides logout when showLogout is false", () => {
    render(Navbar({ showLogout: false }));
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("shows logout when showLogout is true", () => {
    render(Navbar({ showLogout: true }));
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });
});
