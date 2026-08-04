import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ServiceForm from "@/components/ServiceForm";
import "@/integrations";
import { getWidget, getWidgetsWithServiceEditorPreset } from "@/widgets";
import { persistLegacyServices } from "@/components/edit/serviceFormProjection";
import {
  WIDGET_CONFIG_REFERENCE_PREFIX,
  WIDGET_SECRET_REFERENCE_KEY,
  WIDGET_SECRET_REFERENCE_PREFIX,
} from "@/widgets/secretReference";

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
const SAVED_TAUTULLI_SECRET_TOKEN =
  `${WIDGET_SECRET_REFERENCE_PREFIX}["Tautulli","tautulli-activity","api_key"]`;
const SAVED_TAUTULLI_SECRET = {
  [WIDGET_SECRET_REFERENCE_KEY]: SAVED_TAUTULLI_SECRET_TOKEN,
};

describe("ServiceForm – rendering", () => {
  it("edits a Service integration independently from a plain tile", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          tileId: "20000000-0000-4000-8000-000000000001",
          integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    expect(screen.getByLabelText("Tile type")).toHaveValue("");
    expect(screen.getByLabelText("Integration")).toHaveValue("sonarr");
    expect(screen.getByLabelText("URL *")).toHaveValue("http://sonarr");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      widget: undefined,
      editorIntegration: { command: "preserve" },
    }));
  });

  it("persists a new credentialed tile with connection and tile config separated", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );

    fireEvent.change(screen.getByLabelText("Tile type"), { target: { value: "plex" } });
    fireEvent.change(screen.getByLabelText("Server URL *"), {
      target: { value: "http://plex.local:32400" },
    });
    fireEvent.change(screen.getByLabelText("Token *"), {
      target: { value: "token" },
    });
    fireEvent.click(screen.getByText("Save"));

    const input = onSave.mock.calls[0][0];
    expect(input.editorIntegration).toEqual({
      command: "set",
      type: "plex",
      config: { url: "http://plex.local:32400", token: "token" },
    });
    expect(input.widget).toEqual({
      type: "plex",
      config: undefined,
      refresh_interval_ms: undefined,
    });

    const persisted = persistLegacyServices([input], [], []);
    expect(persisted.services[0].integration).toEqual({
      type: "plex",
      config: { url: "http://plex.local:32400", token: "token" },
    });
    expect(persisted.service_tiles[0].widget?.config).toBeUndefined();
  });

  it("adds an integration to an existing plain v2 tile without adding a widget", () => {
    const onSave = vi.fn();
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const tileId = "20000000-0000-4000-8000-000000000001";
    render(
      <ServiceForm
        service={{ id: serviceId, tileId, name: "Sonarr" }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Integration"), {
      target: { value: "sonarr" },
    });
    fireEvent.change(screen.getByLabelText("URL *"), {
      target: { value: "http://sonarr.local" },
    });
    fireEvent.change(screen.getByLabelText("API Key *"), {
      target: { value: "key" },
    });
    fireEvent.click(screen.getByText("Save"));

    const input = onSave.mock.calls[0][0];
    const persisted = persistLegacyServices(
      [input],
      [{ id: serviceId, name: "Sonarr" }],
      [{ id: tileId, service_id: serviceId }]
    );
    expect(persisted.services[0].integration).toEqual({
      type: "sonarr",
      config: { url: "http://sonarr.local", api_key: "key" },
    });
    expect(persisted.service_tiles[0].widget).toBeUndefined();
  });

  it("blocks integration changes that conflict with the current tile", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } },
          widget: { type: "sonarr-calendar" },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Integration"), { target: { value: "" } });
    expect(screen.getByText(/tiles that require a different integration/i)).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeDisabled();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Integration"), { target: { value: "plex" } });
    expect(screen.getByText("Save")).toBeDisabled();
  });

  it("requires a replacement saved credential when a plain tile connection changes", () => {
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          integration: {
            type: "sonarr",
            config: { url: "http://sonarr.local", api_key: SAVED_TAUTULLI_SECRET },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("URL *"), {
      target: { value: "http://other-sonarr.local" },
    });
    expect(screen.getByText(/saved for a different connection/i)).toBeInTheDocument();
    expect(screen.getByLabelText("API Key *")).toBeRequired();
    expect(screen.getByText("Test connection")).toBeDisabled();
    expect(screen.getByText("Save")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("URL *"), {
      target: { value: "http://sonarr.local" },
    });
    expect(screen.queryByText(/saved for a different connection/i)).not.toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeEnabled();
    expect(screen.getByText("Save")).toBeEnabled();
  });

  it("blocks a tile from changing a shared Service to a different integration", () => {
    render(
      <ServiceForm
        service={{
          name: "Sonarr",
          widget: {
            type: "sonarr-calendar",
            config: { url: "http://sonarr.local", api_key: "secret", days: 7 },
          },
        }}
        existingGroups={[]}
        siblingIntegrationTypes={["sonarr"]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.getByText("Save")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });

    expect(screen.getByText(/This Service still has tiles/)).toHaveTextContent(/different integration/i);
    expect(screen.getByText("Save")).toBeDisabled();
  });

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

  it("renders a preview thumbnail for an http(s) or root-relative icon URL", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "https://example.com/icon.png" },
    });
    expect(container.querySelector(".service-form__icon-preview")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "/icons/local.png" },
    });
    expect(container.querySelector(".service-form__icon-preview")).toBeInTheDocument();
  });

  it("does not render a preview thumbnail for a non-http(s) URL scheme", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(container.querySelector(".service-form__icon-preview")).not.toBeInTheDocument();
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
      ok: true,
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
      "/api/icon/detect",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ url: "http://jellyfin.local", name: "" });
  });

  it("sends the service name alongside the URL for name-based fallback matching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ icon: null, source: null }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Arcane" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://towarcloud.worm-marlin.ts.net:3552" },
    });
    fireEvent.click(screen.getByText("Detect icon"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      url: "http://towarcloud.worm-marlin.ts.net:3552",
      name: "Arcane",
    });
  });

  it("shows a hint when no icon is found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
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

  it("shows an error message when the response is not ok (e.g. 401)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Unauthorized" }),
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
      expect(screen.getByText(/icon detection failed/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText("Icon URL")).toHaveValue("");
  });

  it("ignores a stale detect response once the user has since edited the icon manually", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
      )
    );

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://jellyfin.local" },
    });

    // Detect request starts and is left pending (button disables while it's in flight).
    fireEvent.click(screen.getByText("Detect icon"));

    // The user manually edits the icon field before the request resolves.
    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "http://manually-typed.example/icon.png" },
    });

    // The pending (now stale) request resolves with a different icon — it
    // must not clobber what the user has since typed.
    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ icon: "http://jellyfin.local/detected.png", source: "page" }),
    } as Response);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByLabelText("Icon URL")).toHaveValue(
      "http://manually-typed.example/icon.png"
    );
  });

  it("ignores a stale detect response once the user has since edited the name", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
      )
    );

    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Arcane" },
    });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "http://towarcloud.worm-marlin.ts.net:3552" },
    });

    // Detect request starts (matching "Arcane") and is left pending.
    fireEvent.click(screen.getByText("Detect icon"));

    // The user edits the name before the request resolves — a response
    // matched against the old name must not land.
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Something Else" },
    });

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ icon: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/arcane.svg", source: "dashboard-icons" }),
    } as Response);

    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByLabelText("Icon URL")).toHaveValue("");
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
        editorIntegration: {
          command: "set",
          type: "plex",
          config: expect.objectContaining({
            url: "http://192.168.1.10:32400",
            token: "mytoken",
          }),
        },
        widget: expect.objectContaining({ type: "plex" }),
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

  it("keeps the friendly not-configured hint (no error list) while the config is entirely empty", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    expect(
      screen.getByText(
        "Widget not configured — the tile will render as a plain link until the required fields are filled."
      )
    ).toBeInTheDocument();
    // No per-field Zod error list yet — that would be a wall of red text on
    // a freshly-selected widget type nobody has touched.
    expect(container.querySelector(".service-form__widget-issues")).not.toBeInTheDocument();
  });

  it("lists the specific Zod issues once the user has entered something but the config is still invalid", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    // Fill only the URL — Token is still required, so the config remains
    // invalid, but it's no longer empty.
    fireEvent.change(screen.getByLabelText(/Server URL/), {
      target: { value: "http://plex.local:32400" },
    });

    expect(screen.queryByText(/widget not configured/i)).not.toBeInTheDocument();
    const issues = Array.from(
      container.querySelectorAll(".service-form__widget-issues li")
    ).map((el) => el.textContent);
    expect(issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^token: /)])
    );
  });

  it("still shows the positive line once a valid config is entered", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    fireEvent.change(screen.getByLabelText(/Server URL/), {
      target: { value: "http://plex.local:32400" },
    });
    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "secret" },
    });
    expect(
      screen.getByText("Widget configured — it will render on the dashboard tile.")
    ).toBeInTheDocument();
    expect(container.querySelector(".service-form__widget-issues")).not.toBeInTheDocument();
  });
});

