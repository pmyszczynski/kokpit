import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ServiceForm from "@/components/ServiceForm";
import "@/integrations";
import { getWidgetsWithServiceEditorPreset } from "@/widgets";

// Every selectable tile type, with what its schema says about an empty
// config. Derived from the registry so new integrations are covered
// automatically.
const allPresetTiles = getWidgetsWithServiceEditorPreset().map((w) => ({
  id: w.id,
  emptyConfigValid: w.configSchema.safeParse({}).success,
}));

beforeEach(() => {
  // jsdom does not implement dialog methods; close() must dispatch the
  // native "close" event so that <dialog onClose={...}> fires correctly.
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn().mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.dispatchEvent(new Event("close"));
  });
});

const noop = vi.fn();

describe("ServiceForm – rendering", () => {
  it('shows "Add Service" for a new service', () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.getByText("Add Service")).toBeInTheDocument();
  });

  it('shows "Edit Service" when editing an existing service', () => {
    render(
      <ServiceForm
        service={{ name: "Jellyfin" }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByText("Edit Service")).toBeInTheDocument();
  });

  it("pre-fills all fields from the existing service", () => {
    render(
      <ServiceForm
        service={{
          name: "Jellyfin",
          url: "http://jellyfin.local",
          description: "Media server",
          group: "Media",
        }}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Name *")).toHaveValue("Jellyfin");
    expect(screen.getByLabelText("URL")).toHaveValue("http://jellyfin.local");
    expect(screen.getByLabelText("Description")).toHaveValue("Media server");
    expect(screen.getByLabelText("Group")).toHaveValue("Media");
  });
});

describe("ServiceForm – submission", () => {
  it("blocks save when the name matches an existing service (case-insensitive)", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={null}
        existingGroups={[]}
        takenNames={["Plex"]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "plex" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("calls onSave with the entered name", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Sonarr" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Sonarr" }));
  });

  it("omits blank optional fields from the saved payload", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Radarr" },
    });
    fireEvent.click(screen.getByText("Save"));
    const saved = onSave.mock.calls[0][0];
    expect(saved.url).toBeUndefined();
    expect(saved.description).toBeUndefined();
    expect(saved.group).toBeUndefined();
    expect(saved.widget).toBeUndefined();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the ✕ button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={onClose} />
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("ServiceForm – icon detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables the Detect icon button until the URL field has a valid URL", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.getByText("Detect icon")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "not-a-url" },
    });
    expect(screen.getByText("Detect icon")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://jellyfin.local" },
    });
    expect(screen.getByText("Detect icon")).toBeEnabled();
  });

  it("fills the Icon URL field when detection finds an icon", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ icon: "http://jellyfin.local/icon.png", source: "page" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://jellyfin.local" },
    });
    fireEvent.click(screen.getByText("Detect icon"));

    await waitFor(() =>
      expect(screen.getByLabelText("Icon URL")).toHaveValue(
        "http://jellyfin.local/icon.png"
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/icon/detect?url=" + encodeURIComponent("http://jellyfin.local")
    );
  });

  it("shows a hint when no icon is found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ icon: null, source: null }),
      } as Response)
    );

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://jellyfin.local" },
    });
    fireEvent.click(screen.getByText("Detect icon"));

    await waitFor(() =>
      expect(screen.getByText(/no icon found/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText("Icon URL")).toHaveValue("");
  });

  it("shows an error message when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://jellyfin.local" },
    });
    fireEvent.click(screen.getByText("Detect icon"));

    await waitFor(() =>
      expect(screen.getByText("network down")).toBeInTheDocument()
    );
  });
});

describe("ServiceForm – tile type", () => {
  it("does not show the Widget section when Generic is selected", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.getByLabelText("Tile type")).toHaveValue("");
    expect(screen.queryByText("Widget")).not.toBeInTheDocument();
  });

  it("selecting an integration tile type pre-fills name and icon and saves widget.type", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    expect(screen.getByLabelText("Name *")).toHaveValue("Plex");
    expect(screen.getByLabelText("Icon URL")).toHaveValue(
      "https://cdn.simpleicons.org/plex/e5a00d"
    );
    expect(screen.getByText("Widget")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Server URL/), {
      target: { value: "http://192.168.1.10:32400" },
    });
    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "mytoken" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Plex",
        icon: "https://cdn.simpleicons.org/plex/e5a00d",
        widget: expect.objectContaining({
          type: "plex",
          config: expect.objectContaining({
            url: "http://192.168.1.10:32400",
            token: "mytoken",
          }),
        }),
      })
    );
  });

  it("infers tile type from service.widget.type when editing a preset integration", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: {
              url: "http://plex.local:32400",
              token: "x",
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Tile type")).toHaveValue("plex");
    expect(screen.getByLabelText("Name *")).toHaveValue("My Plex");
    expect(screen.getByLabelText(/Server URL/)).toHaveValue("http://plex.local:32400");
  });

  it("preserves an unknown widget type from YAML on save", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Legacy",
          widget: {
            type: "future-widget",
            config: { api_key: "secret" },
            refresh_interval_ms: 12_000,
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );
    expect(screen.getByText(/future-widget/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tile type")).toHaveValue("");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Legacy",
        widget: {
          type: "future-widget",
          config: { api_key: "secret" },
          refresh_interval_ms: 12_000,
        },
      })
    );
  });
});

