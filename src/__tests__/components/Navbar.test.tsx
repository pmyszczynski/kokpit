import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the client component to avoid useRouter in jsdom
vi.mock("@/components/LogoutButton", () => ({
  default: () => <button>Sign out</button>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/",
}));

import Navbar from "@/components/Navbar";
import { EditModeProvider } from "@/components/edit/EditModeProvider";

describe("Navbar", () => {
  it("renders the site brand link", () => {
    render(Navbar({ showLogout: false }));
    expect(screen.getByRole("link", { name: "kokpit" })).toBeInTheDocument();
    expect(screen.getByRole("img", { hidden: true })).toHaveAttribute(
      "src",
      expect.stringContaining("kokpit-mark-navbar-64.png"),
    );
  });

  it("hides logout when showLogout is false", () => {
    render(Navbar({ showLogout: false }));
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
  });

  it("shows logout when showLogout is true", () => {
    render(Navbar({ showLogout: true }));
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  // Regression test: the protected layout renders <Navbar canEdit /> as a
  // CHILD of <EditModeProvider> (so EditToggleButton's useEditMode() call
  // resolves). Rendering it as a sibling instead throws "useEditMode must be
  // used within an EditModeProvider" and 500s every protected route. This
  // mirrors the real composition in src/app/(protected)/layout.tsx.
  it("renders the edit toggle without throwing when canEdit is true and it is nested inside EditModeProvider", () => {
    expect(() =>
      render(
        <EditModeProvider canEdit={true}>
          <Navbar showLogout={false} canEdit={true} />
        </EditModeProvider>
      )
    ).not.toThrow();
    expect(
      screen.getByRole("button", { name: /edit dashboard/i })
    ).toBeInTheDocument();
  });
});