describe("ServiceForm – boolean widget config fields", () => {
  // actualbudget-accounts is the widest boolean case in the registry: one
  // default-true option (privacy_mode), another default-true filter
  // (exclude_closed) and a default-false one (exclude_offbudget).
  function setupAccountsForm(onSave = noop) {
    const result = render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "actualbudget-accounts" },
    });
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Budget" },
    });
    return result;
  }

  it("renders a labelled checkbox for a boolean field", () => {
    setupAccountsForm();
    const checkbox = screen.getByLabelText("Blur amounts until hover");
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("type", "checkbox");
  });

  it("wires the field description up as the checkbox's description", () => {
    setupAccountsForm();
    const checkbox = screen.getByLabelText("Hide closed accounts");
    const hintId = checkbox.getAttribute("aria-describedby");
    expect(hintId).toBe("sf-widget-exclude_closed-hint");
    expect(document.getElementById(hintId!)).toHaveTextContent(
      "Leaves closed accounts out of the list and out of the net worth total."
    );
  });

  it("renders an absent key using the field's defaultValue, not unchecked", () => {
    setupAccountsForm();
    // Nothing has been configured, so none of these keys exist in the config —
    // the boxes must still mirror what the schema defaults actually do.
    expect(screen.getByLabelText("Blur amounts until hover")).toBeChecked();
    expect(screen.getByLabelText("Hide closed accounts")).toBeChecked();
    expect(screen.getByLabelText("Hide off-budget accounts")).not.toBeChecked();
  });

  it("renders a saved value in preference to the defaultValue", () => {
    render(
      <ServiceForm
        service={{
          name: "Budget",
          widget: {
            type: "actualbudget-accounts",
            config: {
              url: "http://actual-http-api:5007",
              api_key: "key",
              budget_sync_id: "sync-id",
              privacy_mode: false,
              exclude_offbudget: true,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Blur amounts until hover")).not.toBeChecked();
    expect(screen.getByLabelText("Hide off-budget accounts")).toBeChecked();
    // Still absent from the saved config → still falls back to its default.
    expect(screen.getByLabelText("Hide closed accounts")).toBeChecked();
  });

  it("writes a real boolean, not the string \"true\"", () => {
    const onSave = vi.fn();
    setupAccountsForm(onSave);
    // exclude_offbudget defaults to false, so one click writes `true`.
    fireEvent.click(screen.getByLabelText("Hide off-budget accounts"));
    fireEvent.click(screen.getByText("Save"));

    const saved = onSave.mock.calls[0][0];
    expect(typeof saved.widget.config.exclude_offbudget).toBe("boolean");
    expect(saved.widget.config.exclude_offbudget).toBe(true);
  });

  it("keeps `false` through a save round-trip when a default-true option is unchecked", () => {
    // The highest-risk failure in the boolean field: cleanWidgetConfig drops
    // "unconfigured" values, and if it dropped `false` too, unchecking a
    // default-true option would silently revert to `true` on save.
    const onSave = vi.fn();
    setupAccountsForm(onSave);
    expect(screen.getByLabelText("Blur amounts until hover")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Blur amounts until hover"));
    expect(screen.getByLabelText("Blur amounts until hover")).not.toBeChecked();
    fireEvent.click(screen.getByText("Save"));

    const saved = onSave.mock.calls[0][0];
    expect(saved.editorIntegration.config).toBeDefined();
    expect(saved.editorIntegration.config).not.toHaveProperty("privacy_mode");
    expect(typeof saved.widget.config.privacy_mode).toBe("boolean");
    expect(saved.widget.config.privacy_mode).toBe(false);
  });

  it("a lone `false` is enough to count as a configured widget", () => {
    // Same guard from the other side: `{privacy_mode: false}` must not clean
    // down to `{}`, which would drop the whole config on save.
    const onSave = vi.fn();
    setupAccountsForm(onSave);
    fireEvent.click(screen.getByLabelText("Hide closed accounts"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].widget.config).toEqual({
      exclude_closed: false,
    });
  });

  it("round-trips a saved `false` back out unchanged when nothing is touched", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Budget",
          widget: {
            type: "actualbudget-accounts",
            config: {
              url: "http://actual-http-api:5007",
              api_key: "key",
              budget_sync_id: "sync-id",
              privacy_mode: false,
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].widget.config).toMatchObject({
      privacy_mode: false,
    });
  });

  it("leaves the other field types rendering exactly as before", () => {
    setupAccountsForm();
    // text / url / password fields on the same widget still render as inputs
    // with the shared class, not as checkboxes.
    const urlInput = screen.getByLabelText("URL *");
    expect(urlInput).toHaveAttribute("type", "text");
    expect(urlInput).toHaveClass("settings-input");
    const apiKey = screen.getByLabelText("API Key *");
    expect(apiKey).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Budget Sync ID *")).toHaveAttribute("type", "text");
  });

  it("leaves number and multiselect fields rendering unchanged", () => {
    const { container } = render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "actualbudget-schedules" },
    });
    expect(screen.getByLabelText("Schedule limit")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Days ahead")).toHaveAttribute("type", "number");

    // Plex's `fields` multiselect still renders as its own labelled group of
    // option checkboxes, not as a row of standalone boolean fields.
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "plex" },
    });
    const group = container.querySelector(".widget-multiselect");
    expect(group).toBeInTheDocument();
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAttribute("aria-labelledby", "sf-widget-fields-label");
    expect(
      container.querySelectorAll(".widget-multiselect__option input[type='checkbox']")
    ).toHaveLength(10);
    expect(container.querySelector(".widget-checkbox")).not.toBeInTheDocument();
  });
});

