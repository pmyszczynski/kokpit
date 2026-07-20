import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { KokpitConfig, Service } from "@/config/schema";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

interface StubServiceFormProps {
  service: Service | null;
  existingGroups: string[];
  takenNames?: string[];
  onSave: (service: Service) => void;
  onClose: () => void;
}

vi.mock("@/components/ServiceForm", () => ({
  default: ({ service, existingGroups, takenNames, onSave, onClose }: StubServiceFormProps) => (
    <div data-testid="service-form-stub">
      <div data-testid="service-form-stub-props">
        {JSON.stringify({ service, existingGroups, takenNames })}
      </div>
      <button onClick={() => onSave({ name: "NewSvc", url: "http://new.local" })}>
        StubSave
      </button>
      <button onClick={onClose}>StubClose</button>
    </div>
  ),
}));

import SettingsPanel from "@/components/SettingsPanel";

function makeConfig(overrides: Partial<KokpitConfig> = {}): KokpitConfig {
  return {
    schema_version: 1,
    auth: { enabled: true, session_ttl_hours: 24 },
    appearance: { theme: "dark", custom_css: "" },
    layout: { columns: 4, row_height: 120 },
    services: [
      { name: "Jellyfin", url: "http://jellyfin.local", group: "Media" },
      { name: "Portainer", url: "http://portainer.local" },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

// Common reset/cleanup shared by every describe below; describes that need
// extra setup (fetch stubs, theme reset, fake timers) add their own
// beforeEach/afterEach on top of this one.
beforeEach(() => {
  resetNavigationMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SettingsPanel - tab switching", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ enabled: false, secret: "S", qrCode: "data:x" })));
  });

  it("shows the Appearance section by default", () => {
    render(<SettingsPanel config={makeConfig()} />);
    expect(screen.getByText("Appearance", { selector: "h2" })).toBeInTheDocument();
  });

  it("switches to the Layout section when the Layout tab is clicked", () => {
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    expect(screen.getByText("Layout", { selector: "h2" })).toBeInTheDocument();
    expect(screen.queryByText("Appearance", { selector: "h2" })).not.toBeInTheDocument();
  });

  it("switches to the Services section when the Services tab is clicked", () => {
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByText("Services", { selector: "h2" })).toBeInTheDocument();
  });
});

describe("SettingsPanel - appearance tab", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selecting a theme updates document.documentElement.dataset.theme", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "light" })).toHaveClass("theme-option--active");
  });

  it("updates the custom CSS textarea", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    const textarea = screen.getByPlaceholderText(".service-tile { border-radius: 0; }");
    fireEvent.change(textarea, { target: { value: ".foo { color: red; }" } });
    expect(textarea).toHaveValue(".foo { color: red; }");
  });

  it("saves appearance settings, shows Saved, then reverts to idle after 2s", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig()} />);

    fireEvent.click(screen.getByRole("button", { name: "light" }));
    fireEvent.change(screen.getByPlaceholderText(".service-tile { border-radius: 0; }"), {
      target: { value: ".x{}" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ appearance: { theme: "light", custom_css: ".x{}" } }),
      })
    );
    expect(screen.getByRole("button", { name: "Saved ✓" })).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

describe("SettingsPanel - layout tab", () => {
  it("shows desktop columns/row-height inputs with config values", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig({ layout: { columns: 6, row_height: 150 } })} />);
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    expect(screen.getByLabelText("Columns")).toHaveValue(6);
    expect(screen.getByLabelText("Row height (px)")).toHaveValue(150);
  });

  it("switches to the tablet viewport sub-tab and shows tablet inputs", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    expect(screen.getByLabelText("Columns")).toBeInTheDocument();
    expect(screen.getByLabelText("Row height (px)")).toBeInTheDocument();
  });

  it("switches to the mobile viewport sub-tab and shows mobile inputs", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByLabelText("Columns")).toBeInTheDocument();
    expect(screen.getByLabelText("Row height (px)")).toBeInTheDocument();
  });

  it("saves layout settings including parsed tablet overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Tablet" }));
    fireEvent.change(screen.getByLabelText("Columns"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Row height (px)"), { target: { value: "100" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          layout: {
            columns: 4,
            row_height: 120,
            tablet: { columns: 2, row_height: 100 },
            mobile: undefined,
          },
        }),
      })
    );
  });
});

describe("SettingsPanel - auth tab / TOTP", () => {
  it("shows the setup form when TOTP is not enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ enabled: false, secret: "SECRET123", qrCode: "data:image/png;base64,xx" }))
    );
    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });
    expect(screen.getByText("SECRET123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable 2FA" })).toBeInTheDocument();
  });

  it("shows the enabled state when TOTP is already enabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ enabled: true })));
    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });
    expect(screen.getByText(/2FA is/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disable 2FA" })).toBeInTheDocument();
  });

  it("enables 2FA after entering a 6-digit code", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ enabled: false, secret: "SECRET123", qrCode: "data:x" })
    );
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enable 2FA" }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/totp/setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ secret: "SECRET123", code: "123456" }),
      })
    );
    expect(screen.getByText("2FA enabled successfully.")).toBeInTheDocument();
    expect(screen.getByText(/2FA is/)).toBeInTheDocument();
  });

  it("disables 2FA after confirming with a code", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: false, secret: "S", qrCode: "d" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable 2FA" }));
    fireEvent.change(screen.getByLabelText("Authenticator code"), {
      target: { value: "654321" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm Disable" }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/totp/setup",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ code: "654321" }),
      })
    );
    expect(screen.getByText("2FA disabled.")).toBeInTheDocument();
  });
});

