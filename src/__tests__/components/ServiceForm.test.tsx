import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ServiceForm from "@/components/ServiceForm";
import "@/integrations";
import { getWidget, getWidgetsWithServiceEditorPreset } from "@/widgets";

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
const SAVED_TAUTULLI_SECRET =
  '__KOKPIT_WIDGET_SECRET_REF__:["Tautulli","tautulli-activity","api_key"]';

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
      widget: {
        type: "tautulli-activity",
        config: {
          url: "http://tautulli.local:8181",
          api_key: "secret",
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
      config: {
        url: "http://tautulli.local:8181",
        api_key: "secret",
      },
      refresh_interval_ms: undefined,
    });
    const parsed = getWidget("tautulli-activity")!.configSchema.safeParse(
      saved.widget!.config
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
    expect(document.body.innerHTML).not.toContain(SAVED_TAUTULLI_SECRET);
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
    expect(document.body.innerHTML).not.toContain(SAVED_TAUTULLI_SECRET);
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