describe("ServiceForm – saved config vs. live edits", () => {
  // Regression test for the "broken widget feedback" bug: the tile validates
  // the RAW saved config (fields: [] fails Plex's `.min(1)`, hence the
  // warning badge), but the dialog used to validate the config AFTER
  // cleanWidgetConfig() strips the empty array — at which point the schema's
  // `.default([...])` kicks in and the config passes. The dialog then told
  // the user everything was fine, contradicting the badge that sent them
  // there. token is deliberately left valid so only `fields` trips the raw
  // schema; that isolates the stripping-reveals-a-default case from a
  // genuinely-broken field, which stripping would not fix.
  it("shows the saved-config issue (not the positive line) for a saved config that only validates after cleaning strips a field down to its default", () => {
    const { container } = render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: {
              url: "http://plex.local:32400",
              token: "secret",
              fields: [],
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(
      screen.queryByText("Widget configured — it will render on the dashboard tile.")
    ).not.toBeInTheDocument();
    const issues = Array.from(
      container.querySelectorAll(".service-form__widget-issues li")
    ).map((el) => el.textContent);
    expect(issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^fields: /)])
    );
    // The saved config fails validation, but the LIVE cleaned config (what
    // Test Connection actually sends) is valid — url and token are fine, and
    // stripping the empty `fields` array lets the schema default apply. The
    // saved-config warning must not block that legitimately-working action.
    expect(screen.getByText("Test connection")).toBeEnabled();
    // Cleaning genuinely does repair this config, so the normalize hint is
    // accurate here.
    expect(
      screen.getByText(/Saving from here will normalize it/)
    ).toBeInTheDocument();
  });

  it("omits the normalize hint when saving would not actually repair the config", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          // `token` is required and has no schema default, so stripping empty
          // values on save fixes nothing — promising normalization would lie.
          widget: {
            type: "plex",
            config: { url: "http://plex.local:32400" },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.getByText(/token: /)).toBeInTheDocument();
    expect(
      screen.queryByText(/Saving from here will normalize it/)
    ).not.toBeInTheDocument();
  });

  it("hands the display over to live validation once the user edits the widget config", () => {
    const { container } = render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: {
              url: "http://plex.local:32400",
              token: "secret",
              fields: [],
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(container.querySelector(".service-form__widget-issues")).toBeInTheDocument();

    // Touch the widget config (token still ends up non-empty) — the saved
    // config's issue list should no longer be authoritative.
    fireEvent.change(screen.getByLabelText(/^Token/), {
      target: { value: "secret2" },
    });

    // Live validation takes over: url + token are filled and the still-empty
    // `fields` array cleans down to its default, so the config is valid.
    expect(
      screen.getByText("Widget configured — it will render on the dashboard tile.")
    ).toBeInTheDocument();
    expect(container.querySelector(".service-form__widget-issues")).not.toBeInTheDocument();
  });

  it("shows the positive line (no false alarm) for a saved config that is already valid", () => {
    const { container } = render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: {
              url: "http://plex.local:32400",
              token: "secret",
              fields: ["streams"],
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(
      screen.getByText("Widget configured — it will render on the dashboard tile.")
    ).toBeInTheDocument();
    expect(container.querySelector(".service-form__widget-issues")).not.toBeInTheDocument();
  });
});