describe("SettingsPanel - auth tab / recovery code", () => {
  it("generates a new recovery code after confirming the current password", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: false, secret: "S", qrCode: "d" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd" }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate new recovery code" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "mypassword" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/recovery-code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "mypassword" }),
      })
    );
    expect(screen.getByText("aaaaaaaa-bbbbbbbb-cccccccc-dddddddd")).toBeInTheDocument();
  });

  it("shows an error message when the confirm password is wrong", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: false, secret: "S", qrCode: "d" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Invalid password" }, false));
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate new recovery code" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpassword" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    });

    expect(screen.getByText("Invalid password")).toBeInTheDocument();
  });

  it("disables Confirm and ignores extra clicks while a regeneration request is in flight", async () => {
    let resolveRequest!: (value: Response) => void;
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: false, secret: "S", qrCode: "d" }));
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRequest = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SettingsPanel config={makeConfig()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Generate new recovery code" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "mypassword" } });

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await Promise.resolve();

    const pendingButton = screen.getByRole("button", { name: "Generating…" });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);

    await act(async () => {
      resolveRequest(jsonResponse({ recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd" }));
      await Promise.resolve();
    });

    // Only one recovery-code request was ever sent, despite the extra click.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("aaaaaaaa-bbbbbbbb-cccccccc-dddddddd")).toBeInTheDocument();
  });
});

describe("SettingsPanel - services tab", () => {
  it("renders the services table with existing services", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByText("Jellyfin")).toBeInTheDocument();
    expect(screen.getByText("Portainer")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    // header row + 2 service rows
    expect(rows).toHaveLength(3);
  });

  it("opens the add-service form with no service and the right existing groups/taken names", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add Service" }));

    const props = JSON.parse(screen.getByTestId("service-form-stub-props").textContent!);
    expect(props.service).toBeNull();
    expect(props.existingGroups).toEqual(["Media"]);
    expect(props.takenNames).toEqual(["Jellyfin", "Portainer"]);
  });

  it("opens the edit-service form with the selected service and excludes it from takenNames", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    const row = screen.getByText("Jellyfin").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));

    const props = JSON.parse(screen.getByTestId("service-form-stub-props").textContent!);
    expect(props.service.name).toBe("Jellyfin");
    expect(props.takenNames).toEqual(["Portainer"]);
  });

  it("adds a new service to state and saves it via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add Service" }));

    await act(async () => {
      fireEvent.click(screen.getByText("StubSave"));
    });

    expect(screen.getByText("NewSvc")).toBeInTheDocument();
    expect(screen.queryByTestId("service-form-stub")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("NewSvc"),
      })
    );
  });

  it("deletes a service from state and saves via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    const row = screen.getByText("Jellyfin").closest("tr")!;

    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    });

    expect(screen.queryByText("Jellyfin")).not.toBeInTheDocument();
    expect(screen.getByText("Portainer")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PATCH" })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.services).toHaveLength(1);
    expect(body.services[0].name).toBe("Portainer");
  });

  it("closes the service form dialog when StubClose is triggered", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add Service" }));
    expect(screen.getByTestId("service-form-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByText("StubClose"));
    expect(screen.queryByTestId("service-form-stub")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no services", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig({ services: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByText("No services configured yet.")).toBeInTheDocument();
  });

  it("shows a Size column with the effective size of each service", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(
      <SettingsPanel
        config={makeConfig({
          services: [
            { name: "Jellyfin", url: "http://j.local", size: "wide" },
            { name: "Portainer", url: "http://p.local" },
          ],
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    const jelly = screen.getByText("Jellyfin").closest("tr")!;
    expect(within(jelly).getByText("Wide (2×1)")).toBeInTheDocument();
    const port = screen.getByText("Portainer").closest("tr")!;
    expect(within(port).getByText("Normal (1×1)")).toBeInTheDocument();
  });

  it("reorders a service down and saves the new array order via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Jellyfin down" }));
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.services.map((s: Service) => s.name)).toEqual(["Portainer", "Jellyfin"]);
  });

  it("disables the up arrow on the first row and the down arrow on the last row", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    render(<SettingsPanel config={makeConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    expect(screen.getByRole("button", { name: "Move Jellyfin up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Portainer down" })).toBeDisabled();
  });
});