describe("ServiceForm – optional widget config", () => {
  it.each(allPresetTiles)(
    "$id: saves widget with type only when the config fields are left empty",
    ({ id }) => {
      const onSave = vi.fn();
      render(
        <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
      );
      fireEvent.change(screen.getByLabelText("Tile type"), {
        target: { value: id },
      });
      fireEvent.click(screen.getByText("Save"));
      expect(onSave).toHaveBeenCalledTimes(1);
      const saved = onSave.mock.calls[0][0];
      expect(saved.widget.type).toBe(id);
      expect(saved.widget.config).toBeUndefined();
    }
  );

  it.each(allPresetTiles)(
    "$id: status line and test button reflect the empty-config state",
    ({ id, emptyConfigValid }) => {
      render(
        <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
      );
      fireEvent.change(screen.getByLabelText("Tile type"), {
        target: { value: id },
      });
      if (emptyConfigValid) {
        expect(screen.getByText(/widget configured/i)).toBeInTheDocument();
        expect(screen.getByText("Test connection")).toBeEnabled();
      } else {
        expect(screen.getByText(/widget not configured/i)).toBeInTheDocument();
        expect(screen.getByText("Test connection")).toBeDisabled();
      }
    }
  );

  it("treats config fields that were filled and cleared as unconfigured", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    const urlInput = screen.getByLabelText(/Server URL/);
    fireEvent.change(urlInput, { target: { value: "http://plex.local:32400" } });
    fireEvent.change(urlInput, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    const saved = onSave.mock.calls[0][0];
    expect(saved.widget.type).toBe("plex");
    expect(saved.widget.config).toBeUndefined();
  });

  it("shows the not-configured status until required fields are filled", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    expect(screen.getByText(/widget not configured/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Server URL/), {
      target: { value: "http://plex.local:32400" },
    });
    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "t" },
    });
    expect(screen.getByText(/widget configured/i)).toBeInTheDocument();
    expect(screen.queryByText(/widget not configured/i)).not.toBeInTheDocument();
  });
});

describe("ServiceForm – test connection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupPlexForm() {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
  }

  function fillPlexConfig() {
    fireEvent.change(screen.getByLabelText(/Server URL/), {
      target: { value: "http://plex.local:32400" },
    });
    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "secret" },
    });
  }

  it("is disabled while the config does not validate", () => {
    setupPlexForm();
    expect(screen.getByText("Test connection")).toBeDisabled();
    fillPlexConfig();
    expect(screen.getByText("Test connection")).toBeEnabled();
  });

  it("posts the current type and config and shows success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    setupPlexForm();
    fillPlexConfig();
    fireEvent.click(screen.getByText("Test connection"));

    await waitFor(() =>
      expect(screen.getByText("Connection OK")).toBeInTheDocument()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/widget/test",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      type: "plex",
      config: { url: "http://plex.local:32400", token: "secret" },
    });
  });

  it("shows the server error message when the test fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "Plex responded with 503" }),
      } as Response)
    );

    setupPlexForm();
    fillPlexConfig();
    fireEvent.click(screen.getByText("Test connection"));

    await waitFor(() =>
      expect(screen.getByText("Plex responded with 503")).toBeInTheDocument()
    );
  });

  it("resets the test result when a config field changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response)
    );

    setupPlexForm();
    fillPlexConfig();
    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() =>
      expect(screen.getByText("Connection OK")).toBeInTheDocument()
    );

    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "different" },
    });
    expect(screen.queryByText("Connection OK")).not.toBeInTheDocument();
  });
});

describe("GroupCombobox", () => {
  it("shows all existing groups when the input is focused while empty", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network", "Storage"]}
        onSave={noop}
        onClose={noop}
      />
    );
    fireEvent.focus(screen.getByLabelText("Group"));
    expect(screen.getByText("Media")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });

  it("filters suggestions as the user types", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network", "Storage"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "net" } });
    expect(screen.getByText("Network")).toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Media")).not.toBeInTheDocument();
  });

  it('shows a "Create" option when the typed value is not an existing group', () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Downloads" } });
    expect(screen.getByText(/Create/i)).toBeInTheDocument();
  });

  it('does not show "Create" when value matches an existing group (case-insensitive)', () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "media" } });
    expect(screen.queryByText(/Create/i)).not.toBeInTheDocument();
  });

  it("selecting a suggestion sets the input value and closes the dropdown", () => {
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network"]}
        onSave={noop}
        onClose={noop}
      />
    );
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Network"));
    expect(input).toHaveValue("Network");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("dropdown is hidden when there are no groups and input is empty", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selected group is included in the onSave payload", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={null}
        existingGroups={["Media", "Network"]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Plex" },
    });
    const input = screen.getByLabelText("Group");
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByText("Media"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Plex", group: "Media" })
    );
  });
});