describe("ServiceForm – focusWidget", () => {
  it("hides the integration selector for a legacy direct-config service", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: { url: "http://plex.local:32400", token: "secret" },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.queryByLabelText("Integration")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Server URL *")).toHaveValue("http://plex.local:32400");
  });

  it("focuses the first invalid widget config field on mount", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: { type: "plex", config: { url: "http://plex.local:32400" } },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
        focusWidget
      />
    );
    expect(screen.getByLabelText(/^Token/)).toHaveFocus();
  });

  it("shows the specific issues immediately (even with an empty config) when opened from the badge", () => {
    const { container } = render(
      <ServiceForm
        service={{ name: "My Plex", widget: { type: "plex" } }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
        focusWidget
      />
    );
    expect(container.querySelector(".service-form__widget-issues")).toBeInTheDocument();
    expect(screen.queryByText(/widget not configured/i)).not.toBeInTheDocument();
  });

  it("falls back to focusing the tile-type selector when nothing is specifically invalid", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: {
            type: "plex",
            config: { url: "http://plex.local:32400", token: "secret" },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
        focusWidget
      />
    );
    expect(screen.getByLabelText("Tile type")).toHaveFocus();
  });

  it("does not move focus when focusWidget is not set", () => {
    render(
      <ServiceForm
        service={{
          name: "My Plex",
          widget: { type: "plex", config: { url: "http://plex.local:32400" } },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText(/^Token/)).not.toHaveFocus();
  });
});