describe("SettingsPanel - groups tab", () => {
  function groupsConfig() {
    return makeConfig({
      groups: [{ name: "Media" }, { name: "Infra" }],
      services: [
        { name: "Jellyfin", url: "http://j.local", group: "Media" },
        { name: "Loose", url: "http://l.local" },
        { name: "Undeclared", url: "http://u.local", group: "Downloads" },
      ],
      bookmarks: [
        {
          name: "Dev",
          placement: { group: "Media" },
          links: [{ name: "GH", url: "https://github.com" }],
        },
      ],
    });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
  });

  function gotoGroups() {
    render(<SettingsPanel config={groupsConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
  }

  it("lists declared groups and undeclared referenced groups", () => {
    gotoGroups();
    expect(screen.getByLabelText("Group name for Media")).toHaveValue("Media");
    expect(screen.getByLabelText("Group name for Infra")).toHaveValue("Infra");
    // "Downloads" is referenced by a service but not declared.
    expect(screen.getByText("Downloads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Declare" })).toBeInTheDocument();
  });

  it("reorders declared groups and saves the new order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    fireEvent.click(screen.getByRole("button", { name: "Move Media down" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual(["Infra", "Media"]);
  });

  it("declaring an undeclared group adds it and saves it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    fireEvent.click(screen.getByRole("button", { name: "Declare" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual([
      "Media",
      "Infra",
      "Downloads",
    ]);
    // A pure declare doesn't touch services/bookmarks.
    expect(body.services).toBeUndefined();
    expect(body.bookmarks).toBeUndefined();
  });

  it("renaming a group cascades into services and bookmark placements in one save", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    const input = screen.getByLabelText("Group name for Media");
    fireEvent.change(input, { target: { value: "Movies" } });
    fireEvent.blur(input);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groups[0].name).toBe("Movies");
    const jelly = body.services.find((s: Service) => s.name === "Jellyfin");
    expect(jelly.group).toBe("Movies");
    expect(body.bookmarks[0].placement.group).toBe("Movies");
  });

  it("deleting a group clears members' group and bookmark placement references", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    const mediaRow = screen.getByLabelText("Group name for Media").closest<HTMLElement>(".groups-row")!;
    fireEvent.click(within(mediaRow).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(mediaRow).getByRole("button", { name: "Confirm" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual(["Infra"]);
    const jelly = body.services.find((s: Service) => s.name === "Jellyfin");
    expect(jelly.group).toBeUndefined();
    expect(body.bookmarks[0].placement).toBeUndefined();
  });

  it("saves the ungrouped position via layout.ungrouped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    fireEvent.change(screen.getByLabelText("Ungrouped position"), {
      target: { value: "first" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.layout.ungrouped).toBe("first");
  });

  it("persists a per-group collapsed default and column override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    gotoGroups();
    const mediaRow = screen.getByLabelText("Group name for Media").closest<HTMLElement>(".groups-row")!;
    fireEvent.click(within(mediaRow).getByLabelText("Collapsed by default"));
    fireEvent.change(within(mediaRow).getByLabelText("Columns for Media"), {
      target: { value: "3" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.groups[0]).toEqual({ name: "Media", collapsed: true, columns: 3 });
  });
});

describe("SettingsPanel - bookmarks tab", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    HTMLDialogElement.prototype.showModal = vi.fn().mockImplementation(function (
      this: HTMLDialogElement
    ) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn().mockImplementation(function (
      this: HTMLDialogElement
    ) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    });
  });

  function bookmarksConfig() {
    return makeConfig({
      bookmarks: [
        { name: "Dev", links: [{ name: "GH", url: "https://github.com" }] },
        { name: "Ops", links: [{ name: "Grafana", url: "https://grafana.com" }] },
      ],
    });
  }

  it("lists bookmark groups with style and link count", () => {
    render(<SettingsPanel config={bookmarksConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    const devRow = screen.getByText("Dev").closest<HTMLElement>(".groups-row")!;
    expect(within(devRow).getByText(/list · 1 link/)).toBeInTheDocument();
  });

  it("reorders bookmark groups and saves the new order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={bookmarksConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Dev down" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.bookmarks.map((b: { name: string }) => b.name)).toEqual(["Ops", "Dev"]);
  });

  it("adds a new bookmark group through the dialog and saves it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={makeConfig({ bookmarks: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add bookmark group" }));

    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "GitHub" } });
    fireEvent.change(screen.getByLabelText("Link 1 URL"), {
      target: { value: "https://github.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.bookmarks).toHaveLength(1);
    expect(body.bookmarks[0].name).toBe("Dev");
    expect(body.bookmarks[0].links[0]).toEqual({
      name: "GitHub",
      url: "https://github.com",
    });
  });

  it("deletes a bookmark group after confirming and saves via PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsPanel config={bookmarksConfig()} />);
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    const devRow = screen.getByText("Dev").closest<HTMLElement>(".groups-row")!;
    fireEvent.click(within(devRow).getByRole("button", { name: "Delete" }));
    await act(async () => {
      fireEvent.click(within(devRow).getByRole("button", { name: "Confirm" }));
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.bookmarks.map((b: { name: string }) => b.name)).toEqual(["Ops"]);
  });
});
