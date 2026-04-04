import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ServiceForm from "@/components/ServiceForm";

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