describe("ServiceForm – Tautulli defaults", () => {
  function selectTautulli(onSave = vi.fn()) {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    fireEvent.change(screen.getByLabelText("Tile type"), {
      target: { value: "tautulli-activity" },
    });
    return onSave;
  }

  function fillTautulliConfig() {
    fireEvent.change(screen.getByLabelText(/^URL \*$/), {
      target: { value: "http://tautulli.local:8181" },
    });
    fireEvent.change(screen.getByLabelText(/^API Key \*$/), {
      target: { value: "secret" },
    });
  }

  it("pre-fills defaults and preserves the final required display section", () => {
    const onSave = selectTautulli();

    expect(screen.getByLabelText("Name *")).toHaveValue("Tautulli");
    expect(screen.getByLabelText("Icon URL")).toHaveValue(
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/tautulli.svg"
    );
    expect(screen.getByLabelText("Summary")).toBeChecked();
    expect(screen.getByLabelText("Active sessions")).toBeChecked();
    fillTautulliConfig();
    fireEvent.click(screen.getByLabelText("Summary"));
    expect(screen.getByLabelText("Summary")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Active sessions"));
    expect(screen.getByLabelText("Active sessions")).toBeChecked();
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      editorIntegration: {
        command: "set",
        type: "tautulli",
        config: {
          url: "http://tautulli.local:8181",
          api_key: "secret",
        },
      },
      widget: {
        type: "tautulli-activity",
        config: {
          sections: ["sessions"],
        },
        refresh_interval_ms: undefined,
      },
    }));
  });

  it("keeps untouched display defaults out of saved config and lets the schema apply them", () => {
    const onSave = selectTautulli();
    fillTautulliConfig();
    fireEvent.click(screen.getByText("Save"));

    const saved = onSave.mock.calls[0][0];
    expect(saved.widget).toEqual({
      type: "tautulli-activity",
      config: undefined,
      refresh_interval_ms: undefined,
    });
    expect(saved.editorIntegration).toEqual({
      command: "set",
      type: "tautulli",
      config: {
        url: "http://tautulli.local:8181",
        api_key: "secret",
      },
    });
    const parsed = getWidget("tautulli-activity")!.configSchema.safeParse(
      { ...saved.editorIntegration.config, ...saved.widget!.config }
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw parsed.error;
    expect(parsed.data.sections).toEqual(["summary", "sessions"]);
  });

  it("keeps a saved secret out of the password input and preserves its token when unchanged", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
              sections: ["summary"],
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    expect(screen.getByLabelText(/^API Key \*$/)).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(SAVED_TAUTULLI_SECRET_TOKEN);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        widget: expect.objectContaining({
          config: expect.objectContaining({
            api_key: SAVED_TAUTULLI_SECRET,
          }),
        }),
      })
    );
  });

  it("replaces a saved secret when a new password is entered", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText(/^API Key \*$/), {
      target: { value: "new-tautulli-secret" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        widget: expect.objectContaining({
          config: expect.objectContaining({
            api_key: "new-tautulli-secret",
          }),
        }),
      })
    );
  });

  it("requires re-entering a saved credential after its destination changes, then accepts a replacement", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText(/^URL \*$/), {
      target: { value: "http://other-tautulli.local:8181" },
    });
    const apiKey = screen.getByLabelText(/^API Key \*$/);
    expect(apiKey).toBeRequired();
    expect(screen.getByText(/re-enter.*credential/i)).toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeDisabled();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(apiKey, { target: { value: "replacement" } });
    expect(screen.getByText("Test connection")).toBeEnabled();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        widget: expect.objectContaining({
          config: expect.objectContaining({ api_key: "replacement" }),
        }),
      })
    );
  });

  it("restores a saved credential reference when a replacement is erased", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    const apiKey = screen.getByLabelText(/^API Key \*$/);
    fireEvent.change(apiKey, { target: { value: "replacement" } });
    fireEvent.change(apiKey, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        widget: expect.objectContaining({
          config: expect.objectContaining({ api_key: SAVED_TAUTULLI_SECRET }),
        }),
      })
    );
  });

  it("announces a stale saved credential to assistive technology", () => {
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText(/^URL \*$/), {
      target: { value: "http://other-tautulli.local:8181" },
    });

    const apiKey = screen.getByLabelText(/^API Key \*$/);
    const alert = screen.getByText(/saved for a different connection/i);
    expect(apiKey).toHaveAttribute("aria-invalid", "true");
    expect(apiKey).toHaveAttribute("aria-describedby", alert.id);
    expect(alert).toHaveTextContent(/saved for a different connection/i);
  });

  it("keeps a saved credential valid when its canonical destination is restored or unrelated fields change", () => {
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
              sections: ["summary"],
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText(/^URL \*$/), {
      target: { value: "http://other-tautulli.local:8181" },
    });
    expect(screen.getByText("Test connection")).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^URL \*$/), {
      target: { value: "HTTP://TAUTULLI.local:8181/" },
    });
    fireEvent.click(screen.getByLabelText("Active sessions"));
    fireEvent.change(screen.getByLabelText("Name *"), {
      target: { value: "Renamed Tautulli" },
    });
    fireEvent.change(screen.getByLabelText("Icon URL"), {
      target: { value: "https://example.test/icon.svg" },
    });
    fireEvent.change(screen.getByLabelText("Group"), { target: { value: "Media" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "large" } });
    fireEvent.change(screen.getByLabelText("Refresh interval (ms)"), {
      target: { value: "15000" },
    });

    expect(screen.queryByText(/re-enter.*credential/i)).not.toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeEnabled();
  });

  it("binds a saved qBittorrent password to both URL and username", () => {
    render(
      <ServiceForm
        service={{
          name: "qBittorrent",
          widget: {
            type: "qbittorrent-stats",
            config: {
              url: "http://qbit.local:8080",
              username: "admin",
              password: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Username *"), {
      target: { value: "other-admin" },
    });
    expect(screen.getByText(/re-enter.*credential/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Password *")).toBeRequired();
    expect(screen.getByText("Test connection")).toBeDisabled();
  });

  it("makes an originally optional saved token required when its scope changes", () => {
    render(
      <ServiceForm
        service={{
          name: "CPU",
          widget: {
            type: "netdata-cpu",
            config: {
              url: "http://netdata.local:19999",
              api_token: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Netdata URL *"), {
      target: { value: "http://other-netdata.local:19999" },
    });
    expect(screen.getByLabelText("API Token *")).toBeRequired();
  });

  it("clears an optional saved credential, including after its destination changes", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "CPU",
          widget: {
            type: "netdata-cpu",
            config: {
              url: "http://netdata.local:19999",
              api_token: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Netdata URL *"), {
      target: { value: "http://other-netdata.local:19999" },
    });
    expect(screen.getByLabelText("API Token *")).toBeRequired();
    expect(screen.getByText(/re-enter.*credential/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Clear saved credential"));

    expect(screen.queryByText(/re-enter.*credential/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("API Token")).not.toBeRequired();
    expect(screen.queryByText("Clear saved credential")).not.toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeEnabled();

    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        widget: expect.objectContaining({
          config: { url: "http://other-netdata.local:19999" },
        }),
      })
    );
  });

  it("does not offer to clear a required saved credential", () => {
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.queryByText("Clear saved credential")).not.toBeInTheDocument();
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

  it("posts the opaque saved-secret token without putting it in the password input", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ServiceForm
        service={{
          name: "Tautulli",
          widget: {
            type: "tautulli-activity",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.getByLabelText(/^API Key \*$/)).toHaveValue("");
    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() =>
      expect(screen.getByText("Connection OK")).toBeInTheDocument()
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      type: "tautulli-activity",
      config: {
        url: "http://tautulli.local:8181",
        api_key: SAVED_TAUTULLI_SECRET,
      },
    });
    expect(document.body.innerHTML).not.toContain(SAVED_TAUTULLI_SECRET_TOKEN);
  });

  it("validates an integration-backed tile with a saved credential reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Tautulli",
          integration: {
            type: "tautulli",
            config: {
              url: "http://tautulli.local:8181",
              api_key: SAVED_TAUTULLI_SECRET,
            },
          },
          widget: { type: "tautulli-activity", config: { sections: ["summary"] } },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.queryByText(/doesn.t match its schema/)).not.toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeEnabled();

    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() => expect(screen.getByText("Connection OK")).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      type: "tautulli-activity",
      config: {
        url: "http://tautulli.local:8181",
        api_key: SAVED_TAUTULLI_SECRET,
      },
    });
  });

  it("treats an opaque catalog integration as configured until replacement starts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const marker = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-opaque-config`;
    const opaqueConfig = { __kokpit_widget_config_reference__: marker };
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          name: "Tautulli",
          integration: { type: "tautulli", config: opaqueConfig },
          editorCatalogOnly: true,
          widget: { type: "tautulli-activity", config: {} },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.getByText(/Connection is configured but hidden/)).toBeInTheDocument();
    expect(screen.getByText(/remains outside the dashboard/)).toBeInTheDocument();
    expect(document.getElementById("sf-widget-url")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(marker);

    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() => expect(screen.getByText("Connection OK")).toBeInTheDocument());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ type: "tautulli-activity", config: opaqueConfig });

    fireEvent.change(document.getElementById("sf-widget-url")!, {
      target: { value: "http://replacement.local" },
    });
    expect(screen.getByText("Test connection")).toBeDisabled();
    expect(screen.getByText(/doesn.t match its schema/)).toBeInTheDocument();
  });

  it("keeps an opaque Service reference out of an ordinary tile config", () => {
    const onSave = vi.fn();
    const marker = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-service-config`;
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          integration: {
            type: "sonarr",
            config: { __kokpit_widget_config_reference__: marker },
          },
          widget: { type: "sonarr-calendar", config: { days: 7 } },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    expect(document.getElementById("sf-widget-days")).toHaveValue(7);
    fireEvent.submit(screen.getByLabelText("Name *").closest("form")!);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      widget: {
        type: "sonarr-calendar",
        config: { days: 7 },
        refresh_interval_ms: undefined,
      },
    }));
    expect(JSON.stringify(onSave.mock.calls[0][0])).not.toContain(marker);
  });

  it("keeps an opaque tile reference when changing a visible tile option", () => {
    const onSave = vi.fn();
    const marker = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-tile-config`;
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Tautulli",
          integration: {
            type: "tautulli",
            config: { url: "http://tautulli.local", api_key: "key" },
          },
          widget: {
            type: "tautulli-activity",
            config: { __kokpit_widget_config_reference__: marker },
          },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.click(screen.getByLabelText("Summary"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      widget: expect.objectContaining({
        config: {
          __kokpit_widget_config_reference__: marker,
          sections: ["sessions"],
        },
      }),
    }));
  });

  it("keeps an untouched opaque connection usable while editing tile options", async () => {
    const onSave = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const marker = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-service-config`;
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          integration: {
            type: "sonarr",
            config: { __kokpit_widget_config_reference__: marker },
          },
          widget: { type: "sonarr-calendar", config: { days: 7 } },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );

    fireEvent.change(screen.getByLabelText("Days ahead"), { target: { value: "8" } });
    expect(screen.getByText("Test connection")).toBeEnabled();
    fireEvent.click(screen.getByText("Test connection"));
    await waitFor(() => expect(screen.getByText("Connection OK")).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      type: "sonarr-calendar",
      config: { __kokpit_widget_config_reference__: marker },
    });

    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      editorIntegration: { command: "preserve" },
      widget: expect.objectContaining({ config: { days: 8 } }),
    }));
  });

  it("still validates visible tile options when the Service connection is opaque", () => {
    const marker = `${WIDGET_CONFIG_REFERENCE_PREFIX}signed-service-config`;
    render(
      <ServiceForm
        service={{
          id: "10000000-0000-4000-8000-000000000001",
          tileId: "20000000-0000-4000-8000-000000000001",
          name: "Sonarr",
          integration: {
            type: "sonarr",
            config: { __kokpit_widget_config_reference__: marker },
          },
          widget: { type: "sonarr-calendar", config: { days: 31 } },
        }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );

    expect(screen.getByText(/Connection is configured but hidden/)).toBeInTheDocument();
    expect(screen.getByText(/days:/)).toBeInTheDocument();
    expect(screen.getByText("Test connection")).toBeDisabled();
    expect(document.body.innerHTML).not.toContain(marker);
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

describe("ServiceForm – size", () => {
  it("defaults the size select to Auto and omits size from the payload", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={onSave} onClose={noop} />
    );
    expect(screen.getByLabelText("Size")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Plex" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].size).toBeUndefined();
  });

  it("pre-fills the size select from the service and includes it on save", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{ name: "Plex", size: "wide" }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Size")).toHaveValue("wide");
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "large" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Plex", size: "large" })
    );
  });

  it("disables sizes below the selected widget's minSize", () => {
    render(
      <ServiceForm service={null} existingGroups={[]} onSave={noop} onClose={noop} />
    );
    // Docker declares minSize "tall" (1×2): normal (1×1) and wide (2×1) can't
    // satisfy it, tall and large can.
    fireEvent.change(screen.getByLabelText("Tile type"), { target: { value: "docker" } });
    const sizeSelect = screen.getByLabelText("Size") as HTMLSelectElement;
    const optByValue = (value: string) =>
      Array.from(sizeSelect.querySelectorAll("option")).find(
        (o) => o.value === value
      )!;
    expect(optByValue("normal")).toBeDisabled();
    expect(optByValue("wide")).toBeDisabled();
    expect(optByValue("tall")).not.toBeDisabled();
    expect(optByValue("large")).not.toBeDisabled();
    expect(screen.getByText(/needs at least Tall/)).toBeInTheDocument();
  });

  it("migrates a legacy position-only service to an explicit size on save", () => {
    const onSave = vi.fn();
    render(
      <ServiceForm
        service={{
          name: "Legacy",
          // width 2 / height 1 → "wide"; no explicit size.
          position: { col: 1, row: 1, width: 2, height: 1 },
        }}
        existingGroups={[]}
        onSave={onSave}
        onClose={noop}
      />
    );
    // The select is seeded from the position mapping so the effective size
    // survives dropping the deprecated field.
    expect(screen.getByLabelText("Size")).toHaveValue("wide");
    fireEvent.click(screen.getByText("Save"));
    const saved = onSave.mock.calls[0][0];
    expect(saved.size).toBe("wide");
    // `position` is deprecated and intentionally dropped.
    expect(saved.position).toBeUndefined();
  });

  it("resets an incompatible explicit size to Auto when picking a widget with a larger minSize", () => {
    render(
      <ServiceForm
        service={{ name: "Box", size: "normal" }}
        existingGroups={[]}
        onSave={noop}
        onClose={noop}
      />
    );
    expect(screen.getByLabelText("Size")).toHaveValue("normal");
    fireEvent.change(screen.getByLabelText("Tile type"), { target: { value: "docker" } });
    expect(screen.getByLabelText("Size")).toHaveValue("");
  });
});
