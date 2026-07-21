import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";

// Controllable edit-mode state for DashboardSurface's view↔edit swap.
let mockState: { active: boolean; draft: KokpitConfig | null } = {
  active: false,
  draft: null,
};

vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditMode: () => mockState,
}));

import DashboardSurface from "@/components/edit/DashboardSurface";

function cfg(): KokpitConfig {
  return KokpitConfigSchema.parse({
    schema_version: 1,
    services: [{ name: "DraftPlex", url: "https://plex.local", group: "Media" }],
  });
}

describe("DashboardSurface", () => {
  beforeEach(() => {
    mockState = { active: false, draft: null };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response)
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the server children in view mode", async () => {
    await act(async () => {
      render(
        <DashboardSurface>
          <div data-testid="server-grid">view</div>
        </DashboardSurface>
      );
    });
    expect(screen.getByTestId("server-grid")).toBeInTheDocument();
  });

  it("renders EditableServiceGrid (from the draft) in edit mode", async () => {
    mockState = { active: true, draft: cfg() };
    await act(async () => {
      render(
        <DashboardSurface>
          <div data-testid="server-grid">view</div>
        </DashboardSurface>
      );
    });
    // Server children are swapped out for the draft-bound grid.
    expect(screen.queryByTestId("server-grid")).not.toBeInTheDocument();
    expect(screen.getByText("DraftPlex")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
  });
});
